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
- **NEW** `frontend/src/app/components/tabular/builtinTabularSchemas.ts` — `BUILTIN_TABULAR_SCHEMAS` array with `{ id, title, description, columns_config }` for the ten med-mal-case schemas (see below). **This is the only place column specs for templates live.** Existing `BUILT_IN_WORKFLOWS` in `frontend/.../workflows/builtinWorkflows.ts` is left alone; if the user wants these to also appear in the workflow picker later, that's a v1.1 follow-up.
- `frontend/src/app/components/projects/NewProjectModal.tsx` — add a Template select directly under the name field, matching the dropdown style used in `AddNewTRModal.tsx:272–346` for consistency.
- `frontend/src/app/lib/mikeApi.ts:84–94` — `createProject` gains optional `template_id` arg.
- `frontend/src/app/(pages)/projects/[projectId]/page.tsx` (or the project detail component) — render a "Recommended tabular reviews" strip when `project.template_id` is set. Buttons open the existing `AddNewTRModal` pre-populated with the matching schema's `columns_config`. Reuses the existing API; no new endpoint.

## Templates and schemas — content

### Template: `med-mal-case` ("Medical Malpractice Case")

Subfolders (parent references use **array-index** to avoid name-collision ambiguity — addresses Plan-agent Issue 2):

| idx | name | parent |
|-----|------|--------|
| 0 | `medical-records` | — |
| 1 | `bills-and-eobs` | — |
| 2 | `correspondence` | — |
| 3 | `depositions` | — |
| 4 | `expert-reports` | — |
| 5 | `pleadings` | — |
| 6 | `imaging` | 0 (under medical-records) |
| 7 | `mental-health-records` | — |
| 8 | `expert-affidavits-145682` | — |
| 9 | `hipaa-authorizations` | — |
| 10 | `discovery` | — |
| 11 | `collections-liens-subrogation` | — |
| 12 | `pre-retainer-investigation` | — |

Net v1 count: 12 top-level folders + `imaging` nested under `medical-records` (13 total).

`mental-health-records` is intentionally a top-level sibling, not under `medical-records`. Per the existing Jenn case-memory and Minn. Stat. § 144.293 (heightened consent for mental-health records): MN heightened-confidentiality treatment, separate authorization, never bundle.

`bills-and-eobs` (renamed from `bills`) is now disambiguated from `collections-liens-subrogation`. The split anchors the Minn. Stat. § 548.251 subd. 2(1) collateral-source carve-out: damages-proof documents (charges, EOBs, write-offs) belong in `bills-and-eobs`; subrogation/lien correspondence (Medicare set-asides, ERISA reimbursement letters, attorney collection letters) belongs in `collections-liens-subrogation`. Mixing them obscures the offset calculation at verdict.

`expert-affidavits-145682` segregates the two Minn. Stat. § 145.682 affidavits (subd. 2 "review" served with summons; subd. 4 "identification" served within 180 days of Rule 26.04(a) discovery commencement) from general `expert-reports` so the mandatory-dismissal exposure under subd. 6 is structurally hard to miss. `hipaa-authorizations`, `discovery`, and `pre-retainer-investigation` similarly carve out distinct workstreams (chain-of-custody, Rule 26 pleadings split, attorney-client-privileged intake).

`recommendedSchemaIds`: all ten schemas below.

### Tabular schemas (ten cuts — addresses Plan-agent Issue 8)

ID prefix `builtin-med-*` for medical-records-extraction schemas; `builtin-*` (no `med`) for cross-cutting case schemas like provider-defendant mapping and causation reasoning (consistent with existing `builtin-*` convention — addresses Plan-agent Issue 9):

| ID | Title | Columns (high level) |
|---|---|---|
| `builtin-med-chronology` | Medical Chronology | date, provider, provider_role, setting, episode_of_care, chief_complaint, assessment, plan, page_ref |
| `builtin-med-bills` | Bill Line Items | date_of_service, cpt, description, provider, units, charge, billed_amount, allowed_amount, paid_by_payer, paid_by_patient, written_off_amount, subrogation_or_lien_amount, lien_holder, modifier_flags, payer, page_ref |
| `builtin-med-transfusion-log` | Transfusion Log | timestamp, product_type, unit_id, issue_time, txn_start, txn_stop, indication, consent_documented, crossmatch_documented, clinical_event_window, page_ref |
| `builtin-med-mar` | Medication Administration Record | timestamp, medication, dose, route, ordered_by, administered_by, indication, order_to_admin_delta_minutes, allergy_conflict_flag, weight_based_dose_check, page_ref |
| `builtin-med-vitals-trend` | Vitals Trend | timestamp, hr, sbp, dbp, map, spo2, temp_c, rr, urine_output_ml, ct_output_ml, critical_value_flag, response_documented_within_minutes, page_ref |
| `builtin-med-labs-trend` | Labs Trend | timestamp, hgb, hct, plt, wbc, pt, aptt, inr, fibrinogen, lactate, critical_value_flag, response_documented_within_minutes, lab_communicated_to, page_ref |
| `builtin-med-imaging-index` | Imaging & Procedure Index | date, modality, indication, key_finding, comparison_to_prior, reading_provider, critical_finding_flag, communication_documented, page_ref |
| `builtin-med-red-flags-scan` | Red-Flag Scan | page_ref, finding, category, evidence_quote, supports_element (duty/breach/causation/damages), severity_1_3, false_positive_risk, expert_addressed_in_145682_affidavit, temporal_proximity_to_outcome |
| `builtin-provider-defendant-map` | Provider / Defendant Map | provider_name, role_title, license_number, npi, employer_entity, independent_contractor_or_employee, held_out_as_hospital_provider, patient_reliance_facts, named_in_145682_2_affidavit, named_as_defendant |
| `builtin-causation-chain` | Causation Chain | alleged_breach, mechanism_of_harm, but_for_met, substantial_factor_met, loss_of_chance_applicable, expert_opinion_quote, defendant_alternative_theory, countervailing_evidence |
| `builtin-expert-opinions-145682` | § 145.682 Expert Opinions | expert_name, specialty, affidavit_type, substance_of_facts_summary, substance_of_opinions_summary, grounds_summary, signed_date, served_date, discovery_commenced_2604a_date, 180_day_deadline, compliance_status |

Splits address Plan-agent Issue 8: vitals (continuous monitoring, frequent) and labs (discrete draws) are sampled at different cadences — keeping them in one schema fights the LLM to align rows; splitting yields cleaner extractions. Red-flag scan tags each finding with `supports_element` ∈ {duty, breach, causation, damages} to feed the `legal:legal-risk-assessment` four-element framework. The MN prima facie negligence test is a 3-element formulation — standard of care, departure, causation — under Plutshack v. Univ. of Minn. Hosps., 316 N.W.2d 1, 5 (Minn. 1982) and Smith v. Knowles, 281 N.W.2d 653, 655 (Minn. 1979); damages is universally required as the fourth element of the cause of action, so the four-cut tagging remains operative. Bill-line-item columns implement the Minn. Stat. § 548.251 split so net recoverable damages (after collateral-source offset and the subd. 2(1) subrogation carve-out) can be computed without re-extracting. The three new schemas anchor distinct legal theories: `builtin-provider-defendant-map` operationalizes the Popovich v. Allina Health Sys., 946 N.W.2d 885 (Minn. 2020) two-factor apparent-authority test; `builtin-causation-chain` separates but-for, substantial-factor (Flom v. Flom, 291 N.W.2d 914 (Minn. 1980)), and loss-of-chance (Dickhoff v. Green, 836 N.W.2d 321 (Minn. 2013)) reasoning into auditable rows; `builtin-expert-opinions-145682` logs each affidavit against the subd. 4(a) content checklist so the subd. 6 mandatory-dismissal trap is structurally hard to spring.

### Cited authority

Primary sources the subfolder taxonomy and schemas are built against. Future template revisions should re-check against this same source set.

Statutes (Minn. unless noted):
- Minn. Stat. §§ 145.61–145.67 (peer-review / review-organization privilege; § 145.64 is the operative discovery shield)
- Minn. Stat. § 145.682 (two-affidavit regime; subd. 2 review affidavit, subd. 4(a) identification affidavit content checklist, subd. 6 mandatory dismissal)
- Minn. Stat. §§ 144.291–144.298 (MN Health Records Act); § 144.293 (heightened consent for mental-health records)
- Minn. Stat. § 541.076(b) (4-year med-mal SOL)
- Minn. Stat. § 541.15(b) (minority tolling; healthcare-provider 7-year cap)
- Minn. Stat. § 548.251 (collateral-source offset; subd. 2(1) subrogation carve-out)
- Minn. Stat. § 573.02 subd. 1 & 3 (wrongful-death med-mal SOL and trustee-appointment prerequisite)
- 45 C.F.R. § 164.508 (HIPAA written-authorization elements)

Rules:
- Minn. R. Civ. P. 3.01 (commencement on service of summons or signed waiver — not on filing)
- Minn. R. Civ. P. 26 / 26.04(a) (discovery; 26.04(a) starts the § 145.682(4) 180-day clock)
- Minn. R. Civ. P. 26(b)(3) (work-product doctrine)
- Minn. R. Evid. 408 (settlement communications)
- Minn. R. Prof. Conduct 1.5(c) (contingency-fee writing requirement)
- Minn. Gen. R. Prac. 114 (opt-in ADR)

Cases:
- *Plutshack v. Univ. of Minn. Hosps.*, 316 N.W.2d 1 (Minn. 1982) — 3-element prima facie negligence test
- *Smith v. Knowles*, 281 N.W.2d 653 (Minn. 1979) — original articulation of the prima facie test
- *Reinhardt v. Colton*, 337 N.W.2d 88 (Minn. 1983) — reaffirms Smith; Mulder rule on package-insert deviation
- *Cornfeldt v. Tongen*, 262 N.W.2d 684 (Minn. 1977) — 5-element informed-consent test
- *Dickhoff v. Green*, 836 N.W.2d 321 (Minn. 2013) — recognizes loss-of-chance doctrine
- *Flom v. Flom*, 291 N.W.2d 914 (Minn. 1980) — canonical MN substantial-factor causation cite
- *Popovich v. Allina Health Sys.*, 946 N.W.2d 885 (Minn. 2020) — apparent-authority two-factor test
- *Rock v. Abdullah* (Minn. Ct. App. 2022) — post-Popovich reliance-element limit at summary judgment

Verification of these citations against Revisor of Statutes and Justia primary sources is logged in `docs/RESEARCH_mn_med_mal_law.md` § "Verification log".

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

For the `med-mal-case` template specifically: Batch A inserts 12 top-level folders; Batch B inserts the single `imaging` folder under `medical-records`. Folder depth in v1 templates is ≤ 2 (one level of nesting). If a future template needs deeper hierarchy, extend Batch B to a loop over depth levels — explicit non-goal for v1.

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

**v1.1 follow-up.** Add a second column — `key_dates jsonb null` — to `projects`, populated with the twelve raw date fields and six computed deadlines from `docs/RESEARCH_mn_med_mal_law.md` § 4.2 (e.g., `date_discovery_commenced_2604a`, `deadline_145682_id_affidavit`, `deadline_4yr_sol`, `deadline_outer_limit_wd`). v1 intentionally defers this: per the user's v1 / v1.1 decision, the MVP scope is folder + schema scaffolding; deadline tracking is the v1.1 surface that turns the project page into an active calendar for the Minn. Stat. § 145.682(4) 180-day clock, § 541.076(b) 4-year SOL, and § 573.02 wrongful-death 3-year cutoff.

## Verification

End-to-end manual test (frontend + backend running per CLAUDE.md commands):

1. `npm run dev --prefix backend` and `npm run dev --prefix frontend`.
2. Apply the schema delta to the Supabase project (one-time).
3. Open the frontend, click "+ Create New" on the projects page.
4. Verify the new "Template" dropdown appears with **"None (blank project)"** and **"Medical Malpractice Case"**.
5. Select "Medical Malpractice Case", enter a name like "Test MedMal", submit.
6. Confirm the project is created and redirected-to.
7. Confirm the twelve top-level subfolders appear in the folder tree (13 total with `imaging` nested under `medical-records`).
8. Confirm the "Recommended tabular reviews" strip is visible on the project page with the ten schema buttons.
9. Click "+ Medical Chronology". Confirm `AddNewTRModal` opens with the nine columns pre-populated (date, provider, provider_role, setting, episode_of_care, chief_complaint, assessment, plan, page_ref).
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
- **No deadline-tracking widget in v1.** The Minn. Stat. § 145.682(4) 180-day clock (running from Rule 26.04(a) discovery commencement, *not* summons service — a recurring gotcha), § 541.076(b) 4-year med-mal SOL, and § 573.02 3-year wrongful-death deadline are tracked manually until v1.1 lands the `key_dates jsonb` column described in the Schema change section. The folder taxonomy (`expert-affidavits-145682`) makes the affidavit workstream structurally visible even without a widget, but does not compute deadlines.

## Estimated effort

- Backend: ~80 LOC (route changes + template registry + shared IDs).
- Frontend: ~150 LOC (modal change + recommended strip + two registries).
- Schema: 1 LOC + a one-line ALTER applied to the live DB.
- No tests to write (project has no test runner per `CLAUDE.md`).
- Total: roughly half a day of focused work, end-to-end testable in one session.
