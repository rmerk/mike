import type { createServerSupabase } from "../supabase";

type Db = ReturnType<typeof createServerSupabase>;

export async function latestRunIdForDocument(
    db: Db,
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

export async function listEventsForChat(
    db: Db,
    documentId: string,
    opts: { limit?: number; offset?: number; encounter_type?: string },
): Promise<unknown[]> {
    const runId = await latestRunIdForDocument(db, documentId);
    if (!runId) return [];
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
    if (error) throw new Error(error.message);
    return data ?? [];
}

export async function listEventsInDateRange(
    db: Db,
    documentId: string,
    fromIso: string,
    toIso: string,
    encounterType?: string,
): Promise<unknown[]> {
    const runId = await latestRunIdForDocument(db, documentId);
    if (!runId) return [];
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
    if (error) throw new Error(error.message);
    return data ?? [];
}
