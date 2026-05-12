import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    completeMedMalExtractionPage: vi.fn(),
    uploadFile: vi.fn(async () => undefined),
    renderPageToPngBuffer: vi.fn(async (_pdf: unknown, n: number) => ({
        png: Buffer.from(`png-page-${n}`),
        pageWidth: 612,
        pageHeight: 792,
    })),
}));

vi.mock("../llm", () => ({
    completeMedMalExtractionPage: mocks.completeMedMalExtractionPage,
}));

vi.mock("../storage", () => ({
    uploadFile: mocks.uploadFile,
    extractionPageRasterKey: (
        u: string,
        d: string,
        r: string,
        p: number,
    ): string => `rk/${u}/${d}/${r}/${p}`,
}));

vi.mock("./pdfRegions", () => ({
    renderPageToPngBuffer: mocks.renderPageToPngBuffer,
}));

import { PEER_REVIEW_MARKERS } from "./peerReviewMarkers";
import { visionPrescanPeerReviewMarkers } from "./peerReviewVisionPrescan";

describe("visionPrescanPeerReviewMarkers", () => {
    beforeEach(() => {
        mocks.completeMedMalExtractionPage.mockReset();
        mocks.uploadFile.mockReset();
        mocks.uploadFile.mockResolvedValue(undefined);
        mocks.renderPageToPngBuffer.mockClear();
    });

    it("returns empty result for empty page list without any LLM calls", async () => {
        const result = await visionPrescanPeerReviewMarkers({
            pdf: {} as never,
            pageNums: [],
            userId: "u",
            documentId: "d",
            runId: "r",
            model: "claude-sonnet-4-6",
            apiKeys: {},
            storageEnabled: true,
        });
        expect(result.markerPages).toEqual([]);
        expect(result.rasterCache.size).toBe(0);
        expect(mocks.completeMedMalExtractionPage).not.toHaveBeenCalled();
    });

    it("flags pages where vision detects a peer-review marker and caches rasters", async () => {
        mocks.completeMedMalExtractionPage.mockImplementation(
            async ({ userContent }: { userContent: string }) => {
                const m = userContent.match(/Page number: (\d+)/);
                const page = m ? Number(m[1]) : 0;
                if (page === 2) {
                    return JSON.stringify({
                        has_peer_review_markers: true,
                        matched_phrase: "M&M conference",
                    });
                }
                return JSON.stringify({
                    has_peer_review_markers: false,
                    matched_phrase: null,
                });
            },
        );

        const result = await visionPrescanPeerReviewMarkers({
            pdf: {} as never,
            pageNums: [1, 2, 3],
            userId: "u",
            documentId: "d",
            runId: "r",
            model: "claude-sonnet-4-6",
            apiKeys: {},
            storageEnabled: true,
        });

        expect(result.markerPages).toEqual([2]);
        expect(result.rasterCache.size).toBe(3);
        for (const p of [1, 2, 3]) {
            const entry = result.rasterCache.get(p);
            expect(entry?.rasterKey).toBe(`rk/u/d/r/${p}`);
            expect(entry?.pngBase64.length).toBeGreaterThan(0);
        }
        expect(mocks.uploadFile).toHaveBeenCalledTimes(3);
    });

    it("embeds the canonical PEER_REVIEW_MARKERS list in the system prompt", async () => {
        mocks.completeMedMalExtractionPage.mockResolvedValueOnce(
            JSON.stringify({
                has_peer_review_markers: false,
                matched_phrase: null,
            }),
        );

        await visionPrescanPeerReviewMarkers({
            pdf: {} as never,
            pageNums: [1],
            userId: "u",
            documentId: "d",
            runId: "r",
            model: "claude-sonnet-4-6",
            apiKeys: {},
            storageEnabled: true,
        });

        const call = mocks.completeMedMalExtractionPage.mock.calls[0]![0];
        const prompt = (call as { systemPrompt: string }).systemPrompt;
        for (const marker of PEER_REVIEW_MARKERS) {
            expect(prompt).toContain(marker);
        }
    });

    it("retries on invalid JSON output and eventually throws if unrecoverable", async () => {
        mocks.completeMedMalExtractionPage.mockResolvedValue(
            "not json at all",
        );
        await expect(
            visionPrescanPeerReviewMarkers({
                pdf: {} as never,
                pageNums: [1],
                userId: "u",
                documentId: "d",
                runId: "r",
                model: "claude-sonnet-4-6",
                apiKeys: {},
                storageEnabled: true,
            }),
        ).rejects.toThrow(/peer-review vision prescan failed/);
        // 1 initial + 2 repair attempts
        expect(mocks.completeMedMalExtractionPage).toHaveBeenCalledTimes(
            3,
        );
    });

    it("skips R2 upload when storage is disabled", async () => {
        mocks.completeMedMalExtractionPage.mockResolvedValueOnce(
            JSON.stringify({
                has_peer_review_markers: false,
                matched_phrase: null,
            }),
        );

        const result = await visionPrescanPeerReviewMarkers({
            pdf: {} as never,
            pageNums: [1],
            userId: "u",
            documentId: "d",
            runId: "r",
            model: "claude-sonnet-4-6",
            apiKeys: {},
            storageEnabled: false,
        });

        expect(mocks.uploadFile).not.toHaveBeenCalled();
        expect(result.rasterCache.size).toBe(0);
    });
});
