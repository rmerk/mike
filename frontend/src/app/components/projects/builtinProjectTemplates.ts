/**
 * Frontend mirror of `backend/src/lib/builtinProjectTemplates.ts`.
 *
 * The frontend doesn't need the `subfolders` array — the backend owns folder
 * creation in POST /projects. The frontend only needs `id`, `name`,
 * `description` (for the modal dropdown), and `recommendedSchemaIds` (to
 * drive the recommended-reviews strip on the project page).
 *
 * When adding a new template id, update both this file and the backend
 * mirror to keep them in lockstep.
 */

import type {
    ProjectTemplateId,
    TabularSchemaId,
} from "../tabular/templateIds";

export interface FrontendProjectTemplate {
    id: ProjectTemplateId;
    name: string;
    description: string;
    recommendedSchemaIds: TabularSchemaId[];
}

export const BUILTIN_PROJECT_TEMPLATES: FrontendProjectTemplate[] = [
    {
        id: "med-mal-case",
        name: "Medical Malpractice Case",
        description:
            "Minnesota med-mal scaffold: 12 folders (incl. § 145.682 affidavits, HIPAA auths, discovery, liens, mental-health) + 11 recommended tabular reviews anchored to Plutshack/Smith, § 548.251, and Popovich.",
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

export function getFrontendProjectTemplate(
    id: string | null | undefined,
): FrontendProjectTemplate | undefined {
    if (!id) return undefined;
    return BUILTIN_PROJECT_TEMPLATES.find((t) => t.id === id);
}
