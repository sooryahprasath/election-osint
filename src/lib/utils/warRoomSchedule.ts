import { isExitPollEmbargoActive } from "@/lib/utils/countdown";

/**
 * IST war-room schedule (aligns with voting_day_ingestor.py).
 * Times are wall-clock Asia/Kolkata on polling days.
 */
export const WAR_ROOM_IST = {
  /** First turnout pull */
  turnoutStartHour: 7,
  turnoutStartMinute: 0,
  /** Switch to “final” estimate pass after polls close */
  turnoutFinalHour: 18,
  turnoutFinalMinute: 30,
  /** Exit-poll broadcast window opens (after polls + calendar embargo lift on 29 Apr) */
  exitPollHour: 19,
  exitPollMinute: 0,
  /** Stop heavy exit-poll polling (script may idle until next day) */
  exitPollQuietHour: 2,
} as const;

export function toISTParts(d: Date): { y: number; m: number; day: number; h: number; min: number } {
  const s = d.toLocaleString("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [datePart, timePart] = s.split(", ");
  const [y, m, day] = datePart.split("-").map(Number);
  const [h, min] = timePart.split(":").map(Number);
  return { y, m, day, h, min };
}

export function sameISTCalendarDay(a: Date, b: Date): boolean {
  const A = toISTParts(a);
  const B = toISTParts(b);
  return A.y === B.y && A.m === B.m && A.day === B.day;
}

export function istMinutesSinceMidnight(d: Date): number {
  const { h, min } = toISTParts(d);
  return h * 60 + min;
}

/** Polling-day windows: live turnout vs final vs exit-poll night (+ calendar embargo before 29 Apr 19:00 IST) */
export type WarRoomPhase =
  | "TURNOUT_LIVE"
  | "TURNOUT_FINAL"
  | "EXIT_POLL_EMBARGO"
  | "EXIT_POLL"
  | "QUIET"
  | "OFF_DAY";

export function getWarRoomPhase(now: Date, isPollingCalendarDay: boolean): WarRoomPhase {
  if (!isPollingCalendarDay) return "OFF_DAY";
  const t = istMinutesSinceMidnight(now);
  const t7 = WAR_ROOM_IST.turnoutStartHour * 60 + WAR_ROOM_IST.turnoutStartMinute;
  const tFinal = WAR_ROOM_IST.turnoutFinalHour * 60 + WAR_ROOM_IST.turnoutFinalMinute;
  const tExit = WAR_ROOM_IST.exitPollHour * 60 + WAR_ROOM_IST.exitPollMinute;
  const tQuietEnd = WAR_ROOM_IST.exitPollQuietHour * 60;

  if (t >= tExit || t < tQuietEnd) {
    return isExitPollEmbargoActive(now) ? "EXIT_POLL_EMBARGO" : "EXIT_POLL";
  }
  if (t < t7) return "QUIET";
  if (t < tFinal) return "TURNOUT_LIVE";
  return "TURNOUT_FINAL";
}
