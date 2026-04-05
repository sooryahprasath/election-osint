// src/lib/config/operationMode.ts

// Valid Modes: "PRE-POLL" | "VOTING_DAY" | "COUNTING_DAY"
export const OPERATION_MODE = process.env.NEXT_PUBLIC_OPERATION_MODE || "PRE-POLL";

export const isPrePoll = OPERATION_MODE === "PRE-POLL";
export const isVotingDay = OPERATION_MODE === "VOTING_DAY";
export const isCountingDay = OPERATION_MODE === "COUNTING_DAY";