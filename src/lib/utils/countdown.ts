// ═══════════════════════════════════════════════════
// DHARMA-OSINT — Utility: Countdown & Time
// ═══════════════════════════════════════════════════

export const ELECTION_DATES = {
  phase1: new Date("2026-04-09T07:00:00+05:30"),
  phase2: new Date("2026-04-23T07:00:00+05:30"),
  phase2b: new Date("2026-04-29T07:00:00+05:30"),
  counting: new Date("2026-05-04T08:00:00+05:30"),
};

/** ECI-style exit-poll broadcast embargo: UI + ingest stay dark until this instant (IST). */
export const EXIT_POLL_EMBARGO_LIFT_IST = new Date("2026-04-29T19:00:00+05:30");

export function isExitPollEmbargoActive(now: Date = new Date()): boolean {
  return now.getTime() < EXIT_POLL_EMBARGO_LIFT_IST.getTime();
}

export interface CountdownResult {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  label: string;
  phase: string;
  isPast: boolean;
  totalMs: number;
}

export function getNextElectionEvent(now: Date = new Date()): CountdownResult {
  const events = [
    { date: ELECTION_DATES.phase1, label: "PHASE 1 POLLING", phase: "Phase 1" },
    { date: ELECTION_DATES.phase2, label: "PHASE 2 POLLING", phase: "Phase 2" },
    { date: ELECTION_DATES.phase2b, label: "WB PHASE 2B", phase: "Phase 2B" },
    { date: ELECTION_DATES.counting, label: "COUNTING DAY", phase: "Counting" },
  ];

  for (const event of events) {
    const diff = event.date.getTime() - now.getTime();
    if (diff > 0) {
      return {
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
        seconds: Math.floor((diff / 1000) % 60),
        label: event.label,
        phase: event.phase,
        isPast: false,
        totalMs: diff,
      };
    }
  }

  // All events passed
  return {
    days: 0, hours: 0, minutes: 0, seconds: 0,
    label: "ALL PHASES COMPLETE",
    phase: "Complete",
    isPast: true,
    totalMs: 0,
  };
}

export function formatCountdown(cd: CountdownResult): string {
  if (cd.isPast) return "COMPLETE";
  const d = String(cd.days).padStart(2, "0");
  const h = String(cd.hours).padStart(2, "0");
  const m = String(cd.minutes).padStart(2, "0");
  const s = String(cd.seconds).padStart(2, "0");
  return `${d}d ${h}h ${m}m ${s}s`;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}
