## Learned User Preferences

- After significant milestones in this repo, update local session notes under `.remember/` (`now.md` and dated `today-*.md` files) so work can be resumed without re-deriving context.

## Learned Workspace Facts

- Med-mal planning docs live at `docs/PLAN_med_mal_roadmap.md` and `docs/PLAN_med_mal_extraction_pipeline.md`; the Cursor Phase 2 execution plan is `.cursor/plans/phase_2_extraction_pipeline_f7bd0030.plan.md`.
- Session continuity notes live in `.remember/` (`now.md`, `today-YYYY-MM-DD.md`) and are typically not committed with the repo.
- For Phase 2 extraction, canonical module names in code are `pdfRegions.ts` and `redFlags.ts`, not the roadmap alternates `pdfPages.ts` / `redFlagRules.ts`.
- Extraction-feature commits use the prefix `feat(extraction):` per the roadmap sequencing convention.
- The backend Supabase client uses the service role on the server; Postgres RLS does not protect tenants by itself on those paths—routes must enforce document and project access in application code.
