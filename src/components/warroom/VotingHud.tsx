"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ChevronUp, ChevronDown, Activity, BarChart3, Clock, PieChart, CheckCircle2, ExternalLink, X, Info } from "lucide-react";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { ELECTION_DATES } from "@/lib/utils/countdown";
import { getWarRoomPhase, istMinutesSinceMidnight, sameISTCalendarDay } from "@/lib/utils/warRoomSchedule";

function latestTurnoutRow(rows: any[], state: string) {
  const list = rows.filter((t) => t.state === state);
  if (!list.length) return null;
  return [...list].sort((a, b) => {
    const ta = Date.parse(a.updated_at || "") || 0;
    const tb = Date.parse(b.updated_at || "") || 0;
    return tb - ta;
  })[0];
}

export default function VotingHud({ isMobileOpen, onCloseMobile }: { isMobileOpen?: boolean; onCloseMobile?: () => void }) {
  const { operationMode, simulatedDate, turnoutData, exitPolls } = useLiveData();
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<"TURNOUT" | "EXIT_POLLS">("TURNOUT");
  const [countingState, setCountingState] = useState<string>("West Bengal");
  const rootRef = useRef<HTMLDivElement>(null);

  /** Shrink the map by the HUD height so the panel does not cover the map (desktop + mobile sheet). */
  useLayoutEffect(() => {
    const clear = () => {
      document.documentElement.style.setProperty("--war-hud-reserve", "0px");
    };

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

  if (operationMode === "PRE-POLL") return null;

  const now = simulatedDate || new Date();
  const isVoting = operationMode === "VOTING_DAY";
  const isCounting = operationMode === "COUNTING_DAY";

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
      phaseBanner = { tone: "blue", text: "Live turnout window (07:00–18:30 IST) — ranges from news + LLM consensus; not official ECI." };
    } else if (warPhase === "TURNOUT_FINAL") {
      phaseBanner = { tone: "amber", text: "Polls closed — final estimate pass (18:30–19:15 IST). Embargo until exit-poll window." };
    } else if (warPhase === "EXIT_POLL") {
      phaseBanner = { tone: "orange", text: "Exit-poll window (19:15–02:00 IST). Multiple agencies; figures are indicative until counts." };
    } else {
      phaseBanner = { tone: "zinc", text: "Quiet window (02:00–07:00 IST). Ingestor resting." };
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

  return (
    <div
      ref={rootRef}
      className={`fixed z-30 flex flex-col overflow-hidden border-[#e4e4e7] bg-white/98 backdrop-blur-md transition-[transform,max-height] duration-300 ease-out
          md:top-auto md:bottom-[28px] md:left-[280px] md:right-[280px] md:max-h-[min(40vh,320px)] md:rounded-t-xl md:rounded-b-none md:border md:border-b-0 md:shadow-[0_-4px_24px_rgba(15,23,42,0.06)]
          top-auto bottom-[76px] left-0 right-0 max-h-[min(48vh,480px)] rounded-t-2xl border-t border-x border-[#e4e4e7] shadow-[0_-4px_24px_rgba(15,23,42,0.08)]
          ${isMobileOpen ? "translate-y-0" : "translate-y-[calc(100%+12px)] md:translate-y-0"}
          ${isDesktopCollapsed ? "md:!max-h-[36px] md:min-h-0" : ""}`}
    >
      <div
        className="flex cursor-pointer items-center justify-between border-b border-[#e4e4e7] bg-white px-3 py-2 md:px-4"
        onClick={() => {
          if (window.innerWidth >= 768) setIsDesktopCollapsed(!isDesktopCollapsed);
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isVoting && (
            <div className="flex flex-1 rounded-lg bg-[#f4f4f5] p-0.5 md:inline-flex md:max-w-md">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab("TURNOUT");
                }}
                className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 font-mono text-[9px] font-bold tracking-wide transition-colors md:flex-initial md:px-3 ${
                  activeTab === "TURNOUT" ? "bg-white text-[#0284c7] shadow-sm" : "text-[#71717a] hover:text-[#52525b]"
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
                className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 font-mono text-[9px] font-bold tracking-wide transition-colors md:flex-initial md:px-3 ${
                  activeTab === "EXIT_POLLS" ? "bg-white text-[#ea580c] shadow-sm" : "text-[#71717a] hover:text-[#52525b]"
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
          <span className="font-mono text-[8px] text-[#a1a1aa]">
            <Clock className="mb-0.5 inline h-3 w-3" /> IST
          </span>
          {isDesktopCollapsed ? <ChevronDown className="h-4 w-4 text-[#a1a1aa]" /> : <ChevronUp className="h-4 w-4 text-[#a1a1aa]" />}
        </div>

        <div className="md:hidden flex items-center" onClick={(e) => { e.stopPropagation(); onCloseMobile?.(); }}>
          <X className="h-4 w-4 text-[#71717a]" />
        </div>
      </div>

      {!isDesktopCollapsed && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 pb-6 md:p-4 md:pb-4">
          {isVoting && phaseBanner && activeTab === "TURNOUT" && (
            <div
              className={`mb-3 flex gap-2 rounded-md border px-2.5 py-1.5 font-mono text-[8px] leading-relaxed md:text-[9px] ${
                phaseBanner.tone === "blue"
                  ? "border-sky-100 bg-sky-50/80 text-sky-900"
                  : phaseBanner.tone === "amber"
                    ? "border-amber-100 bg-amber-50/80 text-amber-900"
                    : phaseBanner.tone === "orange"
                      ? "border-orange-100 bg-orange-50/80 text-orange-900"
                      : "border-[#e4e4e7] bg-[#fafafa] text-[#52525b]"
              }`}
            >
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-current opacity-70" />
              <span>{phaseBanner.text}</span>
            </div>
          )}

          {isVoting && activeTab === "TURNOUT" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {activeStates.map((state) => {
                const stateData = latestTurnoutRow(turnoutData, state);
                const minT = stateData ? Number(stateData.turnout_min) : 0;
                const maxT = stateData ? Number(stateData.turnout_max) : 0;
                const avgT = minT > 0 || maxT > 0 ? (minT + maxT) / 2 : 0;
                const newsBullets = stateData?.booth_news || [];
                const updated = stateData?.updated_at
                  ? new Date(stateData.updated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })
                  : null;

                return (
                  <div key={state} className="flex flex-col rounded-xl border border-[#e4e4e7] bg-white p-3 shadow-sm">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <span className="font-mono text-[10px] font-bold tracking-wide text-[#27272a]">{state.toUpperCase()}</span>
                      <div className="text-right">
                        <span className="font-mono text-[9px] text-[#0284c7] font-bold bg-[#0284c7]/10 px-2 py-0.5 rounded block">
                          {stateData?.time_slot || "AWAITING SYNC"}
                        </span>
                        {updated && <span className="font-mono text-[8px] text-[#a1a1aa] mt-0.5 block">upd {updated}</span>}
                      </div>
                    </div>

                    <div className="flex items-end gap-2 mb-2">
                      <span className="text-3xl font-bold text-[#27272a] leading-none tabular-nums">
                        {avgT > 0 ? `${minT}–${maxT}%` : "—"}
                      </span>
                      <span className="font-mono text-[9px] text-[#71717a] mb-1">RANGE</span>
                    </div>

                    <div className="w-full bg-[#e4e4e7] h-2 rounded-full overflow-hidden mb-3">
                      <div
                        className="h-full bg-gradient-to-r from-[#0284c7] to-[#0369a1] transition-all duration-1000 rounded-full"
                        style={{ width: `${Math.min(100, Math.max(0, avgT))}%` }}
                      />
                    </div>

                    <div className="mt-auto pt-2 border-t border-[#e4e4e7] flex flex-col gap-1.5">
                      <span className="font-mono text-[8px] font-bold text-[#71717a] tracking-wider">FIELD NOTES & SOURCES</span>
                      {newsBullets.length > 0 ? (
                        newsBullets.map((n: any, idx: number) => {
                          const isMeta = n.type === "methodology";
                          const isCit = n.type === "citation";
                          return (
                            <div
                              key={idx}
                              className={`text-[10px] leading-tight flex items-start gap-1.5 rounded px-1.5 py-1 ${
                                isMeta ? "bg-[#f4f4f5] text-[#52525b] italic" : "text-[#27272a]"
                              }`}
                            >
                              <span className={`mt-0.5 shrink-0 ${isCit ? "text-[#0284c7]" : "text-[#ea580c]"}`}>
                                {isCit ? "↗" : "▸"}
                              </span>
                              <span className="min-w-0">
                                {n.text}
                                {n.source ? (
                                  <a
                                    href={n.source}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#0284c7] ml-1 hover:underline inline-flex items-center align-middle"
                                  >
                                    <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                ) : null}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-[10px] text-[#a1a1aa] italic">Awaiting first ingest cycle…</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {isVoting && activeTab === "EXIT_POLLS" && (
            <div className="w-full h-full">
              {!isExitPollUnlocked ? (
                <div className="flex flex-col items-center justify-center h-full pt-4">
                  <BarChart3 className="h-8 w-8 text-[#a1a1aa] mb-2 opacity-50" />
                  <p className="font-mono text-sm font-bold text-[#52525b]">EMBARGO ACTIVE</p>
                  <p className="font-mono text-[10px] text-[#71717a] mt-1 text-center max-w-sm px-4">
                    Exit-poll tab unlocks from 19:15 IST on polling days (or use dev time override after 19:15).
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {exitForStates.map((poll) => (
                    <div key={poll.id} className="border border-[#e4e4e7] rounded-lg p-3 bg-white shadow-sm">
                      <div className="flex justify-between items-center mb-3">
                        <span className="font-mono text-xs font-bold text-[#27272a]">{String(poll.state).toUpperCase()}</span>
                        <span className="font-mono text-[9px] bg-[#fff7ed] border border-[#fed7aa] px-2 py-1 rounded text-[#c2410c]">{poll.agency}</span>
                      </div>
                      <div className="flex flex-col gap-2">
                        <div>
                          <div className="flex justify-between font-mono text-[10px] mb-1">
                            <span className="font-bold text-[#ea580c]">{poll.party_a_name}</span>
                            <span>
                              {poll.party_a_min} – {poll.party_a_max} seats
                            </span>
                          </div>
                          <div className="w-full bg-[#f4f4f5] h-2 rounded overflow-hidden">
                            <div className="bg-[#ea580c] h-full rounded-sm" style={{ width: `${Math.min(100, (Number(poll.party_a_max) / 250) * 100)}%` }} />
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between font-mono text-[10px] mb-1">
                            <span className="font-bold text-[#16a34a]">{poll.party_b_name}</span>
                            <span>
                              {poll.party_b_min} – {poll.party_b_max} seats
                            </span>
                          </div>
                          <div className="w-full bg-[#f4f4f5] h-2 rounded overflow-hidden">
                            <div className="bg-[#16a34a] h-full rounded-sm" style={{ width: `${Math.min(100, (Number(poll.party_b_max) / 250) * 100)}%` }} />
                          </div>
                        </div>
                      </div>
                      <p className="font-mono text-[8px] text-[#a1a1aa] mt-2">Indicative seat bands from news-attributed agencies — not final results.</p>
                    </div>
                  ))}
                  {exitForStates.length === 0 && (
                    <div className="font-mono text-xs text-[#a1a1aa] mt-4 text-center w-full col-span-2">Awaiting exit-poll ingest…</div>
                  )}
                </div>
              )}
            </div>
          )}

          {isCounting && (
            <div className="flex flex-col h-full">
              <div className="flex gap-2 mb-3 overflow-x-auto border-b border-[#e4e4e7] pb-2">
                {["Kerala", "Assam", "Tamil Nadu", "West Bengal", "Puducherry"].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setCountingState(s)}
                    className={`font-mono text-[10px] font-bold px-3 py-1 rounded transition-colors ${
                      countingState === s ? "bg-[#dc2626] text-white" : "bg-[#f4f4f5] text-[#71717a] hover:bg-[#e4e4e7]"
                    }`}
                  >
                    {s.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white border border-[#16a34a] p-3 rounded text-center shadow-sm">
                  <div className="text-2xl font-bold text-[#16a34a]">115</div>
                  <div className="font-mono text-[9px] text-[#71717a]">AITC (WON + LEAD)</div>
                </div>
                <div className="bg-white border border-[#ea580c] p-3 rounded text-center shadow-sm">
                  <div className="text-2xl font-bold text-[#ea580c]">92</div>
                  <div className="font-mono text-[9px] text-[#71717a]">BJP (WON + LEAD)</div>
                </div>
                <div className="bg-white border border-[#3b82f6] p-3 rounded text-center shadow-sm">
                  <div className="text-2xl font-bold text-[#3b82f6]">12</div>
                  <div className="font-mono text-[9px] text-[#71717a]">INC (WON + LEAD)</div>
                </div>
                <div className="bg-[#f4f4f5] border border-[#e4e4e7] p-3 rounded flex flex-col justify-center items-center text-center">
                  <CheckCircle2 className="h-5 w-5 text-[#16a34a] mb-1" />
                  <div className="font-mono text-[9px] font-bold text-[#27272a]">COUNTING IN PROGRESS</div>
                  <div className="font-mono text-[8px] text-[#71717a]">219 / 294 SEATS TRENDING</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
