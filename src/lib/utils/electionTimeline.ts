/**
 * Macro election phases + intraday war-room steps for live UI.
 */
import { ELECTION_DATES } from "@/lib/utils/countdown";
import { type WarRoomPhase, istMinutesSinceMidnight, sameISTCalendarDay, toISTParts, WAR_ROOM_IST } from "@/lib/utils/warRoomSchedule";

export function istYmd(d: Date): string {
  const { y, m, day } = toISTParts(d);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type MacroPhaseStatus = "done" | "current" | "upcoming";

export const ELECTION_MACRO_PHASES = [
  {
    id: "p1",
    shortLabel: "P1",
    fullLabel: "Phase 1 polling",
    date: ELECTION_DATES.phase1,
  },
  {
    id: "p2",
    shortLabel: "P2",
    fullLabel: "Phase 2 polling",
    date: ELECTION_DATES.phase2,
  },
  {
    id: "p2b",
    shortLabel: "2B",
    fullLabel: "Phase 2B (WB)",
    date: ELECTION_DATES.phase2b,
  },
  {
    id: "cnt",
    shortLabel: "Count",
    fullLabel: "Counting day",
    date: ELECTION_DATES.counting,
  },
] as const;

/** Which macro milestone is highlighted vs complete (calendar IST). */
export function getMacroPhaseStatuses(now: Date, operationMode: string): {
  phases: Array<(typeof ELECTION_MACRO_PHASES)[number] & { status: MacroPhaseStatus }>;
  /** Step to emphasize: true "current" day, or first "upcoming" between phases. */
  focusIndex: number;
} {
  const isCounting = operationMode === "COUNTING_DAY";
  const yNow = istYmd(now);

  const phases = ELECTION_MACRO_PHASES.map((p) => {
    const yP = istYmd(p.date);
    if (isCounting && p.id === "cnt") {
      return { ...p, status: "current" as const };
    }
    if (isCounting && p.id !== "cnt") {
      return { ...p, status: "done" as const };
    }
    if (yNow < yP) return { ...p, status: "upcoming" as const };
    if (yNow > yP) return { ...p, status: "done" as const };
    return { ...p, status: "current" as const };
  });

  let focusIndex = phases.findIndex((p) => p.status === "current");
  if (focusIndex < 0) {
    const up = phases.findIndex((p) => p.status === "upcoming");
    focusIndex = up >= 0 ? up : phases.length - 1;
  }
  return { phases, focusIndex };
}

/** Overall progress along the four macro milestones (0–1), for a single progress bar. */
export function getMacroProgress01(now: Date, operationMode: string): number {
  const { phases, focusIndex } = getMacroPhaseStatuses(now, operationMode);
  const n = phases.length;
  if (n <= 1) return 1;

  const doneCount = phases.filter((p) => p.status === "done").length;
  const hasCurrent = phases.some((p) => p.status === "current");
  if (!hasCurrent && doneCount > 0 && doneCount < n) {
    return Math.min(1, (doneCount + 0.45) / (n - 1));
  }

  const base = focusIndex / (n - 1);
  const cur = phases[focusIndex];
  if (!cur || cur.status === "upcoming") return Math.min(1, doneCount / Math.max(1, n - 1));
  if (cur.id === "cnt") return 1;

  const yNow = istYmd(now);
  const yP = istYmd(cur.date);
  if (yNow !== yP) return base;

  const m = istMinutesSinceMidnight(now);
  const t0 = WAR_ROOM_IST.turnoutStartHour * 60 + WAR_ROOM_IST.turnoutStartMinute;
  const t1 = WAR_ROOM_IST.turnoutFinalHour * 60 + WAR_ROOM_IST.turnoutFinalMinute;
  if (m < t0) return base;
  if (m >= t1) return base + (1 / (n - 1)) * 0.95;
  const intra = (m - t0) / Math.max(1, t1 - t0);
  const span = 1 / (n - 1);
  return Math.min(1, base + span * 0.85 * intra);
}

const WAR_ORDER: WarRoomPhase[] = ["QUIET", "TURNOUT_LIVE", "TURNOUT_FINAL", "EXIT_POLL"];

const INTRADAY_META: { war: WarRoomPhase; label: string; sub: string }[] = [
  { war: "QUIET", label: "Pre-open", sub: "02:00–07:00 IST" },
  { war: "TURNOUT_LIVE", label: "Live turnout", sub: "07:00–18:30" },
  { war: "TURNOUT_FINAL", label: "Final pass", sub: "18:30–19:15" },
  { war: "EXIT_POLL", label: "Exit polls", sub: "19:15–02:00" },
];

/** Intraday rhythm on a scheduled polling day (matches voting_day_ingestor windows). */
export function getIntradayWarSteps(now: Date, isPollingCalendarDay: boolean, warPhase: WarRoomPhase) {
  if (!isPollingCalendarDay || warPhase === "OFF_DAY") {
    return {
      show: false as const,
      steps: [] as { key: string; label: string; sub: string; done: boolean; current: boolean }[],
      segmentPct: 0,
      headline: "",
    };
  }

  const idx = WAR_ORDER.indexOf(warPhase);
  const steps = INTRADAY_META.map((s, i) => {
    const wi = WAR_ORDER.indexOf(s.war);
    return {
      key: s.war,
      label: s.label,
      sub: s.sub,
      done: idx >= 0 && wi < idx,
      current: idx >= 0 && wi === idx,
    };
  });

  const m = istMinutesSinceMidnight(now);
  const t7 = WAR_ROOM_IST.turnoutStartHour * 60 + WAR_ROOM_IST.turnoutStartMinute;
  const tFinal = WAR_ROOM_IST.turnoutFinalHour * 60 + WAR_ROOM_IST.turnoutFinalMinute;
  const tExit = WAR_ROOM_IST.exitPollHour * 60 + WAR_ROOM_IST.exitPollMinute;
  const tQuiet = WAR_ROOM_IST.exitPollQuietHour * 60;

  let segmentPct = 0;
  let headline = "";
  if (warPhase === "TURNOUT_LIVE") {
    segmentPct = Math.max(0, Math.min(1, (m - t7) / Math.max(1, tFinal - t7)));
    headline = "Polls open — live turnout window";
  } else if (warPhase === "TURNOUT_FINAL") {
    segmentPct = Math.max(0, Math.min(1, (m - tFinal) / Math.max(1, tExit - tFinal)));
    headline = "Final turnout pass after poll close";
  } else if (warPhase === "EXIT_POLL") {
    if (m >= tExit) {
      segmentPct = Math.max(0, Math.min(1, (m - tExit) / Math.max(1, 24 * 60 - tExit)));
    } else {
      segmentPct = Math.max(0, Math.min(1, m / Math.max(1, tQuiet)));
    }
    headline = "Exit-poll broadcast window";
  } else if (warPhase === "QUIET") {
    segmentPct = Math.max(0, Math.min(1, (m - tQuiet) / Math.max(1, t7 - tQuiet)));
    headline = "Quiet hours before polls open";
  } else {
    headline = "";
  }

  return { show: true as const, steps, segmentPct, headline };
}

export function isAnyPollingCalendarDay(now: Date): boolean {
  return [ELECTION_DATES.phase1, ELECTION_DATES.phase2, ELECTION_DATES.phase2b].some((d) => sameISTCalendarDay(now, d));
}
