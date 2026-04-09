import { describe, expect, test } from "vitest";
import {
  buildCandidateTrends,
  buildConstituencyTrends,
  buildHistoricalResultsMap,
  buildPartyTrends,
  buildTrendSeries,
  classifySignalIssues,
} from "../src/lib/utils/trends";

const now = new Date("2026-04-08T12:00:00.000Z");

const constituencies = [
  { id: "KL-001", name: "Adoor", state: "Kerala", volatility_score: 62, district: "Pathanamthitta" },
  { id: "TN-001", name: "Chepauk", state: "Tamil Nadu", volatility_score: 28, district: "Chennai" },
];

const historicalMap = buildHistoricalResultsMap([
  {
    constituency_id: "KL-001",
    election_year: 2021,
    winner_candidate_name: "A Candidate",
    winner_party: "ABC",
    runner_up_candidate_name: "B Candidate",
    runner_up_party: "XYZ",
    margin_votes: 1200,
    margin_pct: 3.4,
    turnout_pct: 76.2,
  },
]);

const signals = [
  {
    id: "1",
    constituency_id: "KL-001",
    state: "Kerala",
    source: "The Hindu",
    title: "EVM complaint sparks long queues in Adoor",
    body: "Polling officers address an EVM issue after turnout rises.",
    full_summary: ["EVM repaired", "Turnout rising"],
    severity: 4,
    verified: true,
    created_at: "2026-04-08T11:20:00.000Z",
  },
  {
    id: "2",
    constituency_id: "KL-001",
    state: "Kerala",
    source: "ANI",
    title: "Campaign rally sees heavy turnout in Adoor",
    body: "Candidate Alpha addressed supporters.",
    full_summary: ["Large campaign turnout"],
    severity: 3,
    verified: false,
    created_at: "2026-04-08T05:15:00.000Z",
  },
  {
    id: "3",
    constituency_id: "TN-001",
    state: "Tamil Nadu",
    source: "NDTV",
    title: "Tamil Nadu alliance talks intensify",
    body: "Leaders discuss a new alliance formula.",
    full_summary: ["Alliance talks continue"],
    severity: 2,
    verified: true,
    created_at: "2026-04-08T10:55:00.000Z",
  },
];

describe("trends utilities", () => {
  test("buildTrendSeries buckets signals into the selected window", () => {
    const series = buildTrendSeries(signals, "6h", now);

    expect(series).toHaveLength(6);
    const totalSignals = series.reduce((sum, bucket) => sum + bucket.signalCount, 0);
    expect(totalSignals).toBe(2);
  });

  test("classifySignalIssues maps keyword matches into issue taxonomy", () => {
    const issues = classifySignalIssues(signals[0]);
    expect(issues).toContain("EVM");
    expect(issues).toContain("turnout");
  });

  test("constituency trends include positive momentum and swing-seat labeling", () => {
    const rows = buildConstituencyTrends(
      signals,
      constituencies,
      [{ id: "cand-1", constituency_id: "KL-001", name: "Candidate Alpha", party: "ABC", party_abbreviation: "ABC", incumbent: true }],
      historicalMap,
      "24h",
      now
    );
    const adoor = rows.find((row) => row.id === "KL-001");

    expect(adoor).toBeDefined();
    expect(adoor?.score).toBeGreaterThan(0);
    expect(adoor?.momentum).toBeGreaterThan(0);
    expect(adoor?.historicalLabel).toBe("Swing seat");
  });

  test("constituency and party trends can infer from text mentions without constituency ids", () => {
    const inferredSignal = {
      id: "4",
      state: "Kerala",
      source: "Manorama",
      title: "Candidate Alpha gains ground in Adoor as ABC pushes campaign",
      body: "Adoor campaign activity increases for ABC leaders.",
      full_summary: ["Adoor campaign intensifies"],
      severity: 3,
      verified: true,
      created_at: "2026-04-08T11:50:00.000Z",
    };

    const constituencyRows = buildConstituencyTrends(
      [inferredSignal],
      constituencies,
      [{ id: "cand-1", constituency_id: "KL-001", name: "Candidate Alpha", party: "ABC", party_abbreviation: "ABC", incumbent: true }],
      historicalMap,
      "24h",
      now
    );

    const partyRows = buildPartyTrends(
      [inferredSignal],
      [{ id: "cand-1", constituency_id: "KL-001", name: "Candidate Alpha", party: "ABC", party_abbreviation: "ABC", incumbent: true }],
      constituencies,
      "24h",
      now
    );

    expect(constituencyRows.find((row: { id: string }) => row.id === "KL-001")).toBeDefined();
    expect(partyRows.find((row: { id: string }) => row.id === "ABC")).toBeDefined();
  });

  test("candidate trends reward direct mentions and incumbent pressure", () => {
    const rows = buildCandidateTrends(
      signals,
      [
        { id: "cand-1", constituency_id: "KL-001", name: "Candidate Alpha", party: "ABC", party_abbreviation: "ABC", incumbent: true },
      ],
      constituencies,
      historicalMap,
      "24h",
      now
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBeGreaterThan(0);
    expect(rows[0].historicalLabel).toBe("Incumbent under pressure");
  });
});
