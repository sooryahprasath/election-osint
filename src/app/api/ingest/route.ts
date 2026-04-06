import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getServiceSupabase } from "@/lib/supabase-service";

const apiKey = process.env.GEMINI_API_KEY;
const ingestSecret = process.env.INGEST_SHARED_SECRET;

if (!apiKey) {
  console.error("No Gemini API key provided. LLM Insights will fail.");
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

function validIndiaCoords(lat: unknown, lng: unknown, geoConfidence: number): { lat: number; lng: number } | null {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (geoConfidence < 0.45) return null;
  if (a < 6 || a > 38 || b < 67 || b > 98) return null;
  return { lat: a, lng: b };
}

export async function POST(req: Request) {
  try {
    if (ingestSecret) {
      const hdr = req.headers.get("x-ingest-secret");
      const auth = req.headers.get("authorization");
      const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
      if (hdr !== ingestSecret && bearer !== ingestSecret) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    const bodyText = await req.text();
    const data =
      typeof bodyText === "string" && bodyText.startsWith("{")
        ? JSON.parse(bodyText)
        : { title: "", summary: bodyText, source: "Unknown" };

    let { source, title, body } = data;

    if (!body && data.summary) body = data.summary;

    if (!genAI) {
      return NextResponse.json({ success: false, error: "AI Engine Offline Server-side" }, { status: 500 });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
    You are a strictly accurate high-intelligence Election OSINT engine.
    Analyze this election news item:
    Source: ${source}
    Title: ${title}
    Body: ${body}

    Your goal is to extract strictly factual data and return it as a pure JSON object without markdown formatting. Do not wrap in \`\`\`json.

    Fields:
    1. "state": Indian state (e.g. "Kerala", "West Bengal", "Assam", "Tamil Nadu", "Puducherry"). If national, "".
    2. "constituency_id": Internal ID (e.g. "KER-001") if clearly implied; else "".
    3. "severity": integer 1–5 (1 calm, 5 extreme violence/fraud).
    4. "verified": true for official / top-tier outlets; false for rumors.
    5. "latitude", "longitude": decimals only if a specific town/venue is implied; else null. Do not guess from state alone.
    6. "geo_confidence": 0–1 for lat/long; 0 if no coordinates.
    7. "video_relevant": true only if a matching TV/rally clip likely exists for this exact story.
    8. "video_confidence": 0–1.
    9. "video_query": short search string only if video_relevant; else "".

    JSON only:
    { "state": "", "constituency_id": "", "severity": 2, "verified": false, "latitude": null, "longitude": null, "geo_confidence": 0, "video_relevant": false, "video_confidence": 0, "video_query": "" }
    `;

    const result = await model.generateContent(prompt);
    let analysis: Record<string, unknown>;
    try {
      let text = result.response.text().trim();
      if (text.startsWith("```json")) {
        text = text.substring(7, text.length - 3).trim();
      }
      analysis = JSON.parse(text);
    } catch (e) {
      console.error("Failed to parse Gemini output:", result.response.text());
      throw new Error("AI produced invalid JSON");
    }

    const geoC = Number(analysis.geo_confidence) || 0;
    const coords = validIndiaCoords(analysis.latitude, analysis.longitude, geoC);

    const insertRow: Record<string, unknown> = {
      source,
      title,
      body,
      state: (analysis.state as string) || null,
      constituency_id: (analysis.constituency_id as string) || null,
      severity: Number(analysis.severity) || 1,
      verified: Boolean(analysis.verified),
    };

    if (coords) {
      insertRow.latitude = coords.lat;
      insertRow.longitude = coords.lng;
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
