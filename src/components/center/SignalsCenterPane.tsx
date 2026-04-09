"use client";

import { useMemo, useState } from "react";
import SignalCardBase from "@/components/signals/SignalCardBase";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { STATE_META } from "@/lib/utils/states";
import { excludeFromIntelligenceFeed } from "@/lib/utils/signalClassifier";
import PhaseTimeline from "@/components/signals/PhaseTimeline";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { usePullToRefresh } from "@/lib/hooks/usePullToRefresh";

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
  onSelectSignal: (s: unknown) => void;
}) {
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [q, setQ] = useState("");
  const { signals, constituencies, refreshSignals } = useLiveData();

  const { ref: scrollRef, pullPx, state: pullState } = usePullToRefresh({
    enabled: true,
    onRefresh: refreshSignals,
  });

  const liveStates = Array.from(
    new Set(constituencies.map((c: unknown) => String((c as Record<string, unknown>).state || "")))
  ).filter(Boolean) as string[];
  const activeConst = constituencies.find((c: unknown) => String((c as Record<string, unknown>).id || "") === String(globalConstituencyId || ""));
  const effectiveState = activeConst ? String((activeConst as Record<string, unknown>).state || "ALL") : globalStateFilter;

  const filteredSignals = useMemo(() => {
    const filtered = signals.filter((s: unknown) => {
      const ss = s as Record<string, unknown>;
      if (excludeFromIntelligenceFeed(s)) return false;
      if (effectiveState !== "ALL") return ss.state === effectiveState;
      if (q.trim()) {
        const t = `${String(ss.title || "")} ${String(ss.body || "")} ${String(ss.source || "")} ${String(ss.state || "")}`.toLowerCase();
        if (!t.includes(q.trim().toLowerCase())) return false;
      }
      return true;
    });
    filtered.sort((a: unknown, b: unknown) => {
      const aa = a as Record<string, unknown>;
      const bb = b as Record<string, unknown>;
      const at = Date.parse(String(aa.created_at || "")) || 0;
      const bt = Date.parse(String(bb.created_at || "")) || 0;
      return bt - at;
    });
    return filtered;
  }, [signals, effectiveState, q]);

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
        <div className="mt-2 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1.5 rounded-md border border-[color:var(--border)] bg-[var(--surface-1)] px-2 py-1">
            <Search className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search signals…"
              className="w-full bg-transparent font-mono text-[10px] text-[var(--text-primary)] placeholder-[color:var(--text-muted)] outline-none"
            />
            {q.trim() ? (
              <button
                type="button"
                onClick={() => setQ("")}
                className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
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

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto pb-24 max-md:pb-28 md:pb-3 overscroll-contain touch-pan-y"
      >
        {/* Pull-to-refresh chrome (mobile only) */}
        <div
          className="flex items-center justify-center"
          style={{
            height: pullPx ? pullPx : 0,
            transition: pullState === "refreshing" ? "none" : "height 120ms ease",
          }}
        >
          {pullPx ? (
            <div className="rounded-md border border-[color:var(--border)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[9px] font-bold text-[var(--text-secondary)]">
              {pullState === "refreshing" ? "REFRESHING…" : pullState === "ready" ? "RELEASE TO REFRESH" : "PULL TO REFRESH"}
            </div>
          ) : null}
        </div>
        {filteredSignals.length > 0 ? (
          <div className="p-3 grid gap-2">
            {filteredSignals.map((signal: unknown) => (
              <SignalCardBase
                key={String((signal as Record<string, unknown>).id || "")}
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
