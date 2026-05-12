import { describe, expect, it } from "vitest";
import {
    assertValidCitation,
    coerceMedications,
    coerceVitals,
    type DocumentEventInsert,
} from "./eventLog";

describe("eventLog citation enforcement", () => {
    const base: DocumentEventInsert = {
        document_id: "d1",
        extraction_run_id: "r1",
        source_page: 1,
        source_bbox: { x: 0, y: 0, w: 10, h: 10 },
    };

    it("accepts valid rows", () => {
        expect(() => assertValidCitation(base)).not.toThrow();
    });

    it("rejects invalid page", () => {
        expect(() =>
            assertValidCitation({ ...base, source_page: 0 }),
        ).toThrow(/source_page/);
    });

    it("rejects invalid bbox", () => {
        expect(() =>
            assertValidCitation({
                ...base,
                source_bbox: { x: 0, y: 0, w: 0, h: 10 },
            }),
        ).toThrow(/source_bbox/);
    });
});

describe("coerceMedications", () => {
    it("returns null for non-array input", () => {
        expect(coerceMedications(null)).toBeNull();
        expect(coerceMedications({})).toBeNull();
        expect(coerceMedications("heparin")).toBeNull();
    });

    it("returns null when no entry has a name", () => {
        expect(coerceMedications([{}, { dose: "5mg" }])).toBeNull();
    });

    it("keeps entries with a name and coerces optional fields", () => {
        const out = coerceMedications([
            {
                name: "heparin",
                dose: "5000 units",
                route: "IV push",
                allergy_conflict_flag: false,
                weight_based_dose_check_passed: true,
                administered_at: "14:32",
                garbage_extra_field: 99,
            },
        ]);
        expect(out).toEqual([
            {
                name: "heparin",
                dose: "5000 units",
                route: "IV push",
                frequency: null,
                ordered_by: null,
                administered_by: null,
                ordered_at: null,
                administered_at: "14:32",
                indication: null,
                allergy_conflict_flag: false,
                weight_based_dose_check_passed: true,
            },
        ]);
    });

    it("drops entries without a name but keeps valid siblings", () => {
        const out = coerceMedications([
            { dose: "10mg" },
            { name: "morphine", dose: "2mg" },
        ]);
        expect(out).toEqual([
            expect.objectContaining({ name: "morphine", dose: "2mg" }),
        ]);
    });
});

describe("coerceVitals", () => {
    it("returns null for non-object / array input", () => {
        expect(coerceVitals(null)).toBeNull();
        expect(coerceVitals([])).toBeNull();
        expect(coerceVitals("120/80")).toBeNull();
    });

    it("returns null when no recognized field is present", () => {
        expect(coerceVitals({})).toBeNull();
        expect(coerceVitals({ note: "stable" })).toBeNull();
    });

    it("keeps recognized fields and ignores extras", () => {
        const out = coerceVitals({
            bp: "120/80",
            hr: 72,
            spo2: 98,
            something_else: "ignored",
            rr: "not a number",
        });
        expect(out).toEqual({
            bp: "120/80",
            hr: 72,
            rr: null,
            spo2: 98,
            temp_c: null,
            map: null,
            urine_output_ml: null,
        });
    });
});
