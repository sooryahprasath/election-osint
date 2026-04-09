-- DHARMA-OSINT — Opinion Polls table migration
-- Run this once in the Supabase SQL editor (safe to re-run, uses IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS opinion_polls (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    state                TEXT,
    agency               TEXT,
    publish_date         DATE,
    sample_size          INTEGER,
    party_a_name         TEXT,
    party_a_percentage   REAL,
    party_b_name         TEXT,
    party_b_percentage   REAL,
    others_percentage    REAL,
    undecided_percentage REAL,
    source_url           TEXT,
    confidence_score     REAL,
    verified             BOOLEAN DEFAULT false,
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE opinion_polls;

-- RLS
ALTER TABLE public.opinion_polls ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.opinion_polls FROM anon, authenticated;
GRANT SELECT ON TABLE public.opinion_polls TO anon, authenticated;

DROP POLICY IF EXISTS "public_read_opinion_polls" ON public.opinion_polls;
CREATE POLICY "public_read_opinion_polls" ON public.opinion_polls FOR SELECT USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_opinion_polls_state        ON public.opinion_polls (state);
CREATE INDEX IF NOT EXISTS idx_opinion_polls_agency       ON public.opinion_polls (agency);
CREATE INDEX IF NOT EXISTS idx_opinion_polls_publish_date ON public.opinion_polls (publish_date DESC);
