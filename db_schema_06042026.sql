-- DHARMA-OSINT — canonical database schema (single source of truth)
-- Last updated: April 2026
--
-- Fresh project: run this whole file in the Supabase SQL editor (new project).
-- Live project already on older schema: use only the sections you need (indexes, RLS, comments),
-- or export with CLI: `supabase link` then `supabase db dump --schema public`.
--
-- Note: `ALTER PUBLICATION ... ADD TABLE` may error if a table is already in the publication — safe to ignore.

-- Drop existing tables to ensure a clean deployment in sandbox environments
DROP TABLE IF EXISTS briefings CASCADE;
DROP TABLE IF EXISTS exit_polls CASCADE;
DROP TABLE IF EXISTS historical_results CASCADE;
DROP TABLE IF EXISTS live_results CASCADE;
DROP TABLE IF EXISTS signals CASCADE;
DROP TABLE IF EXISTS voter_turnout CASCADE;
DROP TABLE IF EXISTS candidates CASCADE;
DROP TABLE IF EXISTS constituencies CASCADE;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Constituencies (Base Geography)
CREATE TABLE constituencies (
    id TEXT PRIMARY KEY,
    name TEXT,
    state TEXT,
    constituency_number INTEGER,
    phase INTEGER,
    polling_date DATE,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    geojson_blob JSONB,
    volatility_score REAL,
    volatility_updated_at TIMESTAMP WITH TIME ZONE,
    status TEXT,
    turnout_percentage REAL,
    bbox JSONB,
    district TEXT,
    reservation TEXT,
    electorate INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 1B. Historical constituency results (previous assembly cycle baseline)
CREATE TABLE historical_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    constituency_id TEXT REFERENCES constituencies(id),
    election_year INTEGER,
    winner_candidate_name TEXT,
    winner_party TEXT,
    runner_up_candidate_name TEXT,
    runner_up_party TEXT,
    margin_votes INTEGER,
    margin_pct REAL,
    turnout_pct REAL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Candidates
CREATE TABLE candidates (
    id TEXT PRIMARY KEY,
    constituency_id TEXT REFERENCES constituencies(id),
    name TEXT,
    party TEXT,
    party_abbreviation TEXT,
    party_color TEXT,
    assets_value BIGINT,
    criminal_cases INTEGER,
    education TEXT,
    age INTEGER,
    gender TEXT,
    incumbent BOOLEAN,
    source_url TEXT,
    background TEXT,
    nomination_status TEXT,
    is_independent BOOLEAN,
    photo_url TEXT,
    myneta_url TEXT,
    liabilities_value BIGINT,
    myneta_candidate_id TEXT,
    eci_affidavit_url TEXT,
    eci_last_synced_at TIMESTAMP WITH TIME ZONE,
    myneta_last_synced_at TIMESTAMP WITH TIME ZONE,
    removed BOOLEAN NOT NULL DEFAULT false,
    removed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Intelligence Signals
CREATE TABLE signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT,
    body TEXT,
    source TEXT,
    source_url TEXT,
    image_url TEXT,
    video_url TEXT,
    category TEXT,
    state TEXT,
    constituency_id TEXT REFERENCES constituencies(id),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    sentiment_score REAL,
    severity INTEGER,
    verified BOOLEAN,
    full_summary JSONB,
    entities_involved JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3B. Social Signals (separate from intelligence signals)
-- Raw social posts + normalized/event summaries for the Social pane.
CREATE TABLE social_signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform TEXT,
    handle TEXT,
    post_url TEXT,
    title TEXT,
    body TEXT,
    english_title TEXT,
    english_summary TEXT,
    language TEXT,
    kind TEXT, -- tier_a_official | tier_a_media | tier_b_public etc.
    tier TEXT, -- A | B
    verified BOOLEAN,
    score REAL,
    tags JSONB,
    evidence JSONB,
    image_url TEXT,
    video_url TEXT,
    content_hash TEXT,
    simhash64 BIGINT,
    published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 4. AI Briefings
CREATE TABLE briefings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    time_of_day TEXT,
    paragraphs JSONB,
    confidence_score INTEGER,
    sources_count INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 5. War Room: Voter Turnout
CREATE TABLE voter_turnout (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    state TEXT,
    time_slot TEXT,
    turnout_min REAL,
    turnout_max REAL,
    booth_news JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 6. War Room: Exit Polls
CREATE TABLE exit_polls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    state TEXT,
    agency TEXT,
    party_a_name TEXT,
    party_a_min INTEGER,
    party_a_max INTEGER,
    party_b_name TEXT,
    party_b_min INTEGER,
    party_b_max INTEGER,
    others_min INTEGER,
    others_max INTEGER,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 7. War Room: Live Results
CREATE TABLE live_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    constituency_id TEXT REFERENCES constituencies(id),
    leading_candidate_id TEXT,
    margin INTEGER,
    status TEXT,
    votes_counted INTEGER,
    total_votes INTEGER,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Enable realtime for ALL interactive tables so the Next.js UI updates instantly
alter publication supabase_realtime add table constituencies;
alter publication supabase_realtime add table candidates;
alter publication supabase_realtime add table signals;
alter publication supabase_realtime add table social_signals;
alter publication supabase_realtime add table briefings;
alter publication supabase_realtime add table voter_turnout;
alter publication supabase_realtime add table exit_polls;
alter publication supabase_realtime add table live_results;

-- ── Column documentation ─────────────────────────────────────────
comment on column public.constituencies.volatility_score is
  '0–100 deterministic index: contest + affidavit risk + recent OSINT (see osint_workers/intel_ingestor.py)';
comment on column public.constituencies.volatility_updated_at is
  'Last successful update from intel_ingestor';

-- ── Indexes (idempotent) ─────────────────────────────────────────
create index if not exists idx_candidates_constituency_id on public.candidates (constituency_id);
create index if not exists idx_candidates_removed on public.candidates (removed);
create index if not exists idx_candidates_myneta_candidate_id on public.candidates (myneta_candidate_id);
create index if not exists idx_historical_results_constituency_id on public.historical_results (constituency_id);
create index if not exists idx_historical_results_election_year on public.historical_results (election_year desc);

-- ── Row level security (anon = read-only; service role bypasses RLS) ──
alter table public.constituencies enable row level security;
alter table public.historical_results enable row level security;
alter table public.candidates enable row level security;
alter table public.signals enable row level security;
alter table public.social_signals enable row level security;
alter table public.briefings enable row level security;
alter table public.voter_turnout enable row level security;
alter table public.exit_polls enable row level security;
alter table public.live_results enable row level security;

revoke all on table public.constituencies from anon, authenticated;
revoke all on table public.historical_results from anon, authenticated;
revoke all on table public.candidates from anon, authenticated;
revoke all on table public.signals from anon, authenticated;
revoke all on table public.social_signals from anon, authenticated;
revoke all on table public.briefings from anon, authenticated;
revoke all on table public.voter_turnout from anon, authenticated;
revoke all on table public.exit_polls from anon, authenticated;
revoke all on table public.live_results from anon, authenticated;

grant select on table public.constituencies to anon, authenticated;
grant select on table public.historical_results to anon, authenticated;
grant select on table public.candidates to anon, authenticated;
grant select on table public.signals to anon, authenticated;
grant select on table public.social_signals to anon, authenticated;
grant select on table public.briefings to anon, authenticated;
grant select on table public.voter_turnout to anon, authenticated;
grant select on table public.exit_polls to anon, authenticated;
grant select on table public.live_results to anon, authenticated;

drop policy if exists "public_read_constituencies" on public.constituencies;
drop policy if exists "public_read_historical_results" on public.historical_results;
drop policy if exists "public_read_candidates" on public.candidates;
drop policy if exists "public_read_signals" on public.signals;
drop policy if exists "public_read_social_signals" on public.social_signals;
drop policy if exists "public_read_briefings" on public.briefings;
drop policy if exists "public_read_voter_turnout" on public.voter_turnout;
drop policy if exists "public_read_exit_polls" on public.exit_polls;
drop policy if exists "public_read_live_results" on public.live_results;

create policy "public_read_constituencies" on public.constituencies for select using (true);
create policy "public_read_historical_results" on public.historical_results for select using (true);
create policy "public_read_candidates" on public.candidates for select using (true);
create policy "public_read_signals" on public.signals for select using (true);
create policy "public_read_social_signals" on public.social_signals for select using (true);
create policy "public_read_briefings" on public.briefings for select using (true);
create policy "public_read_voter_turnout" on public.voter_turnout for select using (true);
create policy "public_read_exit_polls" on public.exit_polls for select using (true);
create policy "public_read_live_results" on public.live_results for select using (true);

-- ── Legacy DBs only: drop stale nomination_status CHECK if ingest fails ──
alter table public.candidates
  drop constraint if exists candidates_nomination_status_check;
