import { describe, expect, it } from "vitest";
import { runDeterministicRedFlags, type DocumentEventRow } from "./redFlags";

function ev(overrides: Partial<DocumentEventRow>): DocumentEventRow {
    return {
        id: "e-" + Math.random().toString(36).slice(2),
        document_id: "doc-1",
        event_date: null,
        encounter_type: null,
        narrative: null,
        dx_codes: null,
        procedures: null,
        vitals: null,
        source_page: 1,
        ...overrides,
    };
}

describe("ruleDelayedDx", () => {
    it("flags symptoms preceding diagnosis", () => {
        const flags = runDeterministicRedFlags([
            ev({
                event_date: "2024-01-01",
                narrative: "chief complaint: chest pain",
                source_page: 3,
            }),
            ev({
                event_date: "2024-01-10",
                narrative: "diagnosis confirmed",
                dx_codes: ["I21.9"],
                source_page: 8,
            }),
        ]);
        const dx = flags.find((f) => f.rule_id === "delayed_dx");
        expect(dx).toBeDefined();
        expect(dx!.supports_element).toBe("breach");
        // Summary should reference dates, not just pages.
        expect(dx!.summary).toContain("2024-01-01");
        expect(dx!.summary).toContain("2024-01-10");
    });

    it("does not flag when diagnosis precedes symptoms", () => {
        const flags = runDeterministicRedFlags([
            ev({
                event_date: "2024-01-10",
                narrative: "chest pain",
                source_page: 5,
            }),
            ev({
                event_date: "2024-01-01",
                narrative: "diagnosis",
                dx_codes: ["I21.9"],
                source_page: 2,
            }),
        ]);
        expect(flags.find((f) => f.rule_id === "delayed_dx")).toBeUndefined();
    });
});

describe("ruleRetainedForeignObject precedence matrix", () => {
    it("matches retained + foreign", () => {
        const flags = runDeterministicRedFlags([
            ev({ narrative: "post-op imaging shows retained foreign body" }),
        ]);
        expect(
            flags.find((f) => f.rule_id === "retained_foreign_object"),
        ).toBeDefined();
    });

    it("matches sponge + count", () => {
        const flags = runDeterministicRedFlags([
            ev({ narrative: "sponge count incorrect at closure" }),
        ]);
        expect(
            flags.find((f) => f.rule_id === "retained_foreign_object"),
        ).toBeDefined();
    });

    it("matches hardware (procedure) + unaccounted (narrative)", () => {
        const flags = runDeterministicRedFlags([
            ev({
                narrative: "one piece unaccounted at end of case",
                procedures: ["orthopedic hardware insertion"],
            }),
        ]);
        expect(
            flags.find((f) => f.rule_id === "retained_foreign_object"),
        ).toBeDefined();
    });

    it("does NOT match hardware alone without unaccounted", () => {
        const flags = runDeterministicRedFlags([
            ev({
                narrative: "routine closure",
                procedures: ["orthopedic hardware insertion"],
            }),
        ]);
        expect(
            flags.find((f) => f.rule_id === "retained_foreign_object"),
        ).toBeUndefined();
    });
});

describe("ruleFailureToMonitor empty-vitals predicate", () => {
    it("flags ICU narrative with null vitals", () => {
        const flags = runDeterministicRedFlags([
            ev({
                encounter_type: "admission",
                narrative: "transferred to ICU after surgery",
                vitals: null,
            }),
        ]);
        expect(
            flags.find((f) => f.rule_id === "failure_to_monitor"),
        ).toBeDefined();
    });

    it("does NOT throw when vitals is an unexpected non-object", () => {
        // A type-safe call wouldn't allow strings, but the column is jsonb so
        // bad upstream data could land here. Predicate must not throw.
        expect(() =>
            runDeterministicRedFlags([
                ev({
                    encounter_type: "ed",
                    narrative: "post-op course",
                    vitals: "unexpected-string" as unknown,
                }),
            ]),
        ).not.toThrow();
    });
});

describe("runDeterministicRedFlags dedupe", () => {
    it("emits at most one flag per rule_id even when multiple events match", () => {
        const flags = runDeterministicRedFlags([
            ev({ narrative: "tenfold overdose during titration" }),
            ev({ narrative: "wrong dose administered" }),
        ]);
        const medErrors = flags.filter((f) => f.rule_id === "med_error");
        expect(medErrors).toHaveLength(1);
    });
});
