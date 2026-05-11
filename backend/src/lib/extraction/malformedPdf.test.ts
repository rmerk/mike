import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    downloadFile: vi.fn(),
    completeClaudeMedMalExtractionPage: vi.fn(),
    insertDocumentEvents: vi.fn(async () => undefined),
}));

vi.mock("../storage", () => ({
    downloadFile: mocks.downloadFile,
    uploadFile: vi.fn(async () => undefined),
    deleteFile: vi.fn(async () => undefined),
    extractionPageRasterKey: () => "raster-key",
    storageEnabled: true,
}));

vi.mock("../llm", () => ({
    completeClaudeMedMalExtractionPage: mocks.completeClaudeMedMalExtractionPage,
}));

vi.mock("../llm/models", () => ({
    providerForModel: () => "claude",
}));

vi.mock("./peerReviewVisionPrescan", () => ({
    visionPrescanPeerReviewMarkers: vi.fn(async () => ({
        markerPages: [],
        rasterCache: new Map(),
    })),
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

import { loadPdfFromBuffer } from "./pdfRegions";
import { executeMedMalExtraction } from "./medMalExtractor";

// A clearly-not-a-PDF byte sequence. pdf.js rejects with a recognizable error
// well before any text-content traversal.
const MALFORMED_BYTES = new TextEncoder().encode(
    "NOT-A-PDF\n%PDF-x.y\nxref-broken\n",
).buffer as ArrayBuffer;

function rpcDb() {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const db = {
        from(_table: string) {
            return {
                insert: () => ({
                    eq: () => ({ data: null, error: null }),
                }),
                update: () => ({
                    eq: () => ({ data: null, error: null }),
                }),
                select: () => ({
                    eq: () => ({
                        eq: () => ({ data: [], error: null }),
                    }),
                }),
            };
        },
        rpc: async (fn: string, args: unknown) => {
            calls.push({ fn, args });
            return { data: null, error: null };
        },
    };
    return { db, calls };
}

describe("malformed PDF handling", () => {
    beforeEach(() => {
        mocks.downloadFile.mockReset();
        mocks.completeClaudeMedMalExtractionPage.mockReset();
    });

    it("loadPdfFromBuffer rejects malformed bytes", async () => {
        await expect(loadPdfFromBuffer(MALFORMED_BYTES)).rejects.toThrow();
    });

    it("executeMedMalExtraction surfaces a sliced, non-leaking 'Failed to open PDF' error", async () => {
        mocks.downloadFile.mockResolvedValueOnce(MALFORMED_BYTES);
        const { db, calls } = rpcDb();

        const result = await executeMedMalExtraction({
            db: db as unknown as Parameters<typeof executeMedMalExtraction>[0]["db"],
            documentId: "doc-1",
            runId: "run-1",
            userId: "user-1",
            pdfStoragePath: "u/doc/file.pdf",
            apiKeys: {},
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatch(/Failed to open PDF/);
        // Slice cap from medMalExtractor.ts: error must not leak full pdfjs internals.
        // Header ("Failed to open PDF: ") + 200 chars of sliced message + safety margin.
        expect(result.error.length).toBeLessThan(260);

        // No event-extraction call may happen.
        expect(
            mocks.completeClaudeMedMalExtractionPage,
        ).not.toHaveBeenCalled();

        // A terminal failed patch must record the error.
        const failPatch = calls.find((c) => {
            if (c.fn !== "patch_document_extraction_run") return false;
            const a = c.args as { p_patch?: { status?: string } };
            return a.p_patch?.status === "failed";
        });
        expect(failPatch).toBeDefined();
        const a = failPatch!.args as {
            p_patch: { error?: string };
        };
        expect(a.p_patch.error).toMatch(/Failed to open PDF/);
    });
});
