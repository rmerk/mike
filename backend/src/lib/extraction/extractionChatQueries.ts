import type { createServerSupabase } from "../supabase";

type Db = ReturnType<typeof createServerSupabase>;

export type ChatEventRow = {
    id: string;
    event_date: string | null;
    encounter_type: string | null;
    narrative: string | null;
    source_page: number;
    source_bbox: { x: number; y: number; w: number; h: number };
    privacy_class?: string;
};

export type ExtractionQueryResult<T> =
    | { ok: true; events: T[] }
    | { ok: false; reason: "no_extraction_run" }
    | { ok: false; reason: "query_failed"; error: string };

// Only completed runs are exposed to chat tools. A pending/running/failed run
// would otherwise look like ground truth for a partially-extracted document.
async function latestCompleteRunIdForDocument(
    db: Db,
    documentId: string,
): Promise<string | null> {
    const { data } = await db
        .from("document_extractions")
        .select("id")
        .eq("document_id", documentId)
        .eq("status", "complete")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    return (data?.id as string | undefined) ?? null;
}

export async function listEventsForChat(
    db: Db,
    documentId: string,
    opts: { limit?: number; offset?: number; encounter_type?: string },
): Promise<ExtractionQueryResult<ChatEventRow>> {
    const runId = await latestCompleteRunIdForDocument(db, documentId);
    if (!runId) return { ok: false, reason: "no_extraction_run" };
    let q = db
        .from("document_events")
        .select(
            "id, event_date, encounter_type, narrative, source_page, source_bbox, privacy_class",
        )
        .eq("document_id", documentId)
        .eq("extraction_run_id", runId)
        .neq("privacy_class", "peer_review_145_64");
    if (opts.encounter_type) {
        q = q.eq("encounter_type", opts.encounter_type);
    }
    const lim = Math.min(opts.limit ?? 50, 200);
    const off = opts.offset ?? 0;
    const { data, error } = await q
        .order("source_page", { ascending: true })
        .range(off, off + lim - 1);
    if (error) return { ok: false, reason: "query_failed", error: error.message };
    return { ok: true, events: (data ?? []) as ChatEventRow[] };
}

export async function listEventsInDateRange(
    db: Db,
    documentId: string,
    fromIso: string,
    toIso: string,
    encounterType?: string,
): Promise<ExtractionQueryResult<ChatEventRow>> {
    const runId = await latestCompleteRunIdForDocument(db, documentId);
    if (!runId) return { ok: false, reason: "no_extraction_run" };
    let q = db
        .from("document_events")
        .select(
            "id, event_date, encounter_type, narrative, source_page, source_bbox",
        )
        .eq("document_id", documentId)
        .eq("extraction_run_id", runId)
        .neq("privacy_class", "peer_review_145_64")
        .gte("event_date", fromIso)
        .lte("event_date", toIso);
    if (encounterType) q = q.eq("encounter_type", encounterType);
    const { data, error } = await q.order("event_date", { ascending: true });
    if (error) return { ok: false, reason: "query_failed", error: error.message };
    return { ok: true, events: (data ?? []) as ChatEventRow[] };
}
