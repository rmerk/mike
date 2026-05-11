/**
 * Frontend mirror of `backend/src/lib/templateIds.ts`.
 *
 * Single source of truth for `ProjectTemplateId` and `TabularSchemaId` on the
 * frontend. When adding a new id here, update the backend mirror at
 * `backend/src/lib/templateIds.ts` as well — the two files must stay in
 * lockstep. Cross-package imports aren't available in this monorepo without
 * tooling changes, so duplication is intentional.
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
