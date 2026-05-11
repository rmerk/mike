# Plan: Mike project templates — "Medical Malpractice Case"

## Context

Ryan is using **mike** (the in-house Next.js + Express app at `/Users/rchoi/Personal/mike/`) for an active medical malpractice matter (Jenn Choi cardiac-surgery case). The case-investigation workflow already lives in markdown + the `legal:*` skill suite; mike's role is bulk record storage and extraction (Option A → C path from the prior structured-RPI Phase 3).

Today, every new case requires the same boilerplate: create the project, create the same six or seven subfolders by hand, then create the same tabular reviews by hand and re-type the same column schemas. We just did this manually for Jenn while triaging a 3,075-page Epic ebook — the column schemas we needed (chronology, bills, transfusion log, MAR, vitals, labs, imaging index, red-flag scan) were obvious in retrospect and will recur on every future med-mal matter.

**Outcome:** a "Medical Malpractice Case" template that, when chosen at project-create time, scaffolds the standard subfolder structure and registers reusable tabular-review column schemas the user can instantiate on documents as they arrive. Templates are pure code/config + one new column on `projects`; no engine, no catalog feature. Operationalizes what we already know works without locking in any premature abstraction.

## Scope — v1

In scope:
- A registry of project templates (initially one: `med-mal-case`).
- A registry of tabular-review column schemas referenced by the template.
- Backend `POST /projects` accepts optional `template_id`; on a valid template it batch-creates subfolders and persists `template_id` on the project row.
- Frontend project-create modal gets a template picker.
- A "Recommended tabular reviews" strip on the project page (one-click buttons that open the existing `AddNewTRModal` pre-populated with the schema's `columns_config`).

Out of scope for v1:
- Auto-creating empty tabular reviews (reviews need documents — the buttons do this on demand).
- User-defined templates / template CRUD UI.
- A `template_id` column on `tabular_reviews` for provenance.
- Migrating existing projects to retroactively claim a template.

## Files to be modified

**Backend:**
- `backend/schema.sql` — add `template_id text null` to `projects` table (~line 90).
- `backend/src/lib/builtinWorkflows.ts` — leave the chat-workflow shape untouched (the Plan agent confirmed adding tabular schemas here breaks the assistant prompt-lookup at `chatTools.ts:~3242`).
- **NEW** `backend/src/lib/builtinProjectTemplates.ts` — exports `BUILTIN_PROJECT_TEMPLATES` with the `med-mal-case` template (id, name, description, subfolders, recommendedSchemaIds).
- `backend/src/routes/projects.ts:75–98` — extend `POST /projects` to accept `template_id`, validate against registry (400 on unknown), batch-insert subfolders.

**Shared types (single file, imported by both halves to prevent ID drift — addresses Plan-agent Issue 6):**
- **NEW** `backend/src/lib/templateIds.ts` — exports a TypeScript string-literal union `ProjectTemplateId` and `TabularSchemaId`. ~15 LOC. Frontend imports this same file via a relative path or via a tsconfig path alias — confirm at implementation time which the existing build supports; if neither works cleanly, duplicate the ~15 LOC and add a one-line comment in each pointing at the other.

**Frontend:**
- **NEW** `frontend/src/app/components/projects/builtinProjectTemplates.ts` — frontend-side mirror with `{ id, name, description, recommendedSchemaIds }`. Backend doesn't need `name`/`description` (it never renders them); frontend doesn't need `subfolders` (server creates them). Disjoint bodies, shared IDs.
- **NEW** `frontend/src/app/components/tabular/builtinTabularSchemas.ts` — `BUILTIN_TABULAR_SCHEMAS` array with `{ id, title, description, columns_config }` for the seven med-mal schemas (see below). **This is the only place column specs for templates live.** Existing `BUILT_IN_WORKFLOWS` in `frontend/.../workflows/builtinWorkflows.ts` is left alone; if the user wants these to also appear in the workflow picker later, that's a v1.1 follow-up.
- `frontend/src/app/components/projects/NewProjectModal.tsx` — add a Template select directly under the name field, matching the dropdown style used in `AddNewTRModal.tsx:272–346` for consistency.
- `frontend/src/app/lib/mikeApi.ts:84–94` — `createProject` gains optional `template_id` arg.
- `frontend/src/app/(pages)/projects/[projectId]/page.tsx` (or the project detail component) — render a "Recommended tabular reviews" strip when `project.template_id` is set. Buttons open the existing `AddNewTRModal` pre-populated with the matching schema's `columns_config`. Reuses the existing API; no new endpoint.

## Templates and schemas — content

### Template: `med-mal-case` ("Medical Malpractice Case")

Subfolders (parent references use **array-index** to avoid name-collision ambiguity — addresses Plan-agent Issue 2):

| idx | name | parent |
|-----|------|--------|
| 0 | `medical-records` | — |
| 1 | `bills` | — |
| 2 | `correspondence` | — |
| 3 | `depositions` | — |
| 4 | `expert-reports` | — |
| 5 | `pleadings` | — |
| 6 | `imaging` | 0 (under medical-records) |
| 7 | `mental-health-records` | — |

`mental-health-records` is intentionally a top-level sibling, not under `medical-records`. Per the existing Jenn case-memory: MN heightened-confidentiality treatment, separate authorization, never bundle.

`recommendedSchemaIds`: all seven schemas below.

### Tabular schemas (seven cuts — addresses Plan-agent Issue 8)

ID prefix `builtin-med-*` (consistent with existing `builtin-*` convention — addresses Plan-agent Issue 9):

| ID | Title | Columns (high level) |
|---|---|---|
| `builtin-med-chronology` | Medical Chronology | date, provider, setting, chief_complaint, assessment, plan, page_ref |
| `builtin-med-bills` | Bill Line Items | date_of_service, cpt, description, provider, units, charge, paid, adjustment, modifier_flags, payer, page_ref |
| `builtin-med-transfusion-log` | Transfusion Log | timestamp, product_type, unit_id, issue_time, txn_start, txn_stop, indication, clinical_event_window, page_ref |
| `builtin-med-mar` | Medication Administration Record | timestamp, medication, dose, route, ordered_by, administered_by, indication, page_ref |
| `builtin-med-vitals-trend` | Vitals Trend | timestamp, hr, sbp, dbp, map, spo2, temp_c, rr, urine_output_ml, ct_output_ml, page_ref |
| `builtin-med-labs-trend` | Labs Trend | timestamp, hgb, hct, plt, wbc, pt, aptt, inr, fibrinogen, lactate, page_ref |
| `builtin-med-imaging-index` | Imaging & Procedure Index | date, modality, indication, key_finding, comparison_to_prior, reading_provider, page_ref |
| `builtin-med-red-flags-scan` | Red-Flag Scan | page_ref, finding, category, evidence_quote, supports_element (duty/breach/causation/damages), severity_1_3, false_positive_risk |

Splits address Plan-agent Issue 8: vitals (continuous monitoring, frequent) and labs (discrete draws) are sampled at different cadences — keeping them in one schema fights the LLM to align rows; splitting yields cleaner extractions. Red-flag scan gets a `supports_element` column to feed the `legal:legal-risk-assessment` four-element framework.

Each schema's full `columns_config` (with the per-column `prompt` field that the existing tabular extractor consumes) is defined in `builtinTabularSchemas.ts`. Prompts are tuned per column for Mayo/Epic ebook formatting (e.g., the chronology `date` prompt explicitly says "extract calendar date in MM/DD/YYYY format; if multiple dates appear in one note, use the date of service, not the date of charting").

## Backend: `POST /projects` change

Reuses the existing `createServerSupabase()` client. New behavior:

1. Parse `{ name, cm_number?, shared_with?, template_id? }`.
2. If `template_id` is provided and not in `BUILTIN_PROJECT_TEMPLATES`, return `400 { detail: "unknown template_id" }`. (Plan-agent Issue 4.)
3. Insert the project row with `template_id` set when present.
4. If template applies, expand `subfolders` into two batched inserts (Plan-agent Issue 3):
   - **Batch A**: all entries with no `parent`. Single `.insert([...]).select("id, name")` to capture the new UUIDs.
   - **Batch B**: all entries with `parent`. Resolve the array-index `parent` to the UUID returned in Batch A. Single `.insert([...])`.
   - On any error in either batch: delete the project (CASCADE removes any folders already created) and return 500. **Atomic from the user's perspective** even though Postgres-side it isn't truly transactional. Document this behavior in a one-line comment.
5. Response includes the new `subfolders` array so the frontend doesn't need a second round-trip.

Folder depth in v1 templates is ≤ 2 (one level of nesting). If a future template needs deeper hierarchy, extend Batch B to a loop over depth levels — explicit non-goal for v1.

## Frontend wiring

`NewProjectModal.tsx`:
- New `templateId` state, default `null`.
- Dropdown labeled "Template" between the name field and the cm_number field. Options: "None (blank project)" + each entry from `BUILTIN_PROJECT_TEMPLATES`. Selected option's description renders as helper text below.
- On submit, pass `templateId` to the updated `createProject`. On success, redirect to the project page as today.

Project page recommended-reviews strip:
- Conditional on `project.template_id`. Fetch the matching template from the local registry (the IDs are a TS string-literal union — same source of truth as backend).
- Render one button per `recommendedSchemaIds` entry: "+ Medical Chronology", "+ Bill Line Items", etc.
- Click opens `AddNewTRModal` with `columns_config` pre-populated from `BUILTIN_TABULAR_SCHEMAS[id].columns_config`. The user picks documents as today.
- This is the v1 "Quick add" payoff — closes the loop from template choice to instantiated review without auto-creating empty rows. (Plan-agent Issue 7.)

## Schema change

In `backend/schema.sql`, immediately after the existing `projects` columns:

```sql
template_id text null,
```

No `migrations/` directory exists. Per `CLAUDE.md` convention, fresh DBs use `schema.sql` directly. For Ryan's Supabase project `qkfcrsrtualqdmqqexpf` (the live one), apply the column with an inline `alter table public.projects add column if not exists template_id text null;` either via the Supabase MCP `apply_migration` tool or by hand in the Supabase SQL editor. Document this in the PR.

## Verification

End-to-end manual test (frontend + backend running per CLAUDE.md commands):

1. `npm run dev --prefix backend` and `npm run dev --prefix frontend`.
2. Apply the schema delta to the Supabase project (one-time).
3. Open the frontend, click "+ Create New" on the projects page.
4. Verify the new "Template" dropdown appears with **"None (blank project)"** and **"Medical Malpractice Case"**.
5. Select "Medical Malpractice Case", enter a name like "Test MedMal", submit.
6. Confirm the project is created and redirected-to.
7. Confirm the eight subfolders appear in the folder tree, with `imaging` nested under `medical-records`.
8. Confirm the "Recommended tabular reviews" strip is visible on the project page with the seven schema buttons.
9. Click "+ Medical Chronology". Confirm `AddNewTRModal` opens with seven columns pre-populated (date, provider, setting, chief_complaint, assessment, plan, page_ref).
10. Upload a small test PDF, complete the review creation, confirm extraction runs.

Failure-path tests:
11. POST to `/projects` directly with `template_id: "nonexistent"`. Expect 400.
12. Create a project with template, then verify in Supabase Table Editor that `projects.template_id = 'med-mal-case'` and the subfolders all have correct `parent_folder_id` UUIDs.
13. (Manual) Simulate a Supabase write failure on Batch B by temporarily breaking permissions and confirm the project + any Batch A folders are cleaned up.

Type checks:
- `npm run build --prefix backend` — passes (TypeScript narrows on `template_id` discriminant).
- `npm run build --prefix frontend` — passes.

## Risks accepted

- **Frontend/backend mirror drift on `subfolders` content.** The shared `templateIds.ts` enforces ID-level alignment, but not folder-list alignment. If the backend template's subfolders change without the frontend's `recommendedSchemaIds` being updated, the strip still works (it's keyed by IDs, not folders) — accept.
- **Tabular schemas live on the frontend only.** The backend never sees `columns_config` for templates — it's only sent in `createTabularReview` payloads at instantiation time. This is fine for v1; if a future feature wants server-side schema introspection, move `builtinTabularSchemas.ts` into a shared workspace then.
- **One template, one matter type.** The whole feature is built to serve med-mal first. If Ryan later wants a second template (e.g., personal injury, contract dispute), the registry pattern accommodates it but the UI may need polish (a longer dropdown, descriptions in a tooltip). Defer.
- **No template versioning.** Projects created today are tagged with `template_id = 'med-mal-case'`; if the template's subfolder list changes next month, existing projects are not retro-migrated. Accept — this matches how `BUILTIN_WORKFLOWS` already behaves.

## Estimated effort

- Backend: ~80 LOC (route changes + template registry + shared IDs).
- Frontend: ~150 LOC (modal change + recommended strip + two registries).
- Schema: 1 LOC + a one-line ALTER applied to the live DB.
- No tests to write (project has no test runner per `CLAUDE.md`).
- Total: roughly half a day of focused work, end-to-end testable in one session.
