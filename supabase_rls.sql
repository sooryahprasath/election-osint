-- DHARMA-OSINT: RLS hardening (public read, no public write)
-- Run this in Supabase SQL Editor.
-- Notes:
-- - The service role bypasses RLS automatically (used by workers/server).
-- - The anon key is public; RLS is what prevents spam/poisoning.
-- - Python workers and POST /api/ingest must use SUPABASE_SERVICE_ROLE_KEY (server env only).
--   INGEST_SHARED_SECRET is unrelated — it only gates the Next.js HTTP ingest route.

-- Enable RLS
alter table public.constituencies enable row level security;
alter table public.candidates enable row level security;
alter table public.signals enable row level security;
alter table public.briefings enable row level security;
alter table public.voter_turnout enable row level security;
alter table public.exit_polls enable row level security;
alter table public.live_results enable row level security;

-- Remove broad privileges; re-grant only what we want.
revoke all on table public.constituencies from anon, authenticated;
revoke all on table public.candidates from anon, authenticated;
revoke all on table public.signals from anon, authenticated;
revoke all on table public.briefings from anon, authenticated;
revoke all on table public.voter_turnout from anon, authenticated;
revoke all on table public.exit_polls from anon, authenticated;
revoke all on table public.live_results from anon, authenticated;

grant select on table public.constituencies to anon, authenticated;
grant select on table public.candidates to anon, authenticated;
grant select on table public.signals to anon, authenticated;
grant select on table public.briefings to anon, authenticated;
grant select on table public.voter_turnout to anon, authenticated;
grant select on table public.exit_polls to anon, authenticated;
grant select on table public.live_results to anon, authenticated;

-- Drop old policies if re-running
drop policy if exists "public_read_constituencies" on public.constituencies;
drop policy if exists "public_read_candidates" on public.candidates;
drop policy if exists "public_read_signals" on public.signals;
drop policy if exists "public_read_briefings" on public.briefings;
drop policy if exists "public_read_voter_turnout" on public.voter_turnout;
drop policy if exists "public_read_exit_polls" on public.exit_polls;
drop policy if exists "public_read_live_results" on public.live_results;

-- Public read policies
create policy "public_read_constituencies" on public.constituencies for select using (true);
create policy "public_read_candidates" on public.candidates for select using (true);
create policy "public_read_signals" on public.signals for select using (true);
create policy "public_read_briefings" on public.briefings for select using (true);
create policy "public_read_voter_turnout" on public.voter_turnout for select using (true);
create policy "public_read_exit_polls" on public.exit_polls for select using (true);
create policy "public_read_live_results" on public.live_results for select using (true);

