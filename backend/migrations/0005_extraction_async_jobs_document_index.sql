-- Clears Supabase advisor INFO: unindexed foreign key on
-- extraction_async_jobs.document_id. Hot path is the per-document lookup
-- when checking for an existing pending/processing job, which today
-- sequentially scans the table.
create index if not exists extraction_async_jobs_document_id_idx
  on public.extraction_async_jobs (document_id);
