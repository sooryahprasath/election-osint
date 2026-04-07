"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar, CheckCircle2, ChevronDown, ChevronRight, Circle } from "lucide-react";
import { ELECTION_DATES } from "@/lib/utils/countdown";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { istMinutesSinceMidnight, sameISTCalendarDay, toISTParts, WAR_ROOM_IST } from "@/lib/utils/warRoomSchedule";

function istYmd(d: Date): string {
  const { y, m, day } = toISTParts(d);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const PHASES = [
  { phase: "1", label: "Phase 1 — Polling", date: ELECTION_DATES.phase1, states: ["Kerala (140)", "Assam (126)", "Puducherry (30)"], seats: 296 },
  { phase: "2", label: "Phase 2 — Polling", date: ELECTION_DATES.phase2, states: ["Tamil Nadu (234)", "West Bengal I (147)"], seats: 381 },
  { phase: "2B", label: "Phase 2B — WB Polling", date: ELECTION_DATES.phase2b, states: ["West Bengal II (147)"], seats: 147 },
  { phase: "C", label: "Counting Day", date: ELECTION_DATES.counting, states: ["All States — Results"], seats: 824 },
];

export default function PhaseTimeline() {
  const { simulatedDate } = useLiveData();
  const [now, setNow] = useState(simulatedDate || new Date());
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (simulatedDate) {
      setNow(simulatedDate);
    } else {
      const interval = setInterval(() => setNow(new Date()), 30000);
      return () => clearInterval(interval);
    }
  }, [simulatedDate]);

  const ymdNow = useMemo(() => istYmd(now), [now]);

  return (
    <div className="px-3 py-3">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="mb-2 flex w-full items-center justify-between gap-2 border-b border-[color:var(--border)] pb-2 text-left hover:opacity-90"
      >
        <span className="flex items-center gap-1.5 font-mono text-[9px] font-bold tracking-wider text-[var(--text-secondary)]">
          {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-[var(--text-muted)]" /> : <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />}
          ELECTION TIMELINE
        </span>
        <span className="shrink-0 font-mono text-[8px] text-[var(--text-muted)]" suppressHydrationWarning>
          IST {now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })}
        </span>
      </button>
      {expanded && (
      <div className="relative">
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[var(--surface-3)]/70" />
        {PHASES.map((phase) => {
          const ymdPhase = istYmd(phase.date);
          const isPast = ymdNow > ymdPhase;
          const isFuture = ymdNow < ymdPhase;
          const isCalendarDay = sameISTCalendarDay(now, phase.date);

          const mins = istMinutesSinceMidnight(now);
          const tStart = WAR_ROOM_IST.turnoutStartHour * 60 + WAR_ROOM_IST.turnoutStartMinute;
          const tFinal = WAR_ROOM_IST.turnoutFinalHour * 60 + WAR_ROOM_IST.turnoutFinalMinute;
          const isPollingHours =
            isCalendarDay && phase.phase !== "C" && mins >= tStart && mins < tFinal;

          const isActive = isCalendarDay && (!isPast || isPollingHours) && !isFuture;
          const pulse = isPollingHours && phase.phase !== "C";
          const pollProgress =
            isCalendarDay && phase.phase !== "C"
              ? Math.max(0, Math.min(1, (mins - tStart) / Math.max(1, tFinal - tStart)))
              : 0;

          return (
            <div
              key={phase.phase}
              className={[
                "relative flex gap-3 pb-3 last:pb-0 rounded-lg px-1 py-1",
                isCalendarDay ? "bg-[var(--surface-2)]" : "",
              ].join(" ")}
            >
              <div className="relative z-10 mt-0.5 shrink-0 bg-[var(--surface-1)]">
                {isPast && !isCalendarDay ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#16a34a]" />
                ) : pulse ? (
                  <div className="relative flex h-3.5 w-3.5 items-center justify-center">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ea580c] opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#ea580c]" />
                  </div>
                ) : isActive ? (
                  <div className="relative flex h-3.5 w-3.5 items-center justify-center">
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#0284c7]" />
                  </div>
                ) : (
                  <Circle className="h-3.5 w-3.5 text-[var(--text-muted)]" strokeWidth={1.5} />
                )}
              </div>

              <div className={`flex-1 min-w-0 transition-opacity duration-300 ${isFuture ? "opacity-55" : "opacity-100"}`}>
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span
                    className={`font-mono text-[10px] font-bold ${
                      isPast && !isCalendarDay ? "text-[#52525b]" : isActive ? "text-[#0284c7]" : "text-[#71717a]"
                    }`}
                  >
                    {phase.label}
                  </span>
                  {isCalendarDay && phase.phase !== "C" && (
                    <span className="font-mono text-[8px] font-bold text-[#ea580c] bg-[var(--surface-1)] border border-[color:var(--border)] px-1.5 py-0.5 rounded">
                      {pulse ? "POLLS OPEN (IST)" : isPollingHours ? "LIVE" : "SCHEDULED TODAY"}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="h-2.5 w-2.5 text-[var(--text-muted)] shrink-0" />
                  <span className={`font-mono text-[9px] ${isActive ? "text-[var(--text-secondary)] font-semibold" : "text-[var(--text-muted)]"}`} suppressHydrationWarning>
                    {phase.date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}
                  </span>
                  <span className="font-mono text-[9px] text-[var(--text-muted)]">• {phase.seats} seats</span>
                </div>

                {/* Compact stepper: during polling hours, show a progress line with a moving dot */}
                {isCalendarDay && phase.phase !== "C" ? (
                  <div className="mb-1.5">
                    <div className="relative h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-[#ea580c]/60" style={{ width: `${Math.round(pollProgress * 100)}%` }} />
                      <div
                        className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-[color:var(--border)] bg-[var(--surface-1)] shadow-sm"
                        style={{ left: `calc(${Math.round(pollProgress * 100)}% - 6px)` }}
                        aria-hidden="true"
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between font-mono text-[8px] text-[var(--text-muted)]">
                      <span>{String(WAR_ROOM_IST.turnoutStartHour).padStart(2, "0")}:{String(WAR_ROOM_IST.turnoutStartMinute).padStart(2, "0")} open</span>
                      <span>{String(WAR_ROOM_IST.turnoutFinalHour).padStart(2, "0")}:{String(WAR_ROOM_IST.turnoutFinalMinute).padStart(2, "0")} close</span>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-1">
                  {phase.states.map((s) => (
                    <span
                      key={s}
                      className="font-mono text-[8px] text-[var(--text-muted)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded border border-[color:var(--border)]"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
