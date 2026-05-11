import { createServerSupabase } from "../supabase";
import { getUserApiKeys } from "../userSettings";
import { executeMedMalExtraction } from "./medMalExtractor";
import { extractionUsesDbQueue } from "./extractionQueueMode";

const POLL_MS = (() => {
    const raw = process.env.EXTRACTION_JOB_POLL_MS?.trim();
    if (!raw) return 2000;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 500 ? n : 2000;
})();

/**
 * Polls `extraction_async_jobs` and runs {@link executeMedMalExtraction} for claimed rows.
 * Enable with `EXTRACTION_ASYNC_MODE=queue` (durable across serverless instances; run a dedicated worker).
 */
export function startExtractionJobWorker(): void {
    if (!extractionUsesDbQueue()) return;
    const tick = async () => {
        const db = createServerSupabase();
        const { data, error } = await db.rpc("claim_extraction_async_job");
        if (error) {
            console.error("[extraction/worker] claim", error);
            return;
        }
        const rows = (data ?? []) as Array<{
            id: string;
            extraction_run_id: string;
            document_id: string;
            user_id: string;
            pdf_storage_path: string;
        }>;
        const job = rows[0];
        if (!job) return;
        try {
            const apiKeys = await getUserApiKeys(job.user_id, db);
            const result = await executeMedMalExtraction({
                db,
                documentId: job.document_id,
                documentVersionId: "",
                runId: job.extraction_run_id,
                userId: job.user_id,
                pdfStoragePath: job.pdf_storage_path,
                apiKeys,
            });
            await db
                .from("extraction_async_jobs")
                .update({
                    status: result.ok ? "completed" : "failed",
                    last_error: result.ok ? null : result.error.slice(0, 2000),
                })
                .eq("id", job.id);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await db
                .from("extraction_async_jobs")
                .update({
                    status: "failed",
                    last_error: msg.slice(0, 2000),
                })
                .eq("id", job.id);
        }
    };
    setInterval(() => void tick(), POLL_MS);
    void tick();
}
