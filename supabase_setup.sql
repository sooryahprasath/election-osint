-- DHARMA-OSINT Production Schema
-- Last Updated: April 2026

-- Drop existing tables to ensure a clean deployment in sandbox environments
DROP TABLE IF EXISTS briefings CASCADE;
DROP TABLE IF EXISTS exit_polls CASCADE;
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
    status TEXT,
    turnout_percentage REAL,
    bbox JSONB,
    district TEXT,
    reservation TEXT,
    electorate INTEGER,
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
alter publication supabase_realtime add table briefings;
alter publication supabase_realtime add table voter_turnout;
alter publication supabase_realtime add table exit_polls;
alter publication supabase_realtime add table live_results;