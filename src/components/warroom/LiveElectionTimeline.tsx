"use client";

import { Check } from "lucide-react";
import {
  getIntradayWarSteps,
  getMacroPhaseStatuses,
  getMacroProgress01,
} from "@/lib/utils/electionTimeline";
import type { WarRoomPhase } from "@/lib/utils/warRoomSchedule";

type Variant = "voting" | "counting";

export default function LiveElectionTimeline({
  now,
  variant,
  isPollCalendarDay,
  warPhase,
}: {
  now: Date;
  variant: Variant;
  isPollCalendarDay: boolean;
  warPhase: WarRoomPhase;
}) {
  const operationMode = variant === "counting" ? "COUNTING_DAY" : "VOTING_DAY";
  const { phases, focusIndex } = getMacroPhaseStatuses(now, operationMode);
  const macroPct = getMacroProgress01(now, operationMode);
  const intraday =
    variant === "voting" ? getIntradayWarSteps(now, isPollCalendarDay, warPhase) : { show: false as const };

  return (
    <div className="mb-3 space-y-3 rounded-xl border border-[color:var(--border)] bg-[var(--surface-2)]/40 px-3 py-3 dark:bg-[var(--surface-2)]/25 md:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          Election timeline
        </span>
        <span
          className="font-mono text-[9px] text-[var(--text-muted)]"
          suppressHydrationWarning
        >
          IST{" "}
          {now.toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}
        </span>
      </div>

      {/* Macro: P1 → P2 → 2B → Counting */}
      <div className="relative">
        <div
          className="absolute left-0 right-0 top-[11px] h-0.5 rounded-full bg-[var(--surface-3)]"
          aria-hidden
        />
        <div
          className="absolute left-0 top-[11px] h-0.5 rounded-full bg-gradient-to-r from-emerald-600/80 to-sky-600/90 transition-[width] duration-500"
          style={{ width: `${Math.round(macroPct * 100)}%` }}
          aria-hidden
        />
        <div className="relative flex justify-between gap-1">
          {phases.map((p, i) => {
            const isDone = p.status === "done";
            const isCurrent = p.status === "current";
            const isFocus = i === focusIndex;
            const ring =
              isCurrent || (isFocus && p.status === "upcoming")
                ? "ring-2 ring-sky-500/60 ring-offset-2 ring-offset-[var(--surface-1)]"
                : "";
            return (
              <div key={p.id} className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
                <div
                  className={[
                    "relative z-10 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border text-[9px] font-bold transition-colors",
                    isDone
                      ? "border-emerald-600/50 bg-emerald-600 text-white"
                      : isCurrent
                        ? "border-sky-500 bg-sky-500 text-white"
                        : isFocus && p.status === "upcoming"
                          ? "border-dashed border-sky-400/70 bg-[var(--surface-1)] text-sky-700 dark:text-sky-200"
                          : "border-[color:var(--border)] bg-[var(--surface-1)] text-[var(--text-muted)]",
                    ring,
                  ].join(" ")}
                  title={p.fullLabel}
                >
                  {isDone ? <Check className="h-3 w-3" strokeWidth={3} /> : p.shortLabel}
                </div>
                <span
                  className={[
                    "hidden max-w-[4.5rem] font-mono text-[8px] font-semibold leading-tight sm:block",
                    isCurrent ? "text-sky-700 dark:text-sky-200" : "text-[var(--text-muted)]",
                  ].join(" ")}
                >
                  {p.fullLabel.replace(" polling", "").replace(" day", "")}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {variant === "counting" ? (
        <p className="border-t border-[color:var(--border)] pt-2 font-mono text-[10px] leading-snug text-[var(--text-secondary)]">
          <span className="font-bold text-[#dc2626]">Counting live</span> — ECI results and leads update through the
          day. Macro phases above show where the full calendar sits; use state tabs below to focus a region.
        </p>
      ) : intraday.show ? (
        <div className="border-t border-[color:var(--border)] pt-2">
          <p className="mb-2 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">
            Today&apos;s rhythm
          </p>
          {intraday.headline ? (
            <p className="mb-2 text-[11px] leading-snug text-[var(--text-primary)]">{intraday.headline}</p>
          ) : null}
          <div className="relative mb-2">
            <div className="h-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
              <div
                className="h-full rounded-full bg-orange-500/80 transition-[width] duration-500"
                style={{ width: `${Math.round(intraday.segmentPct * 100)}%` }}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 min-[420px]:grid-cols-3 sm:grid-cols-5 gap-1 sm:gap-1.5">
            {intraday.steps.map((s) => (
              <div
                key={s.key}
                className={[
                  "min-w-0 rounded-md px-1 py-1.5 text-center sm:px-1.5",
                  s.current
                    ? "bg-orange-500/15 ring-1 ring-orange-500/40"
                    : s.done
                      ? "text-[var(--text-secondary)] opacity-90"
                      : "text-[var(--text-muted)] opacity-75",
                ].join(" ")}
              >
                <div className="font-mono text-[8px] font-bold leading-tight text-[var(--text-primary)] sm:text-[9px]">
                  {s.label}
                </div>
                <div className="mt-0.5 hidden font-mono text-[7px] text-[var(--text-muted)] sm:block">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="border-t border-[color:var(--border)] pt-2 font-mono text-[9px] leading-snug text-[var(--text-muted)]">
          No state polls scheduled this IST date — macro timeline shows calendar position. Switch dev date to a polling
          day to see the intraday turnout / exit-poll rhythm.
        </p>
      )}
    </div>
  );
}
