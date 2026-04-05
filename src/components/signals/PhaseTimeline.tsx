"use client";

import { useEffect, useState } from "react";
import { Calendar, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { ELECTION_DATES } from "@/lib/utils/countdown";
import { useLiveData } from "@/lib/context/LiveDataContext";

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
      const interval = setInterval(() => setNow(new Date()), 60000);
      return () => clearInterval(interval);
    }
  }, [simulatedDate]);

  return (
    <div className="px-3 py-3">
      <div className="relative">
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#e4e4e7]" />
        {PHASES.map((phase) => {
          const diffHours = (phase.date.getTime() - now.getTime()) / (1000 * 60 * 60);
          const isPast = diffHours < -24;
          const isActive = diffHours >= -24 && diffHours <= 24;
          const isFuture = diffHours > 24;

          return (
            <div key={phase.phase} className="relative flex gap-3 pb-3 last:pb-0">
              <div className="relative z-10 mt-0.5 shrink-0 bg-white">
                {isPast ? <CheckCircle2 className="h-3.5 w-3.5 text-[#16a34a]" /> :
                  isActive ? (
                    <div className="relative flex h-3.5 w-3.5 items-center justify-center">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ea580c] opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#ea580c]"></span>
                    </div>
                  ) : <Clock className="h-3.5 w-3.5 text-[#a1a1aa]" />}
              </div>

              <div className={`flex-1 min-w-0 transition-opacity duration-300 ${isFuture ? "opacity-60" : "opacity-100"}`}>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`font-mono text-[10px] font-bold ${isPast ? "text-[#52525b]" : isActive ? "text-[#ea580c]" : "text-[#71717a]"}`}>
                    {phase.label}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="h-2.5 w-2.5 text-[#71717a] shrink-0" />
                  <span className={`font-mono text-[9px] ${isActive ? "text-[#52525b] font-semibold" : "text-[#71717a]"}`} suppressHydrationWarning>
                    {phase.date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                  <span className="font-mono text-[9px] text-[#71717a]">• {phase.seats} seats</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {phase.states.map((s) => (
                    <span key={s} className="font-mono text-[8px] text-[#71717a] bg-[#f4f4f5] px-1.5 py-0.5 rounded border border-[#e4e4e7]">{s}</span>
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