-- Run this entire file in your Supabase SQL Editor
-- This prepares the schema required by DHARMA-OSINT to consume the OSINT Pipeline

-- Note: We are dropping any old conflicting tables first (like UUID-based schemas)
DROP TABLE IF EXISTS signals CASCADE;
DROP TABLE IF EXISTS candidates CASCADE;
DROP TABLE IF EXISTS constituencies CASCADE;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE constituencies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    state TEXT NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    volatility_score FLOAT DEFAULT 0.0,
    phase INTEGER,
    status TEXT DEFAULT 'pending',
    leading_candidate_id TEXT,
    turnout_percentage FLOAT
);

CREATE TABLE candidates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    party TEXT NOT NULL,
    constituency_id TEXT REFERENCES constituencies(id),
    status TEXT DEFAULT 'pending',
    margin INTEGER DEFAULT 0,
    assets_value BIGINT,
    criminal_cases INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    severity INTEGER,
    constituency_id TEXT REFERENCES constituencies(id),
    state TEXT,
    verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Enable realtime for these tables so the Next.js UI updates automatically
alter publication supabase_realtime add table constituencies;
alter publication supabase_realtime add table candidates;
alter publication supabase_realtime add table signals;
