"use client";

import { useMemo, useState, type CSSProperties, type ComponentType } from "react";
import { Activity, BarChart3, CircleAlert, Filter, MapPinned, ShieldCheck, TrendingUp, Users } from "lucide-react";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { useTrendsData } from "@/lib/useTrendsData";
import { STATE_META } from "@/lib/utils/states";
import {
  buildCandidateTrends,
  buildConstituencyTrends,
  buildHistoricalResultsMap,
  buildIssueTrends,
  buildPartyTrends,
  buildTrendSeries,
  filterTrendSignals,
  summarizeSignals,
  type TrendRow,
  type TrendWindow,
} from "@/lib/utils/trends";

const WINDOWS: TrendWindow[] = ["6h", "24h", "3d", "7d"];

function toneClasses(tone: TrendRow["tone"]) {
  switch (tone) {
    case "danger":
      return "text-[#dc2626]";
    case "warning":
      return "text-[#ea580c]";
    case "info":
      return "text-[#0284c7]";
    case "success":
      return "text-[#16a34a]";
    default:
      return "text-[var(--text-secondary)]";
  }
}

function scoreBarColor(tone: TrendRow["tone"]) {
  switch (tone) {
    case "danger":
      return "#dc2626";
    case "warning":
      return "#ea580c";
    case "info":
      return "#0284c7";
    case "success":
      return "#16a34a";
    default:
      return "#71717a";
  }
}

function TrendKpiCard({
  title,
  value,
  subtitle,
  accent,
  Icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  accent: string;
  Icon: ComponentType<{ className?: string; style?: CSSProperties }>;
}) {
  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[var(--surface-1)] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] font-bold tracking-wider text-[var(--text-muted)]">{title}</span>
        <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
      </div>
      <div className="mt-2 font-mono text-lg font-bold leading-none" style={{ color: accent }}>
        {value}
      </div>
      <div className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">{subtitle}</div>
    </div>
  );
}

function MiniSeriesChart({
  title,
  values,
  labels,
  accent,
  valueFormatter,
}: {
  title: string;
  values: number[];
  labels: string[];
  accent: string;
  valueFormatter: (value: number) => string;
}) {
  const width = 300;
  const height = 88;
  const max = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - (value / max) * (height - 12) - 6;
      return `${x},${y}`;
    })
    .join(" ");
  const latest = values[values.length - 1] ?? 0;

  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[var(--surface-1)] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-bold tracking-wider text-[var(--text-secondary)]">{title}</span>
        <span className="font-mono text-[10px] font-bold" style={{ color: accent }}>
          {valueFormatter(latest)}
        </span>
      </div>
      <div className="mt-3">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full overflow-visible" aria-hidden="true">
          <polyline
            fill="none"
            stroke={accent}
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={points}
          />
        </svg>
        <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[8px] text-[var(--text-muted)]">
          <span>{labels[0] ?? ""}</span>
          <span>{labels[labels.length - 1] ?? ""}</span>
        </div>
      </div>
    </div>
  );
}

function Leaderboard({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: TrendRow[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[var(--surface-1)]">
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--border)] px-3 py-2">
        <span className="font-mono text-[10px] font-bold tracking-wider text-[var(--text-primary)]">{title}</span>
        <span className="font-mono text-[9px] text-[var(--text-muted)]">{rows.length} shown</span>
      </div>
      <div className="divide-y divide-[color:var(--border)]">
        {rows.length === 0 ? (
          <div className="px-3 py-6 text-center font-mono text-[10px] text-[var(--text-muted)]">{emptyLabel}</div>
        ) : (
          rows.map((row, index) => {
            const barColor = scoreBarColor(row.tone);
            return (
              <div key={row.id} className="px-3 py-2.5">
                <div className="flex items-start gap-3">
                  <div className="w-4 shrink-0 pt-0.5 font-mono text-[10px] font-bold text-[var(--text-muted)]">
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[11px] font-bold text-[var(--text-primary)]">{row.label}</span>
                          {row.historicalLabel ? (
                            <span className="rounded border border-[color:var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[8px] font-bold text-[var(--text-secondary)]">
                              {row.historicalLabel.toUpperCase()}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 font-mono text-[9px] text-[var(--text-muted)]">
                          {row.subtitle ? `${row.subtitle} · ` : ""}
                          {row.state}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono text-[11px] font-bold ${toneClasses(row.tone)}`}>{row.score.toFixed(1)}</div>
                        <div className={`font-mono text-[9px] ${row.momentum >= 0 ? "text-[#16a34a]" : "text-[#dc2626]"}`}>
                          {row.momentum >= 0 ? "+" : ""}
                          {row.momentum.toFixed(1)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-[var(--surface-2)]">
                      <div className="h-full rounded-sm transition-all" style={{ width: `${Math.max(4, row.score)}%`, backgroundColor: barColor }} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[8px] text-[var(--text-muted)]">
                      <span>{row.signalCount} sig</span>
                      <span>{row.uniqueSources} src</span>
                      <span>{Math.round(row.verifiedRatio * 100)}% verified</span>
                      <span>sev {row.avgSeverity.toFixed(1)}</span>
                    </div>
                    <div className="mt-1.5 text-[10px] leading-snug text-[var(--text-secondary)]">{row.explanation}</div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function TrendsCenterPane({
  globalStateFilter,
  onChangeGlobalStateFilter,
}: {
  globalStateFilter: string;
  onChangeGlobalStateFilter: (state: string) => void;
}) {
  const { constituencies, candidates } = useLiveData();
  const [window, setWindow] = useState<TrendWindow>("24h");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const { signals, historicalResults, isLoading, error } = useTrendsData(window, true);

  const filteredSignals = useMemo(
    () =>
      filterTrendSignals(
        signals,
        { state: globalStateFilter, verifiedOnly },
        constituencies
      ),
    [signals, globalStateFilter, verifiedOnly, constituencies]
  );

  const scopedConstituencies = useMemo(
    () =>
      globalStateFilter === "ALL"
        ? constituencies
        : constituencies.filter((constituency: any) => constituency.state === globalStateFilter),
    [constituencies, globalStateFilter]
  );

  const scopedCandidates = useMemo(() => {
    if (globalStateFilter === "ALL") return candidates;
    const allowedIds = new Set(scopedConstituencies.map((constituency: any) => constituency.id));
    return candidates.filter((candidate: any) => allowedIds.has(candidate.constituency_id));
  }, [candidates, globalStateFilter, scopedConstituencies]);

  const historicalMap = useMemo(
    () => buildHistoricalResultsMap(historicalResults),
    [historicalResults]
  );

  const series = useMemo(() => buildTrendSeries(filteredSignals, window), [filteredSignals, window]);
  const summary = useMemo(() => summarizeSignals(filteredSignals), [filteredSignals]);
  const constituencyRows = useMemo(
    () => buildConstituencyTrends(filteredSignals, scopedConstituencies, scopedCandidates, historicalMap, window),
    [filteredSignals, scopedConstituencies, scopedCandidates, historicalMap, window]
  );
  const candidateRows = useMemo(
    () => buildCandidateTrends(filteredSignals, scopedCandidates, scopedConstituencies, historicalMap, window),
    [filteredSignals, scopedCandidates, scopedConstituencies, historicalMap, window]
  );
  const partyRows = useMemo(
    () => buildPartyTrends(filteredSignals, scopedCandidates, scopedConstituencies, window),
    [filteredSignals, scopedCandidates, scopedConstituencies, window]
  );
  const issueRows = useMemo(
    () => buildIssueTrends(filteredSignals, window),
    [filteredSignals, window]
  );

  const chartLabels = series.map((bucket) => bucket.label);
  const volumeSeries = series.map((bucket) => bucket.signalCount);
  const severitySeries = series.map((bucket) => bucket.weightedSeverity);
  const verifiedSeries = series.map((bucket) => Math.round(bucket.verifiedRatio * 100));
  const sourceSeries = series.map((bucket) => bucket.uniqueSources);
  const liveStates = Array.from(new Set(constituencies.map((constituency: any) => constituency.state))).filter(Boolean) as string[];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--surface-0)]">
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--border)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-[#ea580c]" />
          <span className="font-mono text-[11px] font-bold tracking-wider text-[var(--text-primary)]">TRENDS BOARD</span>
        </div>
        <span className="font-mono text-[10px] text-[var(--text-muted)]">
          {filteredSignals.length} signal{filteredSignals.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="border-b border-[color:var(--border)] bg-[var(--surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-[color:var(--border)] bg-[var(--surface-2)] px-2 py-1">
            <Filter className="h-3 w-3 text-[var(--text-muted)]" />
            <span className="font-mono text-[9px] font-bold tracking-wider text-[var(--text-secondary)]">FILTERS</span>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => onChangeGlobalStateFilter("ALL")}
              className={`rounded-md px-2 py-1 font-mono text-[9px] font-bold tracking-wider ${globalStateFilter === "ALL" ? "bg-[#16a34a]/15 text-[#16a34a]" : "text-[var(--text-muted)] hover:bg-[var(--surface-2)]"}`}
            >
              ALL
            </button>
            {liveStates.map((state) => {
              const meta = STATE_META[state];
              const active = globalStateFilter === state;
              return (
                <button
                  key={state}
                  type="button"
                  onClick={() => onChangeGlobalStateFilter(state)}
                  className={`rounded-md px-2 py-1 font-mono text-[9px] font-bold tracking-wider ${active ? "" : "text-[var(--text-muted)] hover:bg-[var(--surface-2)]"}`}
                  style={active ? { backgroundColor: `${meta?.color ?? "#16a34a"}20`, color: meta?.color ?? "#16a34a" } : undefined}
                >
                  {meta?.abbr ?? state}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1 rounded-md border border-[color:var(--border)] bg-[var(--surface-2)] p-1">
            {WINDOWS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setWindow(option)}
                className={`rounded-md px-2 py-1 font-mono text-[9px] font-bold tracking-wider ${window === option ? "bg-[var(--surface-1)] text-[#0284c7]" : "text-[var(--text-muted)] hover:bg-[var(--surface-3)]"}`}
              >
                {option.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setVerifiedOnly((current) => !current)}
            className={`ml-auto rounded-md border px-2 py-1 font-mono text-[9px] font-bold tracking-wider ${verifiedOnly ? "border-[#16a34a]/40 bg-[#16a34a]/15 text-[#16a34a]" : "border-[color:var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"}`}
          >
            VERIFIED ONLY
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 pretty-scroll">
        {error ? (
          <div className="rounded-lg border border-[#dc2626]/30 bg-[#dc2626]/10 p-4 text-sm text-[#dc2626]">
            Failed to load trends: {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-lg border border-[color:var(--border)] bg-[var(--surface-1)] p-6 text-center font-mono text-[10px] text-[var(--text-muted)]">
            Loading trends intelligence...
          </div>
        ) : filteredSignals.length === 0 ? (
          <div className="rounded-lg border border-[color:var(--border)] bg-[var(--surface-1)] p-8 text-center">
            <BarChart3 className="mx-auto h-8 w-8 text-[var(--text-muted)] opacity-50" />
            <div className="mt-3 font-mono text-[11px] font-bold tracking-wider text-[var(--text-secondary)]">NO TRENDS IN THIS WINDOW</div>
            <p className="mt-2 font-mono text-[9px] leading-relaxed text-[var(--text-muted)]">
              Try a wider time window, clear the verified-only filter, or switch back to all states.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <TrendKpiCard title="TOTAL SIGNALS" value={String(summary.totalSignals)} subtitle={`${window.toUpperCase()} activity in scope`} accent="#16a34a" Icon={Activity} />
              <TrendKpiCard title="AVG SEVERITY" value={summary.avgSeverity.toFixed(1)} subtitle="Average signal intensity" accent="#ea580c" Icon={CircleAlert} />
              <TrendKpiCard title="VERIFIED RATIO" value={`${Math.round(summary.verifiedRatio * 100)}%`} subtitle="Verified-source share" accent="#0284c7" Icon={ShieldCheck} />
              <TrendKpiCard title="UNIQUE SOURCES" value={String(summary.uniqueSources)} subtitle="Distinct reporting outlets" accent="#8b5cf6" Icon={Users} />
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <MiniSeriesChart title="Signal Volume" values={volumeSeries} labels={chartLabels} accent="#16a34a" valueFormatter={(value) => `${Math.round(value)}`} />
              <MiniSeriesChart title="Severity Trend" values={severitySeries} labels={chartLabels} accent="#ea580c" valueFormatter={(value) => value.toFixed(1)} />
              <MiniSeriesChart title="Verified Share" values={verifiedSeries} labels={chartLabels} accent="#0284c7" valueFormatter={(value) => `${Math.round(value)}%`} />
              <MiniSeriesChart title="Source Diversity" values={sourceSeries} labels={chartLabels} accent="#8b5cf6" valueFormatter={(value) => `${Math.round(value)}`} />
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <Leaderboard title="Trending Constituencies" rows={constituencyRows} emptyLabel="No constituency-linked signals in this window." />
              <Leaderboard title="Trending Candidates" rows={candidateRows} emptyLabel="No candidate-linked trends in this window." />
              <Leaderboard title="Trending Parties" rows={partyRows} emptyLabel="No party trends in this window." />
              <Leaderboard title="Trending Issues" rows={issueRows} emptyLabel="No issue clusters in this window." />
            </div>

            {historicalResults.length === 0 ? (
              <div className="rounded-lg border border-[color:var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
                <div className="flex items-center gap-2 font-mono">
                  <MapPinned className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  Historical labels are ready, but no `historical_results` rows are currently loaded in Supabase.
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
