import { describe, expect, it } from "vitest";
import { assertValidCitation, type DocumentEventInsert } from "./eventLog";

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
