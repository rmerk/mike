# Plan: Med-mal structured extraction pipeline

Companion to [RESEARCH_legal_rag.md](./RESEARCH_legal_rag.md). This is the
Mike-specific build plan derived from Lane 4 of that research: how to turn a
3,000-page Epic medical record into a defensible chronology with page+bbox
citations and a deterministic red-flag layer.

## Context

Med-mal cases routinely arrive as 1,500–3,000+ page Epic PDFs (e.g., Jenn's
`responsetorequest1-ebook.pdf` at 3,075 pages). Two facts about that:

- **Reliable context windows are smaller than advertised.** A 3,000-page PDF is
  roughly 1–1.5M tokens, which exceeds the *reliable* portion of every current
  frontier model (Claude 200K nominal → ~130K reliable, Gemini 1M nominal →
  ~650K reliable). Long-context injection on its own is not load-bearing for
  this corpus size.
- **Deliverables are citation-bound.** A chronology, red-flag list, and missing-
  records gap analysis are only defensible when every claim points back to a
  specific page and region of the chart. "Show me where that's in the record"
  is the standard opposing-counsel response; bounding-box-level citation is the
  production standard at EvenUp / Chronicle / Superinsight.

This pipeline lets the existing long-context + tool-use core remain the engine
for synthesis, while adding a one-time structured extraction pass that produces
a JSON event log anchored to `{source_page, source_bbox}` and a deterministic
red-flag library running over that log.

## Scope

**In:**
- One-shot per-record extraction pass → JSON event log persisted in Postgres.
- Page-level + bounding-box citations enforced at the application layer.
- A v1 red-flag rule library (five rules) running over the event log.
- Page-window retrieval for chat — the existing chat agent queries the structured
  log instead of dumping whole PDFs.
- Side-by-side UI: original PDF on the left (existing `DocView`), event timeline
  + red-flag list on the right; click an event to highlight its bbox.

**Out (deferred — see "Out of scope" at the end):**
- Vector embedding store, GraphRAG, fine-tuned embeddings, ColBERT.
- Cross-case search ("every shoulder-dystocia case in our firm").
- Automated demand-letter generation.

## Architecture

```
upload → convert (if DOC/DOCX) → page-by-page multimodal extraction
       → JSON event log (Postgres) → red-flag rules
       → chat with page-window retrieval (existing chat engine)
```

The extraction pass is async (minutes per record, not seconds). Chat reads
from the event log; the original PDF is only re-fetched for the specific pages
referenced by a query.

## Files to be modified / created

### New backend modules

- `backend/src/lib/extraction/medMalExtractor.ts` — orchestrator. For each page,
  calls a multimodal LLM via `streamChatWithTools` (from
  `backend/src/lib/llm/index.ts`) against a fixed JSON schema. Persists
  results in `document_events`. Tracks progress in `document_extractions`.
- `backend/src/lib/extraction/eventLog.ts` — Postgres reader/writer for the new
  `document_events` table. Owns the citation-enforcement assertion: any event
  without `source_page` + `source_bbox` is rejected before insert.
- `backend/src/lib/extraction/redFlags.ts` — deterministic rule library. One
  exported function per rule (see "Red-flag library" below).
- `backend/src/lib/extraction/pdfRegions.ts` — net-new bbox primitive.
  `pdfjs-dist`'s `getTextContent()` already returns per-item `transform[]`
  coordinates; today they're discarded in `extractPdfText`
  (`backend/src/lib/chatTools.ts`). This sibling keeps them and exposes a
  `getPageItems(pdf, pageNum) → { text, x, y, w, h }[]` helper.

### New backend route

- `backend/src/routes/extraction.ts`:
  - `POST /extraction/:documentId/run` — kick off async extraction.
  - `GET /extraction/:documentId/events` — list event log.
  - `GET /extraction/:documentId/red-flags` — list red-flag findings.
  - `GET /extraction/:documentId/status` — extraction progress.

  Mount in `backend/src/index.ts` behind `requireAuth` and a new
  `extractionLimiter` cloned from the existing `chatCreateLimiter` pattern.

### Backend extensions

- `backend/src/lib/chatTools.ts` — add three tool defs the chat agent can call:
  - `read_event_log(documentId, filters)` — query structured events.
  - `find_events_in_range(documentId, from, to, encounterType?)` — time-window
    retrieval.
  - `read_pdf_page_region(documentId, page, bbox?)` — fetch text + image for a
    specific page region.
- `backend/src/routes/projectChat.ts` — when the active project type is
  med-mal, prefer event-log retrieval over raw-document injection in the
  system prompt construction (lines ~125–142 today).

### Frontend

- `frontend/src/app/lib/mikeApi.ts` — add helpers mirroring the existing
  `tabular`/`document` shapes:
  - `runExtraction(documentId)`
  - `getExtractionStatus(documentId)`
  - `listDocumentEvents(documentId, filters?)`
  - `listRedFlags(documentId)`
  - `streamExtraction(documentId, onEvent)` — modeled on
    `streamTabularGeneration`.
- `frontend/src/app/(pages)/projects/[id]/extraction/page.tsx` — new view:
  - Left pane: existing `DocView` from
    `frontend/src/app/components/shared/DocView.tsx`.
  - Right pane: event timeline + red-flag list. Each entry is clickable.
  - Click an event/flag → jump to its page in `DocView` and draw a bbox
    highlight overlay (extend
    `frontend/src/app/components/shared/highlightQuote.ts` to accept a bbox
    in addition to a text query).

## Schema change

New migration in `backend/migrations/` (create the directory if it doesn't
exist — per `mike/CLAUDE.md`). Also folded into `backend/schema.sql` for fresh
DB installs:

```sql
create table document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  event_date date,
  event_time time,
  event_date_text text,                 -- raw, when date is ambiguous
  provider text,
  encounter_type text,                  -- admission|ed|clinic|lab|imaging|op|nursing|note
  dx_codes text[],
  medications jsonb,                    -- [{name, dose, route, frequency}]
  vitals jsonb,                         -- {bp, hr, rr, spo2, temp, ...}
  procedures text[],
  narrative text,                       -- short LLM summary, ≤500 chars
  source_page int not null,
  source_bbox jsonb,                    -- {x, y, w, h} in PDF user-space units
  extraction_run_id uuid not null,
  created_at timestamptz default now()
);
create index on document_events (document_id, event_date);
create index on document_events (document_id, encounter_type);

create table document_red_flags (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  rule_id text not null,                -- 'delayed_dx', 'med_error', ...
  severity text not null,               -- 'low'|'medium'|'high'
  summary text not null,
  supporting_event_ids uuid[] not null,
  created_at timestamptz default now()
);

create table document_extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  model text not null,
  status text not null,                 -- 'pending'|'running'|'complete'|'failed'
  pages_total int,
  pages_complete int,
  started_at timestamptz,
  completed_at timestamptz,
  error text
);
```

No backfill needed (new tables). RLS policies should match the pattern used by
`documents` (filtered by `user_id` join through the parent document).

## Citation enforcement

Every `document_events` row MUST have `source_page` (NOT NULL) and `source_bbox`
(required at the application level, not DB level — partial extractions should
not abort the whole run on a single missing bbox). The extractor refuses to
emit an event row if it cannot anchor it.

This is "no source, no answer" baked into the type. It is the single most
important rule in this whole plan. Without it, the chronology becomes
inadmissible under cross-examination.

Reuse the existing `tabular_cells.citations` JSONB convention (the
`[[page:N||quote:...]]` inline format used by the tabular review pipeline) for
display-side citations in chat responses — extend rather than replace.

## Red-flag library (v1)

Five rules, each a deterministic typescript filter over `document_events`. They
*surface candidates for human review*; they do not auto-assert malpractice.
Rules live in `backend/src/lib/extraction/redFlags.ts`, one exported function
per rule, returning `{rule_id, severity, summary, supporting_event_ids[]}`.

- `delayed_dx` — symptom-cluster events ≥ N days before a matching dx code.
- `med_error` — dose outside the reference range for a given diagnosis.
- `retained_foreign_object` — op note + post-op imaging mentioning hardware
  not accounted for in the op-note count.
- `failure_to_monitor` — vitals gap > X hours during a high-acuity encounter
  (ICU, post-op, ED).
- `informed_consent_gap` — procedure event with no consent event in the 48h
  prior.

V1 deliberately ships narrow rather than comprehensive — expand once the gold
set (see Verification) tells us where the model's recall is good enough.

## Reuse map

Symbols already in the repo that this plan uses (do not reinvent):

- `streamChatWithTools`, `completeText` — `backend/src/lib/llm/index.ts`
- `providerForModel`, `resolveModel`, `DEFAULT_MAIN_MODEL` —
  `backend/src/lib/llm/models.ts`
- `uploadFile`, `downloadFile`, `storageKey`, `pdfStorageKey` —
  `backend/src/lib/storage.ts`
- `docxToPdf`, `convertedPdfKey` — `backend/src/lib/convert.ts`
- `extractPdfText` and the existing `pdfjs-dist` page-iteration loop —
  `backend/src/lib/chatTools.ts` (the new `pdfRegions.ts` extends this loop to
  keep `transform[]` coordinates instead of discarding them)
- `tabular_cells.citations` JSONB and its inline `[[page:N||quote:...]]`
  format — extend for the new event-log → chat citation flow
- `requireAuth` middleware — `backend/src/middleware/auth.ts`
- `chatCreateLimiter` pattern — `backend/src/index.ts` (clone as
  `extractionLimiter`)
- `DocView` — `frontend/src/app/components/shared/DocView.tsx`
- `highlightQuote.ts` (already used for quote highlighting in `DocView`) —
  `frontend/src/app/components/shared/highlightQuote.ts`; extend to accept
  bbox coords in addition to a text query

## Defenses against PHI exfiltration / prompt injection

- Strip OCR text from outside the page's visible frame before passing it to the
  LLM. Adversarial PDFs sometimes embed text in margins or off-page that's
  invisible to a human but readable by the model.
- Sanitize document metadata (EXIF, XMP, PDF info dict, embedded JS) on
  upload.
- Document text is untrusted input. The extractor system prompt must not give
  it authority to call any tool, change any rule, or modify any output schema.
  Tool calls must be triggered only by the orchestrator, never by content
  parsed from the document.
- Adversarial regression suite (see Verification).

## Verification

End-to-end:

1. Pick 2–3 already-triaged Jenn med-mal PDFs (e.g., portions of
   `responsetorequest1-ebook.pdf`, already mapped in
   `RR1_Triage_Map.pdf/md`).
2. Apply the migration to a Supabase **branch** (via Supabase MCP:
   `create_branch` → `apply_migration`). Never touch prod schema directly.
3. Run extraction. Inspect `document_events` for:
   - date parse accuracy (events with `event_date` vs fallback to
     `event_date_text`),
   - encounter classification distribution,
   - dx/med field population rates,
   - page+bbox anchors that actually land on the right text (manual spot check
     of 20 random events).
4. Render in the new extraction UI. Click 10 random events; confirm the bbox
   highlight lands on the claim.
5. Run the red-flag rules. Cross-check against an attorney-validated chronology
   where one exists; record precision/recall.
6. Adversarial set: a synthetic PDF with prompt-injection text in margins,
   mis-OCR'd handwritten notes, ambiguous MM/DD dates. Confirm:
   - no tool-call leakage (the extractor never executes a tool triggered by
     document content),
   - ambiguous dates land in `event_date_text`, not `event_date`,
   - margin-injected instructions are stripped or ignored.
7. Assert at application level: no event row may be persisted without
   `source_page` + `source_bbox`. Add a unit test.

## Risks accepted

- **LLM cost per page.** Multimodal extraction at current pricing runs roughly
  $0.01–0.05 per page. A 3,000-page case = $30–150 in extraction tokens. This
  is acceptable for litigation work where attorney-time savings dominate.
- **Extraction latency.** Minutes per case, not seconds. Async pipeline with a
  progress indicator (`document_extractions.pages_complete / pages_total`)
  rather than a synchronous request.
- **V1 red-flag recall is narrow.** Five rules, not comprehensive. Expansion
  is gated on the gold-set evaluation, not on speculation.
- **No public benchmark for med-mal chronology quality.** We build our own
  gold set from closed cases. Acceptable; matches what EvenUp et al. do.

## Out of scope (and triggers for revisiting)

- **Vector embedding store.** A med-mal case is 1–10 PDFs; there is no
  "millions of documents" retrieval problem. Postgres event log + R2 metadata
  cover retrieval at lower cost and far better debuggability. *Revisit when:*
  cross-case search becomes a feature ("every shoulder-dystocia case in our
  firm").
- **GraphRAG / knowledge graphs.** Right for citators / Shepardizing, wrong
  for one patient's chart. *Revisit when:* we add case-law citation to demand
  letters.
- **Fine-tuned embeddings.** Premature; LegalBench-RAG even shows that a
  general Cohere reranker *hurts* legal retrieval. *Revisit when:* we have a
  measured baseline and a corpus large enough to fine-tune against.
- **ColBERT / sophisticated rerankers.** Not at the QPS or corpus scale that
  justifies them.
- **Automated demand-letter generation.** Lane 1 / case-law territory; partner
  for content (CourtListener is the open option) rather than self-host
  Westlaw.

## Estimated effort

- Backend extraction modules + route + schema migration: ~3–5 days.
- Frontend extraction view + bbox highlight: ~2–3 days.
- Gold-set evaluation harness + adversarial regression suite: ~2 days.
- Red-flag rule library (v1, five rules): ~2 days.

Total: ~2 weeks of focused work for a v1 that's defensible enough to put in
front of a paying attorney.
