-- DHARMA-OSINT: Candidate dossier enrichment columns
-- Run this in Supabase SQL Editor AFTER your base schema.

alter table public.candidates
  add column if not exists liabilities_value bigint,
  add column if not exists myneta_candidate_id text,
  add column if not exists eci_affidavit_url text,
  add column if not exists eci_last_synced_at timestamptz,
  add column if not exists myneta_last_synced_at timestamptz,
  add column if not exists removed boolean not null default false,
  add column if not exists removed_at timestamptz;

-- Useful indexes for sync and filtering
create index if not exists idx_candidates_constituency_id on public.candidates (constituency_id);
create index if not exists idx_candidates_removed on public.candidates (removed);
create index if not exists idx_candidates_myneta_candidate_id on public.candidates (myneta_candidate_id);

