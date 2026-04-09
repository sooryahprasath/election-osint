-- DHARMA-OSINT -- Historical constituency results migration
-- Run this once in the Supabase SQL editor. Safe to re-run.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS historical_results (
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

ALTER TABLE public.historical_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.historical_results FROM anon, authenticated;
GRANT SELECT ON TABLE public.historical_results TO anon, authenticated;

DROP POLICY IF EXISTS "public_read_historical_results" ON public.historical_results;
CREATE POLICY "public_read_historical_results" ON public.historical_results FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_historical_results_constituency_id ON public.historical_results (constituency_id);
CREATE INDEX IF NOT EXISTS idx_historical_results_election_year ON public.historical_results (election_year DESC);

-- Optional: import repo-tracked CSV via the Supabase table editor or psql \copy.
-- File path in this repo:
--   historical_results_seed.csv
