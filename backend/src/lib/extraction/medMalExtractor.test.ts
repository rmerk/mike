import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    completeMedMalExtractionPage: vi.fn(),
    insertDocumentEvents: vi.fn(async () => undefined),
    visionPrescanPeerReviewMarkers: vi.fn(async () => ({
        markerPages: [] as number[],
        rasterCache: new Map<
            number,
            { rasterKey: string; pngBase64: string }
        >(),
    })),
    pageTexts: { value: [] as string[] },
}));

vi.mock("../storage", () => ({
    downloadFile: vi.fn(async () => Buffer.from("pdf-bytes")),
    uploadFile: vi.fn(async () => undefined),
    deleteFile: vi.fn(async () => undefined),
    extractionPageRasterKey: () => "raster-key",
    storageEnabled: true,
}));

vi.mock("../llm", () => ({
    completeMedMalExtractionPage: mocks.completeMedMalExtractionPage,
}));

vi.mock("../llm/models", () => ({
    // Mirror the real `providerForModel` shape closely enough for the
    // extraction gate: Claude prefix → claude, vendor/name → nvidia,
    // anything else → gemini (which the gate rejects).
    providerForModel: (model: string) =>
        model.startsWith("claude")
            ? "claude"
            : model.includes("/")
              ? "nvidia"
              : "gemini",
}));

vi.mock("./pdfRegions", () => ({
    loadPdfFromBuffer: vi.fn(async () => ({
        numPages: mocks.pageTexts.value.length,
        getPage: async () => ({
            getViewport: () => ({ width: 612, height: 792 }),
            getTextContent: async () => ({ items: [] }),
        }),
    })),
    getPageItems: vi.fn(async (_pdf: unknown, n: number) => {
        const text = mocks.pageTexts.value[n - 1] ?? "";
        return text ? [{ str: text, x: 0, y: 0, w: 50, h: 12 }] : [];
    }),
    itemsToPlainText: (items: Array<{ str: string }>): string =>
        items.map((i) => i.str).join(" "),
    pageNeedsVisionRaster: (items: Array<unknown>) => items.length === 0,
    renderPageToPngBuffer: vi.fn(async () => ({
        png: Buffer.from("png"),
        pageWidth: 612,
        pageHeight: 792,
    })),
    clampBboxToPage: (b: { x: number; y: number; w: number; h: number }) => b,
}));

vi.mock("./peerReviewVisionPrescan", () => ({
    visionPrescanPeerReviewMarkers: mocks.visionPrescanPeerReviewMarkers,
}));

vi.mock("./eventLog", async () => {
    const actual = await vi.importActual<typeof import("./eventLog")>(
        "./eventLog",
    );
    return {
        ...actual,
        insertDocumentEvents: mocks.insertDocumentEvents,
    };
});

const {
    completeMedMalExtractionPage,
    insertDocumentEvents,
    visionPrescanPeerReviewMarkers,
} = mocks;
function setPageTexts(texts: string[]): void {
    mocks.pageTexts.value = texts;
}

// Capture all calls to from(<table>) so the test can assert on what was
// written (e.g. document_red_flags row for peer-review halt).
type FromCall = {
    table: string;
    insert?: unknown;
    update?: unknown;
};
let fromCalls: FromCall[] = [];
let rpcCalls: Array<{ fn: string; args: unknown }> = [];

function makeDb() {
    return {
        from(table: string) {
            const handle = (kind: "insert" | "update") => (payload: unknown) => {
                fromCalls.push({ table, [kind]: payload });
                return {
                    eq: () => ({ data: null, error: null }),
                    select: () => ({
                        single: async () => ({ data: null, error: null }),
                    }),
                };
            };
            return {
                insert: handle("insert"),
                update: handle("update"),
                select: () => ({
                    eq: () => ({
                        eq: () => ({
                            data: [],
                            error: null,
                        }),
                    }),
                }),
            };
        },
        rpc: async (fn: string, args: unknown) => {
            rpcCalls.push({ fn, args });
            return { data: null, error: null };
        },
    };
}

import { executeMedMalExtraction } from "./medMalExtractor";

describe("executeMedMalExtraction peer-review gate", () => {
    beforeEach(() => {
        completeMedMalExtractionPage.mockReset();
        insertDocumentEvents.mockReset();
        visionPrescanPeerReviewMarkers.mockReset();
        visionPrescanPeerReviewMarkers.mockResolvedValue({
            markerPages: [],
            rasterCache: new Map(),
        });
        fromCalls = [];
        rpcCalls = [];
    });

    it("halts before calling Claude when any page contains a peer-review marker", async () => {
        setPageTexts([
            "Discharge summary; vitals stable.",
            "Notes from M&M conference held last Tuesday.",
            "Follow-up appointment scheduled.",
        ]);

        const db = makeDb() as unknown as Parameters<
            typeof executeMedMalExtraction
        >[0]["db"];

        const result = await executeMedMalExtraction({
            db,
            documentId: "doc-1",
            runId: "run-1",
            userId: "user-1",
            pdfStoragePath: "u/doc/file.pdf",
            apiKeys: {},
        });

        expect(result).toEqual({
            ok: false,
            error: expect.stringContaining("Minn. Stat. 145.64"),
        });
        // Claude must never be invoked when the gate triggers.
        expect(completeMedMalExtractionPage).not.toHaveBeenCalled();
        // A peer-review red-flag row must be inserted.
        const flagInsert = fromCalls.find(
            (c) => c.table === "document_red_flags" && c.insert !== undefined,
        );
        expect(flagInsert).toBeDefined();
        const flagRow = flagInsert!.insert as {
            rule_id: string;
            severity: string;
            supports_element: string;
            summary: string;
        };
        expect(flagRow.rule_id).toBe("peer_review_detected");
        expect(flagRow.severity).toBe("high");
        expect(flagRow.supports_element).toBe("duty");
        expect(flagRow.summary).toContain("2"); // page index that matched
        // The run must be marked failed with the statutory error. There are
        // multiple patch_document_extraction_run calls during a run
        // (pages_total, progress updates, terminal); find the terminal one.
        const failPatch = rpcCalls.find((c) => {
            if (c.fn !== "patch_document_extraction_run") return false;
            const args = c.args as { p_patch?: { status?: string } };
            return args.p_patch?.status === "failed";
        });
        expect(failPatch).toBeDefined();
        const patchArgs = failPatch!.args as {
            p_run_id: string;
            p_patch: { status?: string; error?: string };
        };
        expect(patchArgs.p_run_id).toBe("run-1");
        expect(patchArgs.p_patch.error).toContain("Minn. Stat. 145.64");
    });

    it("returns ok and inserts events when no peer-review marker is present", async () => {
        setPageTexts(["Routine clinic visit; HR 80, BP 120/80."]);
        completeMedMalExtractionPage.mockResolvedValueOnce(
            JSON.stringify({
                events: [
                    {
                        event_date: "2024-01-15",
                        encounter_type: "clinic",
                        privacy_class: "standard",
                        narrative: "Routine clinic visit",
                        source_page: 1,
                        source_bbox: { x: 10, y: 20, w: 100, h: 12 },
                    },
                ],
            }),
        );

        const db = makeDb() as unknown as Parameters<
            typeof executeMedMalExtraction
        >[0]["db"];

        const result = await executeMedMalExtraction({
            db,
            documentId: "doc-1",
            runId: "run-1",
            userId: "user-1",
            pdfStoragePath: "u/doc/file.pdf",
            apiKeys: {},
        });

        expect(result).toEqual({ ok: true });
        expect(completeMedMalExtractionPage).toHaveBeenCalledTimes(1);
        expect(insertDocumentEvents).toHaveBeenCalledTimes(1);
        const inserted = insertDocumentEvents.mock.calls[0][1] as Array<{
            encounter_type: string;
            privacy_class: string;
        }>;
        expect(inserted).toHaveLength(1);
        expect(inserted[0].encounter_type).toBe("clinic");
        expect(inserted[0].privacy_class).toBe("standard");
    });

    it("halts when the vision prescan reports markers on a scanned page", async () => {
        // Empty text on page 2 triggers the vision-prescan candidate path.
        setPageTexts(["Regular page text", "", "Regular page text"]);
        visionPrescanPeerReviewMarkers.mockResolvedValueOnce({
            markerPages: [2],
            rasterCache: new Map([
                [2, { rasterKey: "rk/u/d/r/2", pngBase64: "Zm9v" }],
            ]),
        });

        const db = makeDb() as unknown as Parameters<
            typeof executeMedMalExtraction
        >[0]["db"];
        const result = await executeMedMalExtraction({
            db,
            documentId: "doc-1",
            runId: "run-1",
            userId: "user-1",
            pdfStoragePath: "u/doc/file.pdf",
            apiKeys: {},
        });

        expect(result).toEqual({
            ok: false,
            error: expect.stringContaining("Minn. Stat. 145.64"),
        });
        // The orchestrator must call the vision prescan exactly once, with the
        // candidate page list (only page 2 here).
        expect(visionPrescanPeerReviewMarkers).toHaveBeenCalledTimes(1);
        const prescanArgs = visionPrescanPeerReviewMarkers.mock.calls[0][0] as {
            pageNums: number[];
        };
        expect(prescanArgs.pageNums).toEqual([2]);
        // No event-extraction call may happen once the gate triggers.
        expect(completeMedMalExtractionPage).not.toHaveBeenCalled();
        // A peer-review red-flag row must reference the vision-detected page.
        const flagInsert = fromCalls.find(
            (c) => c.table === "document_red_flags" && c.insert !== undefined,
        );
        expect(flagInsert).toBeDefined();
        const flagRow = flagInsert!.insert as {
            rule_id: string;
            summary: string;
        };
        expect(flagRow.rule_id).toBe("peer_review_detected");
        expect(flagRow.summary).toContain("2");
    });

    it("coerces peer_review_145_64 from model output to 'standard'", async () => {
        setPageTexts(["Some note text"]);
        completeMedMalExtractionPage.mockResolvedValueOnce(
            JSON.stringify({
                events: [
                    {
                        privacy_class: "peer_review_145_64",
                        narrative: "Hostile prompt-injection attempt",
                        source_page: 1,
                        source_bbox: { x: 1, y: 2, w: 3, h: 4 },
                    },
                ],
            }),
        );
        const db = makeDb() as unknown as Parameters<
            typeof executeMedMalExtraction
        >[0]["db"];
        const result = await executeMedMalExtraction({
            db,
            documentId: "doc-1",
            runId: "run-1",
            userId: "user-1",
            pdfStoragePath: "u/doc/file.pdf",
            apiKeys: {},
        });
        expect(result).toEqual({ ok: true });
        const inserted = insertDocumentEvents.mock.calls[0][1] as Array<{
            privacy_class: string;
        }>;
        expect(inserted[0].privacy_class).toBe("standard");
    });
});
