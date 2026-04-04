"use client";

import { useEffect, useState } from "react";
import { Calendar, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { ELECTION_DATES } from "@/lib/utils/countdown";

interface PhaseInfo {
  phase: string;
  label: string;
  date: Date;
  states: string[];
  seats: number;
}

const PHASES: PhaseInfo[] = [
  {
    phase: "1",
    label: "Phase 1 — Polling",
    date: ELECTION_DATES.phase1,
    states: ["Kerala (140)", "Assam (126)", "Puducherry (30)"],
    seats: 296,
  },
  {
    phase: "2",
    label: "Phase 2 — Polling",
    date: ELECTION_DATES.phase2,
    states: ["Tamil Nadu (234)", "West Bengal I (147)"],
    seats: 381,
  },
  {
    phase: "2B",
    label: "Phase 2B — WB Polling",
    date: ELECTION_DATES.phase2b,
    states: ["West Bengal II (147)"],
    seats: 147,
  },
  {
    phase: "C",
    label: "Counting Day",
    date: ELECTION_DATES.counting,
    states: ["All States — Results"],
    seats: 824,
  },
];

function getPhaseStatus(date: Date, now: Date): "past" | "active" | "upcoming" {
  const diff = date.getTime() - now.getTime();
  if (diff < 0) return "past";
  if (diff < 24 * 60 * 60 * 1000) return "active";
  return "upcoming";
}

export default function PhaseTimeline() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="px-3 py-2">
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#e4e4e7]" />

        {PHASES.map((phase, i) => {
          const status = getPhaseStatus(phase.date, now);
          return (
            <div key={phase.phase} className="relative flex gap-3 pb-3 last:pb-0">
              {/* Dot */}
              <div className="relative z-10 mt-0.5 shrink-0">
                {status === "past" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#16a34a]" />
                ) : status === "active" ? (
                  <Loader2 className="h-3.5 w-3.5 text-[#ea580c] animate-spin" />
                ) : (
                  <Clock className="h-3.5 w-3.5 text-[#71717a]" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className={`font-mono text-[10px] font-bold ${
                      status === "past"
                        ? "text-[#16a34a]"
                        : status === "active"
                        ? "text-[#ea580c]"
                        : "text-[#52525b]"
                    }`}
                  >
                    {phase.label}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-0.5">
                  <Calendar className="h-2.5 w-2.5 text-[#71717a] shrink-0" />
                  <span className="font-mono text-[9px] text-[#71717a]" suppressHydrationWarning>{phase.date.toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  <span className="font-mono text-[9px] text-[#71717a]">
                    • {phase.seats} seats
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {phase.states.map((s) => (
                    <span
                      key={s}
                      className="font-mono text-[8px] text-[#71717a] bg-[#f4f4f5] px-1.5 py-0.5 rounded"
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
