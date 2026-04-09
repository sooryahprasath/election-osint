// src/lib/config/operationMode.ts

/**
 * Canonical modes: "PRE-POLL" | "VOTING_DAY" | "COUNTING_DAY"
 * Accepts common env typos/aliases (e.g. POLL, LIVE) so prod Vercel env matches UI + HUD.
 */
export function normalizeOperationMode(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "PRE-POLL";
  const u = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if (u === "PRE_POLL" || u === "PREPOLL") return "PRE-POLL";
  if (u === "COUNTING_DAY" || u === "COUNTING") return "COUNTING_DAY";
  if (
    u === "VOTING_DAY" ||
    u === "VOTING" ||
    u === "POLL" ||
    u === "POLLING" ||
    u === "LIVE" ||
    u === "ELECTION_DAY"
  ) {
    return "VOTING_DAY";
  }
  return raw;
}

const RAW_ENV_MODE = process.env.NEXT_PUBLIC_OPERATION_MODE || "PRE-POLL";
export const OPERATION_MODE = normalizeOperationMode(RAW_ENV_MODE);

export const isPrePoll = OPERATION_MODE === "PRE-POLL";
export const isVotingDay = OPERATION_MODE === "VOTING_DAY";
export const isCountingDay = OPERATION_MODE === "COUNTING_DAY";

/** Turnout / exit-poll war room (not pre-poll, not counting). */
export function isVotingLiveWarRoomMode(mode: string): boolean {
  return mode !== "PRE-POLL" && mode !== "COUNTING_DAY";
}