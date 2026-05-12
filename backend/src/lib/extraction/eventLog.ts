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

// Mulder-rule medication shape (per Reinhardt). Only `name` is required so the
// row can still represent a medication mentioned in a chart entry that lacks
// full administration metadata; downstream consumers (MAR view, red-flag
// rules) treat the optional fields as best-effort.
export type MedicationEntry = {
    name: string;
    dose?: string | null;
    route?: string | null;
    frequency?: string | null;
    ordered_by?: string | null;
    administered_by?: string | null;
    ordered_at?: string | null;
    administered_at?: string | null;
    indication?: string | null;
    allergy_conflict_flag?: boolean | null;
    weight_based_dose_check_passed?: boolean | null;
};

// Vital signs captured on a single event. Strings used for `bp` because the
// canonical chart format is "120/80"; everything else numeric. All optional —
// not every encounter captures the full set.
export type VitalsEntry = {
    bp?: string | null;
    hr?: number | null;
    rr?: number | null;
    spo2?: number | null;
    temp_c?: number | null;
    map?: number | null;
    urine_output_ml?: number | null;
};

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
    medications?: MedicationEntry[] | null;
    vitals?: VitalsEntry | null;
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

function coerceNullableString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function coerceNullableNumber(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return value;
}

function coerceNullableBoolean(value: unknown): boolean | null {
    return typeof value === "boolean" ? value : null;
}

// Drop entries without a `name`. Extra/unknown keys are silently ignored so
// the LLM emitting a superset shape does not poison the row.
export function coerceMedications(value: unknown): MedicationEntry[] | null {
    if (!Array.isArray(value)) return null;
    const out: MedicationEntry[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== "object") continue;
        const o = raw as Record<string, unknown>;
        const name = coerceNullableString(o.name);
        if (!name) continue;
        out.push({
            name,
            dose: coerceNullableString(o.dose),
            route: coerceNullableString(o.route),
            frequency: coerceNullableString(o.frequency),
            ordered_by: coerceNullableString(o.ordered_by),
            administered_by: coerceNullableString(o.administered_by),
            ordered_at: coerceNullableString(o.ordered_at),
            administered_at: coerceNullableString(o.administered_at),
            indication: coerceNullableString(o.indication),
            allergy_conflict_flag: coerceNullableBoolean(o.allergy_conflict_flag),
            weight_based_dose_check_passed: coerceNullableBoolean(
                o.weight_based_dose_check_passed,
            ),
        });
    }
    return out.length > 0 ? out : null;
}

// Returns null if zero recognized fields, so the failure-to-monitor rule
// continues to fire on truly empty vitals rather than seeing an empty object.
export function coerceVitals(value: unknown): VitalsEntry | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const o = value as Record<string, unknown>;
    const out: VitalsEntry = {
        bp: coerceNullableString(o.bp),
        hr: coerceNullableNumber(o.hr),
        rr: coerceNullableNumber(o.rr),
        spo2: coerceNullableNumber(o.spo2),
        temp_c: coerceNullableNumber(o.temp_c),
        map: coerceNullableNumber(o.map),
        urine_output_ml: coerceNullableNumber(o.urine_output_ml),
    };
    const hasAny =
        out.bp !== null ||
        out.hr !== null ||
        out.rr !== null ||
        out.spo2 !== null ||
        out.temp_c !== null ||
        out.map !== null ||
        out.urine_output_ml !== null;
    return hasAny ? out : null;
}

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
