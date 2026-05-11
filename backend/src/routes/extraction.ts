import { Router, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { createServerSupabase } from "../lib/supabase";
import { ensureDocAccess } from "../lib/access";
import { loadActiveVersion } from "../lib/documentVersions";
import {
    executeMedMalExtraction,
    resolveExtractionModel,
    resolvePdfPathForVersion,
} from "../lib/extraction/medMalExtractor";
import { extractionUsesDbQueue } from "../lib/extraction/extractionQueueMode";
import type { UserApiKeys } from "../lib/llm/types";
import { getUserApiKeys } from "../lib/userSettings";

export const extractionRouter = Router();

// Postgres unique-violation SQLSTATE; fires when the partial unique index
// `document_extractions_one_running_per_document` rejects a concurrent run
// insert (see migrations/0002_document_extraction.sql).
const PG_UNIQUE_VIOLATION = "23505";

type LoadedDoc = {
    id: string;
    user_id: string;
    project_id: string | null;
    file_type: string | null;
    filename: string;
};

type DocumentAccessResult =
    | { ok: true; doc: LoadedDoc }
    | { ok: false; status: 403 | 404 };

function respondUnlessDocLoaded(
    loaded: DocumentAccessResult,
    res: Response,
): loaded is { ok: true; doc: LoadedDoc } {
    if (loaded.ok) return true;
    const detail = loaded.status === 403 ? "Forbidden" : "Not found";
    res.status(loaded.status).json({ detail });
    return false;
}

async function loadDocumentForAccess(
    documentId: string,
    userId: string,
    userEmail: string | undefined,
    db: ReturnType<typeof createServerSupabase>,
): Promise<DocumentAccessResult> {
    const { data: doc } = await db
        .from("documents")
        .select("id, user_id, project_id, file_type, filename")
        .eq("id", documentId)
        .single();
    if (!doc) return { ok: false, status: 404 };
    const access = await ensureDocAccess(
        {
            user_id: doc.user_id as string,
            project_id: doc.project_id as string | null,
        },
        userId,
        userEmail,
        db,
    );
    if (!access.ok) return { ok: false, status: 403 };
    return {
        ok: true,
        doc: {
            id: doc.id as string,
            user_id: doc.user_id as string,
            project_id: (doc.project_id as string | null) ?? null,
            file_type: (doc.file_type as string | null) ?? null,
            filename: (doc.filename as string | null) ?? "",
        },
    };
}

async function latestExtractionRunId(
    db: ReturnType<typeof createServerSupabase>,
    documentId: string,
): Promise<string | null> {
    const { data } = await db
        .from("document_extractions")
        .select("id")
        .eq("document_id", documentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    return (data?.id as string | undefined) ?? null;
}

// Extraction runs only for documents in med-mal-case projects
// (projects.template_id === "med-mal-case").
async function assertMedMalCaseProject(
    db: ReturnType<typeof createServerSupabase>,
    projectId: string | null,
): Promise<{ ok: true } | { ok: false; detail: string }> {
    if (!projectId) {
        return {
            ok: false,
            detail:
                "Structured extraction is only available for documents in med-mal-case projects",
        };
    }
    const { data: proj } = await db
        .from("projects")
        .select("template_id")
        .eq("id", projectId)
        .maybeSingle();
    if (proj?.template_id !== "med-mal-case") {
        return {
            ok: false,
            detail:
                "Structured extraction is only available for med-mal-case projects",
        };
    }
    return { ok: true };
}

type RunResolution =
    | { ok: true; runId: string }
    | { ok: false; reason: "no_run" | "run_not_for_document" };

async function resolveRunIdForDocument(
    db: ReturnType<typeof createServerSupabase>,
    documentId: string,
    runIdParam: string | undefined,
): Promise<RunResolution> {
    if (runIdParam) {
        const { data } = await db
            .from("document_extractions")
            .select("id")
            .eq("id", runIdParam)
            .eq("document_id", documentId)
            .maybeSingle();
        if (!data)
            return { ok: false, reason: "run_not_for_document" };
        return { ok: true, runId: data.id as string };
    }
    const runId = await latestExtractionRunId(db, documentId);
    if (!runId) return { ok: false, reason: "no_run" };
    return { ok: true, runId };
}

extractionRouter.post("/:documentId/run", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId } = req.params;
    const db = createServerSupabase();
    const loaded = await loadDocumentForAccess(
        documentId,
        userId,
        userEmail,
        db,
    );
    if (!respondUnlessDocLoaded(loaded, res)) return;

    const doc = loaded.doc;
    const fileType = (doc.file_type ?? "").toLowerCase();
    const filename = (doc.filename ?? "").toLowerCase();
    const isPdf =
        fileType.includes("pdf") ||
        filename.endsWith(".pdf") ||
        fileType === "application/pdf";
    if (!isPdf) {
        return void res
            .status(422)
            .json({ detail: "Extraction requires a PDF document" });
    }

    const projectOk = await assertMedMalCaseProject(db, doc.project_id);
    if (!projectOk.ok) {
        return void res.status(422).json({ detail: projectOk.detail });
    }

    const version = await loadActiveVersion(documentId, db);
    if (!version) {
        return void res
            .status(422)
            .json({ detail: "No active document version" });
    }
    const pdfPath = await resolvePdfPathForVersion(version);
    if (!pdfPath) {
        return void res
            .status(422)
            .json({ detail: "Active version has no PDF bytes" });
    }

    let model: string;
    try {
        model = resolveExtractionModel();
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return void res.status(500).json({ detail: msg });
    }
    const { data: run, error } = await db
        .from("document_extractions")
        .insert({
            document_id: documentId,
            document_version_id: version.id,
            model,
            status: "running",
            pages_total: null,
            pages_complete: 0,
            started_at: new Date().toISOString(),
        })
        .select("id")
        .single();

    if (error) {
        if (error.code === PG_UNIQUE_VIOLATION) {
            return void res.status(409).json({
                detail: "An extraction is already running for this document",
                code: "extraction_conflict",
            });
        }
        console.error("[extraction/run] insert", error);
        return void res.status(500).json({ detail: "Failed to start extraction" });
    }

    const runId = run!.id as string;
    const apiKeys: UserApiKeys = await getUserApiKeys(userId, db);

    if (extractionUsesDbQueue()) {
        const { error: jobErr } = await db.from("extraction_async_jobs").insert({
            extraction_run_id: runId,
            document_id: documentId,
            user_id: userId,
            pdf_storage_path: pdfPath,
        });
        if (jobErr) {
            console.error("[extraction/run] enqueue", jobErr);
            await db
                .from("document_extractions")
                .update({
                    status: "failed",
                    error: "Failed to enqueue extraction job",
                    completed_at: new Date().toISOString(),
                })
                .eq("id", runId);
            return void res
                .status(500)
                .json({ detail: "Failed to enqueue extraction" });
        }
    } else {
        setImmediate(() => {
            void executeMedMalExtraction({
                db,
                documentId,
                runId,
                userId,
                pdfStoragePath: pdfPath,
                apiKeys,
            })
                .then((r) => {
                    if (!r.ok) console.error("[extraction/async]", r.error);
                })
                .catch((e) => {
                    // executeMedMalExtraction's own catch normally marks the
                    // run failed; this guard only fires if a thrown error
                    // escaped that try/catch (e.g. a refactor accident).
                    const msg = e instanceof Error ? e.message : String(e);
                    console.error("[extraction/async/unhandled]", msg);
                });
        });
    }

    return void res.status(202).json({ run_id: runId, status: "running" });
});

extractionRouter.get("/:documentId/status", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId } = req.params;
    const db = createServerSupabase();
    const loaded = await loadDocumentForAccess(
        documentId,
        userId,
        userEmail,
        db,
    );
    if (!respondUnlessDocLoaded(loaded, res)) return;

    const { data } = await db
        .from("document_extractions")
        .select(
            "id, status, pages_total, pages_complete, status_seq, updated_at, error, started_at, completed_at",
        )
        .eq("document_id", documentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!data)
        return void res.status(404).json({ detail: "No extraction for document" });
    return void res.json({
        run_id: data.id,
        status: data.status,
        pages_total: data.pages_total,
        pages_complete: data.pages_complete,
        seq: data.status_seq,
        updated_at: data.updated_at,
        error: data.error,
        started_at: data.started_at,
        completed_at: data.completed_at,
    });
});

extractionRouter.get("/:documentId/events", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId } = req.params;
    const runIdParam = req.query.run_id as string | undefined;
    const db = createServerSupabase();
    const loaded = await loadDocumentForAccess(
        documentId,
        userId,
        userEmail,
        db,
    );
    if (!respondUnlessDocLoaded(loaded, res)) return;

    const resolved = await resolveRunIdForDocument(
        db,
        documentId,
        runIdParam,
    );
    if (!resolved.ok) {
        const detail =
            resolved.reason === "run_not_for_document"
                ? "Extraction run not found for this document"
                : "No extraction run";
        return void res.status(404).json({ detail });
    }
    const runId = resolved.runId;

    const { data, error } = await db
        .from("document_events")
        .select("*")
        .eq("document_id", documentId)
        .eq("extraction_run_id", runId)
        .neq("privacy_class", "peer_review_145_64")
        .order("source_page", { ascending: true });
    if (error) {
        console.error("[extraction/events]", error);
        return void res.status(500).json({ detail: "Query failed" });
    }
    return void res.json({ run_id: runId, events: data ?? [] });
});

extractionRouter.get("/:documentId/red-flags", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { documentId } = req.params;
    const runIdParam = req.query.run_id as string | undefined;
    const db = createServerSupabase();
    const loaded = await loadDocumentForAccess(
        documentId,
        userId,
        userEmail,
        db,
    );
    if (!respondUnlessDocLoaded(loaded, res)) return;

    const resolved = await resolveRunIdForDocument(
        db,
        documentId,
        runIdParam,
    );
    if (!resolved.ok) {
        const detail =
            resolved.reason === "run_not_for_document"
                ? "Extraction run not found for this document"
                : "No extraction run";
        return void res.status(404).json({ detail });
    }
    const runId = resolved.runId;

    const { data, error } = await db
        .from("document_red_flags")
        .select("*")
        .eq("document_id", documentId)
        .eq("extraction_run_id", runId)
        .order("created_at", { ascending: true });
    if (error) {
        console.error("[extraction/red-flags]", error);
        return void res.status(500).json({ detail: "Query failed" });
    }
    return void res.json({ run_id: runId, red_flags: data ?? [] });
});
