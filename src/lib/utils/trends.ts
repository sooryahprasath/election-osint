"use client";

import { excludeFromIntelligenceFeed } from "@/lib/utils/signalClassifier";

export type TrendWindow = "6h" | "24h" | "3d" | "7d";
export type IssueKey =
  | "violence"
  | "turnout"
  | "EVM"
  | "alliances"
  | "defections"
  | "campaign"
  | "misinformation"
  | "governance";

export interface HistoricalResult {
  constituency_id: string;
  election_year: number | null;
  winner_candidate_name: string | null;
  winner_party: string | null;
  runner_up_candidate_name: string | null;
  runner_up_party: string | null;
  margin_votes: number | null;
  margin_pct: number | null;
  turnout_pct: number | null;
}

export interface TrendsFilters {
  state: string;
  verifiedOnly: boolean;
}

export interface TrendSeriesBucket {
  label: string;
  signalCount: number;
  weightedSeverity: number;
  verifiedRatio: number;
  uniqueSources: number;
}

export interface TrendSummary {
  totalSignals: number;
  avgSeverity: number;
  verifiedRatio: number;
  uniqueSources: number;
}

export interface TrendRow {
  id: string;
  label: string;
  state: string;
  score: number;
  momentum: number;
  signalCount: number;
  uniqueSources: number;
  verifiedRatio: number;
  avgSeverity: number;
  explanation: string;
  subtitle?: string;
  tone?: "danger" | "warning" | "info" | "neutral" | "success";
  historicalLabel?: string;
}

const WINDOW_MS: Record<TrendWindow, number> = {
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

const BUCKET_MS: Record<TrendWindow, number> = {
  "6h": 60 * 60 * 1000,
  "24h": 4 * 60 * 60 * 1000,
  "3d": 12 * 60 * 60 * 1000,
  "7d": 24 * 60 * 60 * 1000,
};

const ISSUE_META: Record<IssueKey, { label: string; color: string; tone: TrendRow["tone"] }> = {
  violence: { label: "Violence", color: "#dc2626", tone: "danger" },
  turnout: { label: "Turnout", color: "#0284c7", tone: "info" },
  EVM: { label: "EVM", color: "#ea580c", tone: "warning" },
  alliances: { label: "Alliances", color: "#8b5cf6", tone: "info" },
  defections: { label: "Defections", color: "#d97706", tone: "warning" },
  campaign: { label: "Campaign", color: "#16a34a", tone: "success" },
  misinformation: { label: "Misinformation", color: "#be123c", tone: "danger" },
  governance: { label: "Official Action", color: "#0f766e", tone: "neutral" },
};

type SignalLike = Record<string, unknown>;
type CandidateLike = Record<string, unknown>;
type ConstituencyLike = Record<string, unknown>;

type ActivityStats = {
  signalCount: number;
  weightedCount: number;
  weightedSeverity: number;
  uniqueSources: Set<string>;
  verifiedCount: number;
  severitySum: number;
  videoCount: number;
  currentHalfScore: number;
  previousHalfScore: number;
};

type HistoricalMap = Map<string, HistoricalResult>;
type CandidateProfile = {
  id: string;
  constituencyId: string;
  state: string;
  name: string;
  fullLower: string;
  tokens: string[];
  party: string;
};

const NAME_STOPWORDS = new Set(["shri", "smt", "dr", "prof", "mr", "mrs", "ms", "adv"]);

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeText(value: unknown): string {
  return asString(value).trim().toLowerCase();
}

function parseTime(value: unknown): number {
  const ts = Date.parse(asString(value));
  return Number.isFinite(ts) ? ts : 0;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function getTrendWindowMs(window: TrendWindow): number {
  return WINDOW_MS[window];
}

export function getBucketMs(window: TrendWindow): number {
  return BUCKET_MS[window];
}

export function issueMeta(issue: IssueKey) {
  return ISSUE_META[issue];
}

export function buildHistoricalResultsMap(results: HistoricalResult[]): HistoricalMap {
  const map = new Map<string, HistoricalResult>();
  for (const result of results) {
    const id = asString(result.constituency_id);
    if (!id) continue;
    const existing = map.get(id);
    const existingYear = existing?.election_year ?? -Infinity;
    const nextYear = result.election_year ?? -Infinity;
    if (!existing || nextYear >= existingYear) {
      map.set(id, result);
    }
  }
  return map;
}

export function classifySignalIssues(signal: SignalLike): IssueKey[] {
  const chunks = [
    asString(signal.title),
    asString(signal.body),
    ...(Array.isArray(signal.full_summary) ? signal.full_summary.map(asString) : []),
  ];
  const text = chunks.join(" ").toLowerCase();
  const matches: IssueKey[] = [];

  const include = (key: IssueKey, patterns: RegExp[]) => {
    if (patterns.some((pattern) => pattern.test(text))) matches.push(key);
  };

  include("violence", [/\bviolence\b/, /\bclash(?:es)?\b/, /\battack(?:ed)?\b/, /\bbooth capture\b/, /\barson\b/]);
  include("turnout", [/\bturnout\b/, /\bvoter turnout\b/, /\bpoll percentage\b/, /\bqueues?\b/]);
  include("EVM", [/\bevm\b/, /\bvvpats?\b/, /\bmachine fault\b/, /\bmachine malfunction\b/, /\bvoting machine\b/]);
  include("alliances", [/\balliance\b/, /\bseat sharing\b/, /\bcoalition\b/, /\btie[- ]?up\b/]);
  include("defections", [/\bdefect(?:ion|ed|s)?\b/, /\bjoins?\b.*\bparty\b/, /\bswitch(?:ed|es)? camp\b/]);
  include("misinformation", [/\brumou?r\b/, /\bfake news\b/, /\bmisinformation\b/, /\bdeepfake\b/, /\bfalse claim\b/]);
  include("governance", [/\beci\b/, /\belection commission\b/, /\bnotice\b/, /\bmcc\b/, /\bcode of conduct\b/, /\bseizure\b/, /\bpolice\b/, /\bofficial\b/]);
  include("campaign", [/\brally\b/, /\bcampaign\b/, /\broadshow\b/, /\bmanifesto\b/, /\bcanvass(?:ing)?\b/, /\bcandidate\b/]);

  return matches.length > 0 ? Array.from(new Set(matches)) : ["campaign"];
}

export function getSignalSearchText(signal: SignalLike): string {
  const chunks = [
    asString(signal.title),
    asString(signal.body),
    asString(signal.source),
    ...(Array.isArray(signal.full_summary) ? signal.full_summary.map(asString) : []),
  ];
  return chunks.join(" ").toLowerCase();
}

function significantTokens(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 4 && !NAME_STOPWORDS.has(token))
    )
  );
}

function buildCandidateProfiles(
  candidates: CandidateLike[],
  constituencies: ConstituencyLike[]
): CandidateProfile[] {
  const stateByConstituencyId = new Map<string, string>();
  for (const constituency of constituencies) {
    stateByConstituencyId.set(asString(constituency.id), asString(constituency.state));
  }

  return candidates
    .filter((candidate) => !candidate.removed)
    .map((candidate) => {
      const constituencyId = asString(candidate.constituency_id);
      const name = asString(candidate.name);
      return {
        id: asString(candidate.id),
        constituencyId,
        state: stateByConstituencyId.get(constituencyId) ?? "",
        name,
        fullLower: name.trim().toLowerCase(),
        tokens: significantTokens(name),
        party: asString(candidate.party_abbreviation) || asString(candidate.party) || "IND",
      };
    })
    .filter((profile) => profile.id && profile.constituencyId && profile.name);
}

function buildCandidateTokenIndex(profiles: CandidateProfile[]) {
  const index = new Map<string, CandidateProfile[]>();
  for (const profile of profiles) {
    for (const token of profile.tokens) {
      const bucket = index.get(token) ?? [];
      bucket.push(profile);
      index.set(token, bucket);
    }
  }
  return index;
}

function inferCandidateMatches(
  signal: SignalLike,
  candidateIndex: Map<string, CandidateProfile[]>
): CandidateProfile[] {
  const text = getSignalSearchText(signal);
  if (!text) return [];

  const state = normalizeText(signal.state);
  const words = new Set(text.match(/[a-z0-9]{2,}/g) ?? []);
  const counts = new Map<string, { profile: CandidateProfile; hits: number }>();

  for (const word of words) {
    const profiles = candidateIndex.get(word);
    if (!profiles) continue;
    for (const profile of profiles) {
      if (state && normalizeText(profile.state) && normalizeText(profile.state) !== state) continue;
      const entry = counts.get(profile.id);
      if (entry) {
        entry.hits += 1;
      } else {
        counts.set(profile.id, { profile, hits: 1 });
      }
    }
  }

  const matches: CandidateProfile[] = [];
  for (const { profile, hits } of counts.values()) {
    const requiredHits = profile.tokens.length <= 1 ? 1 : 2;
    if (text.includes(profile.fullLower) || hits >= requiredHits) {
      matches.push(profile);
    }
  }

  return matches;
}

function inferConstituencyIdsFromText(signal: SignalLike, constituencies: ConstituencyLike[]): string[] {
  const text = getSignalSearchText(signal);
  if (!text) return [];
  const signalState = normalizeText(signal.state);
  const matches = new Set<string>();

  for (const constituency of constituencies) {
    const name = normalizeText(constituency.name);
    if (!name) continue;
    const constituencyState = normalizeText(constituency.state);
    if (signalState && constituencyState && signalState !== constituencyState) continue;
    if (text.includes(name)) {
      matches.add(asString(constituency.id));
    }
  }

  return Array.from(matches);
}

function buildPartyAliases(candidates: CandidateLike[]): Map<string, Set<string>> {
  const aliases = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (candidate.removed) continue;
    const party = asString(candidate.party_abbreviation) || asString(candidate.party);
    if (!party) continue;
    const bucket = aliases.get(party) ?? new Set<string>();
    const full = normalizeText(candidate.party);
    const abbr = normalizeText(candidate.party_abbreviation);
    if (full) bucket.add(full);
    if (abbr) bucket.add(abbr);
    aliases.set(party, bucket);
  }
  return aliases;
}

export function filterTrendSignals(
  signals: SignalLike[],
  filters: TrendsFilters,
  constituencies: ConstituencyLike[]
): SignalLike[] {
  const stateByConstituencyId = new Map<string, string>();
  for (const constituency of constituencies) {
    stateByConstituencyId.set(asString(constituency.id), asString(constituency.state));
  }

  return signals.filter((signal) => {
    if (excludeFromIntelligenceFeed(signal)) return false;
    if (filters.verifiedOnly && !signal.verified) return false;
    if (filters.state === "ALL") return true;

    const state = asString(signal.state);
    if (state === filters.state) return true;

    const constituencyState = stateByConstituencyId.get(asString(signal.constituency_id));
    return constituencyState === filters.state;
  });
}

function recencyWeight(createdAtMs: number, nowMs: number, windowMs: number): number {
  const age = Math.max(0, nowMs - createdAtMs);
  const freshness = Math.max(0, 1 - age / windowMs);
  return 0.35 + freshness * 0.65;
}

function createEmptyStats(): ActivityStats {
  return {
    signalCount: 0,
    weightedCount: 0,
    weightedSeverity: 0,
    uniqueSources: new Set<string>(),
    verifiedCount: 0,
    severitySum: 0,
    videoCount: 0,
    currentHalfScore: 0,
    previousHalfScore: 0,
  };
}

function accumulateSignal(
  stats: ActivityStats,
  signal: SignalLike,
  nowMs: number,
  windowMs: number,
  windowStartMs: number,
  scale = 1
) {
  const createdAtMs = parseTime(signal.created_at);
  if (!createdAtMs || createdAtMs < windowStartMs || createdAtMs > nowMs) return;

  const weight = recencyWeight(createdAtMs, nowMs, windowMs);
  const severity = Math.max(1, asNumber(signal.severity, 1));
  const halfStartMs = nowMs - windowMs / 2;

  stats.signalCount += scale;
  stats.weightedCount += weight * scale;
  stats.weightedSeverity += weight * severity * scale;
  stats.severitySum += severity * scale;
  if (signal.verified) stats.verifiedCount += scale;
  if (signal.video_url) stats.videoCount += scale;

  const source = asString(signal.source).trim().toLowerCase();
  if (source) stats.uniqueSources.add(source);

  if (createdAtMs >= halfStartMs) {
    stats.currentHalfScore += weight * severity * scale;
  } else {
    stats.previousHalfScore += weight * severity * scale;
  }
}

function statsToMetrics(stats: ActivityStats) {
  return {
    signalCount: round(stats.signalCount, 1),
    uniqueSources: stats.uniqueSources.size,
    verifiedRatio: stats.signalCount > 0 ? stats.verifiedCount / stats.signalCount : 0,
    avgSeverity: stats.signalCount > 0 ? stats.severitySum / stats.signalCount : 0,
    momentum: round(stats.currentHalfScore - stats.previousHalfScore, 1),
  };
}

function constituencyHistoricalLabel(
  score: number,
  result: HistoricalResult | undefined
): string | undefined {
  if (!result) return undefined;
  const marginPct = asNumber(result.margin_pct, -1);
  if (marginPct >= 0 && marginPct < 5) return "Swing seat";
  if (marginPct >= 12 && score >= 55) return "Safe seat under pressure";
  return undefined;
}

function candidateHistoricalLabel(
  score: number,
  candidate: CandidateLike,
  result: HistoricalResult | undefined
): string | undefined {
  if (candidate.incumbent && score >= 50) return "Incumbent under pressure";
  return constituencyHistoricalLabel(score, result);
}

function explanationFromStats(
  stats: ActivityStats,
  options: { includeVideo?: boolean; includeHistorical?: boolean; historicalLabel?: string }
): string {
  const parts: string[] = [];
  parts.push(`${stats.signalCount} signals`);
  if (stats.uniqueSources.size > 1) parts.push(`${stats.uniqueSources.size} sources`);
  if (stats.signalCount > 0) {
    const verifiedPct = Math.round((stats.verifiedCount / stats.signalCount) * 100);
    parts.push(`${verifiedPct}% verified`);
  }
  if (options.includeVideo && stats.videoCount > 0) parts.push(`${stats.videoCount} video-linked`);
  if (options.includeHistorical && options.historicalLabel) parts.push(options.historicalLabel);
  return parts.join(" · ");
}

function clampScore(score: number): number {
  return round(Math.max(0, Math.min(100, score)), 1);
}

export function buildTrendSeries(signals: SignalLike[], window: TrendWindow, now = new Date()): TrendSeriesBucket[] {
  const nowMs = now.getTime();
  const bucketMs = getBucketMs(window);
  const windowMs = getTrendWindowMs(window);
  const bucketCount = Math.ceil(windowMs / bucketMs);
  const startMs = nowMs - bucketCount * bucketMs;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = startMs + index * bucketMs;
    const bucketDate = new Date(bucketStart);
    const label =
      window === "7d"
        ? bucketDate.toLocaleDateString("en-IN", { month: "short", day: "numeric" })
        : bucketDate.toLocaleTimeString("en-IN", { hour: "numeric", hour12: false });
    return {
      label,
      signalCount: 0,
      weightedSeverity: 0,
      verifiedCount: 0,
      sources: new Set<string>(),
    };
  });

  for (const signal of signals) {
    const createdAtMs = parseTime(signal.created_at);
    if (!createdAtMs || createdAtMs < startMs || createdAtMs > nowMs) continue;
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((createdAtMs - startMs) / bucketMs)));
    const severity = Math.max(1, asNumber(signal.severity, 1));
    buckets[index].signalCount += 1;
    buckets[index].weightedSeverity += severity;
    if (signal.verified) buckets[index].verifiedCount += 1;
    const source = asString(signal.source).toLowerCase();
    if (source) buckets[index].sources.add(source);
  }

  return buckets.map((bucket) => ({
    label: bucket.label,
    signalCount: bucket.signalCount,
    weightedSeverity: round(bucket.weightedSeverity, 1),
    verifiedRatio: bucket.signalCount > 0 ? bucket.verifiedCount / bucket.signalCount : 0,
    uniqueSources: bucket.sources.size,
  }));
}

export function summarizeSignals(signals: SignalLike[]): TrendSummary {
  const uniqueSources = new Set<string>();
  let verifiedCount = 0;
  let severitySum = 0;

  for (const signal of signals) {
    const source = asString(signal.source).toLowerCase();
    if (source) uniqueSources.add(source);
    if (signal.verified) verifiedCount += 1;
    severitySum += Math.max(1, asNumber(signal.severity, 1));
  }

  return {
    totalSignals: signals.length,
    avgSeverity: signals.length > 0 ? round(severitySum / signals.length, 1) : 0,
    verifiedRatio: signals.length > 0 ? verifiedCount / signals.length : 0,
    uniqueSources: uniqueSources.size,
  };
}

export function buildConstituencyTrends(
  signals: SignalLike[],
  constituencies: ConstituencyLike[],
  candidates: CandidateLike[],
  historicalMap: HistoricalMap,
  window: TrendWindow,
  now = new Date()
): TrendRow[] {
  const nowMs = now.getTime();
  const windowMs = getTrendWindowMs(window);
  const windowStartMs = nowMs - windowMs;
  const constituencyById = new Map<string, ConstituencyLike>();
  for (const constituency of constituencies) {
    constituencyById.set(asString(constituency.id), constituency);
  }
  const candidateProfiles = buildCandidateProfiles(candidates, constituencies);
  const candidateIndex = buildCandidateTokenIndex(candidateProfiles);
  const candidateMatchesBySignal = new Map<SignalLike, CandidateProfile[]>();
  for (const signal of signals) {
    candidateMatchesBySignal.set(signal, inferCandidateMatches(signal, candidateIndex));
  }

  const statsById = new Map<string, ActivityStats>();
  for (const signal of signals) {
    const constituencyId = asString(signal.constituency_id);
    if (constituencyId && constituencyById.has(constituencyId)) {
      const stats = statsById.get(constituencyId) ?? createEmptyStats();
      accumulateSignal(stats, signal, nowMs, windowMs, windowStartMs);
      statsById.set(constituencyId, stats);
      continue;
    }

    const inferredIds = new Set<string>(inferConstituencyIdsFromText(signal, constituencies));
    for (const candidate of candidateMatchesBySignal.get(signal) ?? []) {
      inferredIds.add(candidate.constituencyId);
    }

    const validInferred = Array.from(inferredIds).filter((id) => constituencyById.has(id));
    if (validInferred.length === 0) continue;
    const scale = 0.8 / validInferred.length;
    for (const inferredId of validInferred) {
      const stats = statsById.get(inferredId) ?? createEmptyStats();
      accumulateSignal(stats, signal, nowMs, windowMs, windowStartMs, scale);
      statsById.set(inferredId, stats);
    }
  }

  const rows: TrendRow[] = [];
  for (const [constituencyId, stats] of statsById.entries()) {
    const constituency = constituencyById.get(constituencyId);
    if (!constituency || stats.signalCount === 0) continue;

    const verifiedRatio = stats.signalCount > 0 ? stats.verifiedCount / stats.signalCount : 0;
    const volatility = asNumber(constituency.volatility_score, 0);
    const historical = historicalMap.get(constituencyId);
    const closenessBonus = historical && asNumber(historical.margin_pct, Infinity) < 5 ? 10 : historical && asNumber(historical.margin_pct, Infinity) < 10 ? 5 : 0;
    const score =
      stats.weightedCount * 13 +
      stats.weightedSeverity * 4 +
      stats.uniqueSources.size * 2.5 +
      verifiedRatio * 10 +
      volatility * 0.18 +
      closenessBonus;
    const historicalLabel = constituencyHistoricalLabel(score, historical);

    rows.push({
      id: constituencyId,
      label: asString(constituency.name) || constituencyId,
      state: asString(constituency.state) || "ALL",
      score: clampScore(score),
      ...statsToMetrics(stats),
      explanation: explanationFromStats(stats, { includeHistorical: true, historicalLabel }),
      subtitle: `VOL ${Math.round(volatility)} · ${asString(constituency.district) || "Seat"}`,
      tone: score >= 70 ? "danger" : score >= 45 ? "warning" : "info",
      historicalLabel,
    });
  }

  return rows.sort((a, b) => b.score - a.score || b.momentum - a.momentum).slice(0, 8);
}

export function buildCandidateTrends(
  signals: SignalLike[],
  candidates: CandidateLike[],
  constituencies: ConstituencyLike[],
  historicalMap: HistoricalMap,
  window: TrendWindow,
  now = new Date()
): TrendRow[] {
  const nowMs = now.getTime();
  const windowMs = getTrendWindowMs(window);
  const windowStartMs = nowMs - windowMs;
  const candidateProfiles = buildCandidateProfiles(candidates, constituencies);
  const candidateIndex = buildCandidateTokenIndex(candidateProfiles);
  const profileById = new Map(candidateProfiles.map((profile) => [profile.id, profile]));
  const candidateMatchesBySignal = new Map<SignalLike, CandidateProfile[]>();
  for (const signal of signals) {
    candidateMatchesBySignal.set(signal, inferCandidateMatches(signal, candidateIndex));
  }
  const constituencyById = new Map<string, ConstituencyLike>();
  for (const constituency of constituencies) {
    constituencyById.set(asString(constituency.id), constituency);
  }

  const signalsByConstituency = new Map<string, SignalLike[]>();
  for (const signal of signals) {
    const constituencyId = asString(signal.constituency_id);
    if (!constituencyId) continue;
    const bucket = signalsByConstituency.get(constituencyId) ?? [];
    bucket.push(signal);
    signalsByConstituency.set(constituencyId, bucket);
  }

  const rows: TrendRow[] = [];
  for (const candidate of candidates) {
    if (candidate.removed) continue;
    const candidateId = asString(candidate.id);
    const constituencyId = asString(candidate.constituency_id);
    if (!candidateId || !constituencyId) continue;

    const constituencySignals = signalsByConstituency.get(constituencyId) ?? [];
    const stats = createEmptyStats();
    for (const signal of constituencySignals) {
      accumulateSignal(stats, signal, nowMs, windowMs, windowStartMs);
    }

    let nameBoost = 0;
    let namedMentions = 0;
    const profile = profileById.get(candidateId);
    for (const signal of signals) {
      const matchedProfiles = candidateMatchesBySignal.get(signal) ?? [];
      const matched = matchedProfiles.find((item) => item.id === candidateId);
      const text = getSignalSearchText(signal);
      const fallbackTextMatch = !!profile?.fullLower && text.includes(profile.fullLower);
      if (!matched && !fallbackTextMatch) continue;

      namedMentions += 1;
      nameBoost += 8;
      const directConstituencyId = asString(signal.constituency_id);
      if (directConstituencyId !== constituencyId) {
        accumulateSignal(stats, signal, nowMs, windowMs, windowStartMs, matched ? 0.85 : 0.75);
      }
    }

    if (stats.signalCount === 0 && namedMentions === 0) continue;

    const verifiedRatio = stats.signalCount > 0 ? stats.verifiedCount / stats.signalCount : 0;
    const videoBoost = stats.videoCount * 4;
    const incumbentBoost = candidate.incumbent ? 6 : 0;
    const score =
      stats.weightedCount * 10 +
      stats.weightedSeverity * 3.8 +
      stats.uniqueSources.size * 2 +
      verifiedRatio * 10 +
      videoBoost +
      nameBoost +
      incumbentBoost;
    const historical = historicalMap.get(constituencyId);
    const historicalLabel = candidateHistoricalLabel(score, candidate, historical);
    const party = asString(candidate.party_abbreviation) || asString(candidate.party) || "IND";
    const constituency = constituencyById.get(constituencyId);

    rows.push({
      id: candidateId,
      label: asString(candidate.name) || candidateId,
      state: asString(constituency?.state) || "ALL",
      score: clampScore(score),
      ...statsToMetrics(stats),
      explanation: `${explanationFromStats(stats, { includeVideo: true, includeHistorical: true, historicalLabel })}${namedMentions > 0 ? ` · ${namedMentions} direct mentions` : ""}`,
      subtitle: `${party} · ${asString(constituency?.name) || constituencyId}`,
      tone: score >= 68 ? "danger" : score >= 42 ? "warning" : "info",
      historicalLabel,
    });
  }

  return rows.sort((a, b) => b.score - a.score || b.momentum - a.momentum).slice(0, 8);
}

export function buildPartyTrends(
  signals: SignalLike[],
  candidates: CandidateLike[],
  constituencies: ConstituencyLike[],
  window: TrendWindow,
  now = new Date()
): TrendRow[] {
  const nowMs = now.getTime();
  const windowMs = getTrendWindowMs(window);
  const windowStartMs = nowMs - windowMs;
  const candidateProfiles = buildCandidateProfiles(candidates, constituencies);
  const candidateIndex = buildCandidateTokenIndex(candidateProfiles);
  const candidateMatchesBySignal = new Map<SignalLike, CandidateProfile[]>();
  for (const signal of signals) {
    candidateMatchesBySignal.set(signal, inferCandidateMatches(signal, candidateIndex));
  }
  const stateByConstituencyId = new Map<string, string>();
  for (const constituency of constituencies) {
    stateByConstituencyId.set(asString(constituency.id), asString(constituency.state));
  }

  const partySeats = new Map<string, Set<string>>();
  const partyAliases = buildPartyAliases(candidates);
  for (const candidate of candidates) {
    if (candidate.removed) continue;
    const party = asString(candidate.party_abbreviation) || asString(candidate.party);
    const constituencyId = asString(candidate.constituency_id);
    if (!party || !constituencyId) continue;
    const seats = partySeats.get(party) ?? new Set<string>();
    seats.add(constituencyId);
    partySeats.set(party, seats);
  }

  const rows: TrendRow[] = [];
  for (const [party, seats] of partySeats.entries()) {
    const stats = createEmptyStats();
    const stateSet = new Set<string>();
    for (const signal of signals) {
      const constituencyId = asString(signal.constituency_id);
      if (constituencyId && seats.has(constituencyId)) {
        accumulateSignal(stats, signal, nowMs, windowMs, windowStartMs);
        const state = stateByConstituencyId.get(constituencyId);
        if (state) stateSet.add(state);
        continue;
      }

      const text = getSignalSearchText(signal);
      const aliasMatched = Array.from(partyAliases.get(party) ?? []).some((alias) => alias && text.includes(alias));
      const candidateMatched = (candidateMatchesBySignal.get(signal) ?? []).some((profile) => profile.party === party);
      if (!aliasMatched && !candidateMatched) continue;
      accumulateSignal(stats, signal, nowMs, windowMs, windowStartMs, candidateMatched ? 0.85 : 0.7);
      const signalState = asString(signal.state);
      if (signalState) stateSet.add(signalState);
    }
    if (stats.signalCount === 0) continue;

    const verifiedRatio = stats.signalCount > 0 ? stats.verifiedCount / stats.signalCount : 0;
    const score =
      stats.weightedCount * 10 +
      stats.weightedSeverity * 3.2 +
      stats.uniqueSources.size * 2.3 +
      verifiedRatio * 10 +
      stateSet.size * 4;

    rows.push({
      id: party,
      label: party,
      state: stateSet.size === 1 ? Array.from(stateSet)[0] : "MULTI",
      score: clampScore(score),
      ...statsToMetrics(stats),
      explanation: `${explanationFromStats(stats, {})} · ${stateSet.size} state${stateSet.size === 1 ? "" : "s"}`,
      subtitle: `${seats.size} constituencies in scope`,
      tone: score >= 70 ? "danger" : score >= 45 ? "warning" : "info",
    });
  }

  return rows.sort((a, b) => b.score - a.score || b.momentum - a.momentum).slice(0, 8);
}

export function buildIssueTrends(signals: SignalLike[], window: TrendWindow, now = new Date()): TrendRow[] {
  const nowMs = now.getTime();
  const windowMs = getTrendWindowMs(window);
  const windowStartMs = nowMs - windowMs;
  const statsByIssue = new Map<IssueKey, ActivityStats>();
  const statesByIssue = new Map<IssueKey, Set<string>>();

  for (const signal of signals) {
    const issues = classifySignalIssues(signal);
    for (const issue of issues) {
      const stats = statsByIssue.get(issue) ?? createEmptyStats();
      accumulateSignal(stats, signal, nowMs, windowMs, windowStartMs);
      statsByIssue.set(issue, stats);

      const states = statesByIssue.get(issue) ?? new Set<string>();
      const state = asString(signal.state);
      if (state) states.add(state);
      statesByIssue.set(issue, states);
    }
  }

  const rows: TrendRow[] = [];
  for (const [issue, stats] of statsByIssue.entries()) {
    if (stats.signalCount === 0) continue;
    const meta = issueMeta(issue);
    const verifiedRatio = stats.signalCount > 0 ? stats.verifiedCount / stats.signalCount : 0;
    const states = statesByIssue.get(issue) ?? new Set<string>();
    const score =
      stats.weightedCount * 12 +
      stats.weightedSeverity * 3 +
      stats.uniqueSources.size * 2 +
      verifiedRatio * 10 +
      states.size * 2.5;

    rows.push({
      id: issue,
      label: meta.label,
      state: states.size === 1 ? Array.from(states)[0] : "MULTI",
      score: clampScore(score),
      ...statsToMetrics(stats),
      explanation: `${explanationFromStats(stats, {})} · ${states.size} state${states.size === 1 ? "" : "s"}`,
      subtitle: `${meta.label} signal cluster`,
      tone: meta.tone,
    });
  }

  return rows.sort((a, b) => b.score - a.score || b.momentum - a.momentum).slice(0, 8);
}
