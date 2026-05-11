-- 0001_projects_template_id.sql
-- Adds `template_id` to `projects` so project-create can pin a built-in template
-- (e.g., `med-mal-case`). Source registry lives in
-- `backend/src/lib/builtinProjectTemplates.ts`. Null for blank projects.
--
-- Applied to qkfcrsrtualqdmqqexpf via Supabase MCP `apply_migration` on
-- 2026-05-11 (Phase 1 of the templates + extraction-pipeline path).
-- Free-tier branching was blocked (PaymentRequiredException), so this ran
-- directly against prod after confirming the change is reversible (drop column).

alter table public.projects
  add column if not exists template_id text null;

comment on column public.projects.template_id is
  'Project template id from BUILTIN_PROJECT_TEMPLATES registry (e.g., med-mal-case). Null for blank projects.';
