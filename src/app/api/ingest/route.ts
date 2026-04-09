import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getServiceSupabase } from "@/lib/supabase-service";

const apiKey = process.env.GEMINI_API_KEY;
const ingestSecret = process.env.INGEST_SHARED_SECRET;

if (!apiKey) {
  console.error("No Gemini API key provided. LLM Insights will fail.");
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const TRACKING_QUERY_KEYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_name",
  "utm_reader",
  "utm_viz_id",
  "utm_pubreferrer",
  "gclid",
  "dclid",
  "fbclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "referrer",
  "ref_src",
  "source",
  "src",
  "cmpid",
  "cmp",
  "mkt_tok",
  "spm",
  "_ga",
  "ocid",
]);

function canonicalizeUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  const raw = u.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    url.hash = "";
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");

    // remove default ports
    if (url.port === "443") url.port = "";

    // normalize pathname
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");

    // strip tracking params and sort remainder
    const entries = Array.from(url.searchParams.entries()).filter(([k]) => !TRACKING_QUERY_KEYS.has(k.toLowerCase()));
    entries.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    url.search = "";
    for (const [k, v] of entries) url.searchParams.append(k.toLowerCase(), v);

    return url.toString();
  } catch {
    return raw.toLowerCase();
  }
}

function extractYouTubeId(u: unknown): string | null {
  if (typeof u !== "string") return null;
  const raw = u.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const v = url.searchParams.get("v");
      if (v) return v;
      const m = url.pathname.match(/^\/(shorts|embed)\/([^/?#]+)/);
      if (m?.[2]) return m[2];
    }
  } catch {
    return null;
  }
  return null;
}

function simhash32(text: string): number {
  const s = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return 0;
  const tokens = (s.match(/[a-z0-9]{2,}/g) || []).slice(0, 800);
  if (tokens.length === 0) return 0;
  const v = new Array<number>(32).fill(0);

  // FNV-1a 32-bit for stable token hashing (ES2019 safe).
  const fnv32 = (t: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h;
  };

  for (const tok of tokens) {
    const x = fnv32(tok) >>> 0;
    for (let i = 0; i < 32; i++) {
      v[i] += (x >>> i) & 1 ? 1 : -1;
    }
  }
  let out = 0;
  for (let i = 0; i < 32; i++) if (v[i] > 0) out |= 1 << i;
  return out;
}

function popcount32(x: number): number {
  // Hacker's Delight popcount for 32-bit ints.
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function hamming32(a: number, b: number): number {
  return popcount32((a ^ b) >>> 0);
}

function validIndiaCoords(lat: unknown, lng: unknown, geoConfidence: number): { lat: number; lng: number } | null {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (geoConfidence < 0.45) return null;
  if (a < 6 || a > 38 || b < 67 || b > 98) return null;
  return { lat: a, lng: b };
}

const MAX_INGEST_BODY_BYTES = 512_000;

export async function POST(req: Request) {
  try {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd && !ingestSecret) {
      return NextResponse.json(
        { success: false, error: "Ingest disabled: set INGEST_SHARED_SECRET in production." },
        { status: 503 }
      );
    }
    if (ingestSecret) {
      const hdr = req.headers.get("x-ingest-secret");
      const auth = req.headers.get("authorization");
      const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
      if (hdr !== ingestSecret && bearer !== ingestSecret) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    const bodyText = await req.text();
    if (bodyText.length > MAX_INGEST_BODY_BYTES) {
      return NextResponse.json({ success: false, error: "Payload too large" }, { status: 413 });
    }
    const data: Record<string, unknown> =
      typeof bodyText === "string" && bodyText.startsWith("{")
        ? JSON.parse(bodyText)
        : { title: "", summary: bodyText, source: "Unknown" };

    const source = data.source;
    const title = data.title;
    const source_url = data.source_url;
    let body = data.body;

    if (!body && data.summary) body = data.summary;
    const sourceStr = typeof source === "string" ? source : String(source || "");
    const titleStr = typeof title === "string" ? title : String(title || "");
    const bodyStr = typeof body === "string" ? body : String(body || "");
    const sourceUrlStr = typeof source_url === "string" ? source_url : null;

    if (!genAI) {
      return NextResponse.json({ success: false, error: "AI Engine Offline Server-side" }, { status: 500 });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
    You are a strictly accurate high-intelligence Election OSINT engine.
    Analyze this election news item:
    Source: ${sourceStr}
    Title: ${titleStr}
    Body: ${bodyStr}

    Your goal is to extract strictly factual data and return it as a pure JSON object without markdown formatting. Do not wrap in \`\`\`json.

    Fields:
    1. "state": Indian state (e.g. "Kerala", "West Bengal", "Assam", "Tamil Nadu", "Puducherry"). If national, "".
    2. "constituency_id": Internal ID (e.g. "KER-001") if clearly implied; else "".
    2b. "election_relevance_0_1": 0.0 to 1.0 indicating how directly this item is about Indian elections. If the item is mostly unrelated or foreign politics dominates (e.g. US politics/Trump) and elections are only mentioned in passing, set <= 0.3.
    2c. "relevance_reason": short reason (<= 12 words) for the relevance score.
    3. "severity": integer 1–5 (1 calm, 5 extreme violence/fraud).
    4. "verified": true for official / top-tier outlets; false for rumors.
    5. "latitude", "longitude": decimals only if a specific town/venue is implied; else null. Do not guess from state alone.
    6. "geo_confidence": 0–1 for lat/long; 0 if no coordinates.
    7. "video_relevant": true only if a matching TV/rally clip likely exists for this exact story.
    8. "video_confidence": 0–1.
    9. "video_query": short search string only if video_relevant; else "".

    JSON only:
    { "state": "", "constituency_id": "", "election_relevance_0_1": 1, "relevance_reason": "", "severity": 2, "verified": false, "latitude": null, "longitude": null, "geo_confidence": 0, "video_relevant": false, "video_confidence": 0, "video_query": "" }
    `;

    const result = await model.generateContent(prompt);
    let analysis: Record<string, unknown>;
    try {
      let text = result.response.text().trim();
      if (text.startsWith("```json")) {
        text = text.substring(7, text.length - 3).trim();
      }
      analysis = JSON.parse(text);
    } catch {
      console.error("Failed to parse Gemini output:", result.response.text());
      throw new Error("AI produced invalid JSON");
    }

    const geoC = Number(analysis.geo_confidence) || 0;
    const coords = validIndiaCoords(analysis.latitude, analysis.longitude, geoC);

    const relevance = Number((analysis as Record<string, unknown>).election_relevance_0_1 ?? 1);
    if (!Number.isFinite(relevance) || relevance < 0.6) {
      return NextResponse.json({
        success: true,
        dropped: true,
        reason: "low_relevance",
        relevance: Number.isFinite(relevance) ? relevance : null,
        relevance_reason: (analysis as Record<string, unknown>).relevance_reason ?? null,
        processed: analysis,
        saved: null,
      });
    }

    const db = getServiceSupabase();
    if (!db) {
      return NextResponse.json(
        {
          success: false,
          error: "Server missing SUPABASE_SERVICE_ROLE_KEY (required to insert signals when RLS blocks anon).",
        },
        { status: 500 }
      );
    }

    // Dedupe alignment: canonical URL + YouTube ID hard dedupe, and simhash near-dup within a recent window.
    const canonUrl = canonicalizeUrl(source_url);
    const ytId = extractYouTubeId(source_url);
    const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const since3d = new Date(Date.now() - 72 * 3600 * 1000).toISOString();

    if (canonUrl || ytId) {
      const { data: dup } = await db
        .from("signals")
        .select("id,source_url,created_at")
        .gte("created_at", since3d)
        .eq("source_url", canonUrl || source_url)
        .limit(1);
      if (dup && dup.length > 0) {
        return NextResponse.json({ success: true, deduped: true, reason: "hard_url", processed: analysis, saved: null });
      }
    }

    const incomingHash = simhash32(`${title || ""} ${body || ""}`);
    if (incomingHash !== 0) {
      const { data: recent } = await db
        .from("signals")
        .select("title,body,created_at")
        .gte("created_at", since24h)
        .order("created_at", { ascending: false })
        .limit(200);
      for (const r of recent || []) {
        const rr = r as Record<string, unknown>;
        const h = simhash32(`${String(rr.title || "")} ${String(rr.body || "")}`);
        // 32-bit hash is coarser: keep a tight threshold.
        if (h !== 0 && hamming32(incomingHash, h) <= 2) {
          return NextResponse.json({ success: true, deduped: true, reason: "soft_simhash", processed: analysis, saved: null });
        }
      }
    }

    const insertRow: Record<string, unknown> = {
      source: sourceStr,
      source_url: canonUrl || (sourceUrlStr || null),
      title: titleStr,
      body: bodyStr,
      state: (analysis.state as string) || null,
      constituency_id: (analysis.constituency_id as string) || null,
      severity: Number(analysis.severity) || 1,
      verified: Boolean(analysis.verified),
    };

    if (coords) {
      insertRow.latitude = coords.lat;
      insertRow.longitude = coords.lng;
    }

    const { data: dbData, error } = await db.from("signals").insert(insertRow).select().single();

    if (error) {
      console.error("Supabase insert error:", error);
      throw error;
    }

    return NextResponse.json({ success: true, processed: analysis, saved: dbData });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Ingest API Error:", error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
