"use client";

import { useState } from "react";
import { BarChart3, ExternalLink, Users } from "lucide-react";
import { useLiveData } from "@/lib/context/LiveDataContext";

const STATES = ["ALL", "Tamil Nadu", "Kerala", "West Bengal", "Assam", "Puducherry"];

const STATE_COLORS: Record<string, string> = {
  "Tamil Nadu":  "#16a34a",
  "Kerala":      "#0284c7",
  "West Bengal": "#dc2626",
  "Assam":       "#ea580c",
  "Puducherry":  "#8b5cf6",
};

function PollBar({ label, percentage, color }: { label: string; percentage: number | null; color: string }) {
  if (percentage == null) return null;
  const pct = Math.min(100, Math.max(0, percentage));
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 truncate font-mono text-[10px] text-[var(--text-secondary)]">{label}</span>
      <div className="relative flex-1">
        <div className="h-2 w-full overflow-hidden rounded bg-[var(--surface-3)]">
          <div
            className="h-full rounded-sm transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
      </div>
      <span className="w-9 shrink-0 text-right font-mono text-[10px] font-bold" style={{ color }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function PollCard({ poll }: { poll: any }) {
  const stateColor = STATE_COLORS[poll.state] ?? "#8b5cf6";
  const dateStr = poll.publish_date
    ? new Date(poll.publish_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 space-y-2.5">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="font-mono text-[11px] font-bold tracking-wide"
              style={{ color: stateColor }}
            >
              {poll.agency ?? "Unknown Agency"}
            </span>
            {poll.verified && (
              <span className="rounded bg-emerald-500/15 px-1 py-0.5 font-mono text-[8px] font-bold text-emerald-400 tracking-wider">
                VERIFIED
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {dateStr && (
              <span className="font-mono text-[9px] text-[var(--text-muted)]">{dateStr}</span>
            )}
            {poll.sample_size && (
              <span className="flex items-center gap-0.5 font-mono text-[9px] text-[var(--text-muted)]">
                <Users className="h-2.5 w-2.5" />
                n={poll.sample_size.toLocaleString()}
              </span>
            )}
            <span
              className="rounded px-1 py-0.5 font-mono text-[8px] font-bold tracking-wider"
              style={{ backgroundColor: `${stateColor}20`, color: stateColor }}
            >
              {poll.state}
            </span>
          </div>
        </div>
        {poll.source_url && (
          <a
            href={poll.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* Bars */}
      <div className="space-y-1.5">
        <PollBar label={poll.party_a_name ?? "Party A"} percentage={poll.party_a_percentage} color="#ea580c" />
        <PollBar label={poll.party_b_name ?? "Party B"} percentage={poll.party_b_percentage} color="#16a34a" />
        {poll.others_percentage != null && (
          <PollBar label="Others" percentage={poll.others_percentage} color="var(--text-muted)" />
        )}
        {poll.undecided_percentage != null && (
          <PollBar label="Undecided" percentage={poll.undecided_percentage} color="#6b7280" />
        )}
      </div>

      {/* Confidence */}
      {poll.confidence_score != null && (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] text-[var(--text-muted)]">AI confidence</span>
          <div className="h-1 w-16 overflow-hidden rounded bg-[var(--surface-3)]">
            <div
              className="h-full rounded-sm"
              style={{
                width: `${Math.min(100, poll.confidence_score * 100)}%`,
                backgroundColor: poll.confidence_score >= 0.8 ? "#16a34a" : poll.confidence_score >= 0.6 ? "#ea580c" : "#dc2626",
              }}
            />
          </div>
          <span className="font-mono text-[9px] text-[var(--text-muted)]">
            {(poll.confidence_score * 100).toFixed(0)}%
          </span>
        </div>
      )}
    </div>
  );
}

export function OpinionPollsPane() {
  const { opinionPolls } = useLiveData();
  const [activeState, setActiveState] = useState("ALL");

  const filtered = opinionPolls.filter(
    (p) => activeState === "ALL" || p.state === activeState
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--surface-0)]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <BarChart3 className="h-3.5 w-3.5 text-[#8b5cf6]" />
        <span className="font-mono text-[11px] font-bold tracking-wider text-[var(--text-primary)]">
          OPINION POLLS
        </span>
        <span className="ml-auto font-mono text-[10px] text-[var(--text-muted)]">
          {filtered.length} poll{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* State filter tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border)] px-3 py-2 scrollbar-none">
        {STATES.map((s) => {
          const active = activeState === s;
          const color = s === "ALL" ? "#8b5cf6" : (STATE_COLORS[s] ?? "#8b5cf6");
          return (
            <button
              key={s}
              type="button"
              onClick={() => setActiveState(s)}
              className={[
                "shrink-0 rounded px-2 py-1 font-mono text-[9px] font-bold tracking-wider transition-colors",
                active
                  ? "border"
                  : "border border-transparent text-[var(--text-muted)] hover:bg-[var(--surface-2)]",
              ].join(" ")}
              style={active ? { color, backgroundColor: `${color}18`, borderColor: `${color}40` } : undefined}
            >
              {s === "ALL" ? "ALL" : s.split(" ").map((w) => w[0]).join("")}
            </button>
          );
        })}
      </div>

      {/* Poll list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
            <BarChart3 className="h-8 w-8 text-[var(--text-muted)] opacity-40" />
            <p className="font-mono text-[11px] text-[var(--text-muted)]">
              No opinion polls ingested yet.
            </p>
            <p className="font-mono text-[9px] text-[var(--text-muted)] opacity-70 max-w-48">
              Run poll_ingestor.py to start collecting survey data from news sources.
            </p>
          </div>
        ) : (
          filtered.map((poll) => <PollCard key={poll.id} poll={poll} />)
        )}
      </div>
    </div>
  );
}
