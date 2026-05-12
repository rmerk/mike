# Phase 3 — Templates ↔ Extraction integration

## Context

Phase 2 ships a citation-anchored event log (`document_events`) keyed by `(document_id, extraction_run_id)` containing per-encounter rows with dates, providers, encounters, narratives, medications, vitals, and `(source_page, source_bbox)` references. Phase 3 surfaces that data to the user as a fast, citation-grounded chronology — satisfying the roadmap §Phase 3 verification gate:

> "opening + Medical Chronology on a fully-extracted document takes < 2s (no LLM call); same operation on a non-extracted document falls back to existing extraction."

## Design tension surfaced by exploration

Every interesting med-mal tabular schema (`builtin-med-chronology`, `builtin-med-mar`, `builtin-med-vitals-trend`, `builtin-med-labs-trend`, `builtin-med-bills`) has **per-encounter / per-administration / per-line-item** columns. But `tabular_cells` is keyed `(review_id, document_id, column_index)` — exactly one cell per `(doc, column)`. A document with 200 events × 5 medications each cannot render as a single tabular row without collapsing the per-row semantics that make the schema useful (sort, filter, inspect per-event).

Earlier drafts of this plan included a "Rail B" idea: tag schemas as `eventLogBacked` and populate cells from event-log SQL. That doesn't actually work — collapsing many events into one cell loses the grid's value. The honest Phase 3 scope is a **separate Timeline surface** that doesn't try to fit into `tabular_reviews` at all.

## Approach — Timeline view (single rail)

`+ Medical Chronology` on an extracted document opens a new route `/projects/[id]/timeline/[docId]` that renders `document_events` rows directly:

- One row per event, sorted by `event_date` then `event_time`.
- Columns: date · provider · provider_role · encounter_type · episode_of_care · narrative · page_ref.
- Bbox-citation chip per row; clicking scrolls the embedded PDF preview to `source_page` and highlights the bbox.
- Filter chips for `privacy_class` (default: hide `peer_review_145_64` even though the SQL excludes it — defense-in-depth; never display events that should not exist).

Reads via the existing `GET /extraction/:documentId/events` ([backend/src/routes/extraction.ts:308](backend/src/routes/extraction.ts:308)). **No new backend code.** Zero LLM calls. Sub-2s by construction.

Other tabular schemas (MAR, vitals, bills, etc.) remain on the existing LLM path. Surfacing their event-log analogs is a clean Phase 3.5+ follow-up — same pattern, different lens (e.g., `/projects/[id]/mar/[docId]`).

The §83 roadmap idea of tabular reviews "consulting" the event log for date-anchoring is a separate enhancement to the existing LLM extractor, decoupled from this PR.

## MVP scope (this PR)

1. **Timeline view**
   - New route [frontend/src/app/(pages)/projects/[id]/timeline/[docId]/page.tsx](frontend/src/app/(pages)/projects/[id]/timeline/[docId]/page.tsx).
   - Reuses `DocView` (PDF preview + bbox highlight) and `listMedMalDocumentEvents` (already exported from [frontend/src/app/lib/mikeApi.ts](frontend/src/app/lib/mikeApi.ts) per the existing extraction page imports — confirm).
   - Layout: left = `DocView`, right = events table; click-row syncs bbox.
   - Empty state: "No events yet — run extraction first" with a link to `/projects/[id]/extraction`.

2. **Routing from `+ Medical Chronology`**
   - On [frontend/src/app/components/projects/ProjectPage.tsx](frontend/src/app/components/projects/ProjectPage.tsx), the recommended-reviews strip routes the chronology button to Timeline when at least one PDF document on the project has `document_extractions.status='complete'`.
   - If multiple extracted docs: small picker (modal or popover) listing them; clicking one navigates to `/projects/[id]/timeline/[docId]`.
   - If zero extracted docs: existing tabular-create modal flow (no behavior change).

3. **No backend changes.** No new tables. No migrations. No `tabular_cells` touching. No schema-tag concept.

## Out of scope (Phase 3.5+ candidates)

- Equivalent views for MAR, vitals, labs, bills (each its own Timeline-style surface with different columns).
- Date-anchoring: tabular-review LLM extractors consulting the event log to anchor extracted dates onto known encounters. Useful but architecturally distinct from this PR.
- Cross-document Timeline (merging events from multiple records into one chronology).
- Persisted user filters / saved views on the Timeline.

## Critical files

- [frontend/src/app/(pages)/projects/[id]/timeline/[docId]/page.tsx](frontend/src/app/(pages)/projects/[id]/timeline/[docId]/page.tsx) — **new**.
- [frontend/src/app/components/projects/ProjectPage.tsx](frontend/src/app/components/projects/ProjectPage.tsx) — recommended-reviews strip → Timeline routing + multi-doc picker.
- [frontend/src/app/lib/mikeApi.ts](frontend/src/app/lib/mikeApi.ts) — likely no changes; the existing `listMedMalDocumentEvents` and `getMedMalExtractionStatus` are exactly what we need. Add `getMedMalExtractionStatus` batched-by-document_ids helper only if Project Page needs it for the "any-doc-extracted?" gate. May be simpler to read `documents[].extraction_status` already on the project payload — verify.
- [frontend/src/app/components/shared/DocView.tsx](frontend/src/app/components/shared/DocView.tsx) — reuse, no changes expected.
- [backend/src/routes/extraction.ts:308](backend/src/routes/extraction.ts:308) — reused as-is.

## Verification

1. **Manual end-to-end** (primary):
   - Open a med-mal project containing an extracted document.
   - Click `+ Medical Chronology` on the recommended-reviews strip.
     - If multiple extracted docs exist: picker appears → pick one.
   - Timeline route loads with PDF preview on the left and event table on the right; load time <2s (browser devtools network panel, no `/chat` or `/tabular-review/*/generate` traffic).
   - Click an event row → PDF preview scrolls to `source_page`, bbox highlight overlays the citation.
   - On a project with **no** extracted documents: clicking `+ Medical Chronology` opens the existing tabular-create modal (unchanged).

2. **Type + build**: `npm run build --prefix frontend` and `npm run lint --prefix frontend` clean. Backend untouched, but `npm run build --prefix backend` should still pass.

3. **No regressions** on `/projects/[id]/extraction` (the during-extraction view) — share `DocView` + `listMedMalDocumentEvents` but the route itself is untouched.

## Followups captured during implementation

(Filled in as we go — placeholder.)
