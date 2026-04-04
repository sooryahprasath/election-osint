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
