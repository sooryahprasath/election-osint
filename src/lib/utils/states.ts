/** Accent colors aligned with dashboard primary #16a34a: muted greens, slate-teals, and one restrained violet.
 * `seats` = Legislative Assembly (Vidhan Sabha) seats for the 2021 election.
 */
export const STATE_META: Record<string, { abbr: string; color: string; dbPrefix?: string; seats?: number }> = {
  Kerala: { abbr: "KL", color: "#15803d", dbPrefix: "KER", seats: 140 },
  Assam: { abbr: "AS", color: "#b45309", dbPrefix: "ASM", seats: 126 },
  "Tamil Nadu": { abbr: "TN", color: "#0369a1", dbPrefix: "TN", seats: 234 },
  "West Bengal": { abbr: "WB", color: "#6d28d9", dbPrefix: "WB", seats: 294 },
  Puducherry: { abbr: "PY", color: "#0f766e", dbPrefix: "PY", seats: 30 },
  ALL: { abbr: "ALL", color: "#16a34a" },
};