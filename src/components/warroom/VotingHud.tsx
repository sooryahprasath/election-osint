"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronUp, ChevronDown, Activity, BarChart3, Clock, PieChart, CheckCircle2, ExternalLink, X, Info, RefreshCw } from "lucide-react";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { ELECTION_DATES } from "@/lib/utils/countdown";
import { getWarRoomPhase, istMinutesSinceMidnight, sameISTCalendarDay } from "@/lib/utils/warRoomSchedule";
import {
  articleLinkUiLabel,
  contextualSearchUrl,
  safeNewsArticleHref,
} from "@/lib/utils/newsUrls";
import LiveElectionTimeline from "@/components/warroom/LiveElectionTimeline";

const MAX_NOTES_PER_STATE = 4;

function latestTurnoutRow(rows: any[], state: string) {
  const list = rows.filter((t) => t.state === state);
  if (!list.length) return null;
  return [...list].sort((a, b) => {
    const ta = Date.parse(a.updated_at || "") || 0;
    const tb = Date.parse(b.updated_at || "") || 0;
    return tb - ta;
  })[0];
}

/** DB time_slot stores ingest wall-clock — misleading when read minutes later. Use only LIVE vs FINAL. */
function turnoutPhaseShort(timeSlot: string): string {
  const u = (timeSlot || "").toUpperCase();
  if (u.includes("FINAL")) return "FINAL";
  return "LIVE";
}

/** Relative age from server updated_at (always meaningful vs a stale "09:11 IST" snapshot). */
function formatRelativeUpdated(updatedAt: unknown): string {
  const ms = updatedAt ? Date.parse(String(updatedAt)) || 0 : 0;
  if (!ms) return "";
  const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (min <= 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return `${h}h ago`;
}

function filterRenderableBoothNews(raw: unknown): Record<string, unknown>[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.filter((n) => {
    if (!n || typeof n !== "object") return false;
    const o = n as Record<string, unknown>;
    const text = String(o.text ?? "").trim();
    const src = String(o.source ?? "").trim();
    const typ = String(o.type ?? "");
    if (typ === "methodology" && text.length < 24) return false;
    if (/^source track:\s*source\s*$/i.test(text)) return false;
    if (text === "..." || text === "…" || text === "." || text === "—" || text === "–") return src.startsWith("http");
    if (text.length >= 14) return true;
    if (typ === "turnout_claim" && text.length >= 8) return true;
    if (src.startsWith("http") && text.length >= 4) return true;
    if (text.length < 4) return false;
    return text.length >= 8;
  }) as Record<string, unknown>[];
}

export default function VotingHud({
  isMobileOpen,
  onCloseMobile,
  variant = "floating",
  chrome = "full",
  activeTab: controlledActiveTab,
  onChangeTab,
}: {
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  variant?: "floating" | "embedded";
  chrome?: "full" | "content";
  activeTab?: "TURNOUT" | "EXIT_POLLS";
  onChangeTab?: (t: "TURNOUT" | "EXIT_POLLS") => void;
}) {
  const { operationMode, simulatedDate, turnoutData, exitPolls, refreshWarRoom } = useLiveData();
  const [, setRelativeTick] = useState(0);
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);
  const [uncontrolledTab, setUncontrolledTab] = useState<"TURNOUT" | "EXIT_POLLS">("TURNOUT");
  const [countingState, setCountingState] = useState<string>("West Bengal");
  const [refreshing, setRefreshing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeTab = controlledActiveTab ?? uncontrolledTab;
  const setActiveTab = (t: "TURNOUT" | "EXIT_POLLS") => {
    onChangeTab?.(t);
    if (!onChangeTab) setUncontrolledTab(t);
  };
  const shouldRender = operationMode !== "PRE-POLL";

  /** Shrink the map by the HUD height so the panel does not cover the map (desktop + mobile sheet). */
  useLayoutEffect(() => {
    const clear = () => {
      document.documentElement.style.setProperty("--war-hud-reserve", "0px");
    };

    if (variant === "embedded") {
      clear();
      return;
    }

    if (operationMode === "PRE-POLL") {
      clear();
      return;
    }

    const el = rootRef.current;
    if (!el) {
      clear();
      return;
    }

    const apply = () => {
      const mobile = typeof window !== "undefined" && window.innerWidth < 768;
      if (mobile && !isMobileOpen) {
        clear();
        return;
      }
      document.documentElement.style.setProperty("--war-hud-reserve", `${el.offsetHeight}px`);
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
      clear();
    };
  }, [operationMode, isMobileOpen, isDesktopCollapsed, activeTab]);

  const now = simulatedDate || new Date();
  const isCounting = operationMode === "COUNTING_DAY";
  // Any live war-room mode except counting (handles env aliases like POLL / LIVE once normalized, and edge values).
  const isVoting = operationMode !== "PRE-POLL" && !isCounting;

  const isPollCalendarDay = [ELECTION_DATES.phase1, ELECTION_DATES.phase2, ELECTION_DATES.phase2b].some((d) => sameISTCalendarDay(now, d));
  const warPhase = getWarRoomPhase(now, isPollCalendarDay);
  const mins = istMinutesSinceMidnight(now);
  const isExitPollUnlocked =
    isVoting &&
    (warPhase === "EXIT_POLL" || (!isPollCalendarDay && mins >= 19 * 60 + 15));

  const activeStates: string[] =
    now >= ELECTION_DATES.phase2b
      ? ["West Bengal"]
      : now >= ELECTION_DATES.phase2
        ? ["Tamil Nadu", "West Bengal"]
        : ["Kerala", "Assam", "Puducherry"];

  let phaseBanner: { tone: "blue" | "amber" | "orange" | "zinc"; text: string } | null = null;
  if (isVoting && isPollCalendarDay) {
    if (warPhase === "TURNOUT_LIVE") {
      phaseBanner = { tone: "blue", text: "Live turnout window (07:00–18:30 IST)." };
    } else if (warPhase === "TURNOUT_FINAL") {
      phaseBanner = { tone: "amber", text: "Polls closed — final turnout pass (18:30–19:15 IST)." };
    } else if (warPhase === "EXIT_POLL") {
      phaseBanner = { tone: "orange", text: "Exit-poll window (19:15–02:00 IST)." };
    } else {
      phaseBanner = { tone: "zinc", text: "Quiet window (02:00–07:00 IST)." };
    }
  }

  const byState = new Map<string, any>();
  for (const ep of exitPolls) {
    if (!activeStates.includes(ep.state)) continue;
    const ts = Date.parse(ep.updated_at || "") || 0;
    const prev = byState.get(ep.state);
    const pt = prev ? Date.parse(prev.updated_at || "") || 0 : 0;
    if (!prev || ts >= pt) byState.set(ep.state, ep);
  }
  const exitForStates = activeStates.map((s) => byState.get(s)).filter(Boolean);

  const latestTurnoutByState = useMemo(() => {
    const m = new Map<string, any>();
    for (const st of activeStates) {
      const row = latestTurnoutRow(turnoutData, st);
      if (row) m.set(st, row);
    }
    return m;
  }, [turnoutData, activeStates]);

  const lastSyncMs = useMemo(() => {
    let best = 0;
    for (const r of turnoutData as any[]) {
      const t = Date.parse(String(r?.updated_at || r?.created_at || "")) || 0;
      if (t > best) best = t;
    }
    for (const r of exitPolls as any[]) {
      const t = Date.parse(String(r?.updated_at || r?.created_at || "")) || 0;
      if (t > best) best = t;
    }
    return best;
  }, [turnoutData, exitPolls]);

  const syncLabel = useMemo(() => {
    if (!lastSyncMs) return "No sync yet";
    const diff = Date.now() - lastSyncMs;
    const m = Math.max(0, Math.round(diff / 60000));
    if (m <= 1) return "Last sync: just now";
    if (m < 60) return `Last sync: ${m}m ago`;
    const h = Math.round(m / 60);
    return `Last sync: ${h}h ago`;
  }, [lastSyncMs]);

  const [notesState, setNotesState] = useState<string>("ALL");
  const [notesOpen, setNotesOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 768;
  });
  useLayoutEffect(() => {
    // keep selection valid when activeStates changes (phase switches)
    if (notesState !== "ALL" && !activeStates.includes(notesState)) setNotesState("ALL");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStates.join("|")]);

  // Re-render periodically so "updated Xm ago" stays honest without a full page refresh.
  useEffect(() => {
    const id = window.setInterval(() => setRelativeTick((n) => n + 1), 30000);
    return () => window.clearInterval(id);
  }, []);

  if (!shouldRender) return null;

  return (
    <div
      ref={rootRef}
      className={
        variant === "embedded"
          ? "flex h-full min-h-0 flex-col overflow-hidden border border-[color:var(--border)] bg-[var(--surface-1)] rounded-none"
          : `fixed z-30 flex flex-col overflow-hidden border-[color:var(--border)] bg-[var(--surface-1)]/98 backdrop-blur-md transition-[transform,max-height] duration-300 ease-out
              md:top-auto md:bottom-[28px] md:left-[280px] md:right-[280px] md:max-h-[min(40vh,320px)] md:rounded-t-xl md:rounded-b-none md:border md:border-b-0 md:shadow-[0_-4px_24px_rgba(15,23,42,0.06)]
              top-auto bottom-[76px] left-0 right-0 max-h-[min(48vh,480px)] rounded-t-2xl border-t border-x border-[color:var(--border)] shadow-[0_-4px_24px_rgba(15,23,42,0.08)]
              ${isMobileOpen ? "translate-y-0" : "translate-y-[calc(100%+12px)] md:translate-y-0"}
              ${isDesktopCollapsed ? "md:!max-h-[36px] md:min-h-0" : ""}`
      }
    >
      {chrome === "full" ? (
        <div
          className="flex cursor-pointer items-center justify-between border-b border-[color:var(--border)] bg-[var(--surface-1)] px-3 py-2 md:px-4"
          onClick={() => {
            if (variant !== "embedded" && window.innerWidth >= 768) setIsDesktopCollapsed(!isDesktopCollapsed);
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {isVoting && (
              <div className="flex flex-1 overflow-hidden rounded-none border border-[color:var(--border)] bg-[var(--surface-2)] p-0.5 md:inline-flex md:max-w-md">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveTab("TURNOUT");
                  }}
                  className={`flex flex-1 items-center justify-center gap-1 px-2 py-1 font-mono text-[9px] font-bold tracking-wide transition-colors md:flex-initial md:px-3 ${
                    activeTab === "TURNOUT" ? "bg-[var(--surface-1)] text-[#0284c7] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  <Activity className="h-3 w-3 shrink-0" /> LIVE TURNOUT
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveTab("EXIT_POLLS");
                  }}
                  className={`flex flex-1 items-center justify-center gap-1 px-2 py-1 font-mono text-[9px] font-bold tracking-wide transition-colors md:flex-initial md:px-3 ${
                    activeTab === "EXIT_POLLS" ? "bg-[var(--surface-1)] text-[#ea580c] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  <BarChart3 className="h-3 w-3 shrink-0" /> EXIT POLLS
                </button>
              </div>
            )}
            {isCounting && (
              <div className="font-mono text-[11px] font-bold tracking-widest text-[#dc2626] flex items-center gap-2">
                <PieChart className="h-4 w-4" /> ECI LIVE RESULTS
              </div>
            )}
          </div>

          <div className="hidden shrink-0 items-center gap-2 md:flex">
            <span className="font-mono text-[8px] text-[var(--text-muted)]">
              <Clock className="mb-0.5 inline h-3 w-3" /> IST
            </span>
            {isDesktopCollapsed ? <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" /> : <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" />}
          </div>

          {variant !== "embedded" ? (
            <div className="md:hidden flex items-center" onClick={(e) => { e.stopPropagation(); onCloseMobile?.(); }}>
              <X className="h-4 w-4 text-[var(--text-muted)]" />
            </div>
          ) : null}
        </div>
      ) : null}

      {(variant === "embedded" || !isDesktopCollapsed) && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 pb-6 md:p-4 md:pb-4">
          {isVoting ? (
            <LiveElectionTimeline
              now={now}
              variant="voting"
              isPollCalendarDay={isPollCalendarDay}
              warPhase={warPhase}
            />
          ) : isCounting ? (
            <LiveElectionTimeline
              now={now}
              variant="counting"
              isPollCalendarDay={isPollCalendarDay}
              warPhase={warPhase}
            />
          ) : null}

          {/* Sticky: phase + status + refresh (mobile-first) */}
          {isVoting && activeTab === "TURNOUT" ? (
            <div className="sticky top-0 z-10 -mx-3 mb-3 border-b border-[color:var(--border)] bg-[var(--surface-1)]/95 px-3 pb-2 pt-2 backdrop-blur-md md:static md:mx-0 md:border-b-0 md:bg-transparent md:px-0 md:pb-0 md:pt-0">
              {phaseBanner ? (
                <div
                  className={`mb-2 flex gap-2 rounded-md border px-2.5 py-1.5 font-mono text-[8px] leading-snug md:text-[9px] ${
                    phaseBanner.tone === "blue"
                      ? "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-200"
                      : phaseBanner.tone === "amber"
                        ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200"
                        : phaseBanner.tone === "orange"
                          ? "border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-200"
                          : "border-[color:var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)]"
                  }`}
                >
                  <Info className="mt-0.5 h-3 w-3 shrink-0 text-current opacity-70" />
                  <span className="line-clamp-1 md:line-clamp-none">{phaseBanner.text}</span>
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 font-mono text-[9px] font-bold text-[var(--text-secondary)]">
                  Live turnout · <span className="font-mono text-[9px] font-bold text-[var(--text-muted)]">{syncLabel}</span> · unofficial
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (refreshing) return;
                    try {
                      setRefreshing(true);
                      await refreshWarRoom();
                    } finally {
                      setRefreshing(false);
                    }
                  }}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[var(--surface-1)] px-2 py-1 font-mono text-[9px] font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                  aria-label="Refresh voting data"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                  REFRESH
                </button>
              </div>
            </div>
          ) : null}

          {isVoting && activeTab === "TURNOUT" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
              {activeStates.map((state) => {
                const stateData = latestTurnoutRow(turnoutData, state);
                const minT = stateData ? Number(stateData.turnout_min) : 0;
                const maxT = stateData ? Number(stateData.turnout_max) : 0;
                const avgT = minT > 0 || maxT > 0 ? (minT + maxT) / 2 : 0;
                const timeSlot = String(stateData?.time_slot || "");
                const phase = turnoutPhaseShort(timeSlot);
                const rel = formatRelativeUpdated(stateData?.updated_at);

                return (
                  <div
                    key={state}
                    className="flex flex-col rounded-xl border border-[color:var(--border)] bg-[var(--surface-1)] p-3 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.04]"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-bold tracking-wide text-[var(--text-primary)]">
                        {state.toUpperCase()}
                      </span>
                      <span className="shrink-0 rounded-full border border-sky-200/80 bg-sky-50 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-sky-950 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-100">
                        {phase}
                      </span>
                    </div>

                    {avgT > 0 ? (
                      <>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[clamp(1.35rem,4vw,1.65rem)] font-bold leading-none tabular-nums text-[var(--text-primary)]">
                            {`${minT}–${maxT}%`}
                          </span>
                          <span className="font-mono text-[10px] font-semibold text-[var(--text-secondary)]">TURNOUT</span>
                        </div>
                        <p className="mt-1.5 text-[11px] leading-snug text-[var(--text-secondary)]">
                          Updated {rel || "—"} · unofficial · wire snapshot
                        </p>
                      </>
                    ) : (
                      <div className="mb-0.5">
                        <div className="text-[15px] font-semibold text-[var(--text-primary)]">Awaiting estimate</div>
                        <p className="mt-1 text-[11px] leading-snug text-[var(--text-secondary)]">
                          No numeric turnout yet · {phase}
                          {rel ? ` · updated ${rel}` : ""}
                        </p>
                      </div>
                    )}

                    {avgT > 0 ? (
                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#0284c7] to-[#0369a1] transition-all duration-700"
                          style={{ width: `${Math.min(100, Math.max(0, avgT))}%` }}
                        />
                      </div>
                    ) : (
                      <div className="mt-3 h-2 w-full rounded-full bg-[var(--surface-3)] opacity-60" />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {isVoting && activeTab === "TURNOUT" && (
            <div className="mt-4 rounded-xl border border-[color:var(--border)] bg-[var(--surface-2)]/40 p-3 ring-1 ring-black/[0.02] dark:bg-[var(--surface-1)] dark:ring-white/[0.04] md:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setNotesOpen((v) => !v)}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[var(--surface-1)] px-3 py-2 font-mono text-[10px] font-bold tracking-wider text-[var(--text-secondary)] shadow-sm hover:bg-[var(--surface-2)] md:min-h-0 md:py-1.5"
                    aria-expanded={notesOpen}
                  >
                    {notesOpen ? (
                      <ChevronUp className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                    )}
                    NOTES & SOURCES
                  </button>
                  <p className="mt-1.5 hidden text-[11px] text-[var(--text-secondary)] sm:block">
                    Up to {MAX_NOTES_PER_STATE} items per state · verified links when the worker stored a URL
                  </p>
                </div>
                <div
                  className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:max-w-[55%] [&::-webkit-scrollbar]:hidden"
                  role="tablist"
                  aria-label="Filter notes by state"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={notesState === "ALL"}
                    onClick={() => setNotesState("ALL")}
                    className={`shrink-0 rounded-lg border px-3 py-2.5 font-mono text-[10px] font-bold transition-colors md:py-2 ${
                      notesState === "ALL"
                        ? "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-500/35 dark:bg-sky-500/15 dark:text-sky-100"
                        : "border-[color:var(--border)] bg-[var(--surface-1)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
                    }`}
                  >
                    ALL
                  </button>
                  {activeStates.map((st) => (
                    <button
                      key={st}
                      type="button"
                      role="tab"
                      aria-selected={notesState === st}
                      onClick={() => setNotesState(st)}
                      className={`shrink-0 rounded-lg border px-3 py-2.5 font-mono text-[10px] font-bold transition-colors md:py-2 ${
                        notesState === st
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "border-[color:var(--border)] bg-[var(--surface-1)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
                      }`}
                    >
                      {st.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-2 text-[11px] text-[var(--text-secondary)] sm:hidden">
                Up to {MAX_NOTES_PER_STATE} items per state · tap a link to open the source
              </p>

              {!notesOpen ? (
                <div className="mt-3 rounded-lg border border-[color:var(--border)] bg-[var(--surface-2)] px-3 py-2">
                  <div className="font-mono text-[9px] font-bold text-[var(--text-muted)]">TOP NOTES</div>
                  <div className="mt-2 grid gap-1.5">
                    {(() => {
                      const states = notesState === "ALL" ? activeStates : [notesState];
                      const flat: { st: string; n: any }[] = [];
                      for (const st of states) {
                        const row = latestTurnoutByState.get(st);
                        const bullets = filterRenderableBoothNews(row?.booth_news);
                        for (const n of bullets) flat.push({ st, n });
                      }
                      const pick = flat.slice(0, 2);
                      return pick.length > 0 ? (
                        pick.map((x, idx) => (
                          <div key={idx} className="flex items-start gap-2 rounded border border-[color:var(--border)] bg-[var(--surface-1)] px-2 py-1">
                            <span className="mt-0.5 shrink-0 font-mono text-[8px] font-bold text-[var(--text-secondary)]">{x.st.toUpperCase()}</span>
                            <span className="min-w-0 text-[11px] text-[var(--text-primary)]">{x.n?.text}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-[11px] text-[var(--text-muted)] italic">No notes yet.</div>
                      );
                    })()}
                  </div>
                  <button
                    type="button"
                    onClick={() => setNotesOpen(true)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[var(--surface-1)] px-2 py-1 font-mono text-[9px] font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                  >
                    <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" /> SHOW ALL
                  </button>
                </div>
              ) : (
                <div className="mt-3 grid gap-3">
                  {(notesState === "ALL" ? activeStates : [notesState]).map((st) => {
                    const row = latestTurnoutByState.get(st);
                    const bullets = filterRenderableBoothNews(row?.booth_news);
                    return (
                      <div
                        key={st}
                        className="rounded-xl border border-[color:var(--border)] bg-[var(--surface-1)] px-3 py-3 shadow-sm md:px-4 md:py-3.5"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="font-mono text-[10px] font-bold tracking-wider text-[var(--text-primary)]">
                            {st.toUpperCase()}
                          </span>
                          <span
                            className="font-mono text-[10px] text-[var(--text-secondary)]"
                            suppressHydrationWarning
                          >
                            {row?.updated_at
                              ? `Updated ${formatRelativeUpdated(row.updated_at) || "—"}`
                              : "Awaiting data"}
                          </span>
                        </div>
                        {bullets.length > 0 ? (
                          <ul className="mt-3 list-none space-y-2.5 p-0">
                            {bullets.slice(0, MAX_NOTES_PER_STATE).map((n: Record<string, unknown>, idx: number) => {
                              const isMeta = n.type === "methodology";
                              const isCit = n.type === "citation";
                              const srcRaw = typeof n.source === "string" ? n.source.trim() : "";
                              const hasHttpSource = /^https?:\/\//i.test(srcRaw);
                              const noteText = String(n.text || "").trim();
                              const fallbackQ = `${st} assembly election 2026 ${noteText}`;
                              const primaryHref =
                                !isMeta && hasHttpSource ? safeNewsArticleHref(srcRaw, fallbackQ) : "";
                              const searchHref =
                                !isMeta && !hasHttpSource && noteText.length >= 12
                                  ? contextualSearchUrl(st, noteText)
                                  : "";
                              const href = primaryHref || searchHref;
                              const linkLabel = href ? articleLinkUiLabel(href) : "";
                              const isSearchOnly = Boolean(searchHref && !primaryHref);

                              return (
                                <li
                                  key={idx}
                                  className={`rounded-lg border border-[color:var(--border)] bg-[var(--surface-2)]/50 px-3 py-2.5 dark:bg-[var(--surface-2)]/30 ${
                                    isMeta ? "border-dashed" : ""
                                  }`}
                                >
                                  <div className="flex gap-3">
                                    <span
                                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                                        isMeta ? "bg-zinc-400" : isCit ? "bg-sky-500" : "bg-amber-500"
                                      }`}
                                      aria-hidden
                                    />
                                    <div className="min-w-0 flex-1">
                                      <p
                                        className={`text-[13px] leading-snug ${
                                          isMeta
                                            ? "italic text-[var(--text-secondary)]"
                                            : "text-[var(--text-primary)]"
                                        }`}
                                      >
                                        {String(n.text ?? "")}
                                      </p>
                                      {href ? (
                                        <a
                                          href={href}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="mt-2 inline-flex min-h-11 w-full max-w-full items-center gap-2 rounded-lg border border-sky-500/25 bg-sky-500/[0.07] px-3 py-2 text-left text-[12px] font-medium text-sky-700 transition-colors hover:bg-sky-500/15 dark:text-sky-200 dark:hover:bg-sky-500/20 md:min-h-0 md:w-auto md:border-transparent md:bg-transparent md:px-0 md:py-1"
                                        >
                                          <ExternalLink className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                                          <span className="min-w-0 break-words">{linkLabel}</span>
                                          {isSearchOnly ? (
                                            <span className="ml-auto shrink-0 rounded bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[var(--text-muted)] md:ml-2">
                                              Find
                                            </span>
                                          ) : null}
                                        </a>
                                      ) : !isMeta ? (
                                        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                                          No URL on file for this line.
                                        </p>
                                      ) : null}
                                    </div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        ) : row ? (
                          <div className="mt-3 text-[12px] leading-snug text-[var(--text-secondary)]">
                            No readable notes after last sync — tap REFRESH or wait for the worker.
                          </div>
                        ) : (
                          <div className="mt-3 text-[12px] text-[var(--text-secondary)]">
                            Awaiting first ingest cycle…
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {isVoting && activeTab === "EXIT_POLLS" && (
            <div className="w-full h-full">
              {!isExitPollUnlocked ? (
                <div className="flex flex-col items-center justify-center h-full pt-4">
                  <BarChart3 className="h-8 w-8 text-[var(--text-muted)] mb-2 opacity-50" />
                  <p className="font-mono text-sm font-bold text-[var(--text-secondary)]">EMBARGO ACTIVE</p>
                  <p className="font-mono text-[10px] text-[var(--text-muted)] mt-1 text-center max-w-sm px-4">
                    Exit-poll tab unlocks from 19:15 IST on polling days (or use dev time override after 19:15).
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {exitForStates.map((poll) => (
                    <div key={poll.id} className="border border-[color:var(--border)] rounded-lg p-3 bg-[var(--surface-1)] shadow-sm">
                      <div className="flex justify-between items-center mb-3">
                        <span className="font-mono text-xs font-bold text-[var(--text-primary)]">{String(poll.state).toUpperCase()}</span>
                        <span className="font-mono text-[9px] bg-orange-500/10 border border-orange-500/25 px-2 py-1 rounded text-orange-200">{poll.agency}</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        <div>
                          <div className="flex justify-between font-mono text-[10px] mb-1">
                            <span className="font-bold text-[#ea580c]">{poll.party_a_name}</span>
                            <span className="text-[var(--text-secondary)]">
                              {poll.party_a_min} – {poll.party_a_max} seats
                            </span>
                          </div>
                          <div className="w-full bg-[var(--surface-3)] h-2 rounded overflow-hidden">
                            <div className="bg-[#ea580c] h-full rounded-sm" style={{ width: `${Math.min(100, (Number(poll.party_a_max) / 250) * 100)}%` }} />
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between font-mono text-[10px] mb-1">
                            <span className="font-bold text-[#16a34a]">{poll.party_b_name}</span>
                            <span className="text-[var(--text-secondary)]">
                              {poll.party_b_min} – {poll.party_b_max} seats
                            </span>
                          </div>
                          <div className="w-full bg-[var(--surface-3)] h-2 rounded overflow-hidden">
                            <div className="bg-[#16a34a] h-full rounded-sm" style={{ width: `${Math.min(100, (Number(poll.party_b_max) / 250) * 100)}%` }} />
                          </div>
                        </div>
                      </div>
                      <p className="font-mono text-[8px] text-[var(--text-muted)] mt-2">Indicative seat bands from news-attributed agencies — not final results.</p>
                    </div>
                  ))}
                  {exitForStates.length === 0 && (
                    <div className="font-mono text-xs text-[var(--text-muted)] mt-4 text-center w-full col-span-2">Awaiting exit-poll ingest…</div>
                  )}
                </div>
              )}
            </div>
          )}

          {isCounting && (
            <div className="flex flex-col h-full">
              <div className="flex gap-2 mb-3 overflow-x-auto border-b border-[color:var(--border)] pb-2">
                {["Kerala", "Assam", "Tamil Nadu", "West Bengal", "Puducherry"].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setCountingState(s)}
                    className={`font-mono text-[10px] font-bold px-3 py-1 rounded transition-colors ${
                      countingState === s ? "bg-[#dc2626] text-white" : "bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[var(--surface-3)]"
                    }`}
                  >
                    {s.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-[var(--surface-1)] border border-[#16a34a]/35 p-3 rounded text-center shadow-sm">
                  <div className="text-2xl font-bold text-[#16a34a]">115</div>
                  <div className="font-mono text-[9px] text-[var(--text-muted)]">AITC (WON + LEAD)</div>
                </div>
                <div className="bg-[var(--surface-1)] border border-[#ea580c]/35 p-3 rounded text-center shadow-sm">
                  <div className="text-2xl font-bold text-[#ea580c]">92</div>
                  <div className="font-mono text-[9px] text-[var(--text-muted)]">BJP (WON + LEAD)</div>
                </div>
                <div className="bg-[var(--surface-1)] border border-[#3b82f6]/35 p-3 rounded text-center shadow-sm">
                  <div className="text-2xl font-bold text-[#3b82f6]">12</div>
                  <div className="font-mono text-[9px] text-[var(--text-muted)]">INC (WON + LEAD)</div>
                </div>
                <div className="bg-[var(--surface-2)] border border-[color:var(--border)] p-3 rounded flex flex-col justify-center items-center text-center">
                  <CheckCircle2 className="h-5 w-5 text-[#16a34a] mb-1" />
                  <div className="font-mono text-[9px] font-bold text-[var(--text-primary)]">COUNTING IN PROGRESS</div>
                  <div className="font-mono text-[8px] text-[var(--text-muted)]">219 / 294 SEATS TRENDING</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
