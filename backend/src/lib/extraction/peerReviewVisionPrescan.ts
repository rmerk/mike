// Vision-based prescan for Minn. Stat. § 145.64 peer-review / QI markers on
// pages whose text layer is empty (scanned images). Renders each candidate
// page to a PNG, asks the configured vision model whether any canonical
// marker phrase appears, and caches the raster + base64 so the main
// extraction loop can reuse them without re-rendering or re-uploading.

import { completeMedMalExtractionPage } from "../llm";
import type { UserApiKeys } from "../llm/types";
import { extractionPageRasterKey, uploadFile } from "../storage";
import { PEER_REVIEW_MARKERS } from "./peerReviewMarkers";
import { renderPageToPngBuffer } from "./pdfRegions";

type PdfJsDoc = Parameters<typeof renderPageToPngBuffer>[0];

export type RasterCacheEntry = {
    rasterKey: string;
    pngBase64: string;
};

export type VisionPrescanResult = {
    markerPages: number[];
    rasterCache: Map<number, RasterCacheEntry>;
};

// Default 8 (up from 4) because the prescan is the silent phase before the
// main extraction loop and dominates time-to-first-page on large scanned PDFs
// (a 3K-page Epic ebook can have hundreds of image-only pages). Override via
// MED_MAL_PRESCAN_CONCURRENCY if the provider rate-limits.
const PRESCAN_CONCURRENCY = (() => {
    const raw = process.env.MED_MAL_PRESCAN_CONCURRENCY?.trim();
    const fallback = 8;
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 && n <= 32 ? n : fallback;
})();
const PRESCAN_MAX_REPAIR_ATTEMPTS = 2;

function buildSystemPrompt(): string {
    const list = PEER_REVIEW_MARKERS.map((m) => `- ${m}`).join("\n");
    return `You analyze a single PDF page image to detect peer-review or quality-improvement protected content under Minn. Stat. § 145.64.
Return ONLY valid JSON (no markdown fences) with this exact shape:
{"has_peer_review_markers": true|false, "matched_phrase": "..."|null}

A page has peer-review markers if it contains ANY of these phrases (case-insensitive, substring match against visible text in the image):
${list}

If a phrase is present, set has_peer_review_markers=true and return the matched phrase verbatim from the list above.
If none of the phrases appear, return {"has_peer_review_markers": false, "matched_phrase": null}.`;
}

function stripJsonFences(raw: string): string {
    let s = raw.trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(s);
    if (fence) s = fence[1].trim();
    return s;
}

type ParsedVerdict = { hasMarker: boolean; matchedPhrase: string | null };

function parseVerdict(raw: string): ParsedVerdict {
    const s = stripJsonFences(raw);
    const o = JSON.parse(s) as Record<string, unknown>;
    const hasMarker = o.has_peer_review_markers === true;
    const matched =
        typeof o.matched_phrase === "string" ? o.matched_phrase : null;
    return { hasMarker, matchedPhrase: matched };
}

async function detectOnSinglePage(params: {
    pdf: PdfJsDoc;
    pageNum: number;
    userId: string;
    documentId: string;
    runId: string;
    model: string;
    apiKeys: UserApiKeys;
    storageEnabled: boolean;
}): Promise<{
    pageNum: number;
    verdict: ParsedVerdict;
    cache: RasterCacheEntry | null;
}> {
    const {
        pdf,
        pageNum,
        userId,
        documentId,
        runId,
        model,
        apiKeys,
        storageEnabled,
    } = params;

    const { png } = await renderPageToPngBuffer(pdf, pageNum);
    const pngBase64 = png.toString("base64");
    let rasterKey: string | null = null;
    if (storageEnabled) {
        rasterKey = extractionPageRasterKey(userId, documentId, runId, pageNum);
        await uploadFile(
            rasterKey,
            png.buffer.slice(
                png.byteOffset,
                png.byteOffset + png.byteLength,
            ) as ArrayBuffer,
            "image/png",
        );
    }

    const systemPrompt = buildSystemPrompt();
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= PRESCAN_MAX_REPAIR_ATTEMPTS; attempt++) {
        const repair =
            attempt > 0
                ? `\nYour previous output was invalid JSON. Emit ONLY the JSON object, no prose. Attempt ${attempt + 1}.`
                : "";
        const raw = await completeMedMalExtractionPage({
            model,
            systemPrompt: systemPrompt + repair,
            userContent: `Page number: ${pageNum}\nA PNG image of this PDF page is attached. Determine whether any canonical § 145.64 marker phrase is visible.`,
            visionPngBase64: pngBase64,
            maxTokens: 256,
            apiKeys,
        });
        if (!raw.trim()) {
            lastErr = new Error("empty model output");
            continue;
        }
        try {
            const verdict = parseVerdict(raw);
            return {
                pageNum,
                verdict,
                cache: rasterKey ? { rasterKey, pngBase64 } : null,
            };
        } catch (e) {
            lastErr = e instanceof Error ? e : new Error("JSON parse failed");
        }
    }
    throw new Error(
        `Page ${pageNum}: peer-review vision prescan failed: ${lastErr?.message ?? "unknown"}`,
    );
}

/**
 * Inspect each candidate page for § 145.64 peer-review markers via vision.
 * Returns marker hits plus a raster cache the main extraction loop reuses.
 * Runs with bounded concurrency to avoid serializing on Claude latency for
 * large scanned PDFs.
 */
export async function visionPrescanPeerReviewMarkers(params: {
    pdf: PdfJsDoc;
    pageNums: number[];
    userId: string;
    documentId: string;
    runId: string;
    model: string;
    apiKeys: UserApiKeys;
    storageEnabled: boolean;
}): Promise<VisionPrescanResult> {
    const result: VisionPrescanResult = {
        markerPages: [],
        rasterCache: new Map(),
    };
    if (params.pageNums.length === 0) return result;

    const queue = [...params.pageNums];

    // Worker-pool pattern: N workers pull from the shared queue until empty.
    // Promise.all collects all worker promises so a rejection in one worker
    // does not leave others dangling as unhandled rejections.
    const workerCount = Math.min(PRESCAN_CONCURRENCY, queue.length);
    const workers = Array.from({ length: workerCount }, async () => {
        while (queue.length > 0) {
            const pageNum = queue.shift();
            if (pageNum === undefined) return;
            const { verdict, cache } = await detectOnSinglePage({
                pdf: params.pdf,
                pageNum,
                userId: params.userId,
                documentId: params.documentId,
                runId: params.runId,
                model: params.model,
                apiKeys: params.apiKeys,
                storageEnabled: params.storageEnabled,
            });
            if (cache) result.rasterCache.set(pageNum, cache);
            if (verdict.hasMarker) result.markerPages.push(pageNum);
        }
    });
    await Promise.all(workers);

    result.markerPages.sort((a, b) => a - b);
    return result;
}
