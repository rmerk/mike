import type { createServerSupabase } from "../supabase";

type Db = ReturnType<typeof createServerSupabase>;

// Coordinates are PDF user space at scale 1, origin bottom-left.
export type SourceBbox = { x: number; y: number; w: number; h: number };

// Mirrors the SQL check on document_events.encounter_type.
export type EncounterType =
    | "admission"
    | "ed"
    | "clinic"
    | "lab"
    | "imaging"
    | "op"
    | "nursing"
    | "note";

// Mirrors the SQL check on document_events.privacy_class. `peer_review_145_64`
// is intentionally excluded: extraction halts before persisting any events
// when peer-review markers are detected (see medMalExtractor.ts peer-review
// gate). Letting that value type-check would defeat that invariant.
export type DocumentEventPrivacyClass =
    | "standard"
    | "mental_health_144_293"
    | "substance_abuse_42_cfr_part_2";

export type DocumentEventInsert = {
    document_id: string;
    extraction_run_id: string;
    event_date?: string | null;
    event_time?: string | null;
    event_date_text?: string | null;
    provider?: string | null;
    provider_role?: string | null;
    episode_of_care?: string | null;
    encounter_type?: EncounterType | null;
    privacy_class?: DocumentEventPrivacyClass;
    key_date_role?: string | null;
    dx_codes?: string[] | null;
    medications?: unknown;
    vitals?: unknown;
    procedures?: string[] | null;
    narrative?: string | null;
    source_page: number;
    source_bbox: SourceBbox;
};

const ENCOUNTER_TYPES: ReadonlySet<EncounterType> = new Set([
    "admission",
    "ed",
    "clinic",
    "lab",
    "imaging",
    "op",
    "nursing",
    "note",
]);

export function coerceEncounterType(value: unknown): EncounterType | null {
    if (typeof value !== "string") return null;
    return ENCOUNTER_TYPES.has(value as EncounterType)
        ? (value as EncounterType)
        : null;
}

const SAFE_PRIVACY_CLASSES: ReadonlySet<DocumentEventPrivacyClass> = new Set([
    "standard",
    "mental_health_144_293",
]);

// LLM-supplied privacy class is restricted to the values the model is
// instructed to use. `substance_abuse_42_cfr_part_2` is reserved for
// server-side classification (not implemented yet) and never accepted from
// model output. Anything else collapses to "standard".
export function coerceLlmPrivacyClass(
    value: unknown,
): DocumentEventPrivacyClass {
    if (typeof value !== "string") return "standard";
    return SAFE_PRIVACY_CLASSES.has(value as DocumentEventPrivacyClass)
        ? (value as DocumentEventPrivacyClass)
        : "standard";
}

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
