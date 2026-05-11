import path from "path";

const STANDARD_FONT_DATA_URL = (() => {
    try {
        const pkgPath = require.resolve("pdfjs-dist/package.json");
        return path.join(path.dirname(pkgPath), "standard_fonts") + path.sep;
    } catch {
        return undefined;
    }
})();

export type PdfTextItem = {
    text: string;
    x: number;
    y: number;
    w: number;
    h: number;
};

type PdfJsDoc = {
    numPages: number;
    getPage: (n: number) => Promise<{
        getViewport: (opts: { scale: number }) => {
            width: number;
            height: number;
        };
        getTextContent: () => Promise<{
            items: Array<{
                str?: string;
                transform?: number[];
                width?: number;
                height?: number;
            }>;
        }>;
        render: (opts: {
            canvasContext: CanvasRenderingContext2D;
            viewport: { width: number; height: number };
        }) => { promise: Promise<void> };
    }>;
};

/** Max edge length (px) for page rasterization — caps memory / encode size. */
export const EXTRACTION_MAX_RASTER_EDGE_PX = 2048;

export async function loadPdfFromBuffer(buf: ArrayBuffer): Promise<PdfJsDoc> {
    const pdfjsLib = await import(
        "pdfjs-dist/legacy/build/pdf.mjs" as string
    );
    const pdf = await (
        pdfjsLib as unknown as {
            getDocument: (opts: unknown) => { promise: Promise<PdfJsDoc> };
        }
    ).getDocument({
        data: new Uint8Array(buf),
        standardFontDataUrl: STANDARD_FONT_DATA_URL,
    }).promise;
    return pdf;
}

/**
 * Per-glyph / text-run items in PDF user space (pdf.js text content coordinates).
 */
export async function getPageItems(
    pdf: PdfJsDoc,
    pageNum: number,
): Promise<PdfTextItem[]> {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const out: PdfTextItem[] = [];
    for (const item of textContent.items) {
        const str = typeof item.str === "string" ? item.str : "";
        if (!str.trim()) continue;
        const t = item.transform;
        if (!t || t.length < 6) continue;
        const x = t[4] ?? 0;
        const y = t[5] ?? 0;
        const w =
            typeof item.width === "number" && item.width > 0
                ? item.width
                : Math.max(str.length * 4, 8);
        const h =
            typeof item.height === "number" && item.height > 0
                ? item.height
                : Math.abs(t[3] ?? 12) || 12;
        out.push({ text: str, x, y, w, h });
    }
    return out;
}

export function itemsToPlainText(items: PdfTextItem[]): string {
    return items.map((i) => i.text).join(" ");
}

export function pageNeedsVisionRaster(items: PdfTextItem[]): boolean {
    return items.length === 0 || !itemsToPlainText(items).trim();
}

/**
 * Rasterize one PDF page to PNG (for vision extraction when the text layer is empty).
 * Uses pdf.js render + node-canvas; coordinates for bbox prompts use `pageWidth` / `pageHeight` at scale 1.
 */
export async function renderPageToPngBuffer(
    pdf: PdfJsDoc,
    pageNum: number,
): Promise<{ png: Buffer; pageWidth: number; pageHeight: number }> {
    let createCanvas: typeof import("canvas").createCanvas;
    try {
        ({ createCanvas } = await import("canvas"));
    } catch {
        throw new Error(
            "Raster extraction requires the `canvas` package (native build).",
        );
    }
    const page = await pdf.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1 });
    const pageWidth = baseViewport.width;
    const pageHeight = baseViewport.height;
    const maxDim = Math.max(pageWidth, pageHeight);
    const rasterScale =
        maxDim <= EXTRACTION_MAX_RASTER_EDGE_PX
            ? 1
            : EXTRACTION_MAX_RASTER_EDGE_PX / maxDim;
    const viewport = page.getViewport({ scale: rasterScale });
    const w = Math.max(1, Math.floor(viewport.width));
    const h = Math.max(1, Math.floor(viewport.height));
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    const task = page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
    });
    await task.promise;
    const png = canvas.toBuffer("image/png");
    return { png, pageWidth, pageHeight };
}

export function clampBboxToPage(
    bbox: { x: number; y: number; w: number; h: number },
    pageWidth: number,
    pageHeight: number,
): { x: number; y: number; w: number; h: number } {
    let { x, y, w, h } = bbox;
    if (w < 0) {
        x += w;
        w = -w;
    }
    if (h < 0) {
        y += h;
        h = -h;
    }
    x = Math.max(0, Math.min(x, pageWidth));
    y = Math.max(0, Math.min(y, pageHeight));
    w = Math.max(0, Math.min(w, pageWidth - x));
    h = Math.max(0, Math.min(h, pageHeight - y));
    return { x, y, w, h };
}
