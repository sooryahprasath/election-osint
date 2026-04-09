/**
 * Google News RSS and some LLM outputs store redirect/wrapper URLs that browsers
 * often reject ("invalid link"). Unwrap known patterns and fall back safely.
 */
export function unwrapGoogleRedirectUrl(href: string): string {
  const t = href.trim();
  if (!t.startsWith("http")) return t;
  try {
    const u = new URL(t);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "google.com" || host.endsWith(".google.com")) {
      if (u.pathname === "/url" || u.pathname.startsWith("/url")) {
        const q = u.searchParams.get("q") || u.searchParams.get("url");
        if (q?.startsWith("http")) {
          try {
            return decodeURIComponent(q);
          } catch {
            return q;
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return t;
}

/** Prefer a real publisher URL; if still a Google News stub, open a web search from the note text. */
export function safeNewsArticleHref(raw: string, fallbackText: string): string {
  const unwrapped = unwrapGoogleRedirectUrl(raw);
  if (!unwrapped.startsWith("http")) return "";
  try {
    const host = new URL(unwrapped).hostname.toLowerCase();
    if (host === "news.google.com" || host.endsWith(".news.google.com")) {
      const q = fallbackText.replace(/\s+/g, " ").trim().slice(0, 160);
      if (q.length >= 8) {
        return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
      }
      return "";
    }
  } catch {
    return "";
  }
  return unwrapped;
}
