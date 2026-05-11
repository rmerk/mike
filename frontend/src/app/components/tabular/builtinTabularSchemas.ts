/**
 * Built-in tabular review schemas for project templates.
 *
 * v1 ships 11 med-mal-case schemas with full `columns_config` (each column has
 * the `prompt` field the existing tabular extractor consumes). When a project
 * uses a template (see `builtinProjectTemplates.ts`), the project page renders
 * a "Recommended tabular reviews" strip; clicking a schema opens
 * `AddNewTRModal` with `columns_config` pre-populated from this registry.
 *
 * Column prompts are tuned for Mayo/Epic ebook formatting and anchor to MN
 * primary sources (Minn. Stat. § 145.682, § 548.251, § 144.293; Plutshack/
 * Smith v. Knowles, Reinhardt, Cornfeldt, Dickhoff, Popovich, Flom). See
 * `docs/RESEARCH_mn_med_mal_law.md` § 2 for the authority backing each schema.
 *
 * This is the only place column specs for templates live — duplication into
 * the backend is intentionally avoided (the backend never sees columns_config
 * for templates; it only sees them in `createTabularReview` payloads at
 * instantiation time).
 */

import type { ColumnConfig } from "../shared/types";
import type { TabularSchemaId } from "./templateIds";

export interface BuiltinTabularSchema {
    id: TabularSchemaId;
    title: string;
    /**
     * Short description shown in the recommended-reviews strip; should name
     * the prima facie element or filing requirement the schema supports.
     */
    description: string;
    columns_config: ColumnConfig[];
}

const PAGE_REF_PROMPT =
    "Cite the source page number(s) from the original PDF, in the format 'p. N' or 'pp. N–M'. Always include a page reference for every row so the chronology is defensible under cross-examination.";

export const BUILTIN_TABULAR_SCHEMAS: BuiltinTabularSchema[] = [
    {
        id: "builtin-med-chronology",
        title: "Medical Chronology",
        description:
            "All four prima facie elements (duty/breach/causation/damages). Day-by-day clinical timeline.",
        columns_config: [
            {
                index: 0,
                name: "date",
                prompt:
                    "Extract the calendar date of service in MM/DD/YYYY format. If multiple dates appear in one note, use the date of service (when care was rendered), not the date of charting. If only a relative date is given (e.g., 'POD #3'), compute the actual date from context.",
                format: "date",
            },
            {
                index: 1,
                name: "provider",
                prompt:
                    "Extract the clinician's full name as it appears on the note (e.g., 'Smith, K. MD'). If multiple providers signed, list the attending first; if unsigned, write 'unsigned'.",
                format: "text",
            },
            {
                index: 2,
                name: "provider_role",
                prompt:
                    "Classify the provider's role: attending, fellow, resident, APRN, CRNA, RN, perfusionist, PA, or 'other (specify)'. Plutshack requires the standard-of-care expert to be qualified to opine on this exact role.",
                format: "tag",
            },
            {
                index: 3,
                name: "setting",
                prompt:
                    "Where did the encounter take place? Use one of: ICU, post-op floor, ward, ED, OR, clinic, telehealth, home, other (specify).",
                format: "tag",
            },
            {
                index: 4,
                name: "episode_of_care",
                prompt:
                    "Cluster this event under one of the case's episodes of care: 'index op', 'reop'/'takeback', 'readmission', 'clinic visit', 'ED visit', 'inpatient day N', or 'outpatient follow-up'. The Jenn case has three distinct episodes: 5/19 index op, 5/20 takeback, and 1/27/2026 sternal-wire removal — group rows accordingly.",
                format: "tag",
            },
            {
                index: 5,
                name: "chief_complaint",
                prompt:
                    "Quote or paraphrase the chief complaint or reason-for-visit in ≤ 30 words. If this is a continuation note (no fresh CC), write '(continuation)'.",
                format: "text",
            },
            {
                index: 6,
                name: "assessment",
                prompt:
                    "Summarize the provider's assessment / impression in ≤ 60 words. Capture diagnoses (with ICD-10 codes when present), differential considerations, and clinical reasoning.",
                format: "text",
            },
            {
                index: 7,
                name: "plan",
                prompt:
                    "Summarize the plan in ≤ 60 words. Capture orders placed, consults requested, medications started/stopped/adjusted, and disposition.",
                format: "text",
            },
            {
                index: 8,
                name: "page_ref",
                prompt: PAGE_REF_PROMPT,
                format: "text",
            },
        ],
    },
    {
        id: "builtin-med-bills",
        title: "Bill Line Items",
        description:
            "Damages (§ 548.251). Charge / collateral-source / subrogation split, line-by-line.",
        columns_config: [
            {
                index: 0,
                name: "date_of_service",
                prompt:
                    "Date the service was rendered (not the date of statement / billing). MM/DD/YYYY. On a UB-04 use field 6 (Statement Covers Period 'From'); on a CMS-1500 use box 24A.",
                format: "date",
            },
            {
                index: 1,
                name: "cpt",
                prompt:
                    "CPT or HCPCS code (e.g., '99232', 'J3490'). On a UB-04 use field 44; on a CMS-1500 use box 24D. If the code is suppressed in the print-out (some EOBs do this), write 'redacted'.",
                format: "text",
            },
            {
                index: 2,
                name: "description",
                prompt:
                    "Narrative description of the service in ≤ 20 words. Use the description column on the bill verbatim where possible.",
                format: "text",
            },
            {
                index: 3,
                name: "provider",
                prompt:
                    "Rendering provider name (the human or facility actually performing the service). On UB-04 use field 76; on CMS-1500 use box 31.",
                format: "text",
            },
            {
                index: 4,
                name: "units",
                prompt:
                    "Number of units billed. UB-04 field 46; CMS-1500 box 24G. Default to '1' when blank on a per-day room charge.",
                format: "number",
            },
            {
                index: 5,
                name: "charge",
                prompt:
                    "Gross charge (chargemaster price) for this line. UB-04 field 47; CMS-1500 box 24F. Capture as a numeric value with no currency symbol.",
                format: "currency",
            },
            {
                index: 6,
                name: "billed_amount",
                prompt:
                    "Same as 'charge' on most bills, but capture the explicit billed amount when the bill / EOB distinguishes 'billed' from 'submitted' (some Medicare Advantage EOBs do).",
                format: "currency",
            },
            {
                index: 7,
                name: "allowed_amount",
                prompt:
                    "Payer-contracted allowed amount (often much less than billed). On an EOB this is the 'allowed' or 'plan allowed' field. Critical for the § 548.251 collateral-source calculation.",
                format: "currency",
            },
            {
                index: 8,
                name: "paid_by_payer",
                prompt:
                    "Actual insurance / government disbursement to the provider. On an EOB this is the 'paid' or 'payment' field. Excludes deductible/copay/coinsurance.",
                format: "currency",
            },
            {
                index: 9,
                name: "paid_by_patient",
                prompt:
                    "Deductible + copay + coinsurance — the portion the patient actually owed and paid (or still owes). Sum of 'patient responsibility' fields on the EOB.",
                format: "currency",
            },
            {
                index: 10,
                name: "written_off_amount",
                prompt:
                    "Contractual adjustment / write-off. This is NOT a damages claim under § 548.251 — it never left the patient's pocket and the provider can't seek it.",
                format: "currency",
            },
            {
                index: 11,
                name: "subrogation_or_lien_amount",
                prompt:
                    "Amount asserted against the patient under a subrogation right (Medicare/Medicaid, ERISA plan, hospital lien). Minn. Stat. § 548.251 subd. 2(1) carves this out of the collateral-source offset — capture it precisely.",
                format: "currency",
            },
            {
                index: 12,
                name: "lien_holder",
                prompt:
                    "Name of the entity asserting the lien (e.g., 'Medicare', 'BCBS MN', 'Allina Health'). Blank if no subrogation-or-lien-amount.",
                format: "text",
            },
            {
                index: 13,
                name: "modifier_flags",
                prompt:
                    "CPT modifiers (e.g., '-25', '-59', '-RT') in a comma-separated list. Flag '59' (distinct procedural service) for potential unbundling scrutiny.",
                format: "text",
            },
            {
                index: 14,
                name: "payer",
                prompt:
                    "Primary payer for this line (e.g., 'BCBS MN', 'Medicare Part B', 'self-pay'). Note tertiary payers when present.",
                format: "text",
            },
            {
                index: 15,
                name: "page_ref",
                prompt: PAGE_REF_PROMPT,
                format: "text",
            },
        ],
    },
    {
        id: "builtin-med-transfusion-log",
        title: "Transfusion Log",
        description:
            "Breach + informed consent (Cornfeldt). Blood-product administration with consent/crossmatch verification.",
        columns_config: [
            {
                index: 0,
                name: "timestamp",
                prompt:
                    "Date+time the transfusion event occurred, MM/DD/YYYY HH:MM (24-hour). Use the start-of-transfusion time when ranges are given.",
                format: "date",
            },
            {
                index: 1,
                name: "product_type",
                prompt:
                    "Blood product: PRBC, FFP, platelets, cryoprecipitate, whole blood, albumin, other (specify). Use the abbreviation as charted.",
                format: "tag",
            },
            {
                index: 2,
                name: "unit_id",
                prompt:
                    "Unique unit identifier from the blood bank (e.g., 'W0123 24 002345'). Critical for tracing batches if a reaction is alleged.",
                format: "text",
            },
            {
                index: 3,
                name: "issue_time",
                prompt:
                    "Time the unit was issued from the blood bank (HH:MM 24-hour). May precede txn_start by minutes-to-hours.",
                format: "text",
            },
            {
                index: 4,
                name: "txn_start",
                prompt:
                    "Time the transfusion was initiated at the bedside (HH:MM 24-hour).",
                format: "text",
            },
            {
                index: 5,
                name: "txn_stop",
                prompt:
                    "Time the transfusion was completed or terminated (HH:MM 24-hour). If terminated early, capture the reason in 'indication'.",
                format: "text",
            },
            {
                index: 6,
                name: "indication",
                prompt:
                    "Clinical indication as documented (e.g., 'hgb 6.8', 'active bleed post-CABG'). Quote the chart when possible.",
                format: "text",
            },
            {
                index: 7,
                name: "consent_documented",
                prompt:
                    "Was informed consent for transfusion documented prior to the first product? Answer 'yes (page N)', 'no', or 'emergency exception' (Cornfeldt informed-consent duty does not apply to emergency transfusion where the patient cannot consent and a competent third party is not available).",
                format: "yes_no",
            },
            {
                index: 8,
                name: "crossmatch_documented",
                prompt:
                    "Was a crossmatch / type-and-screen documented before this unit was administered? Answer 'yes (page N)', 'no', or 'emergency release' (Type O uncrossmatched).",
                format: "yes_no",
            },
            {
                index: 9,
                name: "clinical_event_window",
                prompt:
                    "What other clinically significant events occurred within ± 30 minutes of this transfusion? E.g., 'BP 70/40 at 02:05, txn started 02:08'. Establishes temporal proximity to outcomes.",
                format: "text",
            },
            {
                index: 10,
                name: "page_ref",
                prompt: PAGE_REF_PROMPT,
                format: "text",
            },
        ],
    },
    {
        id: "builtin-med-mar",
        title: "Medication Administration Record",
        description:
            "Breach (Reinhardt Mulder rule). Med ordering, administration timing, allergy / dose conflicts.",
        columns_config: [
            {
                index: 0,
                name: "timestamp",
                prompt:
                    "Date+time of administration, MM/DD/YYYY HH:MM (24-hour). Use the admin-time on the MAR, NOT the scheduled-time, when they differ.",
                format: "date",
            },
            {
                index: 1,
                name: "medication",
                prompt:
                    "Generic name (brand in parens if shown). E.g., 'heparin (sodium)', 'protamine sulfate'. Use generic to enable Mulder-rule package-insert lookups.",
                format: "text",
            },
            {
                index: 2,
                name: "dose",
                prompt:
                    "Dose actually administered with units (e.g., '5000 units IV', '40 mg IV'). NOT the ordered dose if different — capture the discrepancy in the order_to_admin_delta_minutes column's notes.",
                format: "text",
            },
            {
                index: 3,
                name: "route",
                prompt:
                    "Administration route: IV push, IV infusion, PO, IM, SC, PR, inhaled, topical, NG, other (specify).",
                format: "tag",
            },
            {
                index: 4,
                name: "ordered_by",
                prompt:
                    "Provider who entered the medication order. First-last format. If verbal/telephone, write 'verbal: <name>' and capture the cosign in 'page_ref'.",
                format: "text",
            },
            {
                index: 5,
                name: "administered_by",
                prompt:
                    "Person who administered the medication. Typically the bedside RN; surface CRNA / anesthesiologist for OR meds.",
                format: "text",
            },
            {
                index: 6,
                name: "indication",
                prompt:
                    "Indication documented for the dose (e.g., 'systemic anticoagulation for CPB', 'reversal of heparin'). Required for off-label / weight-based scrutiny.",
                format: "text",
            },
            {
                index: 7,
                name: "order_to_admin_delta_minutes",
                prompt:
                    "Minutes between order-time and administration-time. Negative if admin preceded order (anesthesia case). Late administration is a recurring breach signal — flag rows > 30 min for high-acuity meds.",
                format: "number",
            },
            {
                index: 8,
                name: "allergy_conflict_flag",
                prompt:
                    "Did this medication conflict with any documented patient allergy? Answer 'yes (allergen: X)', 'no', or 'unknown'. An ignored allergy is a per-se breach pattern.",
                format: "yes_no",
            },
            {
                index: 9,
                name: "weight_based_dose_check",
                prompt:
                    "Was the administered dose within the FDA package-insert range for the patient's weight + indication? Answer 'within range', 'over (by X%)', 'under (by X%)', or 'no reference range applies'. Reinhardt's Mulder rule: package-insert deviation is prima facie evidence of negligence with competent medical testimony.",
                format: "tag",
            },
            {
                index: 10,
                name: "page_ref",
                prompt: PAGE_REF_PROMPT,
                format: "text",
            },
        ],
    },
    {
        id: "builtin-med-vitals-trend",
        title: "Vitals Trend",
        description:
            "Breach (failure to monitor). Continuous vital-sign sampling with critical-value / response-timing flags.",
        columns_config: [
            {
                index: 0,
                name: "timestamp",
                prompt:
                    "Vital-sign timestamp, MM/DD/YYYY HH:MM (24-hour). Sample at the cadence Epic charts (typically Q15 min ICU, Q1H floor).",
                format: "date",
            },
            { index: 1, name: "hr", prompt: "Heart rate, bpm.", format: "number" },
            {
                index: 2,
                name: "sbp",
                prompt: "Systolic blood pressure, mmHg.",
                format: "number",
            },
            {
                index: 3,
                name: "dbp",
                prompt: "Diastolic blood pressure, mmHg.",
                format: "number",
            },
            {
                index: 4,
                name: "map",
                prompt:
                    "Mean arterial pressure, mmHg. Compute as (SBP + 2·DBP)/3 if not charted.",
                format: "number",
            },
            { index: 5, name: "spo2", prompt: "SpO2, %.", format: "number" },
            { index: 6, name: "temp_c", prompt: "Temperature, °C. Convert from °F if charted in F.", format: "number" },
            { index: 7, name: "rr", prompt: "Respiratory rate, breaths/min.", format: "number" },
            {
                index: 8,
                name: "urine_output_ml",
                prompt:
                    "Urine output over the documented interval (mL). Capture interval in note if not Q1H.",
                format: "number",
            },
            {
                index: 9,
                name: "ct_output_ml",
                prompt:
                    "Chest-tube output over the documented interval (mL). Cardiac/thoracic post-op only — leave blank otherwise.",
                format: "number",
            },
            {
                index: 10,
                name: "critical_value_flag",
                prompt:
                    "Did any vital cross an institutional critical-value threshold (e.g., HR > 130, SBP < 90, SpO2 < 88, UOP < 0.5 mL/kg/h × 2h)? Answer 'yes (which)' or 'no'.",
                format: "yes_no",
            },
            {
                index: 11,
                name: "response_documented_within_minutes",
                prompt:
                    "Minutes from the critical-value crossing to the first documented clinical response (provider note, escalation, intervention). Blank if no critical value. A long delay supports a failure-to-monitor breach theory.",
                format: "number",
            },
            { index: 12, name: "page_ref", prompt: PAGE_REF_PROMPT, format: "text" },
        ],
    },
    {
        id: "builtin-med-labs-trend",
        title: "Labs Trend",
        description:
            "Breach (failure to monitor + critical-result communication). Discrete lab draws with critical-value / communication flags.",
        columns_config: [
            {
                index: 0,
                name: "timestamp",
                prompt:
                    "Time the specimen was collected (not the time the result was filed), MM/DD/YYYY HH:MM (24-hour).",
                format: "date",
            },
            { index: 1, name: "hgb", prompt: "Hemoglobin, g/dL.", format: "number" },
            { index: 2, name: "hct", prompt: "Hematocrit, %.", format: "number" },
            { index: 3, name: "plt", prompt: "Platelets, ×10³/µL.", format: "number" },
            { index: 4, name: "wbc", prompt: "White blood cell count, ×10³/µL.", format: "number" },
            { index: 5, name: "pt", prompt: "Prothrombin time, seconds.", format: "number" },
            { index: 6, name: "aptt", prompt: "Activated partial thromboplastin time, seconds.", format: "number" },
            { index: 7, name: "inr", prompt: "International normalized ratio.", format: "number" },
            { index: 8, name: "fibrinogen", prompt: "Fibrinogen, mg/dL.", format: "number" },
            { index: 9, name: "lactate", prompt: "Lactate, mmol/L.", format: "number" },
            {
                index: 10,
                name: "critical_value_flag",
                prompt:
                    "Did any lab cross an institutional critical threshold (e.g., Hgb < 7, K+ > 6.0, lactate > 4)? Answer 'yes (which)' or 'no'.",
                format: "yes_no",
            },
            {
                index: 11,
                name: "response_documented_within_minutes",
                prompt:
                    "Minutes from the critical-result file-time to the first documented clinical response. A long delay supports a failure-to-monitor breach theory.",
                format: "number",
            },
            {
                index: 12,
                name: "lab_communicated_to",
                prompt:
                    "Epic builds a 'critical result called to ___ at ___ by ___' string on critical labs. Capture the recipient name + role (e.g., 'Dr. Smith, attending, 03:12 by RN Jones'). Failure-to-communicate is a recurring liability theory; blank if not charted.",
                format: "text",
            },
            { index: 13, name: "page_ref", prompt: PAGE_REF_PROMPT, format: "text" },
        ],
    },
    {
        id: "builtin-med-imaging-index",
        title: "Imaging & Procedure Index",
        description:
            "Breach (communication of findings). Radiology / procedure log with critical-finding tracking.",
        columns_config: [
            { index: 0, name: "date", prompt: "Study date, MM/DD/YYYY.", format: "date" },
            {
                index: 1,
                name: "modality",
                prompt: "CT, MRI, X-ray, US, echo, PET, fluoroscopy, angiography, other (specify).",
                format: "tag",
            },
            {
                index: 2,
                name: "indication",
                prompt:
                    "Clinical indication for the study (e.g., 'r/o PE post-op', 'evaluate sternal wound dehiscence').",
                format: "text",
            },
            {
                index: 3,
                name: "key_finding",
                prompt:
                    "Headline finding in ≤ 30 words. Quote the impression / conclusion from the radiology report when possible.",
                format: "text",
            },
            {
                index: 4,
                name: "comparison_to_prior",
                prompt:
                    "What did the report compare to? Capture comparison study + date (e.g., 'CT 5/19/2025'). 'None' if no comparison.",
                format: "text",
            },
            {
                index: 5,
                name: "reading_provider",
                prompt: "Radiologist or interpreting provider name.",
                format: "text",
            },
            {
                index: 6,
                name: "critical_finding_flag",
                prompt:
                    "Did this study identify a critical finding (e.g., 'sternal wire migration', 'large pneumothorax', 'free air')? Answer 'yes (which)' or 'no'.",
                format: "yes_no",
            },
            {
                index: 7,
                name: "communication_documented",
                prompt:
                    "Was the critical finding communicated to the ordering / responsible provider? Capture recipient + time + method (e.g., 'Dr. Smith via phone 14:32'). Blank if not charted. Failure to communicate critical radiology findings is a recurring breach pattern.",
                format: "text",
            },
            { index: 8, name: "page_ref", prompt: PAGE_REF_PROMPT, format: "text" },
        ],
    },
    {
        id: "builtin-med-red-flags-scan",
        title: "Red-Flag Scan",
        description:
            "Breach + causation. Page-by-page sweep tagging suspicious events against the Plutshack/Smith 4-cut.",
        columns_config: [
            { index: 0, name: "page_ref", prompt: PAGE_REF_PROMPT, format: "text" },
            {
                index: 1,
                name: "finding",
                prompt:
                    "Describe the red-flag finding in ≤ 50 words. Be specific (e.g., 'HR rose from 88 to 133 over 2 hours overnight 5/19→5/20 without provider notification').",
                format: "text",
            },
            {
                index: 2,
                name: "category",
                prompt:
                    "Type of red flag: delayed dx, med error, retained foreign object, failure to monitor, informed-consent gap, documentation gap, communication failure, other (specify).",
                format: "tag",
            },
            {
                index: 3,
                name: "evidence_quote",
                prompt:
                    "Verbatim chart quote (≤ 100 chars) anchoring this finding. Required for cross-examination defense.",
                format: "text",
            },
            {
                index: 4,
                name: "supports_element",
                prompt:
                    "Which prima facie element does this finding support? One of: duty, breach, causation, damages. Plutshack/Smith 3-element test plus damages.",
                format: "tag",
            },
            {
                index: 5,
                name: "severity_1_3",
                prompt:
                    "1 = mild / questionable; 2 = clear breach signal; 3 = severe / would support a per-se theory. Calibrate against the gold-set once available.",
                format: "number",
            },
            {
                index: 6,
                name: "false_positive_risk",
                prompt:
                    "Low / medium / high — how likely is this finding to evaporate on closer scrutiny by a defense expert? Surfaces brittle red flags for triage before the expert affidavit pass.",
                format: "tag",
            },
            {
                index: 7,
                name: "expert_addressed_in_145682_affidavit",
                prompt:
                    "Has this finding been addressed by the retained expert in the § 145.682 subd. 4 identification affidavit? Answer 'yes (affidavit page N)', 'no', or 'pending retention'. Closes the loop with subd. 4(a) content checklist.",
                format: "yes_no",
            },
            {
                index: 8,
                name: "temporal_proximity_to_outcome",
                prompt:
                    "Hours between this finding and the next adverse outcome (arrest, exsanguination, stroke, death, return-to-OR, unplanned ICU transfer). Sharper temporal anchors sharpen the causation expert's reasoning per Plutshack/Smith.",
                format: "number",
            },
        ],
    },
    {
        id: "builtin-provider-defendant-map",
        title: "Provider / Defendant Map",
        description:
            "Vicarious-liability defendant selection (Popovich). Every clinician/entity that touched the patient.",
        columns_config: [
            {
                index: 0,
                name: "provider_name",
                prompt:
                    "Canonical full name (resolve nicknames / initials / suffixes — e.g., 'Karen R. Smith MD' for 'Dr. K. Smith').",
                format: "text",
            },
            {
                index: 1,
                name: "role_title",
                prompt:
                    "Stated title on the chart: attending, fellow, resident, APRN, CRNA, RN, perfusionist, PA, hospitalist, surgical assistant, other (specify).",
                format: "tag",
            },
            {
                index: 2,
                name: "license_number",
                prompt:
                    "State license number where shown. Cross-check the MN BMP database for active / disciplined status before adding as a defendant.",
                format: "text",
            },
            {
                index: 3,
                name: "npi",
                prompt:
                    "10-digit National Provider Identifier where shown on the chart, EOB, or operative report.",
                format: "text",
            },
            {
                index: 4,
                name: "employer_entity",
                prompt:
                    "Employing entity per the chart (e.g., 'Mayo Clinic', 'Allina Health Cardiothoracic Surgery Group, PA'). The hospital and the surgeon's PA can be separate defendants.",
                format: "text",
            },
            {
                index: 5,
                name: "independent_contractor_or_employee",
                prompt:
                    "'Employee', 'independent contractor', 'unclear from record'. Drives respondeat superior vs. Popovich apparent-authority analysis.",
                format: "tag",
            },
            {
                index: 6,
                name: "held_out_as_hospital_provider",
                prompt:
                    "Did the hospital hold this provider out as its own (Popovich factor 1)? Capture evidence: signage, badges, billing letterhead, intake forms. 'Yes (evidence: …)', 'no', or 'unknown'.",
                format: "text",
            },
            {
                index: 7,
                name: "patient_reliance_facts",
                prompt:
                    "Did the patient rely on the hospital rather than this specific provider (Popovich factor 2 — the chokepoint per Rock v. Abdullah)? Capture intake forms, choice-of-physician evidence, deposition testimony when available. Critical for vicarious-liability viability.",
                format: "text",
            },
            {
                index: 8,
                name: "named_in_145682_2_affidavit",
                prompt:
                    "Was this provider named in the § 145.682 subd. 2 affidavit-of-expert-review served with the complaint? 'Yes', 'no', or 'pending'.",
                format: "yes_no",
            },
            {
                index: 9,
                name: "named_as_defendant",
                prompt:
                    "Is this provider currently named as a defendant on the operative complaint? 'Yes', 'no', or 'under consideration'.",
                format: "yes_no",
            },
        ],
    },
    {
        id: "builtin-causation-chain",
        title: "Causation Chain",
        description:
            "Causation (Plutshack/Flom/Dickhoff). Explicit reasoning rows linking breach to harm.",
        columns_config: [
            {
                index: 0,
                name: "alleged_breach",
                prompt:
                    "What act or omission constitutes the breach? Reference the underlying chronology row or red-flag-scan row that anchors it.",
                format: "text",
            },
            {
                index: 1,
                name: "mechanism_of_harm",
                prompt:
                    "How did the breach cause the harm, biomechanically / physiologically? ≤ 100 words. Quote the expert's theory when available.",
                format: "text",
            },
            {
                index: 2,
                name: "but_for_met",
                prompt:
                    "But for the breach, would the harm have been avoided? 'Yes (brief)', 'no', or 'expert opinion pending'. But-for is the default MN causation test.",
                format: "yes_no",
            },
            {
                index: 3,
                name: "substantial_factor_met",
                prompt:
                    "Was the breach a substantial factor in producing the harm per Flom v. Flom, 291 N.W.2d 914 (Minn. 1980)? Applies when there are multiple sufficient causes (e.g., aggressive disease + delay).",
                format: "yes_no",
            },
            {
                index: 4,
                name: "loss_of_chance_applicable",
                prompt:
                    "Does Dickhoff v. Green, 836 N.W.2d 321 (Minn. 2013), apply? Use 'yes' when the patient had a non-zero baseline chance of recovery that the breach substantially reduced (delayed-diagnosis cases especially). The plaintiff retains the preponderance burden — this is not a relaxation.",
                format: "yes_no",
            },
            {
                index: 5,
                name: "expert_opinion_quote",
                prompt:
                    "Verbatim quote from the retained expert's report or deposition supporting this causation theory. Required for defensibility; blank if expert not yet retained.",
                format: "text",
            },
            {
                index: 6,
                name: "defendant_alternative_theory",
                prompt:
                    "What is the defense's likely counter-theory? E.g., 'aggressive underlying sepsis was the sole cause, independent of the medication delay'.",
                format: "text",
            },
            {
                index: 7,
                name: "countervailing_evidence",
                prompt:
                    "Evidence in the record that undercuts the defense theory (e.g., prior labs trending toward stability before the delay).",
                format: "text",
            },
        ],
    },
    {
        id: "builtin-expert-opinions-145682",
        title: "§ 145.682 Expert Opinions",
        description:
            "Filing-deadline compliance (§ 145.682 subd. 4 & 6). One row per expert, tracking each affidavit type.",
        columns_config: [
            {
                index: 0,
                name: "expert_name",
                prompt: "Full name + credentials (e.g., 'Jane Doe MD FACS').",
                format: "text",
            },
            {
                index: 1,
                name: "specialty",
                prompt:
                    "Specialty / sub-specialty as relevant to the defendant being opined against. Must match defendant's role per Plutshack (e.g., to opine on a CRNA's standard, the expert must be qualified in anesthesia practice involving CRNAs).",
                format: "text",
            },
            {
                index: 2,
                name: "affidavit_type",
                prompt:
                    "'subd2_review' (served with summons and complaint per § 145.682 subd. 2) or 'subd4_id' (identification affidavit served within 180 days of Rule 26.04(a) discovery commencement per subd. 4).",
                format: "tag",
            },
            {
                index: 3,
                name: "substance_of_facts_summary",
                prompt:
                    "Per § 145.682 subd. 4(a)(2): a brief summary of the substance of the facts to which the expert is expected to testify. ≤ 200 words. Sufficient detail to survive a Sorenson motion.",
                format: "text",
            },
            {
                index: 4,
                name: "substance_of_opinions_summary",
                prompt:
                    "Per § 145.682 subd. 4(a)(3): a brief summary of the substance of the opinions to which the expert is expected to testify. ≤ 200 words. Must articulate standard of care, departure, and causation.",
                format: "text",
            },
            {
                index: 5,
                name: "grounds_summary",
                prompt:
                    "Per § 145.682 subd. 4(a)(4): a summary of the grounds for each opinion. Without grounds, even a detailed opinion is insufficient (Sorenson v. St. Paul Ramsey Med. Ctr., 457 N.W.2d 188 (Minn. 1990)).",
                format: "text",
            },
            {
                index: 6,
                name: "signed_date",
                prompt:
                    "Date the expert signed the affidavit, MM/DD/YYYY.",
                format: "date",
            },
            {
                index: 7,
                name: "served_date",
                prompt:
                    "Date the affidavit was served on defense counsel, MM/DD/YYYY. For subd2 this is service-of-summons date; for subd4 this controls compliance with the 180-day clock.",
                format: "date",
            },
            {
                index: 8,
                name: "discovery_commenced_2604a_date",
                prompt:
                    "Date Rule 26.04(a) initial discovery conference commenced, MM/DD/YYYY. The § 145.682 subd. 4 180-day clock runs from THIS date — NOT summons service.",
                format: "date",
            },
            {
                index: 9,
                name: "180_day_deadline",
                prompt:
                    "discovery_commenced_2604a_date + 180 days, MM/DD/YYYY. Compute mechanically. Subd. 6 mandates dismissal for failure.",
                format: "date",
            },
            {
                index: 10,
                name: "compliance_status",
                prompt:
                    "'compliant', 'late but cured', 'late and uncured (subd. 6 risk)', 'pending', or 'n/a (subd2 only)'.",
                format: "tag",
            },
        ],
    },
];

/**
 * Look up a built-in tabular schema by id. Returns undefined for unknown ids.
 */
export function getBuiltinTabularSchema(
    id: TabularSchemaId | string | null | undefined,
): BuiltinTabularSchema | undefined {
    if (!id) return undefined;
    return BUILTIN_TABULAR_SCHEMAS.find((s) => s.id === id);
}
