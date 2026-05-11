# Minnesota Medical Malpractice Law — Validation of the mike `med-mal-case` Template

**Author:** Ryan Choi / research pass by Claude
**Date:** 2026-05-11
**Purpose:** Stress-test `docs/PLAN_med_mal_templates.md` against Minnesota primary sources before any code lands. Each section ends with a "Template implications" subsection naming the concrete plan edits the research supports.
**Scope:** Plaintiff-side, Minnesota state-court venue. Federal law only where it directly applies (HIPAA records-access timelines).

---

## Two corrections to internalize first

Spot-checking the initial research pass against the Revisor of Statutes surfaced two errors that the original `PLAN_med_mal_templates.md` and Jenn's case `CLAUDE.md` both inherit.

1. **§ 145.682 subd. 4's 180-day clock runs from "commencement of discovery under Rule 26.04(a)" — not from commencement of the action.** The statute is explicit: the affidavit-of-expert-identification must be served "within 180 days after commencement of discovery under the Rules of Civil Procedure, rule 26.04(a)." Minn. Stat. § 145.682, subd. 4(a). Practitioner gotcha — the clock is downstream of the initial Rule 26.04(a) discovery conference, not the summons service that commences the action under Minn. R. Civ. P. 3.01.
2. **The canonical MN prima facie negligence test is a 3-element formulation** — standard of care, departure, and causation — with damages implicit. Plutshack v. Univ. of Minn. Hosps., 316 N.W.2d 1, 5 (Minn. 1982); see also Smith v. Knowles, 281 N.W.2d 653, 655 (Minn. 1979); reaffirmed Reinhardt v. Colton, 337 N.W.2d 88 (Minn. 1983); cited in Dickhoff v. Green, 836 N.W.2d 321, 329 (Minn. 2013). The 5-element test in Plutshack at 4–5 (citing Cornfeldt v. Tongen, 262 N.W.2d 684 (Minn. 1977)) is specifically the informed-consent test, not general negligence.

---

## 1. Subfolder taxonomy

### 1.1 Authority
- Minn. Stat. § 145.682, subd. 2 & 4 (2024) — two-affidavit regime; subd. 6 mandates dismissal for non-compliance.
- Minn. Stat. §§ 145.61–145.67 (2024) — peer-review/review-organization privilege; § 145.64 is the operative discovery shield.
- Minn. Stat. §§ 144.291–144.298 (2024) (MN Health Records Act) + 45 C.F.R. § 164.508 (HIPAA) — written authorization requirements; § 144.293 carves mental-health records out for heightened consent.
- Minn. R. Civ. P. 26 — discovery; 26.04(a) is the trigger for § 145.682(4).
- Minn. Stat. § 548.251 (2024) — collateral-source rule drives the bills/EOBs vs. collections/liens split.
- Minn. R. Prof. Conduct 1.5(c) — contingency-fee writing requirement.
- Minn. Gen. R. Prac. 114 — non-mandatory ADR.

### 1.2 Findings
- **No pre-suit notice statute** for MN med-mal. Unlike Florida (Fla. Stat. § 766.106) or Indiana, MN does not require a Notice of Intent before filing. A `pre-suit-notice` folder is therefore not needed. A `pre-retainer-investigation` folder is still defensible — it houses the engagement letter, the Initial Claim Investigation Agreement (cf. Jenn case-memory: Matonich Law signed-but-pre-retainer), and intake notes that are attorney-client privileged from day one.
- **§ 145.682 affidavits live and die on their own timeline.** The subd. 2 "affidavit-of-expert-review" is served *with the summons and complaint*; the subd. 4 "affidavit-of-expert-identification" is served within 180 days of Rule 26.04(a) discovery commencement. Both have statutory content checklists (subd. 3 and subd. 4(a)). Mandatory dismissal under subd. 6 for failure. Segregate from the general `expert-reports` flow so missing the deadline becomes structurally hard.
- **HIPAA authorizations are a distinct workstream.** Signed forms, the records-request cover letters they ride with, and custodian acknowledgments (production receipts) form a chain of custody for every record set produced.
- **Mental-health records segregation** (already in plan) confirmed correct by § 144.293's separate-consent regime. The case-memory has explicit history of this gotcha.
- **Settlement/mediation.** MN has no mandatory ADR (Gen. R. Prac. 114 is opt-in by court order). Rule 408, Minn. R. Evid., makes settlement communications inadmissible to prove liability — but they remain discoverable. A segregated folder is a v1.1 nice-to-have; v1 can park them in `correspondence`.
- **Trial exhibits.** Premature for v1; exhibits emerge from discovery in established cases.
- **Bills vs. liens.** § 548.251 subd. 2(1) excludes amounts "for which a subrogation right has been asserted" from the collateral-source offset. One `bills` folder conflates damages-proof documents (what was billed → what was paid) with collateral-source-offset documents (insurance EOBs, written-off contractuals) with subrogation-carve-out documents (Medicare set-asides, ERISA plan reimbursement letters). Split.
- **Discovery vs. pleadings.** Rule 26 discovery (interrogatories, RFPs, RFAs, depositions, expert disclosures) is a distinct workstream from Rule 7–12 pleadings (complaint, answer, motions, orders). Conflating them obscures privilege review and disclosure-deadline tracking.
- **Damages-expert reports** (life-care plans, vocational, economic loss) share enough structure with general expert reports that a filename prefix is sufficient at v1 — no separate folder needed.

### 1.3 Template implications

| Action | Folder | Rationale |
|---|---|---|
| ADD top-level | `expert-affidavits-145682` | § 145.682 subd. 2 & 4 mandatory-dismissal exposure |
| ADD top-level | `hipaa-authorizations` | § 144.291–.298 + § 144.293 chain-of-custody |
| ADD top-level | `discovery` | Rule 26 workstream distinct from pleadings |
| ADD top-level | `collections-liens-subrogation` | § 548.251 subd. 2(1) collateral-source carve-out |
| ADD top-level | `pre-retainer-investigation` | Attorney-client privilege from intake |
| RENAME | `bills` → `bills-and-eobs` | Disambiguates from collections folder |
| DEFER v1.1 | `settlement-mediation` | Park in `correspondence` until needed |
| DEFER v1.1 | `trial-exhibits` | Emerges post-discovery |
| KEEP | `medical-records`, `imaging` (nested), `mental-health-records`, `correspondence`, `depositions`, `expert-reports`, `pleadings` | Already correct |

**Net v1 count:** 12 top-level folders + `imaging` nested under `medical-records` (13 total).

---

## 2. Tabular review schemas

### 2.1 Authority
- *Plutshack v. Univ. of Minn. Hosps.*, 316 N.W.2d 1, 5 (Minn. 1982) — prima facie test: standard of care, departure, causation (expert testimony required unless within common knowledge).
- *Smith v. Knowles*, 281 N.W.2d 653, 655 (Minn. 1979) — original articulation of the prima facie test.
- *Reinhardt v. Colton*, 337 N.W.2d 88 (Minn. 1983) — reaffirms Smith; **Mulder rule**: deviation from a drug's package-insert recommendations is prima facie evidence of negligence when accompanied by competent medical testimony of causation.
- *Cornfeldt v. Tongen*, 262 N.W.2d 684 (Minn. 1977); *Plutshack* at 4 — 5-element informed-consent test (duty to know risk, duty to disclose, breach, causation, damages).
- *Dickhoff v. Green*, 836 N.W.2d 321 (Minn. 2013) — recognizes **loss-of-chance** doctrine in MN med-mal; plaintiff retains preponderance burden but proves "physician's negligence substantially reduced the patient's chance of recovery or survival."
- *Flom v. Flom*, 291 N.W.2d 914 (Minn. 1980) — canonical MN statement of the **substantial-factor** causation test (premises-liability fact pattern, but the causation framework is general MN tort law).
- *Popovich v. Allina Health Sys.*, 946 N.W.2d 885 (Minn. 2020) — **apparent-authority vicarious liability** of hospitals for independent-contractor physicians (two-factor test: hospital held itself out as provider, patient relied on hospital rather than specific physician).
- Minn. Stat. § 145.682, subd. 4(a) — affidavit content checklist.
- Minn. Stat. § 548.251 — collateral-source post-verdict offset.

### 2.2 Per-schema column additions

**`builtin-med-chronology`** — current: date, provider, setting, chief_complaint, assessment, plan, page_ref.
- ADD `episode_of_care` (e.g., index op / re-op / readmission / clinic visit). Direct hit on the Jenn case: 5/19 index op, 5/20 takeback, and 1/27/2026 sternal-wire removal are three distinct episodes that should cluster.
- ADD `provider_role` (attending, fellow, resident, APRN, CRNA, RN, perfusionist, PA). Standard of care varies by role; *Plutshack* requires the expert to be qualified to opine on *that* role's standard.

**`builtin-med-bills`** — current: date_of_service, cpt, description, provider, units, charge, paid, adjustment, modifier_flags, payer, page_ref.
- ADD `billed_amount` — chargemaster figure.
- ADD `allowed_amount` — payer-contracted amount (often much less than billed).
- ADD `paid_by_payer` — actual insurance/government disbursement.
- ADD `paid_by_patient` — deductible / copay / coinsurance.
- ADD `written_off_amount` — contractual adjustment; **not a damages claim**.
- ADD `subrogation_or_lien_amount` and `lien_holder` — § 548.251 subd. 2(1) carve-out.
- REMOVE `paid` and `adjustment` (replaced by the more specific columns above).
- These columns together let the case compute net recoverable damages after § 548.251 offsets without re-extracting.

**`builtin-med-transfusion-log`** — current: timestamp, product_type, unit_id, issue_time, txn_start, txn_stop, indication, clinical_event_window, page_ref.
- ADD `consent_documented` (Y/N + page_ref) — informed-consent disclosure for elective transfusion under Cornfeldt/Plutshack. Emergency transfusion follows a different consent regime.
- ADD `crossmatch_documented` (Y/N) — ABO/Rh verification is standard of care.

**`builtin-med-mar`** — current: timestamp, medication, dose, route, ordered_by, administered_by, indication, page_ref.
- ADD `order_to_admin_delta_minutes` — late administration is a recurring breach signal.
- ADD `allergy_conflict_flag` (Y/N) — auto-check against documented allergies; ignored allergy is a per-se breach pattern.
- ADD `weight_based_dose_check` (Y/N) — feeds **Mulder rule** under *Reinhardt*; deviation from pharmacy reference dosing is prima facie evidence.

**`builtin-med-vitals-trend`** — current: timestamp, hr, sbp, dbp, map, spo2, temp_c, rr, urine_output_ml, ct_output_ml, page_ref.
- ADD `critical_value_flag` (Y/N) — auto-set when a vital crosses an institutional critical-value threshold.
- ADD `response_documented_within_minutes` — minutes between critical-value crossing and the first documented clinical response. The Jenn case is exactly the shape that needs this: HR 88 → 133 from 00:00 → 02:00 on 5/20 with documented hypotension at ~02:00. The breach question is whether the rising HR triggered escalation in real time.

**`builtin-med-labs-trend`** — current: timestamp, hgb, hct, plt, wbc, pt, aptt, inr, fibrinogen, lactate, page_ref.
- ADD `critical_value_flag` (Y/N).
- ADD `response_documented_within_minutes`.
- ADD `lab_communicated_to` — Mayo's Epic builds a "critical result called to…" string; capture the recipient. Failure to communicate a critical lab is a recurring liability theory.

**`builtin-med-imaging-index`** — current: date, modality, indication, key_finding, comparison_to_prior, reading_provider, page_ref.
- ADD `critical_finding_flag` (Y/N).
- ADD `communication_documented` (to whom, when, how) — failure to communicate critical radiology findings is a recurring breach pattern.

**`builtin-med-red-flags-scan`** — current: page_ref, finding, category, evidence_quote, supports_element (duty/breach/causation/damages), severity_1_3, false_positive_risk.
- ADD `expert_addressed_in_145682_affidavit` (Y/N + affidavit page_ref) — closes the loop between extracted red flags and the § 145.682(4)(a) affidavit content checklist.
- ADD `temporal_proximity_to_outcome` (hours) — supports causation linkage; *Plutshack/Smith* require expert testimony for causation, and a tight temporal anchor sharpens the expert's reasoning.
- KEEP `supports_element` ∈ {duty, breach, causation, damages}. While *Plutshack/Smith* state a 3-element prima facie test, MN also treats damages as a required element of the cause of action — Dobbs, Law of Torts § 196. The four-cut categorization remains operative for extraction tagging.

### 2.3 New schemas

**`builtin-provider-defendant-map`** (NEW) — every clinician/entity that touched the patient.
- Columns: `provider_name`, `role_title`, `license_number`, `npi`, `employer_entity`, `independent_contractor_or_employee`, `held_out_as_hospital_provider` (apparent-authority Popovich factor 1), `patient_reliance_facts` (Popovich factor 2), `named_in_145682_2_affidavit` (Y/N), `named_as_defendant` (Y/N).
- Authority: respondeat superior (universal MN tort law) + apparent-authority theory (*Popovich v. Allina Health Sys.*, 946 N.W.2d 885 (Minn. 2020) — two-factor test). The two columns `held_out_as_hospital_provider` and `patient_reliance_facts` map directly to the Popovich test.
- Caveat: post-Popovich, MN courts have dismissed apparent-authority claims at summary judgment where the reliance element was not evidenced (e.g., *Rock v. Abdullah* (2022) — patient chose her own surgeon). The reliance column is therefore not optional — it's the chokepoint.

**`builtin-causation-chain`** (NEW) — explicit causation reasoning rows.
- Columns: `alleged_breach`, `mechanism_of_harm`, `but_for_met` (Y/N + brief), `substantial_factor_met` (Y/N + brief), `loss_of_chance_applicable` (Y/N — *Dickhoff* trigger), `expert_opinion_quote`, `defendant_alternative_theory`, `countervailing_evidence`.
- Authority: *Plutshack/Smith* (causation requires expert testimony unless common knowledge); *Flom v. Flom*, 291 N.W.2d 914 (Minn. 1980) (substantial-factor); *Dickhoff v. Green*, 836 N.W.2d 321 (Minn. 2013) (loss-of-chance recognized — relevant when negligence reduced but did not solely cause harm, e.g., delayed-diagnosis cases).

**`builtin-expert-opinions-145682`** (NEW) — § 145.682 affidavit compliance log.
- Columns: `expert_name`, `specialty`, `affidavit_type` (`subd2_review` or `subd4_id`), `substance_of_facts_summary`, `substance_of_opinions_summary`, `grounds_summary`, `signed_date`, `served_date`, `discovery_commenced_2604a_date`, `180_day_deadline`, `compliance_status`.
- Authority: § 145.682 subd. 4(a) — affidavit must contain expert identity, substance of facts, substance of opinions, summary of grounds. Subd. 6: failure to comply triggers mandatory dismissal upon motion.

### 2.4 Template implications

| Schema | Action | Source authority |
|---|---|---|
| `builtin-med-chronology` | + 2 columns | *Plutshack* (role-specific standard of care) |
| `builtin-med-bills` | Restructure damages columns | § 548.251 |
| `builtin-med-transfusion-log` | + consent, crossmatch | *Cornfeldt/Plutshack* informed consent |
| `builtin-med-mar` | + 3 columns | *Reinhardt* Mulder rule |
| `builtin-med-vitals-trend` | + critical-value + response timing | Breach pattern |
| `builtin-med-labs-trend` | + 3 columns | Breach pattern + critical-result communication |
| `builtin-med-imaging-index` | + critical finding + communication | Radiology breach pattern |
| `builtin-med-red-flags-scan` | + 145.682 link + temporal anchor | § 145.682(4)(a) + *Plutshack* causation |
| `builtin-provider-defendant-map` | NEW | *Popovich* two-factor test |
| `builtin-causation-chain` | NEW | *Plutshack*, *Flom*, *Dickhoff* |
| `builtin-expert-opinions-145682` | NEW | § 145.682 subd. 4(a) |

Update `recommendedSchemaIds` in the template (PLAN line 63) to include the three new IDs.

---

## 3. Recommended-review presets

### 3.1 Authority & framing
v1 of the plan surfaces all schemas as one-click buttons (PLAN lines 106–110). Each preset still anchors to one of the prima facie elements (standard of care, departure, causation, damages) or to a statutory filing requirement.

### 3.2 Preset logic

| Schema | When recommended | Anchored to |
|---|---|---|
| Chronology | Always | All four elements |
| Bills | Always | Damages (§ 548.251) |
| Red-flags scan | Always | Breach + causation |
| Provider/Defendant Map | Always | Vicarious-liability defendant selection (*Popovich*) |
| Expert Opinions (§145.682) | Always | Filing-deadline compliance (§ 145.682 subd. 4 & 6) |
| Vitals trend | Inpatient or surgical records present | Breach pattern |
| Labs trend | Inpatient or surgical records present | Breach pattern |
| MAR | Inpatient or surgical records present | Breach (Mulder rule) |
| Transfusion log | "transfusion" appears in any record | Informed consent + breach |
| Imaging index | Imaging-modality keywords (CT/MRI/echo/x-ray/US/PET) hit | Breach (communication-of-findings) |
| Causation chain | After expert is retained (project-level toggle) | Causation (*Plutshack*, *Dickhoff*) |

### 3.3 Template implications
- v1 ships all 11 schema buttons unconditionally; PLAN lines 108–110 already iterate `recommendedSchemaIds`. Conditional filtering is v1.1.
- Each schema description string in `frontend/src/app/components/tabular/builtinTabularSchemas.ts` should name the prima facie element or filing requirement it supports (e.g., "Damages — feeds § 548.251 collateral-source offset"). The "why" surfaces inline rather than via tooltip.

---

## 4. SOL & deadline triggers

### 4.1 Authority
- Minn. Stat. § 541.076(b) (2024): "An action by a patient or former patient against a health care provider alleging malpractice, error, mistake, or failure to cure, whether based on a contract or tort, must be commenced within four years from the date the cause of action accrued."
- Minn. Stat. § 573.02, subd. 1 (2024): wrongful-death med-mal "shall be commenced within three years of the date of death, but in no event shall be commenced beyond the time set forth in section 541.076."
- Minn. Stat. § 573.02, subd. 3 (2024): trustee-appointment prerequisite to suit.
- Minn. Stat. § 145.682, subd. 4(a) (2024): 180 days from "commencement of discovery under the Rules of Civil Procedure, rule 26.04(a)."
- Minn. R. Civ. P. 3.01: action commences on service of summons or signed waiver (NOT on filing — this is the "hip-pocket service" gotcha for SOL screening, separate from the § 145.682(4) clock).
- Minn. R. Civ. P. 26.04(a): the initial discovery conference; starts the § 145.682(4) 180-day clock.
- Minn. Stat. § 541.15, ¶ (b) (2024): minority tolling; healthcare-provider exception caps tolling at "more than seven years, or for more than one year after the disability ceases" (compared to the general five-year cap).

### 4.2 Required date fields on the project

| Field | Purpose |
|---|---|
| `date_of_negligent_act` | § 541.076(b) accrual trigger |
| `date_of_last_treatment_for_condition` | Continuing-treatment doctrine may extend accrual |
| `date_of_injury_discovery` | Rare alternate accrual moment |
| `date_of_death` | § 573.02 subd. 1 trigger (if wrongful death) |
| `date_trustee_appointed` | § 573.02 subd. 3 prerequisite |
| `date_action_commenced_service` | Rule 3.01 — for screening § 541.076(b) compliance |
| `date_action_filed` | Filing date (≠ commencement in MN) |
| `date_discovery_commenced_2604a` | § 145.682(4) clock start — **THE key date** |
| `date_affidavit_review_served` | § 145.682 subd. 2 compliance |
| `date_affidavit_id_served` | § 145.682 subd. 4 compliance |
| `date_plaintiff_reached_majority` | § 541.15(b) tolling end |
| `plaintiff_was_minor_at_accrual` | Toggles minority-tolling logic |

Computed read-only fields:
- `deadline_4yr_sol` = `date_of_negligent_act` + 4 years
- `deadline_3yr_wd` = `date_of_death` + 3 years (or N/A if not wrongful death)
- `deadline_outer_limit_wd` = min(deadline_3yr_wd, deadline_4yr_sol)
- `deadline_145682_id_affidavit` = `date_discovery_commenced_2604a` + 180 days
- `continuing_treatment_flag` = (`date_of_last_treatment_for_condition` > `date_of_negligent_act`)
- `applicable_filing_deadline` = the earliest applicable SOL

### 4.3 Template implications
- ADD a "Key Dates" project-level structured field group. The current PLAN scopes v1 to subfolders + tabular schemas only; adding Key Dates is a substantial expansion of the v1 schema delta at PLAN lines 113–120. **Recommended scope: v1.1** unless the user opts in to v1.
- ADD a dashboard widget on the project page (also v1.1):
  - Red: `applicable_filing_deadline` within 120 days.
  - Yellow: within 12 months.
  - Green: otherwise.
- ADD an accepted-risk bullet to PLAN line 153 noting that v1 does not track these deadlines automatically.

---

## 5. Document-type triage rules (for `legal:triage-nda` med-mal variant)

### 5.1 Authority
- Minn. Stat. §§ 145.61–145.67 (2024) — peer-review/review-organization privilege; § 145.64 is the operative discovery shield; original-source documents are not immunized.
- Minn. Stat. §§ 144.291–144.298 (2024) — MN Health Records Act; § 144.293 heightened consent for mental-health.
- Minn. R. Civ. P. 26(b)(3) — work-product doctrine.
- Minn. R. Prof. Conduct 1.5(c) — fee-agreement writing requirement.
- 45 C.F.R. § 164.508 — HIPAA written-authorization elements.

### 5.2 Document classes and triage rules

Format per row: destination folder, auto-tags, red-flag actions.

| # | Class | Destination | Key tags | Red-flag |
|---|---|---|---|---|
| 1 | Clinical record (notes/op-notes/anesthesia/perfusion/MAR/flowsheets/labs/imaging/path/discharge summary) | `medical-records/` | `document_type:medical_record`, `source:<entity>` | none |
| 2 | Imaging report or image | `medical-records/imaging/` | `modality:<CT|MRI|...>` | none |
| 3 | Mental-health record (psych note, MH assessment, MH discharge) | `mental-health-records/` | `privacy:mn_144_293_heightened` | confirm authorization includes MH scope |
| 4 | UB-04/CMS-1500/itemized bill/EOB/payment ledger | `bills-and-eobs/` | `damages_relevant:yes`, `collateral_source_relevant:yes` | none |
| 5 | Subrogation/lien/collection letter | `collections-liens-subrogation/` | `collateral_source_excluded:yes` (§ 548.251 subd. 2(1)) | quantify lien against verdict floor |
| 6 | Peer-review/QI committee record | `medical-records/` w/ `PEER-REVIEW-DO-NOT-PRODUCE_` prefix | `privileged:peer_review_145.64`, `discoverable:no` | **segregate, notify counsel, do not extract** |
| 7 | Incident report | `medical-records/incident-reports/` | `privileged:contested` | privilege depends on review-organization nexus; do not produce without counsel |
| 8 | Rule 26 discovery (interrogatory/RFP/RFA/deposition + exhibits) | `discovery/` | `document_type:<interrogatory|rfp|rfa|deposition>` | depositions feed chronology extraction |
| 9 | Court filing (complaint/answer/motion/order/judgment) | `pleadings/` | `document_type:<complaint|motion|order|...>` | none |
| 10 | HIPAA or MN-specific MH authorization | `hipaa-authorizations/` | `signed:<Y/N>`, `scope:<...>`, `expires:<date>` | flag if unsigned/expired or MH scope missing |
| 11 | § 145.682 affidavit | `expert-affidavits-145682/` | `affidavit_type:<subd2|subd4>`, `signed_date`, `served_date` | validate against subd. 4(a) checklist |
| 12 | General expert report (retained/consulting/rebuttal/supplemental) | `expert-reports/` | `expert_role:<testifying|consulting>` | mark work-product if consulting-only |
| 13 | Damages expert deliverable (life-care plan, vocational, economic loss) | `expert-reports/` w/ `DAMAGES-` prefix | `damages_element:<future_medical|lost_earnings|...>` | none |
| 14 | Retainer/engagement/fee agreement | `pre-retainer-investigation/` | `privileged:attorney_client`, `discoverable:no` | verify Rule 1.5(c) writing requirement |
| 15 | Attorney correspondence (pre-suit memos, opinion letters) | `correspondence/` w/ privileged subprefix | `privileged:work_product_26b3` | never produce without privilege-log entry |

### 5.3 Template implications
- The triage rules above presume the folder taxonomy revisions in § 1.3. Without those folders, several classes (HIPAA auths, liens, § 145.682 affidavits, discovery) default to `correspondence/` or `expert-reports/`, losing the filing-deadline anchoring and privilege segregation that justifies the taxonomy split.
- Scope: this list is a **specification for** the `legal:triage-nda` skill's med-mal variant — there is no currently installed `legal:*` skill bundle on disk at `~/.claude/plugins/`. When the variant is built (or the skill ships from the plugin registry), it should adopt these rules as its `references/medmal-document-classes.md`. **No code change in `mike/`.**

---

## Plan deltas — `docs/PLAN_med_mal_templates.md`

Apply in a follow-up turn. Line refs are against the current file (160 lines, committed 2026-05-11 11:20).

1. **Lines 50–61 (Subfolders table):** replace the 8-folder table with the revised taxonomy. Additions: `expert-affidavits-145682`, `hipaa-authorizations`, `discovery`, `collections-liens-subrogation`, `pre-retainer-investigation`. Rename: `bills` → `bills-and-eobs`. New v1 count: 12 top-level + `imaging` nested.
2. **Line 61 (mental-health rationale):** add a parenthetical citing Minn. Stat. § 144.293 alongside the existing case-memory reference.
3. **Lines 65–78 (Tabular schemas table):** keep the seven existing IDs; add three new IDs — `builtin-provider-defendant-map`, `builtin-causation-chain`, `builtin-expert-opinions-145682`. Apply per-schema column changes from § 2.2 above.
4. **Line 72 (bills schema columns):** replace `paid`, `adjustment` with the seven-column § 548.251 split (`billed_amount`, `allowed_amount`, `paid_by_payer`, `paid_by_patient`, `written_off_amount`, `subrogation_or_lien_amount`, `lien_holder`).
5. **Line 78 (red-flag scan columns):** add `expert_addressed_in_145682_affidavit` and `temporal_proximity_to_outcome`.
6. **Line 80 (paragraph after schema table):** rewrite the rationale to cite Plutshack v. Univ. of Minn. Hosps., 316 N.W.2d 1, 5 (Minn. 1982) and Smith v. Knowles, 281 N.W.2d 653, 655 (Minn. 1979) for the four-element red-flag framework (the existing paragraph cites no authority).
7. **Lines 84–97 (POST /projects change):** no statutory change required; route still creates folders. Update the v1 folder count from "≤ 2 depth" / 8 entries to 12 top-level + 1 nested.
8. **Lines 113–120 (Schema change):** if § 4.3's Key Dates recommendation is accepted, add a v1.1 follow-up note here flagging that `projects` will need a `key_dates jsonb null` column (JSONB recommended for flexibility); v1 stays at the single `template_id text null` addition.
9. **Line 153 (Risks accepted):** add a new accepted-risk bullet: "No deadline-tracking widget in v1 — § 145.682(4) 180-day clock, § 541.076 4-year SOL, and § 573.02 3-year wrongful-death deadline are tracked manually until v1.1."
10. **New section after line 82** ("Cited authority"): list every primary source the schemas are built against — § 145.682, § 541.076, § 573.02, § 548.251, § 144.293, §§ 145.61–145.67, § 541.15, Rule 26.04(a), Rule 3.01, Rule 1.5(c); Plutshack, Smith v. Knowles, Reinhardt v. Colton, Cornfeldt v. Tongen, Dickhoff v. Green, Flom v. Flom, Popovich v. Allina Health Sys. — so future template revisions can be re-checked against the same source set.

---

## Cited authority — quick reference

**Statutes (MN unless noted):**
- Minn. Stat. § 145.61–145.67 (peer-review privilege)
- Minn. Stat. § 145.682 (expert-affidavit regime)
- Minn. Stat. §§ 144.291–144.298 (Health Records Act); § 144.293 (mental-health heightened consent)
- Minn. Stat. § 541.076(b) (4-yr SOL)
- Minn. Stat. § 541.15(b) (minority tolling; 7-yr healthcare cap)
- Minn. Stat. § 548.251 (collateral source)
- Minn. Stat. § 573.02 (wrongful-death med-mal SOL)
- 45 C.F.R. § 164.508 (HIPAA authorizations)

**Rules:**
- Minn. R. Civ. P. 3.01 (commencement)
- Minn. R. Civ. P. 26 / 26.04(a) (discovery)
- Minn. R. Civ. P. 26(b)(3) (work product)
- Minn. R. Evid. 408 (settlement)
- Minn. R. Prof. Conduct 1.5(c) (contingency fee writing)
- Minn. Gen. R. Prac. 114 (ADR)

**Cases:**
- *Plutshack v. Univ. of Minn. Hosps.*, 316 N.W.2d 1 (Minn. 1982)
- *Smith v. Knowles*, 281 N.W.2d 653 (Minn. 1979)
- *Reinhardt v. Colton*, 337 N.W.2d 88 (Minn. 1983)
- *Cornfeldt v. Tongen*, 262 N.W.2d 684 (Minn. 1977)
- *Dickhoff v. Green*, 836 N.W.2d 321 (Minn. 2013)
- *Flom v. Flom*, 291 N.W.2d 914 (Minn. 1980)
- *Popovich v. Allina Health Sys.*, 946 N.W.2d 885 (Minn. 2020)
- *Rock v. Abdullah* (Minn. Ct. App. 2022) (post-*Popovich* reliance-element limit)

**Verification log (primary-source spot-checks performed during research):**

| Cite | Source | Status |
|---|---|---|
| § 145.682 subd. 2 & 4 | revisor.mn.gov/statutes/cite/145.682 | ✓ verified |
| § 541.076(b) | revisor.mn.gov/statutes/cite/541.076 | ✓ verified |
| § 573.02 subd. 1 & 3 | revisor.mn.gov/statutes/cite/573.02 | ✓ verified |
| § 548.251 subd. 1, 2, 3(a) | revisor.mn.gov/statutes/cite/548.251 | ✓ verified |
| § 145.64 | revisor.mn.gov/statutes/cite/145.64 | ✓ verified |
| § 541.15(b) | revisor.mn.gov/statutes/cite/541.15 | ✓ verified |
| *Plutshack* 3-element test | law.justia.com (cited in *Dickhoff v. Green*) | ✓ verified |
| *Reinhardt v. Colton* | law.justia.com/cases/minnesota/supreme-court/1983/cx-82-284-2.html | ✓ verified |
| *Popovich v. Allina* | law.justia.com/cases/minnesota/supreme-court/2020/a18-1987.html | ✓ verified |
| *Dickhoff v. Green* | law.justia.com/cases/minnesota/supreme-court/2013/a11-402.html | ✓ verified |
| *Flom v. Flom* | law.justia.com/cases/minnesota/supreme-court/1980/49562-1.html | ✓ verified (non-med-mal but canonical substantial-factor cite) |
