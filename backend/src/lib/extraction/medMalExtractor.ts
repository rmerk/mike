import {
    downloadFile,
    uploadFile,
    deleteFile,
    extractionPageRasterKey,
    storageEnabled,
} from "../storage";
import { completeMedMalExtractionPage } from "../llm";
import { providerForModel } from "../llm/models";
import type { Provider, UserApiKeys } from "../llm/types";
import type { createServerSupabase } from "../supabase";
import { textContainsPeerReviewMarker } from "./peerReviewMarkers";
import {
    clampBboxToPage,
    getPageItems,
    itemsToPlainText,
    loadPdfFromBuffer,
    pageNeedsVisionRaster,
    renderPageToPngBuffer,
} from "./pdfRegions";
import {
    coerceEncounterType,
    coerceLlmPrivacyClass,
    coerceMedications,
    coerceVitals,
    insertDocumentEvents,
    type DocumentEventInsert,
} from "./eventLog";
import {
    visionPrescanPeerReviewMarkers,
    type RasterCacheEntry,
} from "./peerReviewVisionPrescan";
import { runDeterministicRedFlags, type DocumentEventRow } from "./redFlags";

type Db = ReturnType<typeof createServerSupabase>;

// Vision/image input is currently implemented for the Claude (Anthropic
// `messages` with image content blocks) and NVIDIA (OpenAI-compatible chat
// completions with `image_url` content blocks; Kimi K2.5/K2.6 VLM and
// Llama-3.2 Vision) providers. Validate at boot and again at run-start (route
// handler) so a misconfigured env fails fast, not mid-run.
const DEFAULT_EXTRACTION_MODEL = "moonshotai/kimi-k2.6";

const VISION_CAPABLE_PROVIDERS: ReadonlySet<Provider> = new Set([
    "claude",
    "nvidia",
]);

export function resolveExtractionModel(): string {
    const configured = process.env.MED_MAL_EXTRACTION_MODEL?.trim();
    const model = configured || DEFAULT_EXTRACTION_MODEL;
    const provider = providerForModel(model);
    if (!VISION_CAPABLE_PROVIDERS.has(provider)) {
        throw new Error(
            `MED_MAL_EXTRACTION_MODEL must be a vision-capable model (Claude or NVIDIA Kimi VLM). Got: ${model} (provider: ${provider}).`,
        );
    }
    return model;
}

const EXTRACTION_MODEL = resolveExtractionModel();

// 1 initial attempt + 2 repair attempts is empirically enough for transient
// JSON glitches without burning tokens on persistently broken responses.
const MAX_JSON_REPAIR_ATTEMPTS = 2;

// Main loop concurrency. Default 8 — empirically the right knob to bring a
// 3K-page run from days to hours on NIM Kimi K2.6. Each parallel slot is a
// fully independent per-page extraction; the existing per-page hard-fail
// semantics are preserved (the whole batch aborts on any one page failure).
// Override with MED_MAL_MAIN_LOOP_CONCURRENCY.
const MAIN_LOOP_CONCURRENCY = (() => {
    const raw = process.env.MED_MAL_MAIN_LOOP_CONCURRENCY?.trim();
    const fallback = 8;
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 && n <= 32 ? n : fallback;
})();

// Decode budget per page. Was 8192 — wasteful when most pages emit <1K tokens
// of JSON. 4096 halves decode wallclock on long generations while leaving
// headroom for dense pages.
const PAGE_MAX_OUTPUT_TOKENS = 4096;

// Truncate page text before sending to the LLM. Most clinical pages fit in
// 40K chars (~10K tokens); above that is usually decorative repetition,
// footers, or column overflow that hurts more than it helps. Saves both
// upload time and prefill tokens on big-prompt models.
const PAGE_TEXT_CHAR_CAP = 40000;

const SYSTEM_PROMPT = `You extract structured clinical timeline events from ONE page of a medical record PDF.
Return ONLY valid JSON (no markdown fences) with this exact shape:
{"events":[{"event_date":null,"event_time":null,"event_date_text":null,"provider":null,"provider_role":null,"episode_of_care":null,"encounter_type":"admission"|"ed"|"clinic"|"lab"|"imaging"|"op"|"nursing"|"note"|null,"privacy_class":"standard","key_date_role":null,"dx_codes":null,"medications":null,"vitals":null,"procedures":null,"narrative":"string max 500 chars","source_page":NUMBER,"source_bbox":{"x":number,"y":number,"w":number,"h":number}}]}
medications: when the page records medication orders or administrations, emit an array of objects with this shape (omit fields that are not in the chart entry — use null, not invented values):
  [{"name":"drug name (generic preferred)","dose":"e.g. 5000 units","route":"IV|IV push|IV infusion|PO|IM|SC|PR|inhaled|topical|NG|other","frequency":"e.g. q6h","ordered_by":"provider name","administered_by":"RN name","ordered_at":"ISO 8601 timestamp or HH:MM","administered_at":"ISO 8601 timestamp or HH:MM","indication":"clinical reason","allergy_conflict_flag":boolean|null,"weight_based_dose_check_passed":boolean|null}]
  - "name" is required for every entry. If you cannot identify a drug name, omit the entry.
  - Use null for any subfield the chart does not state. Do NOT fabricate dosing, routes, providers, or timestamps.
vitals: when the page records vital signs, emit a single object (not array) capturing what's documented for that encounter:
  {"bp":"systolic/diastolic e.g. 120/80","hr":number,"rr":number,"spo2":number,"temp_c":number,"map":number,"urine_output_ml":number}
  - Use null for any field that is not in the chart.
  - bp is always a string; the rest are numbers.
Rules:
- Every event MUST have source_page equal to the page number given in the user message.
- source_bbox must be tight around the cited region in PDF user space units (same origin as pdf.js text positions; origin bottom-left).
- When a page image is attached, source_bbox must still use PDF user space for the page width/height stated in the message — not raw PNG pixel coordinates.
- If the page has no clinically relevant discrete events, return {"events":[]}.
- privacy_class must be "standard" unless the note is clearly mental-health sensitive (then "mental_health_144_293").
- Never use "peer_review_145_64"; extraction is halted upstream when peer-review markers are detected.`;

export type MedMalExtractionResult =
    | { ok: true }
    | { ok: false; error: string };

function stripJsonFences(raw: string): string {
    let s = raw.trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(s);
    if (fence) s = fence[1].trim();
    return s;
}

function parseEventsJson(raw: string): unknown {
    const s = stripJsonFences(raw);
    return JSON.parse(s);
}

export type NormalizeDropReason =
    | "not_object"
    | "wrong_source_page"
    | "missing_bbox"
    | "non_finite_bbox"
    | "zero_area_bbox"
    | "malformed_medications"
    | "malformed_vitals";

export type NormalizeResult = {
    events: DocumentEventInsert[];
    dropped: Record<NormalizeDropReason, number>;
};

function coerceNullableString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

function normalizeLlmEvents(
    parsed: unknown,
    documentId: string,
    runId: string,
    pageNum: number,
    pageW: number,
    pageH: number,
): NormalizeResult {
    const dropped: Record<NormalizeDropReason, number> = {
        not_object: 0,
        wrong_source_page: 0,
        missing_bbox: 0,
        non_finite_bbox: 0,
        zero_area_bbox: 0,
        malformed_medications: 0,
        malformed_vitals: 0,
    };
    const out: DocumentEventInsert[] = [];
    if (!parsed || typeof parsed !== "object") return { events: out, dropped };
    const evs = (parsed as { events?: unknown }).events;
    if (!Array.isArray(evs)) return { events: out, dropped };
    for (const row of evs) {
        if (!row || typeof row !== "object") {
            dropped.not_object++;
            continue;
        }
        const o = row as Record<string, unknown>;
        const sp = o.source_page;
        if (typeof sp !== "number" || sp !== pageNum) {
            dropped.wrong_source_page++;
            continue;
        }
        const bboxRaw = o.source_bbox;
        if (!bboxRaw || typeof bboxRaw !== "object") {
            dropped.missing_bbox++;
            continue;
        }
        const b = bboxRaw as Record<string, unknown>;
        const x = Number(b.x),
            y = Number(b.y),
            w = Number(b.w),
            h = Number(b.h);
        if (![x, y, w, h].every(Number.isFinite)) {
            dropped.non_finite_bbox++;
            continue;
        }
        const source_bbox = clampBboxToPage({ x, y, w, h }, pageW, pageH);
        if (source_bbox.w <= 0 || source_bbox.h <= 0) {
            dropped.zero_area_bbox++;
            continue;
        }
        out.push({
            document_id: documentId,
            extraction_run_id: runId,
            event_date: coerceNullableString(o.event_date),
            event_time: coerceNullableString(o.event_time),
            event_date_text: coerceNullableString(o.event_date_text),
            provider: coerceNullableString(o.provider),
            provider_role: coerceNullableString(o.provider_role),
            episode_of_care: coerceNullableString(o.episode_of_care),
            encounter_type: coerceEncounterType(o.encounter_type),
            privacy_class: coerceLlmPrivacyClass(o.privacy_class),
            key_date_role: coerceNullableString(o.key_date_role),
            dx_codes: Array.isArray(o.dx_codes)
                ? (o.dx_codes as string[])
                : null,
            medications: (() => {
                if (o.medications == null) return null;
                const coerced = coerceMedications(o.medications);
                if (coerced === null && o.medications !== null) {
                    dropped.malformed_medications++;
                }
                return coerced;
            })(),
            vitals: (() => {
                if (o.vitals == null) return null;
                const coerced = coerceVitals(o.vitals);
                if (coerced === null && o.vitals !== null) {
                    dropped.malformed_vitals++;
                }
                return coerced;
            })(),
            procedures: Array.isArray(o.procedures)
                ? (o.procedures as string[])
                : null,
            narrative:
                typeof o.narrative === "string"
                    ? o.narrative.slice(0, 500)
                    : null,
            source_page: pageNum,
            source_bbox,
        });
    }
    return { events: out, dropped };
}

function hasAnyDrops(dropped: Record<NormalizeDropReason, number>): boolean {
    return (
        dropped.not_object > 0 ||
        dropped.wrong_source_page > 0 ||
        dropped.missing_bbox > 0 ||
        dropped.non_finite_bbox > 0 ||
        dropped.zero_area_bbox > 0 ||
        dropped.malformed_medications > 0 ||
        dropped.malformed_vitals > 0
    );
}

async function bumpSeq(
    db: Db,
    runId: string,
    patch: Record<string, unknown>,
): Promise<void> {
    const { error } = await db.rpc("patch_document_extraction_run", {
        p_run_id: runId,
        p_patch: patch,
    });
    if (error) {
        console.error("[extraction/patch_document_extraction_run]", error);
        throw new Error(error.message);
    }
}

export async function executeMedMalExtraction(params: {
    db: Db;
    documentId: string;
    runId: string;
    userId: string;
    pdfStoragePath: string;
    apiKeys: UserApiKeys;
}): Promise<MedMalExtractionResult> {
    const { db, documentId, runId, userId, pdfStoragePath, apiKeys } = params;
    // Track every raster key uploaded during this run (prescan + main loop)
    // so a single end-of-run sweep can clean them up. The previous per-page
    // `finally` delete pattern did not allow the prescan to share rasters
    // with the main loop without leaking them mid-run.
    const allRasterKeys = new Set<string>();
    try {
        const raw = await downloadFile(pdfStoragePath);
        if (!raw) {
            await bumpSeq(db, runId, {
                status: "failed",
                error: "Could not download PDF from storage",
                completed_at: new Date().toISOString(),
            });
            return { ok: false, error: "Could not download PDF from storage" };
        }
        let pdf: Awaited<ReturnType<typeof loadPdfFromBuffer>>;
        try {
            pdf = await loadPdfFromBuffer(raw);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const enc =
                /password|encrypted/i.test(msg) ||
                /PasswordException/i.test(msg);
            const errMsg = enc
                ? "This PDF is password-protected or encrypted."
                : `Failed to open PDF: ${msg.slice(0, 200)}`;
            await bumpSeq(db, runId, {
                status: "failed",
                error: errMsg,
                completed_at: new Date().toISOString(),
            });
            return { ok: false, error: errMsg };
        }
        const numPages = pdf.numPages;
        if (numPages === 0) {
            await bumpSeq(db, runId, {
                status: "failed",
                error: "PDF has zero pages",
                completed_at: new Date().toISOString(),
            });
            return { ok: false, error: "PDF has zero pages" };
        }
        await bumpSeq(db, runId, { pages_total: numPages, pages_complete: 0 });
        console.info("[extraction/run] pdf loaded", {
            runId,
            documentId,
            numPages,
            model: EXTRACTION_MODEL,
        });

        // Phase 1 prescan: text-layer peer-review marker scan (fast path for
        // digital PDFs). Phase 2 prescan: vision-based scan over pages whose
        // text layer is empty (scanned image pages). Both must complete
        // before any event-extraction call so § 145.64 marker detection
        // cannot be bypassed by a scanned page mid-document.
        const peerPages: number[] = [];
        const visionCandidates: number[] = [];
        const textLayerStart = Date.now();
        for (let p = 1; p <= numPages; p++) {
            const items = await getPageItems(pdf, p);
            const plain = itemsToPlainText(items);
            if (textContainsPeerReviewMarker(plain)) {
                peerPages.push(p);
            } else if (pageNeedsVisionRaster(items)) {
                visionCandidates.push(p);
            }
        }
        console.info("[extraction/run] text-layer scan complete", {
            runId,
            numPages,
            peerPages: peerPages.length,
            visionCandidates: visionCandidates.length,
            elapsedMs: Date.now() - textLayerStart,
        });
        let visionRasterCache = new Map<number, RasterCacheEntry>();
        if (visionCandidates.length > 0 && peerPages.length === 0) {
            // Skip the vision prescan if a text-layer hit already mandates a
            // halt: the result would not change extraction outcome.
            if (!storageEnabled) {
                const errMsg =
                    "Scanned pages present but object storage (R2) is disabled; cannot run § 145.64 vision prescan.";
                await bumpSeq(db, runId, {
                    status: "failed",
                    error: errMsg,
                    completed_at: new Date().toISOString(),
                });
                return { ok: false, error: errMsg };
            }
            console.info("[extraction/run] vision prescan starting", {
                runId,
                pages: visionCandidates.length,
                model: EXTRACTION_MODEL,
            });
            const prescanStart = Date.now();
            try {
                const prescan = await visionPrescanPeerReviewMarkers({
                    pdf,
                    pageNums: visionCandidates,
                    userId,
                    documentId,
                    runId,
                    model: EXTRACTION_MODEL,
                    apiKeys,
                    storageEnabled,
                });
                console.info("[extraction/run] vision prescan complete", {
                    runId,
                    pages: visionCandidates.length,
                    elapsedMs: Date.now() - prescanStart,
                    markerPages: prescan.markerPages.length,
                });
                for (const entry of prescan.rasterCache.values()) {
                    allRasterKeys.add(entry.rasterKey);
                }
                visionRasterCache = prescan.rasterCache;
                for (const p of prescan.markerPages) peerPages.push(p);
                peerPages.sort((a, b) => a - b);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                const errMsg = `Vision peer-review prescan failed: ${msg.slice(0, 500)}`;
                await bumpSeq(db, runId, {
                    status: "failed",
                    error: errMsg,
                    completed_at: new Date().toISOString(),
                });
                return { ok: false, error: errMsg };
            }
        }
        if (peerPages.length > 0) {
            const { error: flagErr } = await db
                .from("document_red_flags")
                .insert({
                    document_id: documentId,
                    extraction_run_id: runId,
                    rule_id: "peer_review_detected",
                    supports_element: "duty",
                    severity: "high",
                    summary: `Peer-review / QI markers detected on page(s): ${peerPages.join(", ")}. Extraction halted per Minn. Stat. 145.64.`,
                    supporting_event_ids: [],
                });
            if (flagErr) {
                // The audit row is the legal basis for halting. If we cannot
                // persist it, do not silently mark the run failed with a
                // peer-review reason — surface the underlying error so a
                // human can investigate.
                console.error(
                    "[extraction/peer_review_flag_insert]",
                    { runId, documentId, peerPages, error: flagErr },
                );
                const errMsg = `Failed to record peer-review red flag: ${flagErr.message}`;
                await bumpSeq(db, runId, {
                    status: "failed",
                    error: errMsg.slice(0, 2000),
                    completed_at: new Date().toISOString(),
                });
                return { ok: false, error: errMsg };
            }
            const errMsg =
                "Peer-review-protected content (Minn. Stat. 145.64): extraction halted.";
            await bumpSeq(db, runId, {
                status: "failed",
                error: errMsg,
                completed_at: new Date().toISOString(),
            });
            return { ok: false, error: errMsg };
        }

        // Per-page extraction. Returns ok+events on success; ok:false on
        // fatal failure (caller aborts the whole run). Pages are processed
        // in parallel batches of MAIN_LOOP_CONCURRENCY so a 3K-page run that
        // would take days serially completes in hours. All shared mutable
        // state (allRasterKeys) is only mutated via methods that are safe
        // for concurrent adds; pdfjs page handles are read-only.
        type PageResult =
            | { ok: true; pageNum: number; events: DocumentEventInsert[] }
            | { ok: false; pageNum: number; errMsg: string };

        async function processPage(pageNum: number): Promise<PageResult> {
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.0 });
            const items = await getPageItems(pdf, pageNum);
            const needsRaster = pageNeedsVisionRaster(items);
            let visionB64: string | undefined;

            if (needsRaster) {
                if (!storageEnabled) {
                    return {
                        ok: false,
                        pageNum,
                        errMsg: `Page ${pageNum}: scanned page requires object storage (R2) for vision extraction.`,
                    };
                }
                const cached = visionRasterCache.get(pageNum);
                if (cached) {
                    visionB64 = cached.pngBase64;
                } else {
                    try {
                        const { png } = await renderPageToPngBuffer(
                            pdf,
                            pageNum,
                        );
                        visionB64 = png.toString("base64");
                        const rasterKey = extractionPageRasterKey(
                            userId,
                            documentId,
                            runId,
                            pageNum,
                        );
                        await uploadFile(
                            rasterKey,
                            png.buffer.slice(
                                png.byteOffset,
                                png.byteOffset + png.byteLength,
                            ) as ArrayBuffer,
                            "image/png",
                        );
                        allRasterKeys.add(rasterKey);
                    } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        return {
                            ok: false,
                            pageNum,
                            errMsg: `Page ${pageNum}: raster/vision failed: ${msg.slice(0, 500)}`,
                        };
                    }
                }
            }

            const pageText = itemsToPlainText(items);
            const userContent = needsRaster
                ? `Page number: ${pageNum}\nPage width (PDF user space): ${viewport.width}\nPage height (PDF user space): ${viewport.height}\n\nA PNG of this page is attached (downscaled if large). Extract events; source_bbox values must be PDF user space coordinates for this width and height.`
                : `Page number: ${pageNum}\nPage width: ${viewport.width}\nPage height: ${viewport.height}\n\nPage text (may be incomplete if scanned):\n${pageText.slice(0, PAGE_TEXT_CHAR_CAP)}`;

            let lastErr: Error | null = null;
            let toInsert: DocumentEventInsert[] = [];
            for (
                let attempt = 0;
                attempt <= MAX_JSON_REPAIR_ATTEMPTS;
                attempt++
            ) {
                const repair =
                    attempt > 0
                        ? `\nYour previous output was invalid JSON. Emit ONLY the JSON object, no prose. Attempt ${attempt + 1}.`
                        : "";
                const rawText = await completeMedMalExtractionPage({
                    model: EXTRACTION_MODEL,
                    systemPrompt: SYSTEM_PROMPT + repair,
                    userContent,
                    visionPngBase64: visionB64,
                    maxTokens: PAGE_MAX_OUTPUT_TOKENS,
                    apiKeys,
                });
                if (!rawText.trim()) {
                    lastErr = new Error("empty model output");
                    continue;
                }
                try {
                    const parsed = parseEventsJson(rawText);
                    const normalized = normalizeLlmEvents(
                        parsed,
                        documentId,
                        runId,
                        pageNum,
                        viewport.width,
                        viewport.height,
                    );
                    toInsert = normalized.events;
                    if (hasAnyDrops(normalized.dropped)) {
                        console.warn("[extraction/normalize_dropped]", {
                            runId,
                            pageNum,
                            kept: normalized.events.length,
                            dropped: normalized.dropped,
                        });
                    }
                    lastErr = null;
                    break;
                } catch (e) {
                    lastErr =
                        e instanceof Error
                            ? e
                            : new Error("JSON parse failed");
                }
            }
            if (lastErr) {
                return {
                    ok: false,
                    pageNum,
                    errMsg: `Page ${pageNum}: ${lastErr.message}`,
                };
            }
            return { ok: true, pageNum, events: toInsert };
        }

        let completed = 0;
        for (
            let batchStart = 1;
            batchStart <= numPages;
            batchStart += MAIN_LOOP_CONCURRENCY
        ) {
            const batchEnd = Math.min(
                batchStart + MAIN_LOOP_CONCURRENCY - 1,
                numPages,
            );
            const tasks: Promise<PageResult>[] = [];
            for (let p = batchStart; p <= batchEnd; p++) {
                tasks.push(processPage(p));
            }
            const results = await Promise.all(tasks);
            // Sort by page number so persistence + log ordering is predictable
            // (Promise.all preserves array order already, but be explicit).
            results.sort((a, b) => a.pageNum - b.pageNum);

            const failure = results.find((r) => !r.ok);
            if (failure && !failure.ok) {
                await bumpSeq(db, runId, {
                    status: "failed",
                    error: failure.errMsg,
                    pages_complete: completed,
                    completed_at: new Date().toISOString(),
                });
                return { ok: false, error: failure.errMsg };
            }

            // Persist events for each successfully-extracted page. Per-page
            // insert (not batched across pages) keeps citation rows scoped
            // to their source page in case a later DB error happens —
            // partial-on-disk is preferable to all-or-nothing for a
            // multi-hour run.
            for (const r of results) {
                if (!r.ok) continue; // unreachable due to failure check
                if (r.events.length === 0) continue;
                try {
                    await insertDocumentEvents(db, r.events);
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    console.error("[extraction/insertDocumentEvents]", {
                        runId,
                        pageNum: r.pageNum,
                        error: msg,
                    });
                }
            }

            completed += results.length;
            await bumpSeq(db, runId, { pages_complete: completed });
            // Periodic progress log: at the end of each batch + headline
            // milestones. Avoids spamming the console once concurrency is
            // high (8 pages per batch × 3075 / 8 = 384 batches).
            const passedMilestone =
                completed === results.length || // first batch
                Math.floor(completed / 25) >
                    Math.floor((completed - results.length) / 25) ||
                completed === numPages;
            if (passedMilestone) {
                console.info("[extraction/run] page complete", {
                    runId,
                    completed,
                    numPages,
                });
            }
        }

        const { data: eventRows } = await db
            .from("document_events")
            .select(
                "id, document_id, event_date, encounter_type, narrative, dx_codes, procedures, vitals, source_page",
            )
            .eq("extraction_run_id", runId);
        const events = (eventRows ?? []) as DocumentEventRow[];
        const flags = runDeterministicRedFlags(events);
        if (flags.length) {
            const { error: flagErr } = await db
                .from("document_red_flags")
                .insert(
                    flags.map((f) => ({
                        document_id: documentId,
                        extraction_run_id: runId,
                        rule_id: f.rule_id,
                        supports_element: f.supports_element,
                        severity: f.severity,
                        summary: f.summary,
                        supporting_event_ids: f.supporting_event_ids,
                    })),
                );
            if (flagErr) {
                console.error("[extraction/red_flag_insert]", {
                    runId,
                    documentId,
                    count: flags.length,
                    error: flagErr,
                });
            }
        }
        await bumpSeq(db, runId, {
            status: "complete",
            completed_at: new Date().toISOString(),
            error: null,
        });
        return { ok: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        try {
            await bumpSeq(db, runId, {
                status: "failed",
                error: msg.slice(0, 2000),
                completed_at: new Date().toISOString(),
            });
        } catch {
            /* ignore secondary failure */
        }
        return { ok: false, error: msg.slice(0, 2000) };
    } finally {
        // Best-effort end-of-run raster sweep. Both prescan- and main-loop-
        // owned rasters go through this single path so a failure mid-run
        // does not leak R2 objects.
        if (allRasterKeys.size > 0) {
            await Promise.all(
                Array.from(allRasterKeys).map((key) =>
                    deleteFile(key).catch(() => {
                        /* best-effort */
                    }),
                ),
            );
        }
    }
}

export async function resolvePdfPathForVersion(version: {
    pdf_storage_path: string | null;
    storage_path: string;
}): Promise<string | null> {
    if (version.pdf_storage_path) return version.pdf_storage_path;
    const ft = version.storage_path.toLowerCase();
    if (ft.endsWith(".pdf")) return version.storage_path;
    return null;
}
