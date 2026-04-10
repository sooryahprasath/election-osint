import { ELECTION_DATES } from "@/lib/utils/countdown";
import { istMinutesSinceMidnight, sameISTCalendarDay } from "@/lib/utils/warRoomSchedule";

/** Matches CenterPane / CenterModeSwitcher modes used as URL-less default. */
export type BootstrapCenterMode = "signals" | "live";

/** End of counting day (IST) — after this, default center is Signals during counting mode. */
export const ELECTION_COUNTING_END_IST = new Date("2026-05-04T23:59:59.999+05:30");

/** Hide Voting live / Counting live center tab; default everything to Signals (next cycle updates dates). */
export const WAR_ROOM_CENTER_UI_HIDE_AFTER_IST = new Date("2026-05-15T00:00:00+05:30");

const POLL_DAYS: Date[] = [ELECTION_DATES.phase1, ELECTION_DATES.phase2, ELECTION_DATES.phase2b];

export function isScheduledPollingDayIST(now: Date): boolean {
  return POLL_DAYS.some((d) => sameISTCalendarDay(now, d));
}

/** Whether the LIVE (voting / counting) center switcher should appear. Dev workflows unchanged if they force mode via env. */
export function shouldShowWarRoomCenterTab(now: Date): boolean {
  if (now.getTime() >= WAR_ROOM_CENTER_UI_HIDE_AFTER_IST.getTime()) return false;
  return true;
}

/**
 * Center column default on first app mount / full refresh only.
 * - Non–poll days while election season: Signals.
 * - Poll day 06:00–23:59:59 IST: Live (voting HUD).
 * - Poll day 00:00–05:59 IST: Signals.
 * - Day after any poll (00:00 IST onward): Signals until next poll day 06:00.
 * - After counting day ends: Signals; after hide date: Signals and tab hidden via shouldShowWarRoomCenterTab.
 */
export function getDefaultCenterModeOnInitialLoad(now: Date, operationMode: string): BootstrapCenterMode {
  if (now.getTime() >= WAR_ROOM_CENTER_UI_HIDE_AFTER_IST.getTime()) return "signals";
  if (operationMode === "PRE-POLL") return "signals";

  if (operationMode === "COUNTING_DAY") {
    if (now.getTime() > ELECTION_COUNTING_END_IST.getTime()) return "signals";
    return "live";
  }

  if (operationMode !== "PRE-POLL" && operationMode !== "COUNTING_DAY") {
    if (!isScheduledPollingDayIST(now)) return "signals";
    const mins = istMinutesSinceMidnight(now);
    if (mins < 6 * 60) return "signals";
    return "live";
  }

  return "signals";
}
