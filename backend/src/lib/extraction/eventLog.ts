import type { createServerSupabase } from "../supabase";

type Db = ReturnType<typeof createServerSupabase>;

export type SourceBbox = { x: number; y: number; w: number; h: number };

export type DocumentEventInsert = {
    document_id: string;
    extraction_run_id: string;
    event_date?: string | null;
    event_time?: string | null;
    event_date_text?: string | null;
    provider?: string | null;
    provider_role?: string | null;
    episode_of_care?: string | null;
    encounter_type?: string | null;
    privacy_class?: string;
    key_date_role?: string | null;
    dx_codes?: string[] | null;
    medications?: unknown;
    vitals?: unknown;
    procedures?: string[] | null;
    narrative?: string | null;
    source_page: number;
    source_bbox: SourceBbox;
};

export function assertValidCitation(row: DocumentEventInsert): void {
    if (
        typeof row.source_page !== "number" ||
        !Number.isFinite(row.source_page) ||
        row.source_page < 1
    ) {
        throw new Error("document_events: invalid source_page");
    }
    const b = row.source_bbox;
    if (
        !b ||
        typeof b.x !== "number" ||
        typeof b.y !== "number" ||
        typeof b.w !== "number" ||
        typeof b.h !== "number" ||
        !Number.isFinite(b.x + b.y + b.w + b.h) ||
        b.w <= 0 ||
        b.h <= 0
    ) {
        throw new Error("document_events: invalid source_bbox");
    }
}

export async function insertDocumentEvents(
    db: Db,
    rows: DocumentEventInsert[],
): Promise<void> {
    for (const r of rows) {
        assertValidCitation(r);
    }
    if (rows.length === 0) return;
    const { error } = await db.from("document_events").insert(
        rows.map((r) => ({
            document_id: r.document_id,
            extraction_run_id: r.extraction_run_id,
            event_date: r.event_date ?? null,
            event_time: r.event_time ?? null,
            event_date_text: r.event_date_text ?? null,
            provider: r.provider ?? null,
            provider_role: r.provider_role ?? null,
            episode_of_care: r.episode_of_care ?? null,
            encounter_type: r.encounter_type ?? null,
            privacy_class: r.privacy_class ?? "standard",
            key_date_role: r.key_date_role ?? null,
            dx_codes: r.dx_codes ?? null,
            medications: r.medications ?? null,
            vitals: r.vitals ?? null,
            procedures: r.procedures ?? null,
            narrative: r.narrative ?? null,
            source_page: r.source_page,
            source_bbox: r.source_bbox,
        })),
    );
    if (error) throw new Error(error.message);
}
