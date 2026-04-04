import { createClient } from '@supabase/supabase-js'

export type Candidate = {
  id: string
  name: string
  party: string
  constituency_id: string
  status: 'leading' | 'trailing' | 'won' | 'lost' | 'pending'
  margin: number
  assets_value?: number
  criminal_cases?: number
  updated_at: string
}

export type Constituency = {
  id: string
  name: string
  state: string
  latitude: number
  longitude: number
  volatility_score: number
  phase: number
  status: 'polling' | 'counting' | 'declared' | 'pending'
  leading_candidate_id?: string
  turnout_percentage?: number
}

export type Signal = {
  id: string
  source: string
  title: string
  body: string
  severity: number // 1-5
  constituency_id?: string
  state?: string
  verified: boolean
  created_at: string
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy_key'

export const supabase = createClient(supabaseUrl, supabaseKey)

// ─── Database init schema string (For documentation / setup script) ────────────
export const DB_SCHEMA = `
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
`
