/**
 * Shared string-literal unions for project templates and tabular review
 * schemas. Imported by both the backend template registry
 * (`builtinProjectTemplates.ts`) and the frontend mirror
 * (`frontend/src/app/components/projects/builtinProjectTemplates.ts`).
 *
 * The frontend copies these IDs (relative import not available across
 * package boundaries in this monorepo); when adding a new ID, update both
 * files. The single source of truth for ID semantics is this file.
 */

export type ProjectTemplateId = "med-mal-case";

export type TabularSchemaId =
    | "builtin-med-chronology"
    | "builtin-med-bills"
    | "builtin-med-transfusion-log"
    | "builtin-med-mar"
    | "builtin-med-vitals-trend"
    | "builtin-med-labs-trend"
    | "builtin-med-imaging-index"
    | "builtin-med-red-flags-scan"
    | "builtin-provider-defendant-map"
    | "builtin-causation-chain"
    | "builtin-expert-opinions-145682";
