-- 0002_document_extraction.sql
-- Med-mal extraction: event log, red flags, extraction runs (Phase 2).
-- See docs/PLAN_med_mal_extraction_pipeline.md and .cursor/plans/phase_2_extraction_pipeline_f7bd0030.plan.md

-- ---------------------------------------------------------------------------
-- document_extractions
-- ---------------------------------------------------------------------------

create table if not exists public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  model text not null,
  status text not null
    check (status = any (array['pending'::text, 'running'::text, 'complete'::text, 'failed'::text])),
  pages_total integer,
  pages_complete integer not null default 0,
  status_seq integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  error text
);

create unique index if not exists document_extractions_one_running_per_document
  on public.document_extractions (document_id)
  where (status = 'running'::text);

create index if not exists document_extractions_document_id_idx
  on public.document_extractions (document_id, created_at desc);

comment on table public.document_extractions is
  'Per-PDF structured extraction run; pins document_version_id at start.';

-- ---------------------------------------------------------------------------
-- document_events
-- ---------------------------------------------------------------------------

create table if not exists public.document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  event_date date,
  event_time time,
  event_date_text text,
  provider text,
  provider_role text,
  episode_of_care text,
  encounter_type text,
  privacy_class text not null default 'standard'
    check (privacy_class = any (array[
      'standard'::text,
      'mental_health_144_293'::text,
      'peer_review_145_64'::text,
      'substance_abuse_42_cfr_part_2'::text
    ])),
  key_date_role text,
  dx_codes text[],
  medications jsonb,
  vitals jsonb,
  procedures text[],
  narrative text,
  source_page integer not null,
  source_bbox jsonb not null,
  extraction_run_id uuid not null references public.document_extractions(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists document_events_doc_date_idx
  on public.document_events (document_id, event_date);

create index if not exists document_events_doc_encounter_idx
  on public.document_events (document_id, encounter_type);

create index if not exists document_events_doc_privacy_idx
  on public.document_events (document_id, privacy_class);

create index if not exists document_events_doc_key_date_idx
  on public.document_events (document_id, key_date_role)
  where key_date_role is not null;

create index if not exists document_events_run_idx
  on public.document_events (extraction_run_id);

-- ---------------------------------------------------------------------------
-- document_red_flags
-- ---------------------------------------------------------------------------

create table if not exists public.document_red_flags (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  extraction_run_id uuid not null references public.document_extractions(id) on delete cascade,
  rule_id text not null,
  supports_element text not null
    check (supports_element = any (array['duty'::text, 'breach'::text, 'causation'::text, 'damages'::text])),
  severity text not null
    check (severity = any (array['low'::text, 'medium'::text, 'high'::text])),
  summary text not null,
  supporting_event_ids uuid[] not null,
  awaits_expert_affidavit boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists document_red_flags_document_id_idx
  on public.document_red_flags (document_id);

create index if not exists document_red_flags_run_idx
  on public.document_red_flags (extraction_run_id);

-- ---------------------------------------------------------------------------
-- RLS (defense in depth; backend uses service role and re-checks access)
-- ---------------------------------------------------------------------------

alter table public.document_extractions enable row level security;
alter table public.document_events enable row level security;
alter table public.document_red_flags enable row level security;

drop policy if exists "Users can view accessible document extractions" on public.document_extractions;
create policy "Users can view accessible document extractions"
  on public.document_extractions for select
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and (
          d.user_id = public.current_user_id_text()
          or (d.project_id is not null and public.project_is_accessible(d.project_id))
        )
    )
  );

drop policy if exists "Users can insert accessible document extractions" on public.document_extractions;
create policy "Users can insert accessible document extractions"
  on public.document_extractions for insert
  with check (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and (
          d.user_id = public.current_user_id_text()
          or (d.project_id is not null and public.project_is_accessible(d.project_id))
        )
    )
  );

drop policy if exists "Users can update accessible document extractions" on public.document_extractions;
create policy "Users can update accessible document extractions"
  on public.document_extractions for update
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and (
          d.user_id = public.current_user_id_text()
          or (d.project_id is not null and public.project_is_accessible(d.project_id))
        )
    )
  )
  with check (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and (
          d.user_id = public.current_user_id_text()
          or (d.project_id is not null and public.project_is_accessible(d.project_id))
        )
    )
  );

drop policy if exists "Users can view accessible document events" on public.document_events;
create policy "Users can view accessible document events"
  on public.document_events for select
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and (
          d.user_id = public.current_user_id_text()
          or (d.project_id is not null and public.project_is_accessible(d.project_id))
        )
    )
    and privacy_class is distinct from 'peer_review_145_64'::text
  );

drop policy if exists "Users can insert accessible document events" on public.document_events;
create policy "Users can insert accessible document events"
  on public.document_events for insert
  with check (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and (
          d.user_id = public.current_user_id_text()
          or (d.project_id is not null and public.project_is_accessible(d.project_id))
        )
    )
  );

drop policy if exists "Users can view accessible document red flags" on public.document_red_flags;
create policy "Users can view accessible document red flags"
  on public.document_red_flags for select
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and (
          d.user_id = public.current_user_id_text()
          or (d.project_id is not null and public.project_is_accessible(d.project_id))
        )
    )
  );

drop policy if exists "Users can insert accessible document red flags" on public.document_red_flags;
create policy "Users can insert accessible document red flags"
  on public.document_red_flags for insert
  with check (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and (
          d.user_id = public.current_user_id_text()
          or (d.project_id is not null and public.project_is_accessible(d.project_id))
        )
    )
  );
