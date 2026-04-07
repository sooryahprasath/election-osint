import type { CenterMode } from "@/components/center/CenterModeSwitcher";

/** Rows from the social YouTube/RSS worker (or legacy `signals` inserts) must not appear in the OSINT intelligence feed. */
export function excludeFromIntelligenceFeed(s: any): boolean {
  if (!s) return true;
  const cat = String(s.category || "").toLowerCase();
  if (cat === "social") return true;

  const ent = s.entities_involved || s.entitiesInvolved;
  const pv = typeof ent?.pipeline_version === "string" ? ent.pipeline_version : "";
  if (pv.startsWith("social_")) return true;

  const src = String(s.source || "").trim();
  const urls = `${String(s.source_url || s.url || "")} ${String(s.video_url || "")}`.toLowerCase();
  const looksYouTube = urls.includes("youtube.com") || urls.includes("youtu.be");
  if (looksYouTube && src.startsWith("@")) return true;

  return false;
}

export function isLikelySocialSource(s: any): boolean {
  const src = String(s?.source || "").toLowerCase();
  const cat = String(s?.category || "").toLowerCase();
  const url = String(s?.source_url || s?.url || s?.video_url || "").toLowerCase();
  const hint = `${src} ${cat} ${url}`;
  return (
    cat === "social" ||
    hint.includes("twitter") ||
    hint.includes("x.com") ||
    hint.includes("tweet") ||
    hint.includes("telegram") ||
    hint.includes("t.me") ||
    hint.includes("instagram") ||
    hint.includes("facebook") ||
    hint.includes("whatsapp") ||
    hint.includes("youtube") ||
    hint.includes("youtu")
  );
}

export function centerModeForSignal(s: any): CenterMode {
  if (s?.video_url) return "videos";
  if (isLikelySocialSource(s)) return "signals";
  if (s?.constituency_id || (typeof s?.latitude === "number" && typeof s?.longitude === "number")) return "map";
  return "signals";
}

