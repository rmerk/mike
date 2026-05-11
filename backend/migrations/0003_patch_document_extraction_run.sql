-- Atomic status_seq bump + partial patch for document_extractions (Phase 2).
-- Called from backend via Supabase RPC patch_document_extraction_run.

create or replace function public.patch_document_extraction_run(
  p_run_id uuid,
  p_patch jsonb
) returns void
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  update public.document_extractions
  set
    status_seq = document_extractions.status_seq + 1,
    updated_at = now(),
    status = case when p_patch ? 'status' then (p_patch->>'status')::text else status end,
    pages_total = case when p_patch ? 'pages_total' then (p_patch->>'pages_total')::integer else pages_total end,
    pages_complete = case when p_patch ? 'pages_complete' then (p_patch->>'pages_complete')::integer else pages_complete end,
    error = case
      when not (p_patch ? 'error') then document_extractions.error
      when jsonb_typeof(p_patch->'error') = 'null' then null
      else (p_patch->>'error')::text
    end,
    completed_at = case
      when not (p_patch ? 'completed_at') then document_extractions.completed_at
      when jsonb_typeof(p_patch->'completed_at') = 'null' then null
      else (p_patch->>'completed_at')::timestamptz
    end
  where id = p_run_id;
end;
$fn$;

revoke all on function public.patch_document_extraction_run(uuid, jsonb) from public;
grant execute on function public.patch_document_extraction_run(uuid, jsonb) to service_role;
grant execute on function public.patch_document_extraction_run(uuid, jsonb) to authenticated;
