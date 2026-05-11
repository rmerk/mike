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
  provider text,                        -- verbatim name; canonical resolution is post-extraction
  provider_role text,                   -- attending|fellow|resident|aprn|crna|rn|perfusionist|pa (Plutshack role-specific SOC)
  episode_of_care text,                 -- index_op|reop|readmission|clinic|ed_visit|... (chronology clustering)
  encounter_type text,                  -- admission|ed|clinic|lab|imaging|op|nursing|note
  privacy_class text not null default 'standard',  -- standard|mental_health_144_293|peer_review_145_64|substance_abuse_42_cfr_part_2
  key_date_role text,                   -- null|negligent_act_candidate|last_treatment_candidate|injury_discovery_candidate|discovery_commenced_2604a_candidate (feeds Phase 4 key_dates jsonb)
  dx_codes text[],
  medications jsonb,                    -- [{name, dose, route, frequency, ordered_by, administered_by, ordered_at, administered_at, indication, allergy_conflict_flag, weight_based_dose_check_passed}] (Mulder rule per Reinhardt)
  vitals jsonb,                         -- {bp, hr, rr, spo2, temp, ...}
  procedures text[],
  narrative text,                       -- short LLM summary, ≤500 chars (redacted-by-default when privacy_class=mental_health_144_293; never populated when privacy_class=peer_review_145_64)
  source_page int not null,
  source_bbox jsonb,                    -- {x, y, w, h} in PDF user-space units
  extraction_run_id uuid not null,
  created_at timestamptz default now()
);
create index on document_events (document_id, event_date);
create index on document_events (document_id, encounter_type);
create index on document_events (document_id, privacy_class);
create index on document_events (document_id, key_date_role) where key_date_role is not null;

create table document_red_flags (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  rule_id text not null,                -- 'delayed_dx', 'med_error', 'temporal_anchor_causation', ...
  supports_element text not null,       -- 'duty'|'breach'|'causation'|'damages' (Plutshack/Smith four-cut tagging)
  severity text not null,               -- 'low'|'medium'|'high'
  summary text not null,
  supporting_event_ids uuid[] not null,
  awaits_expert_affidavit boolean not null default true,  -- flipped to false when builtin-expert-opinions-145682 row marks this flag as addressed (§ 145.682(4)(a))
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
**Additional RLS clause for `document_events`**: default queries filter
`privacy_class != 'peer_review_145_64'`. Rows with that class are written by
the extractor's hard-refuse path (see §Defenses) but never surfaced through
the default reader; explicit project-level toggle required.

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

Six rules, each a deterministic typescript filter over `document_events`. They
*surface candidates for human review*; they do not auto-assert malpractice.
Rules live in `backend/src/lib/extraction/redFlags.ts`, one exported function
per rule, returning `{rule_id, supports_element, severity, summary, supporting_event_ids[]}`.
The `supports_element` value tags each rule against the *Plutshack/Smith*
4-cut framework (duty / breach / causation / damages) so the project page's
red-flag list can be filtered by which prima facie element a flag bolsters.

| rule_id | supports_element | Trigger | Primary authority |
|---|---|---|---|
| `delayed_dx` | breach | Symptom-cluster events ≥ N days before a matching dx code. | *Plutshack/Smith* (departure from SOC) |
| `med_error` | breach | Dose outside the reference range for a given diagnosis; package-insert deviation. | *Reinhardt v. Colton* (Mulder rule) |
| `retained_foreign_object` | breach | Op note + post-op imaging mentioning hardware not accounted for in the op-note count. | *Plutshack/Smith* + common-knowledge exception |
| `failure_to_monitor` | breach | Vitals gap > X hours during a high-acuity encounter (ICU, post-op, ED). | *Plutshack/Smith* |
| `informed_consent_gap` | duty | Procedure event with no consent event in the 48h prior. | *Cornfeldt v. Tongen* (informed-consent duty) |
| `temporal_anchor_causation` | causation | Adverse outcome (narrative matches: arrest, exsanguination, stroke, death, return-to-OR, unexpected ICU transfer) within ≤ N hours of a `delayed_dx` / `med_error` / `failure_to_monitor` finding. Severity scales with temporal proximity. | *Plutshack/Smith* causation skeleton; *Flom v. Flom* substantial-factor |

V1 deliberately ships narrow rather than comprehensive — expand once the gold
set (see Verification) tells us where the model's recall is good enough. The
`temporal_anchor_causation` rule does NOT prove causation (Plutshack/Smith
require expert testimony for causation); it surfaces tight temporal anchors
that sharpen the retained expert's reasoning. Loss-of-chance analysis
(*Dickhoff v. Green*) is reserved for the `builtin-causation-chain` tabular
review.

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

### MN-specific extraction policies

- **§ 145.64 peer-review hard-refuse.** Before any per-page extraction call,
  scan page text (case-insensitive) for peer-review markers: `peer review`,
  `peer-review committee`, `QI committee`, `quality improvement review`,
  `root cause analysis`, `RCA report`, `morbidity and mortality conference`,
  `M&M conference`, `sentinel event review`. If any page matches, **the
  entire document extraction halts immediately**. The extractor emits a
  single `document_red_flags` row with `rule_id='peer_review_detected'`,
  `supports_element='breach'`, `severity='high'`, summary naming the
  matching page numbers — and writes zero `document_events` rows. Minn. Stat.
  § 145.64 makes peer-review records non-discoverable; extracting their
  contents into the event log creates discoverable derivative material and is
  malpractice on the attorney's part. **This is the strictest policy in the
  codebase — refuse, do not redact.**

- **§ 144.293 mental-health redaction-by-default.** When the document-class
  triage marks a page or document as a mental-health record (research § 5.2
  row 3), the extractor sets `privacy_class='mental_health_144_293'` and
  emits a *redacted* event log: dates and `encounter_type` preserved, but
  `narrative`, `dx_codes`, and `medications` left null. Full extraction is
  gated on a project-level toggle that the user only flips after confirming
  the heightened mental-health authorization required by § 144.293 is on
  file. Default is redact.

- **Rule 408 settlement-communications caveat.** Settlement correspondence
  flagged in document-class triage (research § 5.2 row 15 attorney
  correspondence with settlement context) is extracted normally — settlement
  comms are discoverable — but every resulting `document_events.narrative`
  is prefixed with `[Rule 408 — inadmissible to prove liability]`. The
  caveat survives downstream into chat surfaces and the timeline UI so the
  inadmissibility is impossible to miss when assembling exhibits.

- **Rule 26(b)(3) work-product opt-out.** Attorney-correspondence and
  consulting-expert notes flagged with `privileged:work_product_26b3`
  (research § 5.2 rows 12, 15) are NOT extracted by default. Project-level
  opt-in only, with a UI confirmation that explicitly names the
  work-product privilege being waived for indexing purposes.

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
- **Causation-chain reasoning (`builtin-causation-chain` tabular schema
  columns: mechanism_of_harm, but_for_met, substantial_factor_met,
  loss_of_chance_applicable).** Deliberately human-in-the-loop. *Plutshack
  v. Univ. of Minn. Hosps.*, 316 N.W.2d 1, 5 (Minn. 1982) and *Smith v.
  Knowles*, 281 N.W.2d 653, 655 (Minn. 1979) require expert testimony for
  causation unless within common knowledge; deterministic LLM extraction
  cannot substitute. Loss-of-chance under *Dickhoff v. Green*, 836 N.W.2d
  321 (Minn. 2013), is fact-intensive and depends on the plaintiff retaining
  the preponderance burden — also human-in-the-loop. The
  `temporal_anchor_causation` red-flag rule surfaces candidate anchors but
  does not assert causation. *Revisit when:* never — this is permanent
  architectural separation.
- **Provider-defendant entity resolution (`builtin-provider-defendant-map`
  schema columns: held_out_as_hospital_provider, patient_reliance_facts,
  named_as_defendant).** The event log captures `provider` name verbatim
  and `provider_role` from the chart; canonical-entity resolution and
  Popovich apparent-authority analysis (*Popovich v. Allina Health Sys.*,
  946 N.W.2d 885 (Minn. 2020)) are post-extraction work. Why: the two
  Popovich factors (hospital held-out as the provider; patient relied on
  hospital rather than specific physician) are fact-intensive and depend on
  outside-the-record evidence — advertising, patient testimony, intake
  forms. *Revisit when:* a record-only signal correlates strongly enough
  with held-out behavior to be worth automating (probably never — the
  reliance prong almost certainly requires deposition testimony per
  *Rock v. Abdullah* (Minn. Ct. App. 2022) limits).

## Estimated effort

- Backend extraction modules + route + schema migration: ~3–5 days.
- Frontend extraction view + bbox highlight: ~2–3 days.
- Gold-set evaluation harness + adversarial regression suite: ~2 days.
- Red-flag rule library (v1, five rules): ~2 days.

Total: ~2 weeks of focused work for a v1 that's defensible enough to put in
front of a paying attorney.

---

## Plan deltas — MN-law research alignment

Apply in a follow-up turn. Line refs are against this file as of the templates-plan-revisions commit (1247921, 2026-05-11). All deltas are sourced from `docs/RESEARCH_mn_med_mal_law.md` and the validated `docs/PLAN_med_mal_templates.md`.

**Two corrections to internalize first** (mirroring the research format). Both are already correct in this plan as written, but verify before edits land:
- § 145.682 subd. 4's 180-day clock runs from "commencement of discovery under Rule 26.04(a)," not summons service. This plan doesn't claim otherwise; new red-flag rules that depend on the 145.682(4) deadline (none in v1) must reference Rule 26.04(a).
- The MN prima facie negligence test is the 3-element Plutshack/Smith formulation (standard of care, departure, causation). Damages is the fourth element of the cause of action but not of the negligence test. The new `supports_element` tagging across tabular schemas keeps the four-cut categorization for extraction, which is correct.

**Architectural tension flagged for Phase 3 integration:** the event log currently models clinical chronology only (`event_date`, `provider`, `encounter_type`, `dx_codes`, `medications`, `vitals`, `procedures`, `narrative`). The validated templates plan adds 10 tabular review schemas covering bills (§ 548.251 split), transfusions, MAR (Mulder rule), vitals/labs trends, imaging index, red flags, provider/defendant mapping, causation chain, and § 145.682 expert opinions. Most of these don't map cleanly to event-log columns. Phase 3 integration ("populate from event log") must decide: (a) expand the event log to cover every schema column (heavier extraction), or (b) keep per-schema extractor functions that read the PDF directly. Recommend (b) — the event log stays narrow and authoritative; each tabular schema has its own extractor that may *consult* the event log for date-anchoring but extracts schema-specific data independently. This is the cleanest separation of concerns.

1. **`document_events` schema additions (line 132 region)**: add three columns to support Plutshack role-specific standard-of-care and the templates `episode_of_care` clustering: `provider_role text` (attending, fellow, resident, APRN, CRNA, RN, perfusionist, PA — *Plutshack* requires the expert to be qualified to opine on *that* role's standard), `episode_of_care text` (index op, re-op, readmission, clinic visit, etc. — feeds the templates `builtin-med-chronology` clustering at chronology line 75 of the templates plan), and `key_date_role text` (nullable enum: `negligent_act_candidate`, `last_treatment_candidate`, `injury_discovery_candidate`, `discovery_commenced_2604a_candidate` — Phase 4's `key_dates jsonb` widget auto-suggests from this).

2. **`document_events.privacy_class` (NEW column at line 132 region)**: enum `standard | mental_health_144_293 | peer_review_145_64 | substance_abuse_42_cfr_part_2`. The extractor sets this per-page based on document-class triage (research § 5.2 rows 3, 6, 7). Combined with the hard-refuse rule below (delta 8), this is how MN heightened-consent and peer-review-privilege regimes are honored at the data layer. RLS policies in line 169–170 should add a clause filtering `peer_review_145_64` rows from default queries (must be explicitly requested).

3. **`document_events.medications jsonb` shape (line 134)**: extend per-item shape from `{name, dose, route, frequency}` to `{name, dose, route, frequency, ordered_by, administered_by, ordered_at, administered_at, indication, allergy_conflict_flag, weight_based_dose_check_passed}`. The two flag fields feed the **Mulder rule** under *Reinhardt v. Colton*, 337 N.W.2d 88 (Minn. 1983) — deviation from package-insert dosing is prima facie evidence of negligence when accompanied by competent medical testimony. `ordered_at` and `administered_at` enable the templates `order_to_admin_delta_minutes` derived column for the MAR schema.

4. **`document_red_flags.supports_element` (NEW column at line 146 region)**: enum `duty | breach | causation | damages`. Required, not null. Mirrors `builtin-med-red-flags-scan.supports_element` from the templates plan. Each red-flag rule (line 187–204) emits with the element it supports tagged. Without this column the rule library remains breach-only by accident (see delta 7).

5. **`document_red_flags.awaits_expert_affidavit boolean default true` (NEW column at line 146 region)**: closes the loop with § 145.682(4)(a) affidavit content checklist (substance of facts, opinions, grounds). When the corresponding `builtin-expert-opinions-145682` tabular review row marks the affidavit as addressing this flag, an explicit reconciliation pass flips this to `false`. Until then, the project page's red-flag list can highlight "N flags awaiting expert affidavit" — operationally critical given subd. 6's mandatory-dismissal exposure.

6. **Red-flag library rebalance (lines 187–204)**: tag each of the 5 existing rules with its `supports_element`. As-written: `delayed_dx` → breach (arguably causation when delay caused harm), `med_error` → breach, `retained_foreign_object` → breach, `failure_to_monitor` → breach, `informed_consent_gap` → duty (informed-consent duty under *Cornfeldt v. Tongen*, 262 N.W.2d 684 (Minn. 1977)). **All five are breach- or duty-anchored — no causation rule.** Add one causation-anchoring rule for v1: `temporal_anchor_causation` — a documented adverse outcome (event with `narrative` matching outcome keywords: arrest, exsanguination, stroke, death, return-to-OR) within ≤ N hours of a `delayed_dx`/`med_error`/`failure_to_monitor` finding. Severity scales with the temporal proximity. This is the *Plutshack/Smith* causation skeleton in deterministic form; expert testimony still required for trial, but the temporal anchor sharpens the expert's reasoning.

7. **§ 145.64 peer-review hard-refuse (extend §Defenses, lines 229–240)**: add a pre-extraction triage step that scans page text for peer-review markers (case-insensitive: `peer review`, `peer-review committee`, `QI committee`, `quality improvement`, `root cause analysis`, `RCA report`, `morbidity and mortality`, `M&M conference`, `sentinel event review`). If detected on any page, **the entire document extraction halts**; the extractor emits a `document_red_flags` row with `rule_id='peer_review_detected'`, severity=`high`, and the supporting page numbers. **Do not extract any event-log rows from such documents.** § 145.64 makes these documents non-discoverable; extracting their contents into the event log creates discoverable derivative material and is malpractice on the attorney's part. Document this as the strictest extraction policy in the codebase.

8. **§ 144.293 mental-health policy (extend §Defenses)**: when `privacy_class = mental_health_144_293`, the extractor produces a *redacted* event log (narrative omitted, specific diagnoses suppressed, only encounter dates + general encounter type preserved). The full content is only extracted on explicit project-level toggle once the case has signed the heightened mental-health authorization required by § 144.293. Mirror the templates plan's segregation of `mental-health-records/` as a top-level folder.

9. **Explicit out-of-scope for v1 extraction (extend §Out of scope, line 284 region)**: name two surfaces that are *intentionally* not in extraction scope, with rationale:
   - **Causation-chain reasoning** (`builtin-causation-chain` tabular schema columns: mechanism_of_harm, but_for_met, substantial_factor_met, loss_of_chance_applicable). Reserved for post-extraction tabular review or chat. Why: *Plutshack/Smith* require expert testimony for causation unless within common knowledge; deterministic LLM extraction cannot substitute. Loss-of-chance under *Dickhoff v. Green*, 836 N.W.2d 321 (Minn. 2013), is fact-intensive and requires the *plaintiff retains preponderance burden* framing. Human-in-the-loop.
   - **Provider-defendant entity resolution** (`builtin-provider-defendant-map` schema columns: held_out_as_hospital_provider, patient_reliance_facts, named_as_defendant). The event log extracts `provider` name verbatim; canonical-entity resolution and Popovich apparent-authority analysis (*Popovich v. Allina Health Sys.*, 946 N.W.2d 885 (Minn. 2020)) are post-extraction. Why: the two Popovich factors (hospital held-out + patient reliance) are fact-intensive and depend on outside-the-record evidence (advertising, patient testimony).

10. **§Defenses MN-specific additions (lines 229–240)**: append three policies:
   - **§ 145.64 peer-review hard-refuse** (per delta 7).
   - **§ 144.293 mental-health redaction-by-default** (per delta 8).
   - **Rule 408 settlement-communications caveat**: events extracted from settlement correspondence (privacy_class is `standard` but document-class triage flagged it as settlement) get a `narrative` prefix `[Rule 408 — inadmissible to prove liability]`. The event is extracted because settlement comms are discoverable, but the inadmissibility caveat survives downstream into the chat/UI surface.
   - **Rule 26(b)(3) work-product opt-out**: consulting-expert notes flagged in the document-class triage (research § 5.2 row 12, attorney-correspondence with `privileged:work_product_26b3`) are NOT extracted by default. Project-level opt-in only.

---

## Cited authority — quick reference

**Statutes (Minn. unless noted):**
- Minn. Stat. §§ 145.61–145.67 (peer-review / review-organization privilege; § 145.64 is the operative discovery shield) — delta 7
- Minn. Stat. § 145.682 subd. 4(a), subd. 6 (affidavit content checklist + mandatory dismissal) — delta 5
- Minn. Stat. § 144.293 (heightened consent for mental-health records) — delta 8
- 42 C.F.R. Part 2 (federal substance-abuse-record confidentiality) — delta 2 enum
- Minn. R. Civ. P. 26(b)(3) (work-product doctrine) — delta 10
- Minn. R. Evid. 408 (settlement communications) — delta 10

**Cases:**
- *Plutshack v. Univ. of Minn. Hosps.*, 316 N.W.2d 1 (Minn. 1982) — 3-element prima facie test; role-specific standard of care — deltas 1, 6, 9
- *Smith v. Knowles*, 281 N.W.2d 653 (Minn. 1979) — original articulation of the prima facie test — deltas 6, 9
- *Reinhardt v. Colton*, 337 N.W.2d 88 (Minn. 1983) — Mulder rule on package-insert deviation — delta 3
- *Cornfeldt v. Tongen*, 262 N.W.2d 684 (Minn. 1977) — informed-consent duty — delta 6
- *Dickhoff v. Green*, 836 N.W.2d 321 (Minn. 2013) — loss-of-chance doctrine — delta 9
- *Popovich v. Allina Health Sys.*, 946 N.W.2d 885 (Minn. 2020) — apparent-authority two-factor test — delta 9

Verification of all cites: see `docs/RESEARCH_mn_med_mal_law.md` § "Verification log" (Revisor of Statutes + Justia primary-source spot-checks performed 2026-05-11).
