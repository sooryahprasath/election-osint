-- DHARMA-OSINT — Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CONSTITUENCIES
CREATE TABLE constituencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('Kerala','Assam','Tamil Nadu','West Bengal','Puducherry')),
  constituency_number INTEGER,
  phase INTEGER NOT NULL CHECK (phase IN (1, 2)),
  polling_date DATE NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  geojson_blob JSONB,
  volatility_score REAL DEFAULT 0.0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- CANDIDATES
CREATE TABLE candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constituency_id UUID REFERENCES constituencies(id),
  name TEXT NOT NULL,
  party TEXT NOT NULL,
  party_abbreviation TEXT,
  party_color TEXT,
  wealth BIGINT DEFAULT 0,
  criminal_records INTEGER DEFAULT 0,
  education TEXT,
  age INTEGER,
  gender TEXT,
  incumbent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- LIVE RESULTS
CREATE TABLE live_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  constituency_id UUID REFERENCES constituencies(id),
  leading_candidate_id UUID REFERENCES candidates(id),
  margin INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','counting','declared')),
  votes_counted INTEGER DEFAULT 0,
  total_votes INTEGER DEFAULT 0,
  timestamp TIMESTAMPTZ DEFAULT now()
);

-- SIGNALS (news/intelligence feed)
CREATE TABLE signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT,
  source TEXT,
  source_url TEXT,
  category TEXT CHECK (category IN ('breaking','alert','analysis','rumor','official')),
  state TEXT,
  constituency_id UUID REFERENCES constituencies(id),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  sentiment_score REAL,
  severity INTEGER DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT now()
);
