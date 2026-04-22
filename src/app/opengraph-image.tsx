import { ImageResponse } from "next/og"
import { getSiteUrl } from "@/lib/site"

export const runtime = "edge"

export const alt = "DHARMA-OSINT — 2026 Election Intelligence"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpenGraphImage() {
  void getSiteUrl()

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "64px",
          background: "#0b0f14",
          color: "white",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 22 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#16a34a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              fontWeight: 800,
            }}
          >
            D
          </div>
          <div style={{ fontSize: 42, fontWeight: 800, letterSpacing: "-0.02em" }}>DHARMA-OSINT</div>
        </div>
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
          Election Watch — India state elections 2026
        </div>
        <div style={{ marginTop: 18, fontSize: 22, color: "#94a3b8", maxWidth: 980, lineHeight: 1.35 }}>
          Live map, signals, and candidate intelligence. Historical 2021 seat results across Tamil Nadu, Kerala, West Bengal, Assam,
          and Puducherry.
        </div>
        <div style={{ marginTop: 32, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {["Insights", "News signals", "Candidate dossiers", "Seat share", "Tight seats"].map((t) => (
            <div
              key={t}
              style={{
                border: "1px solid rgba(148,163,184,0.25)",
                background: "rgba(15,23,42,0.6)",
                padding: "10px 14px",
                borderRadius: 999,
                fontSize: 18,
                color: "#e2e8f0",
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    size
  )
}

