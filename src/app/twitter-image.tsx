import { ImageResponse } from "next/og"

export const runtime = "edge"

export const alt = "DHARMA-OSINT — 2026 Election Intelligence"
export const size = { width: 1200, height: 600 }
export const contentType = "image/png"

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0f14",
          color: "white",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
        }}
      >
        <div style={{ width: "92%", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: "-0.03em" }}>DHARMA-OSINT</div>
          <div style={{ marginTop: 8, fontSize: 26, color: "#94a3b8" }}>Election Watch — India state elections 2026</div>
          <div style={{ marginTop: 18, fontSize: 18, color: "#e2e8f0" }}>
            Maps · Signals · Candidate dossiers · 2021 results
          </div>
        </div>
      </div>
    ),
    size
  )
}

