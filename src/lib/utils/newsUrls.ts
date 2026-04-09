/**
 * Google News RSS and LLM outputs often ship redirect wrappers, trailing junk,
 * or slightly invalid URLs. Normalize and fall back to a web search so links
 * stay usable in the Voting / Signals UI.
 */

const TRAILING_URL_JUNK = /[)\].,;'"»”“]+$/;

/** Strip whitespace and trailing punctuation LLMs often paste after URLs. */
export function stripArticleUrlNoise(raw: string): string {
  let t = raw.trim().replace(/^\(+/, "");
  let prev = "";
  while (t !== prev) {
    prev = t;
    t = t.replace(TRAILING_URL_JUNK, "").trim();
  }
  return t;
}

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

function webSearchUrl(query: string): string {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 220);
  if (q.length < 6) return "";
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/** When a note has no stored URL, still offer a grounded web search (state + text). */
export function contextualSearchUrl(state: string, noteText: string): string {
  return webSearchUrl(`${state} ${noteText}`);
}

function isBlockedOrWrapperHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "news.google.com" ||
    h.endsWith(".news.google.com") ||
    h === "vertexaisearch.cloud.google.com" ||
    h.endsWith(".vertexaisearch.cloud.google.com")
  );
}

/**
 * Prefer a real https publisher URL. Google News / Vertex search stubs become a
 * normal Google web search built from `fallbackText` (include state + headline).
 * Malformed URLs also fall back to search instead of a dead `href`.
 */
export function safeNewsArticleHref(raw: string, fallbackText: string): string {
  const fallback = webSearchUrl(fallbackText);

  let t = stripArticleUrlNoise(unwrapGoogleRedirectUrl((raw || "").trim()));
  if (!t) {
    return fallback;
  }

  if (!/^https?:\/\//i.test(t)) {
    if (/^[a-z0-9][a-z0-9+.-]*:\/\//i.test(t)) {
      return fallback;
    }
    t = `https://${t.replace(/^\/+/, "")}`;
  }

  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return fallback;
    }
    const host = u.hostname.toLowerCase();
    if (isBlockedOrWrapperHost(host)) {
      return fallback;
    }
    return u.toString();
  } catch {
    return fallback;
  }
}

/** Short label for link UI (e.g. `thehindu.com`). */
export function articleHostnameLabel(href: string): string {
  try {
    const h = new URL(href).hostname.toLowerCase();
    return h.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Button / aria label: distinguish publisher vs fallback web search. */
export function articleLinkUiLabel(href: string): string {
  try {
    const u = new URL(href);
    if (u.hostname.endsWith("google.com") && u.pathname.startsWith("/search")) {
      return "Google Search";
    }
    const host = articleHostnameLabel(href);
    return host ? `Open · ${host}` : "Open source";
  } catch {
    return "Open source";
  }
}
