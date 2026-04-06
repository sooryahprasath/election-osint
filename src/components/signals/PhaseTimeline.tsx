"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar, CheckCircle2, Clock } from "lucide-react";
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
      <div className="mb-2 flex items-center justify-between border-b border-[#e4e4e7] pb-2">
        <span className="font-mono text-[9px] font-bold text-[#52525b] tracking-wider">ELECTION TIMELINE</span>
        <span className="font-mono text-[8px] text-[#a1a1aa]" suppressHydrationWarning>
          IST {now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })}
        </span>
      </div>
      <div className="relative">
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#e4e4e7]" />
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

          return (
            <div key={phase.phase} className="relative flex gap-3 pb-3 last:pb-0">
              <div className="relative z-10 mt-0.5 shrink-0 bg-white">
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
                  <Clock className="h-3.5 w-3.5 text-[#a1a1aa]" />
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
                    <span className="font-mono text-[8px] text-[#ea580c] bg-[#fff7ed] border border-[#fed7aa] px-1.5 py-0.5 rounded">
                      {pulse ? "POLLS OPEN (IST)" : isPollingHours ? "LIVE" : "SCHEDULED TODAY"}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="h-2.5 w-2.5 text-[#71717a] shrink-0" />
                  <span className={`font-mono text-[9px] ${isActive ? "text-[#52525b] font-semibold" : "text-[#71717a]"}`} suppressHydrationWarning>
                    {phase.date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}
                  </span>
                  <span className="font-mono text-[9px] text-[#71717a]">• {phase.seats} seats</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {phase.states.map((s) => (
                    <span
                      key={s}
                      className="font-mono text-[8px] text-[#71717a] bg-[#f4f4f5] px-1.5 py-0.5 rounded border border-[#e4e4e7]"
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
    </div>
  );
}
