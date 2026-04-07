// ═══════════════════════════════════════════════════
// DHARMA-OSINT — Utility: Formatting
// ═══════════════════════════════════════════════════

/**
 * Format Indian currency in crores/lakhs
 */
export function formatIndianCurrency(amount: number): string {
  if (amount >= 10000000) {
    return `₹${(amount / 10000000).toFixed(1)} Cr`;
  }
  if (amount >= 100000) {
    return `₹${(amount / 100000).toFixed(1)} L`;
  }
  if (amount >= 1000) {
    return `₹${(amount / 1000).toFixed(1)}K`;
  }
  return `₹${amount}`;
}

/**
 * Abbreviate large numbers
 */
export function abbreviateNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Severity to label
 */
export function severityLabel(severity: number): string {
  const labels: Record<number, string> = {
    1: "LOW",
    2: "MODERATE",
    3: "ELEVATED",
    4: "HIGH",
    5: "CRITICAL",
  };
  return labels[severity] || "UNKNOWN";
}

/**
 * Relative time (e.g. "3m ago", "2h ago")
 */
export function relativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Generate a volatility color based on score (0-100)
 */
export function volatilityColor(score: number): string {
  if (score >= 80) return "#dc2626";
  if (score >= 60) return "#ea580c";
  if (score >= 40) return "#16a34a";
  if (score >= 20) return "#0284c7";
  return "#555555";
}

/**
 * Normalize education strings coming from scrapers (MyNeta / ECI).
 * Protects the UI from accidentally rendering full-page blobs.
 */
export function normalizeEducation(raw: unknown): string {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "-";

  // If a whole MyNeta page got stored, extract the education category only.
  // Example: "... Educational Details Category: Graduate B.Com... Details of PAN ..."
  const m = s.match(
    /Educational Details.*?Category:\s*([\s\S]+?)(?:Details of PAN|Details of Criminal Cases|Assets\s*&\s*Liabilities|Disclaimer:|$)/i
  );
  if (m?.[1]) {
    const picked = pickTopEducationLine(m[1]);
    if (picked) return picked;
  }

  const m2 = s.match(
    /\bCategory:\s*([\s\S]+?)(?:Details of PAN|Details of Criminal Cases|Assets\s*&\s*Liabilities|Disclaimer:|$)/i
  );
  if (m2?.[1]) {
    const picked = pickTopEducationLine(m2[1]);
    if (picked) return picked;
  }

  // If it looks like a breadcrumb dump, try to keep only a short meaningful tail.
  if (s.includes("→") || /home\s*→/i.test(s) || s.length > 120) return clampText(s, 64);

  return s;
}

function clampText(s: string, max: number) {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function pickTopEducationLine(raw: string) {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";

  // Prefer the category phrase itself (e.g. "Graduate", "Graduate Professional", "10th Pass").
  // If there are multiple qualifications, keep only the first clause.
  const first = s
    .split(/(?:,|;|\||\/|\bDetails\b|\bfrom\b|\byear\b|\bpassed\b|\bUniversity\b|\bCollege\b|\bSchool\b)/i)[0]
    ?.trim();

  const out = first || s;
  return clampText(out, 32);
}
