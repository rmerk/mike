// Deterministic red-flag rules over extracted document_events. Each rule is a
// pure function that emits at most one RedFlagInsert; runDeterministicRedFlags
// dedupes by rule_id.

export type DocumentEventRow = {
    id: string;
    document_id: string;
    event_date: string | null;
    encounter_type: string | null;
    narrative: string | null;
    dx_codes: string[] | null;
    procedures: string[] | null;
    vitals: unknown;
    source_page: number;
};

export type RedFlagInsert = {
    rule_id: string;
    supports_element: "duty" | "breach" | "causation" | "damages";
    severity: "low" | "medium" | "high";
    summary: string;
    supporting_event_ids: string[];
};

function narrativeLower(e: DocumentEventRow): string {
    return (e.narrative ?? "").toLowerCase();
}

function ruleDelayedDx(events: DocumentEventRow[]): RedFlagInsert | null {
    const withDx = events.filter((e) => e.dx_codes && e.dx_codes.length > 0);
    const symptomish = events.filter((e) => {
        const n = narrativeLower(e);
        return (
            (n.includes("pain") ||
                n.includes("fever") ||
                n.includes("sob") ||
                n.includes("shortness of breath")) &&
            (!e.dx_codes || e.dx_codes.length === 0)
        );
    });
    for (const s of symptomish) {
        for (const d of withDx) {
            if (s.id === d.id) continue;
            if (s.event_date && d.event_date && d.event_date > s.event_date) {
                return {
                    rule_id: "delayed_dx",
                    supports_element: "breach",
                    severity: "medium",
                    summary: `Possible delayed diagnosis: symptoms dated ${s.event_date} (page ${s.source_page}) precede diagnosis dated ${d.event_date} (page ${d.source_page}).`,
                    supporting_event_ids: [s.id, d.id],
                };
            }
        }
    }
    return null;
}

function ruleMedError(events: DocumentEventRow[]): RedFlagInsert | null {
    const re = /overdose|wrong dose|medication error|mg\/kg|tenfold/i;
    for (const e of events) {
        if (re.test(e.narrative ?? "")) {
            return {
                rule_id: "med_error",
                supports_element: "breach",
                severity: "high",
                summary: `Medication-related language on page ${e.source_page}.`,
                supporting_event_ids: [e.id],
            };
        }
    }
    return null;
}

function ruleRetainedForeignObject(
    events: DocumentEventRow[],
): RedFlagInsert | null {
    for (const e of events) {
        const n = narrativeLower(e);
        const procs = (e.procedures ?? []).join(" ").toLowerCase();
        if (
            (n.includes("retained") && n.includes("foreign")) ||
            (n.includes("sponge") && n.includes("count")) ||
            (procs.includes("hardware") && n.includes("unaccounted"))
        ) {
            return {
                rule_id: "retained_foreign_object",
                supports_element: "breach",
                severity: "high",
                summary: `Possible retained foreign object / count issue (page ${e.source_page}).`,
                supporting_event_ids: [e.id],
            };
        }
    }
    return null;
}

function ruleFailureToMonitor(events: DocumentEventRow[]): RedFlagInsert | null {
    for (const e of events) {
        if (
            (e.encounter_type === "admission" ||
                e.encounter_type === "ed" ||
                e.encounter_type === "op") &&
            (e.vitals == null ||
                (typeof e.vitals === "object" &&
                    e.vitals !== null &&
                    Object.keys(e.vitals as object).length === 0))
        ) {
            const n = narrativeLower(e);
            if (n.includes("icu") || n.includes("post-op") || n.includes("pacu")) {
                return {
                    rule_id: "failure_to_monitor",
                    supports_element: "breach",
                    severity: "medium",
                    summary: `High-acuity context with sparse vitals on page ${e.source_page}.`,
                    supporting_event_ids: [e.id],
                };
            }
        }
    }
    return null;
}

function ruleInformedConsentGap(events: DocumentEventRow[]): RedFlagInsert | null {
    const hasConsent = events.some((e) =>
        narrativeLower(e).includes("consent"),
    );
    const proc = events.find(
        (e) =>
            e.encounter_type === "op" ||
            narrativeLower(e).includes("procedure"),
    );
    if (proc && !hasConsent) {
        return {
            rule_id: "informed_consent_gap",
            supports_element: "duty",
            severity: "low",
            summary: `Operative/procedure event on page ${proc.source_page} with no consent event in the extracted log.`,
            supporting_event_ids: [proc.id],
        };
    }
    return null;
}

function ruleTemporalAnchorCausation(
    events: DocumentEventRow[],
): RedFlagInsert | null {
    const adverse = events.filter((e) => {
        const n = narrativeLower(e);
        return (
            n.includes("arrest") ||
            n.includes("stroke") ||
            n.includes("death") ||
            n.includes("exsanguination") ||
            n.includes("return to or") ||
            n.includes("unexpected icu")
        );
    });
    const breachish = events.filter((e) => {
        const n = narrativeLower(e);
        return (
            n.includes("delayed") ||
            n.includes("overdose") ||
            n.includes("failure to monitor")
        );
    });
    for (const a of adverse) {
        for (const b of breachish) {
            if (a.id === b.id) continue;
            return {
                rule_id: "temporal_anchor_causation",
                supports_element: "causation",
                severity: "medium",
                summary: `Adverse outcome language near other breach-candidate language (pages ${b.source_page} and ${a.source_page}); temporal anchor only.`,
                supporting_event_ids: [b.id, a.id],
            };
        }
    }
    return null;
}

const RULES: ((e: DocumentEventRow[]) => RedFlagInsert | null)[] = [
    ruleDelayedDx,
    ruleMedError,
    ruleRetainedForeignObject,
    ruleFailureToMonitor,
    ruleInformedConsentGap,
    ruleTemporalAnchorCausation,
];

export function runDeterministicRedFlags(
    events: DocumentEventRow[],
): RedFlagInsert[] {
    const out: RedFlagInsert[] = [];
    const seen = new Set<string>();
    for (const rule of RULES) {
        const r = rule(events);
        if (r && !seen.has(r.rule_id)) {
            seen.add(r.rule_id);
            out.push(r);
        }
    }
    return out;
}
