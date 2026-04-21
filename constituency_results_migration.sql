-- Add 2021 constituency results for incumbent + breakdown
-- Safe to run on an existing Supabase project (idempotent).

CREATE TABLE IF NOT EXISTS constituency_results (
  state TEXT NOT NULL,
  election_year INTEGER NOT NULL DEFAULT 2021,
  constituency_id TEXT NOT NULL,
  constituency_name_raw TEXT,

  winner_name TEXT,
  winner_party TEXT,
  runner_up_name TEXT,
  runner_up_party TEXT,

  -- ECI detailed-results fields (best-effort; may be null for Wikipedia-ingested rows)
  winner_votes INTEGER,
  runner_up_votes INTEGER,
  total_votes_polled INTEGER,
  total_electors INTEGER,

  margin_votes INTEGER,
  margin_pct NUMERIC,
  turnout_pct NUMERIC,

  source_url TEXT,
  source_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  PRIMARY KEY (state, election_year, constituency_id)
);

-- If the table already existed, add new columns safely
ALTER TABLE public.constituency_results ADD COLUMN IF NOT EXISTS winner_votes INTEGER;
ALTER TABLE public.constituency_results ADD COLUMN IF NOT EXISTS runner_up_votes INTEGER;
ALTER TABLE public.constituency_results ADD COLUMN IF NOT EXISTS total_votes_polled INTEGER;
ALTER TABLE public.constituency_results ADD COLUMN IF NOT EXISTS total_electors INTEGER;

-- Helpful lookup index for UI queries
CREATE INDEX IF NOT EXISTS idx_constituency_results_constituency_year
  ON constituency_results (constituency_id, election_year);

-- Realtime (optional): ignore errors if publication already includes it
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE constituency_results;
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;

-- RLS: public read-only from the app; writes should be service-role only.
ALTER TABLE public.constituency_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.constituency_results FROM anon, authenticated;
GRANT SELECT ON TABLE public.constituency_results TO anon, authenticated;

DROP POLICY IF EXISTS "public_read_constituency_results" ON public.constituency_results;
CREATE POLICY "public_read_constituency_results"
  ON public.constituency_results
  FOR SELECT
  USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- ECI "Electors Data Summary" (state-level gender counts; GEN/SC/ST/TOTAL)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS state_electors_summary (
  state TEXT NOT NULL,
  election_year INTEGER NOT NULL DEFAULT 2021,
  constituency_type TEXT NOT NULL, -- GEN / SC / ST / TOTAL

  electors_male BIGINT,
  electors_female BIGINT,
  electors_third BIGINT,
  electors_total BIGINT,

  voted_male BIGINT,
  voted_female BIGINT,
  voted_third BIGINT,
  voted_total BIGINT,

  poll_pct NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  PRIMARY KEY (state, election_year, constituency_type)
);

CREATE INDEX IF NOT EXISTS idx_state_electors_summary_state_year
  ON state_electors_summary (state, election_year);

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE state_electors_summary;
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;

ALTER TABLE public.state_electors_summary ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.state_electors_summary FROM anon, authenticated;
GRANT SELECT ON TABLE public.state_electors_summary TO anon, authenticated;

DROP POLICY IF EXISTS "public_read_state_electors_summary" ON public.state_electors_summary;
CREATE POLICY "public_read_state_electors_summary"
  ON public.state_electors_summary
  FOR SELECT
  USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- ECI "Constituency Data Summary" (AC-wise electors/voters gender totals)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS constituency_electors_summary (
  state TEXT NOT NULL,
  election_year INTEGER NOT NULL DEFAULT 2021,
  constituency_id TEXT NOT NULL,
  constituency_name_raw TEXT,

  electors_male BIGINT,
  electors_female BIGINT,
  electors_third BIGINT,
  electors_total BIGINT,

  voters_male BIGINT,
  voters_female BIGINT,
  voters_third BIGINT,
  voters_total BIGINT,

  poll_pct NUMERIC,
  source_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  PRIMARY KEY (state, election_year, constituency_id)
);

CREATE INDEX IF NOT EXISTS idx_constituency_electors_summary_state_year
  ON constituency_electors_summary (state, election_year);

CREATE INDEX IF NOT EXISTS idx_constituency_electors_summary_constituency_year
  ON constituency_electors_summary (constituency_id, election_year);

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE constituency_electors_summary;
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;

ALTER TABLE public.constituency_electors_summary ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.constituency_electors_summary FROM anon, authenticated;
GRANT SELECT ON TABLE public.constituency_electors_summary TO anon, authenticated;

DROP POLICY IF EXISTS "public_read_constituency_electors_summary" ON public.constituency_electors_summary;
CREATE POLICY "public_read_constituency_electors_summary"
  ON public.constituency_electors_summary
  FOR SELECT
  USING (true);

