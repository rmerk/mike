import type { PageViewport } from "pdfjs-dist";

/**
 * Draw a semi-transparent bbox over a rendered PDF page wrapper.
 * `bbox` is in PDF user space (same coordinates as pdf.js text items at scale 1);
 * `viewport` is the scaled viewport used for this render pass.
 */
export function placePdfBboxOverlay(
    wrapper: HTMLElement,
    viewport: PageViewport,
    bbox: { x: number; y: number; w: number; h: number },
): HTMLElement {
    clearBboxOverlays(wrapper);
    const el = document.createElement("div");
    el.className = "pdf-bbox-overlay";
    el.setAttribute("aria-hidden", "true");
    el.style.position = "absolute";
    el.style.left = "0";
    el.style.top = "0";
    el.style.pointerEvents = "none";
    el.style.background = "rgba(250, 204, 21, 0.22)";
    el.style.border = "2px solid rgba(202, 138, 4, 0.95)";
    el.style.boxSizing = "border-box";
    el.style.zIndex = "2";
    const r = viewport.convertToViewportRectangle([
        bbox.x,
        bbox.y,
        bbox.x + bbox.w,
        bbox.y + bbox.h,
    ]);
    const x = Math.min(r[0], r[2]);
    const y = Math.min(r[1], r[3]);
    const w = Math.abs(r[2] - r[0]);
    const h = Math.abs(r[3] - r[1]);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    wrapper.appendChild(el);
    return el;
}

export function clearBboxOverlays(wrapper: HTMLElement) {
    wrapper.querySelectorAll(".pdf-bbox-overlay").forEach((n) => n.remove());
}
