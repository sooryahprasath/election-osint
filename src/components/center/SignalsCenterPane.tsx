"use client";

import { useMemo, useState, useEffect } from "react";
import SignalCardBase from "@/components/signals/SignalCardBase";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { STATE_META } from "@/lib/utils/states";
import { excludeFromIntelligenceFeed } from "@/lib/utils/signalClassifier";
import PhaseTimeline from "@/components/signals/PhaseTimeline";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Intelligence feed (OSINT `signals`) — moved from the left pane into Center.
 */
export default function SignalsCenterPane({
  globalStateFilter,
  setGlobalStateFilter,
  globalConstituencyId,
  onSelectSignal,
}: {
  globalStateFilter: string;
  setGlobalStateFilter: (s: string) => void;
  globalConstituencyId: string | null;
  onSelectSignal: (s: any) => void;
}) {
  const [tick, setTick] = useState(0);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const { signals, constituencies } = useLiveData();

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const liveStates = Array.from(new Set(constituencies.map((c: any) => c.state))).filter(Boolean) as string[];
  const activeConst = constituencies.find((c: any) => c.id === globalConstituencyId);
  const effectiveState = activeConst ? activeConst.state : globalStateFilter;

  const filteredSignals = useMemo(() => {
    const filtered = signals.filter((s: any) => {
      if (excludeFromIntelligenceFeed(s)) return false;
      if (effectiveState !== "ALL") return s.state === effectiveState;
      return true;
    });
    filtered.sort((a: any, b: any) => {
      const at = Date.parse(a.created_at || "") || 0;
      const bt = Date.parse(b.created_at || "") || 0;
      return bt - at;
    });
    return filtered;
  }, [signals, effectiveState]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--surface-1)]">
      <div className="shrink-0 border-b border-[color:var(--border)] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="font-mono text-[10px] font-bold tracking-wider text-[#16a34a]">
            INTELLIGENCE FEED
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTimelineOpen((v) => !v)}
              className="rounded-md border border-[color:var(--border)] bg-[var(--surface-1)] px-2 py-1 font-mono text-[10px] font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-2)] inline-flex items-center gap-1.5"
              aria-expanded={timelineOpen}
              title="Election timeline"
            >
              {timelineOpen ? <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" /> : <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
              ELECTION TIMELINE
            </button>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">{filteredSignals.length} ITEMS</span>
          </div>
        </div>
        {timelineOpen ? (
          <div className="mt-2 rounded-lg border border-[color:var(--border)] bg-[var(--surface-2)]">
            <PhaseTimeline />
          </div>
        ) : null}
        <div className="mt-2 overflow-x-auto">
          <div className="inline-flex min-w-full gap-1 rounded-md border border-[color:var(--border)] bg-[var(--surface-2)] p-1">
            <button
              type="button"
              onClick={() => setGlobalStateFilter("ALL")}
              className={[
                "shrink-0 rounded-sm px-2.5 py-1 font-mono text-[10px] font-bold tracking-wide transition-colors",
                effectiveState === "ALL"
                  ? "bg-[var(--surface-1)] text-[#16a34a] shadow-sm"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text-secondary)]",
              ].join(" ")}
            >
              ALL
            </button>
            {liveStates.map((state) => {
              const meta = STATE_META[state];
              const isActive = effectiveState === state;
              return (
                <button
                  key={state}
                  type="button"
                  onClick={() => setGlobalStateFilter(state)}
                  className={[
                    "shrink-0 rounded-sm px-2.5 py-1 font-mono text-[10px] font-bold tracking-wide transition-colors",
                    isActive ? "bg-[var(--surface-1)] shadow-sm" : "text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text-secondary)]",
                  ].join(" ")}
                  style={isActive && meta?.color ? { color: meta.color } : undefined}
                >
                  {meta?.abbr || state}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-24 max-md:pb-28 md:pb-3">
        {filteredSignals.length > 0 ? (
          <div className="p-3 grid gap-2">
            {filteredSignals.map((signal: any) => (
              <SignalCardBase
                key={signal.id}
                signal={signal}
                onClick={() => onSelectSignal(signal)}
                tone="soft"
                showBody={true}
                showChips={true}
                showCoords={true}
              />
            ))}
          </div>
        ) : (
          <div className="p-6 text-center font-mono text-[10px] text-[var(--text-muted)]">
            No intelligence reports filed for this sector.
          </div>
        )}
      </div>
    </section>
  );
}
