import { NextResponse } from 'next/server'
import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabase } from '@/lib/supabase';

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error("No Gemini API key provided. LLM Insights will fail.");
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

export async function POST(req: Request) {
  try {
    const bodyText = await req.text();
    // Support parsing strings or objects sent from the python bot
    const data = typeof bodyText === 'string' && bodyText.startsWith('{') ? JSON.parse(bodyText) : { title: '', summary: bodyText, source: 'Unknown' };
    
    let { source, title, body } = data;
    
    // In case python sent "summary" instead of "body"
    if (!body && data.summary) body = data.summary;

    if (!genAI) {
        return NextResponse.json({ success: false, error: "AI Engine Offline Server-side" }, { status: 500 });
    }

    // 1. NER & Classification (LLM pass)
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `
    You are a strictly accurate high-intelligence Election OSINT engine.
    Analyze this election news item:
    Source: ${source}
    Title: ${title}
    Body: ${body}
    
    Your goal is to extract strictly factual data and return it as a pure JSON object without markdown formatting. Do not wrap in \`\`\`json.
    
    Fields to extract:
    1. "state": The Indian state this event occurs in (e.g. "Kerala", "West Bengal", "Assam", "Tamil Nadu", "Puducherry"). If national, leave empty string.
    2. "constituency_id": If a specific constituency like "Kannur" or "Nandigram" is mentioned, output our internal ID (e.g., "KER-13"). If unknown, leave empty string.
    3. "severity": An integer from 1 to 5. 1 = Peaceful/Normal, 3 = Tense, 5 = Extreme Violence/Booth Capturing.
    4. "verified": true if the source is official (like PIB, ECI) or highly reputable. false if it sounds like an unconfirmed rumor.
    
    JSON format only:
    { "state": "...", "constituency_id": "...", "severity": 2, "verified": true }
    `;
    
    const result = await model.generateContent(prompt);
    let analysis;
    try {
        let text = result.response.text().trim();
        // Fallback cleanup if gemini wrapped in markdown
        if(text.startsWith('```json')) {
           text = text.substring(7, text.length - 3).trim(); 
        }
        analysis = JSON.parse(text);
    } catch(e) {
        console.error("Failed to parse Gemini output:", result.response.text());
        throw new Error("AI produced invalid JSON");
    }

    // 2. Database Insertion
    const { data: dbData, error } = await supabase.from('signals').insert({
      source,
      title,
      body,
      state: analysis.state || null,
      constituency_id: analysis.constituency_id || null,
      severity: analysis.severity || 1,
      verified: analysis.verified || false
    }).select().single();

    if (error) {
        console.error("Supabase insert error:", error);
        throw error;
    }

    return NextResponse.json({ success: true, processed: analysis, saved: dbData })

  } catch (error: any) {
    console.error("Ingest API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
