-- Durable extraction jobs for serverless / multi-instance backends.
-- POST /extraction/:doc/run enqueues a row; an in-process worker claims rows
-- via claim_extraction_async_job() using FOR UPDATE SKIP LOCKED.

create table if not exists public.extraction_async_jobs (
  id uuid primary key default gen_random_uuid(),
  extraction_run_id uuid not null references public.document_extractions(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id text not null,
  pdf_storage_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  unique (extraction_run_id)
);

create index if not exists extraction_async_jobs_pending_idx
  on public.extraction_async_jobs (created_at)
  where status = 'pending';

alter table public.extraction_async_jobs enable row level security;

revoke all on table public.extraction_async_jobs from public;
grant select, insert, update, delete on table public.extraction_async_jobs to service_role;

revoke all on table public.extraction_async_jobs from anon, authenticated;

create or replace function public.claim_extraction_async_job()
returns setof public.extraction_async_jobs
language sql
security invoker
set search_path = public
as $fj$
  with cte as (
    select id
    from public.extraction_async_jobs
    where status = 'pending'
    order by created_at
    for update skip locked
    limit 1
  )
  update public.extraction_async_jobs j
  set
    status = 'processing',
    started_at = coalesce(j.started_at, now()),
    attempts = j.attempts + 1
  from cte
  where j.id = cte.id
  returning j.*;
$fj$;

revoke all on function public.claim_extraction_async_job() from public;
grant execute on function public.claim_extraction_async_job() to service_role;
