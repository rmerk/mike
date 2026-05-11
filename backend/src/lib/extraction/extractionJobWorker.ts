import { createServerSupabase } from "../supabase";
import { getUserApiKeys } from "../userSettings";
import { executeMedMalExtraction } from "./medMalExtractor";
import { extractionUsesDbQueue } from "./extractionQueueMode";

type Db = ReturnType<typeof createServerSupabase>;

// 500ms floor prevents misconfiguration from hot-looping the
// claim_extraction_async_job RPC against the database.
const POLL_MS = (() => {
    const raw = process.env.EXTRACTION_JOB_POLL_MS?.trim();
    if (!raw) return 2000;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 500 ? n : 2000;
})();

// Orphaned-run reaper: an extraction that has been `running` for longer than
// this is assumed dead (process recycle, OOM, container restart), so we flip
// it to `failed` to release the partial unique index that otherwise blocks
// retries. Default 20 minutes; override with EXTRACTION_RUN_TIMEOUT_MS.
const RUN_TIMEOUT_MS = (() => {
    const raw = process.env.EXTRACTION_RUN_TIMEOUT_MS?.trim();
    const fallback = 20 * 60 * 1000;
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 60 * 1000 ? n : fallback;
})();

// Run the reaper at most this often (independent of POLL_MS).
const REAP_INTERVAL_MS = 60 * 1000;

type ClaimedJob = {
    id: string;
    extraction_run_id: string;
    document_id: string;
    user_id: string;
    pdf_storage_path: string;
};

type JobStatus = "pending" | "processing" | "completed" | "failed";

async function patchRunFailed(
    db: Db,
    runId: string,
    error: string,
): Promise<void> {
    const { error: rpcErr } = await db.rpc("patch_document_extraction_run", {
        p_run_id: runId,
        p_patch: {
            status: "failed",
            error: error.slice(0, 2000),
            completed_at: new Date().toISOString(),
        },
    });
    if (rpcErr) {
        console.error("[extraction/worker] patch_run_failed", {
            runId,
            error: rpcErr,
        });
    }
}

async function updateJobStatus(
    db: Db,
    jobId: string,
    status: JobStatus,
    lastError: string | null,
): Promise<void> {
    const { error } = await db
        .from("extraction_async_jobs")
        .update({ status, last_error: lastError })
        .eq("id", jobId);
    if (error) {
        console.error("[extraction/worker] update_job_status", {
            jobId,
            status,
            error,
        });
    }
}

async function processOneJob(db: Db, job: ClaimedJob): Promise<void> {
    try {
        const apiKeys = await getUserApiKeys(job.user_id, db);
        const result = await executeMedMalExtraction({
            db,
            documentId: job.document_id,
            runId: job.extraction_run_id,
            userId: job.user_id,
            pdfStoragePath: job.pdf_storage_path,
            apiKeys,
        });
        await updateJobStatus(
            db,
            job.id,
            result.ok ? "completed" : "failed",
            result.ok ? null : result.error.slice(0, 2000),
        );
    } catch (e) {
        // Reaching here means executeMedMalExtraction threw before it could
        // mark the run failed (e.g. getUserApiKeys threw, or the executor
        // never entered its own try). Reconcile both tables so the UI poller
        // sees a terminal state and the partial unique index releases.
        const msg = e instanceof Error ? e.message : String(e);
        await patchRunFailed(db, job.extraction_run_id, msg);
        await updateJobStatus(db, job.id, "failed", msg.slice(0, 2000));
    }
}

export async function reapStaleRuns(db: Db): Promise<number> {
    const cutoff = new Date(Date.now() - RUN_TIMEOUT_MS).toISOString();
    const { data, error } = await db
        .from("document_extractions")
        .update({
            status: "failed",
            error: "Run timed out (process likely recycled or crashed).",
            completed_at: new Date().toISOString(),
        })
        .eq("status", "running")
        .lt("started_at", cutoff)
        .select("id");
    if (error) {
        console.error("[extraction/reaper]", error);
        return 0;
    }
    const reaped = data?.length ?? 0;
    if (reaped > 0) {
        console.warn("[extraction/reaper] reaped stale runs", {
            count: reaped,
            ids: data?.map((r) => r.id),
        });
    }
    return reaped;
}

export type ExtractionWorkerHandles = {
    pollTimer: NodeJS.Timeout | null;
    reapTimer: NodeJS.Timeout;
};

// Started in-process by backend/src/index.ts on boot. The job poller only
// runs in queue mode, but the orphan reaper runs unconditionally because
// inline (`setImmediate`) runs can also be orphaned by a process recycle.
// In a multi-instance deployment, every instance starts both; the
// claim_extraction_async_job RPC uses FOR UPDATE SKIP LOCKED so workers
// naturally fan out, and concurrent reaper UPDATEs are idempotent.
export function startExtractionJobWorker(): ExtractionWorkerHandles {
    const reapTick = async () => {
        const db = createServerSupabase();
        await reapStaleRuns(db);
    };
    const reapTimer = setInterval(() => void reapTick(), REAP_INTERVAL_MS);
    void reapTick();

    if (!extractionUsesDbQueue()) return { pollTimer: null, reapTimer };

    let inFlight = false;
    const tick = async () => {
        if (inFlight) return; // skip overlapping ticks; previous job still running
        inFlight = true;
        try {
            const db = createServerSupabase();
            const { data, error } = await db.rpc("claim_extraction_async_job");
            if (error) {
                console.error("[extraction/worker] claim", error);
                return;
            }
            const rows = (data ?? []) as ClaimedJob[];
            const job = rows[0]; // RPC claims at most one row (LIMIT 1)
            if (!job) return;
            await processOneJob(db, job);
        } finally {
            inFlight = false;
        }
    };
    const pollTimer = setInterval(() => void tick(), POLL_MS);
    void tick();
    return { pollTimer, reapTimer };
}
