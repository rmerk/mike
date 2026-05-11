import type { ProjectTemplateId, TabularSchemaId } from "./templateIds";

/**
 * A subfolder in a project template. `parent` is the array index of another
 * subfolder in the same template's `subfolders` array (allows nesting without
 * name-collision ambiguity). `undefined` means the subfolder is top-level.
 * POST /projects resolves array-index references to UUIDs after Batch A
 * inserts complete (see `routes/projects.ts`).
 */
export interface ProjectTemplateSubfolder {
    name: string;
    parent?: number;
}

export interface ProjectTemplate {
    id: ProjectTemplateId;
    name: string;
    description: string;
    subfolders: ProjectTemplateSubfolder[];
    recommendedSchemaIds: TabularSchemaId[];
}

/**
 * Built-in project template registry. v1 ships one template (`med-mal-case`);
 * additional templates extend `ProjectTemplateId` in `templateIds.ts` and add
 * entries here.
 *
 * Folder taxonomy and rationale: see `docs/PLAN_med_mal_templates.md` and
 * `docs/RESEARCH_mn_med_mal_law.md` § 1.
 */
export const BUILTIN_PROJECT_TEMPLATES: ProjectTemplate[] = [
    {
        id: "med-mal-case",
        name: "Medical Malpractice Case",
        description:
            "Minnesota med-mal case scaffold: 12 top-level folders + nested imaging, " +
            "11 recommended tabular review schemas. Anchored to Minn. Stat. § 145.682 " +
            "(expert affidavits), § 548.251 (collateral source), § 144.293 (mental-health " +
            "consent), and the Plutshack/Smith prima facie negligence framework.",
        subfolders: [
            // Index 0 — clinical bedrock
            { name: "medical-records" },
            // Index 1 — damages-proof + collateral-source documents
            { name: "bills-and-eobs" },
            // Index 2 — general correspondence
            { name: "correspondence" },
            // Index 3 — depositions (testimony)
            { name: "depositions" },
            // Index 4 — general expert reports (non-145.682)
            { name: "expert-reports" },
            // Index 5 — pleadings (Rule 7–12 court filings)
            { name: "pleadings" },
            // Index 6 — imaging, nested under medical-records (parent: 0)
            { name: "imaging", parent: 0 },
            // Index 7 — § 144.293 heightened-consent regime; never bundle with medical-records
            { name: "mental-health-records" },
            // Index 8 — § 145.682 subd. 2 & 4 affidavits; mandatory-dismissal exposure under subd. 6
            { name: "expert-affidavits-145682" },
            // Index 9 — § 144.291–.298 + HIPAA chain-of-custody
            { name: "hipaa-authorizations" },
            // Index 10 — Rule 26 discovery workstream (interrogatories, RFPs, RFAs)
            { name: "discovery" },
            // Index 11 — § 548.251 subd. 2(1) subrogation carve-out
            { name: "collections-liens-subrogation" },
            // Index 12 — attorney-client privileged from intake
            { name: "pre-retainer-investigation" },
        ],
        recommendedSchemaIds: [
            "builtin-med-chronology",
            "builtin-med-bills",
            "builtin-med-transfusion-log",
            "builtin-med-mar",
            "builtin-med-vitals-trend",
            "builtin-med-labs-trend",
            "builtin-med-imaging-index",
            "builtin-med-red-flags-scan",
            "builtin-provider-defendant-map",
            "builtin-causation-chain",
            "builtin-expert-opinions-145682",
        ],
    },
];

/**
 * Look up a template by id. Returns undefined for unknown / null / empty ids;
 * callers (route validation) should 400 on undefined when `template_id` was
 * non-empty in the request.
 */
export function getProjectTemplate(
    id: string | null | undefined,
): ProjectTemplate | undefined {
    if (!id) return undefined;
    return BUILTIN_PROJECT_TEMPLATES.find((t) => t.id === id);
}
