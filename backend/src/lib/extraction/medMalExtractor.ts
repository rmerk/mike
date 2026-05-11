import {
    downloadFile,
    uploadFile,
    deleteFile,
    extractionPageRasterKey,
    storageEnabled,
} from "../storage";
import { completeClaudeMedMalExtractionPage } from "../llm";
import { providerForModel } from "../llm/models";
import type { UserApiKeys } from "../llm/types";
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
    insertDocumentEvents,
    type DocumentEventInsert,
} from "./eventLog";
import { runDeterministicRedFlags, type DocumentEventRow } from "./redFlags";

type Db = ReturnType<typeof createServerSupabase>;

// Vision/image input goes through the Anthropic-specific page extractor, so
// non-Claude models cannot satisfy the contract. Validate at boot and again at
// run-start (route handler) so a misconfigured env fails fast, not mid-run.
const DEFAULT_EXTRACTION_MODEL = "claude-sonnet-4-6";

export function resolveExtractionModel(): string {
    const configured = process.env.MED_MAL_EXTRACTION_MODEL?.trim();
    const model = configured || DEFAULT_EXTRACTION_MODEL;
    if (providerForModel(model) !== "claude") {
        throw new Error(
            `MED_MAL_EXTRACTION_MODEL must be a Claude model (vision required). Got: ${model}`,
        );
    }
    return model;
}

const EXTRACTION_MODEL = resolveExtractionModel();

// 1 initial attempt + 2 repair attempts is empirically enough for transient
// JSON glitches without burning tokens on persistently broken responses.
const MAX_JSON_REPAIR_ATTEMPTS = 2;

const SYSTEM_PROMPT = `You extract structured clinical timeline events from ONE page of a medical record PDF.
Return ONLY valid JSON (no markdown fences) with this exact shape:
{"events":[{"event_date":null,"event_time":null,"event_date_text":null,"provider":null,"provider_role":null,"episode_of_care":null,"encounter_type":"admission"|"ed"|"clinic"|"lab"|"imaging"|"op"|"nursing"|"note"|null,"privacy_class":"standard","key_date_role":null,"dx_codes":null,"medications":null,"vitals":null,"procedures":null,"narrative":"string max 500 chars","source_page":NUMBER,"source_bbox":{"x":number,"y":number,"w":number,"h":number}}]}
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
    | "zero_area_bbox";

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
            medications: o.medications ?? null,
            vitals: o.vitals ?? null,
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
        dropped.zero_area_bbox > 0
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

        const peerPages: number[] = [];
        for (let p = 1; p <= numPages; p++) {
            const items = await getPageItems(pdf, p);
            const plain = itemsToPlainText(items);
            if (textContainsPeerReviewMarker(plain)) peerPages.push(p);
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

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            let rasterKey: string | null = null;
            try {
                const page = await pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale: 1.0 });
                const items = await getPageItems(pdf, pageNum);
                const needsRaster = pageNeedsVisionRaster(items);
                let visionB64: string | undefined;

                if (needsRaster) {
                    if (!storageEnabled) {
                        const errMsg =
                            "Scanned page requires object storage (R2) for vision extraction.";
                        await bumpSeq(db, runId, {
                            status: "failed",
                            error: `${errMsg} (page ${pageNum})`,
                            pages_complete: pageNum - 1,
                            completed_at: new Date().toISOString(),
                        });
                        return { ok: false, error: errMsg };
                    }
                    try {
                        const { png } = await renderPageToPngBuffer(
                            pdf,
                            pageNum,
                        );
                        visionB64 = png.toString("base64");
                        rasterKey = extractionPageRasterKey(
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
                    } catch (e) {
                        const msg =
                            e instanceof Error ? e.message : String(e);
                        const errMsg = `Page ${pageNum}: raster/vision failed: ${msg.slice(0, 500)}`;
                        await bumpSeq(db, runId, {
                            status: "failed",
                            error: errMsg,
                            pages_complete: pageNum - 1,
                            completed_at: new Date().toISOString(),
                        });
                        return { ok: false, error: errMsg };
                    }
                }

                const pageText = itemsToPlainText(items);
                const userContent = needsRaster
                    ? `Page number: ${pageNum}\nPage width (PDF user space): ${viewport.width}\nPage height (PDF user space): ${viewport.height}\n\nA PNG of this page is attached (downscaled if large). Extract events; source_bbox values must be PDF user space coordinates for this width and height.`
                    : `Page number: ${pageNum}\nPage width: ${viewport.width}\nPage height: ${viewport.height}\n\nPage text (may be incomplete if scanned):\n${pageText.slice(0, 120000)}`;

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
                    const rawText = await completeClaudeMedMalExtractionPage({
                        model: EXTRACTION_MODEL,
                        systemPrompt: SYSTEM_PROMPT + repair,
                        userContent,
                        visionPngBase64: visionB64,
                        maxTokens: 8192,
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
                            console.warn(
                                "[extraction/normalize_dropped]",
                                {
                                    runId,
                                    pageNum,
                                    kept: normalized.events.length,
                                    dropped: normalized.dropped,
                                },
                            );
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
                    const errMsg = `Page ${pageNum}: ${lastErr.message}`;
                    await bumpSeq(db, runId, {
                        status: "failed",
                        error: errMsg,
                        pages_complete: pageNum - 1,
                        completed_at: new Date().toISOString(),
                    });
                    return { ok: false, error: errMsg };
                }
                if (toInsert.length) {
                    try {
                        await insertDocumentEvents(db, toInsert);
                    } catch (e) {
                        // Per-page persistence failures (bad citation, DB
                        // error) must not abort the whole run after partial
                        // pages already landed. Log and continue with the
                        // next page.
                        const msg = e instanceof Error ? e.message : String(e);
                        console.error("[extraction/insertDocumentEvents]", {
                            runId,
                            pageNum,
                            error: msg,
                        });
                    }
                }
                await bumpSeq(db, runId, { pages_complete: pageNum });
            } finally {
                if (rasterKey)
                    await deleteFile(rasterKey).catch(() => {
                        /* best-effort */
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
