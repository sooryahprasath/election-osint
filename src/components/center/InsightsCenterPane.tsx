"use client"

import { useMemo, useState, useEffect } from "react"
import { Sparkles, Users, MapPin, Scale, AlertTriangle, ExternalLink } from "lucide-react"
import { useLiveData } from "@/lib/context/LiveDataContext"
import { supabase } from "@/lib/supabase"
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps"
import { STATE_META } from "@/lib/utils/states"

type ConstituencyResult2021 = {
  constituency_id: string
  election_year: number
  state: string
  constituency_name_raw?: string | null
  winner_name?: string | null
  winner_party?: string | null
  runner_up_name?: string | null
  runner_up_party?: string | null
  winner_votes?: number | null
  runner_up_votes?: number | null
  total_votes_polled?: number | null
  total_electors?: number | null
  margin_votes?: number | null
  turnout_pct?: number | null
  source_url?: string | null
  source_note?: string | null
}

const STATES = ["ALL", "Tamil Nadu", "Kerala", "West Bengal", "Assam", "Puducherry"]

/**
 * Flip to true (via NEXT_PUBLIC_SHOW_DEV_HINTS=true) to surface ingest/script hints
 * for operators. Public viewers see friendlier copy.
 */
const SHOW_DEV_HINTS = process.env.NEXT_PUBLIC_SHOW_DEV_HINTS === "true"

const STATE_MAP_FILES: Record<string, string> = {
  "Kerala": "kerala.json",
  "Assam": "assam.json",
  "Puducherry": "puducherry.json",
  "Tamil Nadu": "tamilnadu.json",
  "West Bengal": "westbengal.json",
}

type SeatShareMode = "PARTY" | "ALLIANCE"

const ALLIANCE_MAP_2021: Record<string, Record<string, string>> = {
  // Best-effort mapping (Wikipedia party strings vary). Unknowns fall back to party.
  "Tamil Nadu": {
    "DMK": "DMK+",
    "AIADMK": "AIADMK+",
    "INC": "DMK+",
    "CPI": "DMK+",
    "CPI(M)": "DMK+",
    "VCK": "DMK+",
    "IUML": "DMK+",
    "MNM": "OTH",
    "BJP": "BJP+",
    "PMK": "BJP+",
    "DMDK": "AIADMK+",
    "AMMK": "OTH",
    "IND": "IND",
  },
  "Kerala": {
    "CPI(M)": "LDF",
    "CPI": "LDF",
    "INC": "UDF",
    "IUML": "UDF",
    "BJP": "NDA",
    "BDJS": "NDA",
    "IND": "IND",
  },
  "West Bengal": {
    "AITC": "TMC",
    "TMC": "TMC",
    "BJP": "NDA",
    "INC": "INC+",
    "CPI(M)": "LEFT",
    "CPI": "LEFT",
    "RSP": "LEFT",
    "FB": "LEFT",
    "IND": "IND",
  },
  "Assam": {
    "BJP": "NDA",
    "AGP": "NDA",
    "UPPL": "NDA",
    "INC": "INC+",
    "AIUDF": "INC+",
    "BPF": "OTH",
    "IND": "IND",
  },
  "Puducherry": {
    "AINRC": "NDA",
    "BJP": "NDA",
    "INC": "INC+",
    "DMK": "INC+",
    "IND": "IND",
  },
}

const ALLIANCE_COLORS: Record<string, string> = {
  "DMK+": "#ef4444",
  "AIADMK+": "#22c55e",
  "BJP+": "#f97316",
  "NDA": "#f97316",
  "UDF": "#3b82f6",
  "LDF": "#dc2626",
  "TMC": "#10b981",
  "LEFT": "#dc2626",
  "INC+": "#3b82f6",
  "IND": "#71717a",
  "OTH": "#a855f7",
  "UNKNOWN": "#64748b",
  "OTHER": "#64748b",
}

const PARTY_COLORS: Record<string, string> = {
  "BJP": "#f97316",
  "INC": "#3b82f6",
  "DMK": "#ef4444",
  "AIADMK": "#22c55e",
  "AITC": "#10b981",
  "TMC": "#10b981",
  "CPI(M)": "#dc2626",
  "CPIM": "#dc2626",
  "CPI": "#ef4444",
  "IUML": "#0ea5e9",
  "AGP": "#f97316",
  "UPPL": "#f97316",
  "AINRC": "#f97316",
  "IND": "#71717a",
  "UNKNOWN": "#64748b",
  "OTHER": "#64748b",
}

const hashedColor = (k: string) => {
  const s = String(k || "OTHER").trim().toUpperCase()
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  const hue = Math.abs(h) % 360
  return `hsl(${hue} 78% 56%)`
}

const seatShareColor = (mode: SeatShareMode, key: string) => {
  const k = String(key || "UNKNOWN").trim().toUpperCase()
  if (mode === "ALLIANCE") return ALLIANCE_COLORS[k] || hashedColor(k)
  return PARTY_COLORS[k] || hashedColor(k)
}

const normalizePartyKey = (p: unknown) => {
  const s = String(p || "").trim()
  if (!s) return "UNKNOWN"
  if (s.toUpperCase() === "INDEPENDENT") return "IND"
  return s
}

const seatShareKey = (state: string, party: unknown, mode: SeatShareMode) => {
  const pk = normalizePartyKey(party)
  if (mode === "PARTY") return pk
  const m = ALLIANCE_MAP_2021[state] || {}
  return m[pk] || pk
}

const fmtPct = (num: number, den: number) => {
  if (!den) return "—"
  return `${Math.round((num / den) * 100)}%`
}

const normName = (s: unknown) => {
  const x = String(s || "")
    .replace(/\((SC|ST)\)/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return x
}

const tokenOverlap = (a: unknown, b: unknown) => {
  const ta = new Set(normName(a).split(" ").filter(Boolean))
  const tb = new Set(normName(b).split(" ").filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter += 1
  return inter / Math.max(1, Math.min(ta.size, tb.size))
}

const bestCandidateMatch = (cands: any[], targetName: unknown) => {
  const t = String(targetName || "").trim()
  if (!t) return null
  const tn = normName(t)
  if (!tn) return null
  let best: any | null = null
  let bestScore = 0
  for (const c of cands || []) {
    const cn = normName(c?.name)
    if (!cn) continue
    if (cn === tn) return c
    const sc = tokenOverlap(t, c?.name)
    if (sc > bestScore) {
      bestScore = sc
      best = c
    }
  }
  if (best && bestScore >= 0.5) return best
  return null
}

function SeatShareArc({
  totalSeats,
  counts,
  title,
  colorMode,
  tile = false,
}: {
  totalSeats: number
  counts: Array<{ key: string; count: number }>
  title: string
  colorMode: SeatShareMode
  /** Flush cell in a hairline grid (no outer radius / border). */
  tile?: boolean
}) {
  const total = Math.max(0, Number(totalSeats || 0))
  if (!total) {
    return (
      <div className={`flex h-[170px] flex-col items-center justify-center bg-[var(--surface-1)] p-3 text-center ${tile ? "rounded-none border-0" : "rounded-lg border border-[var(--border)]"}`}>
        <div className="eb-eyebrow">{title}</div>
        <div className="mt-2 font-mono text-[10px] text-[var(--text-muted)]">No 2021 seat results loaded.</div>
      </div>
    )
  }

  const slots = Array.from({ length: total }, (_, i) => i)
  const expanded: Array<{ key: string; color: string }> = []
  for (const r of counts) {
    const color = seatShareColor(colorMode, r.key)
    for (let i = 0; i < r.count; i++) expanded.push({ key: r.key, color })
  }
  while (expanded.length < total) expanded.push({ key: "OTHER", color: seatShareColor(colorMode, "OTHER") })
  if (expanded.length > total) expanded.length = total

  // Semi-circle dot layout.
  // For small states (e.g. PY=30), fixed 9 rows looks broken; make rows adaptive.
  const rows = Math.min(11, Math.max(4, Math.ceil(Math.sqrt(total) / 1.15)))
  const dot = total <= 35 ? 9 : 8
  const rowCaps = Array.from({ length: rows }, (_, r) => Math.round(Math.pow(r + 2.25, 1.25)))
  const capSum = rowCaps.reduce((a, b) => a + b, 0)
  const scale = total / capSum
  const scaledCaps = rowCaps.map((c) => Math.max(1, Math.round(c * scale)))
  // Re-balance to exact total
  while (scaledCaps.reduce((a, b) => a + b, 0) > total) {
    const idx = scaledCaps.findIndex((c) => c > 1)
    if (idx < 0) break
    scaledCaps[idx] -= 1
  }
  while (scaledCaps.reduce((a, b) => a + b, 0) < total) scaledCaps[scaledCaps.length - 1] += 1

  let cursor = 0
  const dotEls: any[] = []
  const width = 300
  // Add extra bottom padding so the center label never overlaps dots.
  const height = 196
  const cx = width / 2
  // Lift the arc a bit to reserve space for overlay text.
  const baseY = 142
  for (let r = 0; r < rows; r++) {
    const n = scaledCaps[r]
    // Tighter spacing for prettier arcs; small totals still need slightly larger steps.
    const radius = total <= 35 ? 18 + r * 12 : 24 + r * 10
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1)
      const ang = Math.PI * (1 - t) // left -> right across semi-circle
      const x = cx + Math.cos(ang) * radius
      const y = baseY - Math.sin(ang) * radius
      const c = expanded[cursor++]
      dotEls.push(<circle key={`${r}-${i}`} cx={x} cy={y} r={dot / 2} fill={c?.color || "#64748b"} opacity={0.95} />)
      if (cursor >= expanded.length) break
    }
    if (cursor >= expanded.length) break
  }

  const topLegend = counts.slice(0, 6)

  return (
    <div className={`bg-[var(--surface-1)] p-3 ${tile ? "rounded-none border-0" : "rounded-lg border border-[var(--border)]"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="eb-eyebrow">{title}</div>
        <div className="font-mono text-[11px] text-[var(--text-muted)]">{total} seats total</div>
      </div>
      <div className="mt-2 flex items-center justify-center overflow-visible">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="h-auto w-full max-w-[360px]">
          {dotEls}
          {/* Largest winner */}
          {counts[0] && (
            <>
              <g>
                <rect
                  x={cx - 62}
                  y={height - 40}
                  width={124}
                  height={30}
                  rx={999}
                  fill="var(--surface-1)"
                  opacity={0.92}
                />
                <text
                  x={cx}
                  y={height - 20}
                  textAnchor="middle"
                  fill="var(--text-secondary)"
                  fontSize="16"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontWeight="800"
                >
                  {counts[0].count}/{total}
                </text>
                <text
                  x={cx}
                  y={height - 8}
                  textAnchor="middle"
                  fill="var(--text-muted)"
                  fontSize="9"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                >
                  {counts[0].key} · {Math.round((counts[0].count / total) * 100)}%
                </text>
              </g>
            </>
          )}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {topLegend.map((r) => (
          <div key={r.key} className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: seatShareColor(colorMode, r.key) }} />
            <span className="font-mono text-[11px] font-bold text-[var(--text-secondary)]">{r.key}</span>
            <span className="font-mono text-[11px] text-[var(--text-muted)]">{r.count} ({Math.round((r.count/total)*100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Proportional stacked bar — used for small states (< 80 seats) */
function SeatShareBar({
  totalSeats,
  counts,
  title,
  colorMode,
  tile = false,
}: {
  totalSeats: number
  counts: Array<{ key: string; count: number }>
  title: string
  colorMode: SeatShareMode
  tile?: boolean
}) {
  const total = Math.max(0, Number(totalSeats || 0))
  if (!total) return (
    <div className={`flex h-[100px] flex-col items-center justify-center bg-[var(--surface-1)] p-3 text-center ${tile ? "rounded-none border-0" : "rounded-lg border border-[var(--border)]"}`}>
      <div className="eb-eyebrow">{title}</div>
      <div className="mt-2 font-mono text-[10px] text-[var(--text-muted)]">No 2021 results.</div>
    </div>
  )
  const topLegend = counts.slice(0, 6)
  return (
    <div className={`bg-[var(--surface-1)] p-3 ${tile ? "rounded-none border-0" : "rounded-lg border border-[var(--border)]"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="eb-eyebrow">{title}</div>
        <div className="font-mono text-[11px] text-[var(--text-muted)]">{total} seats</div>
      </div>
      {/* Stacked proportional bar */}
      <div className="mt-3 flex h-8 w-full overflow-hidden rounded-md">
        {counts.map((r) => {
          const pct = (r.count / total) * 100
          const color = seatShareColor(colorMode, r.key)
          return (
            <div
              key={r.key}
              title={`${r.key}: ${r.count} (${Math.round(pct)}%)`}
              style={{ width: `${pct}%`, backgroundColor: color, minWidth: r.count > 0 ? "2px" : 0 }}
            />
          )
        })}
      </div>
      {/* Winner callout */}
      {counts[0] && (
        <div className="mt-2 flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: seatShareColor(colorMode, counts[0].key) }} />
          <span className="font-mono text-[13px] font-bold text-[var(--text-primary)]">{counts[0].key}</span>
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            {counts[0].count}/{total} · {Math.round((counts[0].count / total) * 100)}%
          </span>
        </div>
      )}
      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {topLegend.map((r) => (
          <div key={r.key} className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5">
            <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: seatShareColor(colorMode, r.key) }} />
            <span className="font-mono text-[10px] font-bold text-[var(--text-secondary)]">{r.key}</span>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">{r.count} ({Math.round((r.count/total)*100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MiniSeatMap({
  state,
  lat,
  lng,
  title,
  subtitle,
}: {
  state: string
  lat: number | null
  lng: number | null
  title?: string | null
  subtitle?: string | null
}) {
  const mapFile = STATE_MAP_FILES[state] ? `/maps/${STATE_MAP_FILES[state]}` : "/maps/india.json"
  const hasPoint = typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
  const stateCenter: Record<string, [number, number]> = {
    "Kerala": [76.2, 10.5],
    "Assam": [92.9, 26.2],
    "Tamil Nadu": [78.3, 10.9],
    "West Bengal": [87.9, 24.3],
    "Puducherry": [79.73, 11.91],
  }
  const center = hasPoint ? ([lng as number, lat as number] as [number, number]) : (stateCenter[state] || ([78.9629, 22.5937] as [number, number]))
  const zoom = hasPoint ? 7.2 : state ? 3.4 : 1.2
  return (
    <div className="flex h-full min-h-[180px] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
      {/* Header strip */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-2.5 py-1.5">
        <span className="eb-eyebrow">Seat Location</span>
        <span className="font-mono text-[9px] text-[var(--text-muted)]">{state || "—"}</span>
      </div>
      {/* Map fills remaining height */}
      <div className="relative min-h-0 flex-1">
        <ComposableMap
          projection="geoMercator"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
          projectionConfig={{ scale: 1480 }}
        >
          <ZoomableGroup center={center} zoom={zoom} minZoom={1} maxZoom={12} translateExtent={[[-400, -400], [1200, 900]]}>
            <Geographies geography={mapFile}>
              {({ geographies }) =>
                geographies.map((geo) => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill="#0b1526"
                    stroke="#22304a"
                    strokeWidth={0.9}
                    style={{ default: { outline: "none" }, hover: { outline: "none" }, pressed: { outline: "none" } }}
                  />
                ))
              }
            </Geographies>
            {hasPoint ? (
              <Marker coordinates={[lng as number, lat as number]}>
                <circle r={5.2} fill="#22d3ee" stroke="#082f49" strokeWidth={1.2} />
                <circle r={16} fill="rgba(34,211,238,0.12)" />
              </Marker>
            ) : null}
          </ZoomableGroup>
        </ComposableMap>
        {/* Seat name overlay — bottom of map */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 bg-[#060e1c]/85 px-2.5 py-1.5 backdrop-blur-sm">
          <span className="min-w-0 truncate font-mono text-[10px] font-bold text-[var(--text-secondary)]">
            {title || "No constituency selected"}
          </span>
          {hasPoint ? (
            <span className="shrink-0 rounded border border-[#22d3ee]/30 bg-[#0c4a6e]/60 px-1.5 py-0.5 font-mono text-[8px] font-bold text-[#22d3ee]">
              pinned
            </span>
          ) : null}
        </div>
      </div>
      {/* Subtitle strip — district / reservation / phase */}
      {subtitle ? (
        <div className="shrink-0 border-t border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 font-mono text-[9px] text-[var(--text-muted)] truncate">
          {subtitle}
        </div>
      ) : null}
    </div>
  )
}

const bucketAge = (age: number | null | undefined) => {
  if (age == null || Number.isNaN(Number(age))) return "Unknown"
  const a = Number(age)
  if (a <= 25) return "18–25"
  if (a <= 35) return "26–35"
  if (a <= 45) return "36–45"
  if (a <= 60) return "46–60"
  return "60+"
}

const normGender = (g: unknown) => {
  const s = String(g || "").trim().toLowerCase()
  if (!s) return "Unknown"
  if (s.startsWith("m")) return "Male"
  if (s.startsWith("f")) return "Female"
  if (s.includes("third") || s.includes("other")) return "Other"
  return "Unknown"
}

function MiniBar({
  label,
  value,
  max,
  color,
  suffix,
  showPct = false,
  total,
}: {
  label: string
  value: number
  max: number
  color: string
  suffix?: string
  showPct?: boolean
  total?: number
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  const valuePct = total && total > 0 ? Math.round((value / total) * 100) : null
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 truncate font-mono text-[11px] text-[var(--text-secondary)]">
        {label}
      </span>
      <div className="relative flex-1">
        <div className="h-[10px] w-full overflow-hidden rounded bg-[var(--surface-3)]">
          <div className="h-full rounded-sm transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
      </div>
      <span className="shrink-0 min-w-[3rem] text-right font-mono text-[11px] font-bold text-[var(--text-secondary)]">
        {value}{suffix ?? ""}
        {showPct && valuePct !== null ? (
          <span className="ml-1 font-normal text-[var(--text-muted)]">({valuePct}%)</span>
        ) : null}
      </span>
    </div>
  )
}

/**
 * Mobile-only collapsible wrapper. Renders children normally on md+, and as a
 * collapsible section on mobile so heavy analytics blocks don't drown the view.
 */
function MobileCollapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <>
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="hit-44 flex w-full items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-left"
        >
          <span className="font-sans text-[13px] font-semibold text-[var(--text-primary)]">{title}</span>
          <span className="font-mono text-[11px] text-[var(--text-muted)]">{open ? "−" : "+"}</span>
        </button>
        {open ? <div className="mt-2">{children}</div> : null}
      </div>
      <div className="hidden md:block">{children}</div>
    </>
  )
}

export default function InsightsCenterPane({
  globalStateFilter,
  globalConstituencyId,
  onChangeGlobalStateFilter,
  onSelectConstituency,
}: {
  globalStateFilter: string
  globalConstituencyId: string | null
  onChangeGlobalStateFilter: (s: string) => void
  onSelectConstituency: (id: string | null) => void
}) {
  const { constituencies, candidates, ensureCandidatesForPrefixes, candidateCounts, criminalCounts } = useLiveData()
  const [activeState, setActiveState] = useState<string>(() => (globalStateFilter && globalStateFilter !== "ALL" ? globalStateFilter : "ALL"))
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null)
  const [seatResult, setSeatResult] = useState<ConstituencyResult2021 | null>(null)
  const [seatShareMode, setSeatShareMode] = useState<SeatShareMode>("PARTY")
  const [stateResults2021, setStateResults2021] = useState<ConstituencyResult2021[] | null>(null)
  const [allResults2021, setAllResults2021] = useState<Record<string, ConstituencyResult2021[]> | null>(null)
  const [stateElectorsSummary, setStateElectorsSummary] = useState<any[] | null>(null)
  const [seatElectorsSummary, setSeatElectorsSummary] = useState<any | null>(null)
  const [assetsDb, setAssetsDb] = useState<{ median: number | null; coveragePct: number | null; assetsRows: number; totalRows: number } | null>(null)
  const [topAssetsByState, setTopAssetsByState] = useState<Array<{ state: string; name: string; party: string; assets_value: number }> | null>(null)
  const [stateTopAssets, setStateTopAssets] = useState<Array<{ id: string; name: string; party: string; assets_value: number; constituency_id: string }> | null>(null)
  const [seatTopAsset, setSeatTopAsset] = useState<{ id: string; name: string; party: string; assets_value: number } | null>(null)

  useEffect(() => {
    if (!globalStateFilter) return
    if (globalStateFilter === "ALL") {
      setActiveState("ALL")
      setSelectedSeatId(null)
      return
    }
    setActiveState(globalStateFilter)
  }, [globalStateFilter])

  useEffect(() => {
    const id = globalConstituencyId ? String(globalConstituencyId) : ""
    if (!id) {
      if (selectedSeatId) setSelectedSeatId(null)
      return
    }
    if (String(selectedSeatId || "") !== id) setSelectedSeatId(id)
  }, [globalConstituencyId, selectedSeatId])

  useEffect(() => {
    if (!activeState) return
    if (activeState === "ALL") {
      const prefixes = STATES.filter((s) => s !== "ALL")
        .map((s) => STATE_META[s]?.dbPrefix)
        .filter(Boolean) as string[]
      void ensureCandidatesForPrefixes(prefixes)
      return
    }
    const prefix = STATE_META[activeState]?.dbPrefix
    if (!prefix) return
    void ensureCandidatesForPrefixes([prefix])
  }, [activeState, ensureCandidatesForPrefixes])

  useEffect(() => {
    // Median assets must come from DB, not "currently loaded candidates",
    // otherwise ALL/state/seat scopes look unstable/broken.
    let cancelled = false
    const run = async () => {
      const scope =
        selectedSeatId
          ? ({ kind: "SEAT" as const, key: String(selectedSeatId) })
          : activeState === "ALL"
            ? ({ kind: "ALL" as const, key: "ALL" })
            : ({ kind: "STATE" as const, key: String(activeState) })

      const statePrefix = scope.kind === "STATE" ? (STATE_META[scope.key]?.dbPrefix ? `${STATE_META[scope.key]?.dbPrefix}-%` : null) : null

      const totalCountQuery =
        scope.kind === "SEAT"
          ? supabase.from("candidates").select("id", { count: "exact", head: true }).eq("removed", false).eq("constituency_id", scope.key)
          : scope.kind === "STATE" && statePrefix
            ? supabase.from("candidates").select("id", { count: "exact", head: true }).eq("removed", false).like("constituency_id", statePrefix)
            : supabase.from("candidates").select("id", { count: "exact", head: true }).eq("removed", false)

      const assetsCountQuery =
        scope.kind === "SEAT"
          ? supabase.from("candidates").select("id", { count: "exact", head: true }).eq("removed", false).eq("constituency_id", scope.key).gt("assets_value", 0)
          : scope.kind === "STATE" && statePrefix
            ? supabase.from("candidates").select("id", { count: "exact", head: true }).eq("removed", false).like("constituency_id", statePrefix).gt("assets_value", 0)
            : supabase.from("candidates").select("id", { count: "exact", head: true }).eq("removed", false).gt("assets_value", 0)

      const [{ count: totalRows }, { count: assetsRows }] = await Promise.all([totalCountQuery, assetsCountQuery])
      const total = Number(totalRows || 0)
      const assetsN = Number(assetsRows || 0)
      const coveragePct = total ? Math.round((assetsN / total) * 100) : null

      if (!assetsN) {
        if (!cancelled) setAssetsDb({ median: null, coveragePct, assetsRows: 0, totalRows: total })
        return
      }

      // Efficient median: fetch the single row at the mid-point index using ORDER BY + RANGE
      // This replaces N/1000 page fetches with exactly one fetch.
      const midIdx = Math.floor(assetsN / 2)
      const medianBaseQ =
        scope.kind === "SEAT"
          ? supabase.from("candidates").select("assets_value").eq("removed", false).eq("constituency_id", scope.key).gt("assets_value", 0)
          : scope.kind === "STATE" && statePrefix
            ? supabase.from("candidates").select("assets_value").eq("removed", false).like("constituency_id", statePrefix).gt("assets_value", 0)
            : supabase.from("candidates").select("assets_value").eq("removed", false).gt("assets_value", 0)
      const { data: medianRows, error: medianErr } = await medianBaseQ
        .order("assets_value", { ascending: true })
        .range(midIdx, midIdx)
      const medianRaw = !medianErr && Array.isArray(medianRows) && medianRows[0]
        ? Number(medianRows[0].assets_value || 0)
        : 0
      const median = Number.isFinite(medianRaw) && medianRaw > 0 ? medianRaw : null
      if (!cancelled) setAssetsDb({ median, coveragePct, assetsRows: assetsN, totalRows: total })
    }
    run()
    return () => {
      cancelled = true
    }
  }, [activeState, selectedSeatId])

  useEffect(() => {
    if (!activeState || activeState === "ALL") {
      setStateResults2021(null)
      return
    }
    let cancelled = false
    supabase
      .from("constituency_results")
      .select("state,election_year,constituency_id,winner_party,winner_name,runner_up_name,runner_up_party,margin_votes,turnout_pct,source_url")
      .eq("state", activeState)
      .eq("election_year", 2021)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !Array.isArray(data)) {
          setStateResults2021(null)
          return
        }
        setStateResults2021(data as any)
      })
    return () => {
      cancelled = true
    }
  }, [activeState])

  useEffect(() => {
    if (activeState !== "ALL") {
      setTopAssetsByState(null)
      return
    }
    let cancelled = false
    const run = async () => {
      const states = STATES.filter((s) => s !== "ALL")
      const rows = await Promise.all(
        states.map(async (s) => {
          const prefix = STATE_META[s]?.dbPrefix
          if (!prefix) return null
          const baseQuery = () =>
            supabase
              .from("candidates")
              .select("name,party,assets_value,constituency_id")
              .like("constituency_id", `${prefix}-%`)
              .gt("assets_value", 0)
              .order("assets_value", { ascending: false })
              .limit(1)

          const first = await baseQuery().eq("removed", false)
          const second = first?.error ? await baseQuery() : null
          const data = (first?.error ? second?.data : first?.data) as any[] | null
          const r: any = Array.isArray(data) && data.length ? data[0] : null
          if (!r?.assets_value) return null
          return { state: s, name: String(r.name || "—"), party: String(r.party || "—"), assets_value: Number(r.assets_value || 0) }
        })
      )
      const out = rows.filter(Boolean) as Array<{ state: string; name: string; party: string; assets_value: number }>
      out.sort((a, b) => b.assets_value - a.assets_value)
      if (!cancelled) setTopAssetsByState(out)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [activeState])

  useEffect(() => {
    if (!activeState || activeState === "ALL" || selectedSeatId) {
      setStateTopAssets(null)
      return
    }
    let cancelled = false
    const run = async () => {
      const prefix = STATE_META[activeState]?.dbPrefix
      if (!prefix) {
        if (!cancelled) setStateTopAssets(null)
        return
      }
      const baseQuery = () =>
        supabase
          .from("candidates")
          .select("id,name,party,assets_value,constituency_id")
          .like("constituency_id", `${prefix}-%`)
          .gt("assets_value", 0)
          .order("assets_value", { ascending: false })
          .limit(10)

      const first = await baseQuery().eq("removed", false)
      const second = first?.error ? await baseQuery() : null
      const data = (first?.error ? second?.data : first?.data) as any[] | null
      const out =
        (Array.isArray(data) ? data : []).map((r: any) => ({
          id: String(r.id),
          name: String(r.name || "—"),
          party: String(r.party || "—"),
          assets_value: Number(r.assets_value || 0),
          constituency_id: String(r.constituency_id || ""),
        })) || null
      if (!cancelled) setStateTopAssets(out)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [activeState, selectedSeatId])

  useEffect(() => {
    if (!activeState || activeState === "ALL") {
      setStateElectorsSummary(null)
      return
    }
    let cancelled = false
    supabase
      .from("state_electors_summary")
      .select("state,election_year,constituency_type,electors_male,electors_female,electors_third,electors_total,voted_male,voted_female,voted_third,voted_total,poll_pct")
      .eq("state", activeState)
      .eq("election_year", 2021)
      .then(({ data }) => {
        if (cancelled) return
        setStateElectorsSummary((data as any[]) || null)
      })
    return () => {
      cancelled = true
    }
  }, [activeState])

  useEffect(() => {
    if (!selectedSeatId) {
      setSeatElectorsSummary(null)
      return
    }
    let cancelled = false
    supabase
      .from("constituency_electors_summary")
      .select("state,election_year,constituency_id,electors_male,electors_female,electors_third,electors_total,voters_male,voters_female,voters_third,voters_total,poll_pct,source_note")
      .eq("constituency_id", selectedSeatId)
      .eq("election_year", 2021)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setSeatElectorsSummary((data as any) || null)
      })
    return () => {
      cancelled = true
    }
  }, [selectedSeatId])

  useEffect(() => {
    if (activeState !== "ALL") {
      setAllResults2021(null)
      return
    }
    let cancelled = false
    const states = STATES.filter((s) => s !== "ALL")
    Promise.all(
      states.map(async (s) => {
        const { data, error } = await supabase
          .from("constituency_results")
          .select("state,election_year,constituency_id,winner_party,margin_votes,turnout_pct,total_electors,total_votes_polled")
          .eq("state", s)
          .eq("election_year", 2021)
        if (error || !Array.isArray(data)) return [s, [] as ConstituencyResult2021[]] as const
        return [s, data as any] as const
      })
    ).then((pairs) => {
      if (cancelled) return
      const out: Record<string, ConstituencyResult2021[]> = {}
      for (const [s, rows] of pairs) out[s] = rows || []
      setAllResults2021(out)
    })
    return () => {
      cancelled = true
    }
  }, [activeState])

  useEffect(() => {
    if (!selectedSeatId) {
      setSeatResult(null)
      return
    }
    let cancelled = false
    supabase
      .from("constituency_results")
      .select("state,election_year,constituency_id,constituency_name_raw,winner_name,winner_party,runner_up_name,runner_up_party,winner_votes,runner_up_votes,total_votes_polled,total_electors,margin_votes,turnout_pct,source_url,source_note")
      .eq("constituency_id", selectedSeatId)
      .eq("election_year", 2021)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setSeatResult((data as any) || null)
      })
    return () => {
      cancelled = true
    }
  }, [selectedSeatId])

  useEffect(() => {
    if (!selectedSeatId) {
      setSeatTopAsset(null)
      return
    }
    let cancelled = false
    const run = async () => {
      const baseQuery = () =>
        supabase
          .from("candidates")
          .select("id,name,party,assets_value")
          .eq("constituency_id", selectedSeatId)
          .gt("assets_value", 0)
          .order("assets_value", { ascending: false })
          .limit(1)

      const first = await baseQuery().eq("removed", false)
      const second = first?.error ? await baseQuery() : null
      const data = (first?.error ? second?.data : first?.data) as any[] | null
      const r: any = Array.isArray(data) && data.length ? data[0] : null
      const out = r?.assets_value
        ? { id: String(r.id), name: String(r.name || "—"), party: String(r.party || "—"), assets_value: Number(r.assets_value || 0) }
        : null
      if (!cancelled) setSeatTopAsset(out)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [selectedSeatId])

  const filteredSeats = useMemo(() => {
    if (selectedSeatId) {
      const seat = constituencies.find((c: any) => String(c.id) === String(selectedSeatId))
      return seat ? [seat] : []
    }
    const byState = activeState === "ALL" ? constituencies : constituencies.filter((c: any) => c.state === activeState)
    return byState
  }, [constituencies, activeState, selectedSeatId])

  const selectedSeat = useMemo(() => {
    if (!selectedSeatId) return null
    return constituencies.find((c: any) => String(c.id) === String(selectedSeatId)) || null
  }, [constituencies, selectedSeatId])

  const selectedSeatCandidates = useMemo(() => {
    if (!selectedSeatId) return []
    return (candidates as any[]).filter((c) => String(c.constituency_id) === String(selectedSeatId))
  }, [candidates, selectedSeatId])

  const selectedSeatVoterSpread = useMemo(() => {
    if (!selectedSeatId) return null
    const ageM = new Map<string, number>()
    const genM = new Map<string, number>()
    let ind = 0
    let crim = 0
    const assets: number[] = []
    for (const c of selectedSeatCandidates) {
      ageM.set(bucketAge(c.age), (ageM.get(bucketAge(c.age)) || 0) + 1)
      genM.set(normGender(c.gender), (genM.get(normGender(c.gender)) || 0) + 1)
      if (c.is_independent) ind += 1
      if (Number(c.criminal_cases || 0) > 0) crim += 1
      const av = Number(c.assets_value || 0)
      if (Number.isFinite(av) && av > 0) assets.push(av)
    }
    assets.sort((a, b) => a - b)
    const medianAssets = assets.length ? assets[Math.floor(assets.length / 2)] : null
    const ageOrder = ["18–25", "26–35", "36–45", "46–60", "60+", "Unknown"]
    const genOrder = ["Male", "Female", "Other", "Unknown"]
    return {
      candidates: selectedSeatCandidates.length,
      independents: ind,
      criminal: crim,
      medianAssets,
      age: ageOrder.map((k) => ({ k, v: ageM.get(k) || 0 })),
      gender: genOrder.map((k) => ({ k, v: genM.get(k) || 0 })),
    }
  }, [selectedSeatId, selectedSeatCandidates])

  // Broaden search to all loaded state candidates — the 2021 winner/runner-up may be running in a different seat in 2026
  const stateCandidatesForHistory = useMemo(() => {
    if (!activeState || activeState === "ALL") return candidates as any[]
    const prefix = STATE_META[activeState]?.dbPrefix
    if (!prefix) return candidates as any[]
    return (candidates as any[]).filter((c) => String(c.constituency_id || "").startsWith(prefix))
  }, [candidates, activeState])

  // Prefer match within the currently selected seat. If none, fall back to a state-wide match
  // (used only to detect the "moved seat" case and render a secondary hint — never auto-nav).
  const inSeatWinnerCand = useMemo(
    () => bestCandidateMatch(selectedSeatCandidates, seatResult?.winner_name),
    [selectedSeatCandidates, seatResult?.winner_name]
  )
  const inSeatRunnerCand = useMemo(
    () => bestCandidateMatch(selectedSeatCandidates, seatResult?.runner_up_name),
    [selectedSeatCandidates, seatResult?.runner_up_name]
  )
  const stateWideWinnerCand = useMemo(
    () => bestCandidateMatch(stateCandidatesForHistory, seatResult?.winner_name),
    [stateCandidatesForHistory, seatResult?.winner_name]
  )
  const stateWideRunnerCand = useMemo(
    () => bestCandidateMatch(stateCandidatesForHistory, seatResult?.runner_up_name),
    [stateCandidatesForHistory, seatResult?.runner_up_name]
  )
  // Legacy aliases kept for any existing reads; now prefer in-seat match for photos etc.
  const selectedSeatWinnerCand = inSeatWinnerCand || stateWideWinnerCand
  const selectedSeatRunnerCand = inSeatRunnerCand || stateWideRunnerCand

  const movedWinner =
    !inSeatWinnerCand && stateWideWinnerCand && String(stateWideWinnerCand.constituency_id || "") !== String(selectedSeatId || "")
      ? stateWideWinnerCand
      : null
  const movedRunner =
    !inSeatRunnerCand && stateWideRunnerCand && String(stateWideRunnerCand.constituency_id || "") !== String(selectedSeatId || "")
      ? stateWideRunnerCand
      : null
  const constNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of constituencies as any[]) m.set(String(c.id), String(c.name || c.id))
    return m
  }, [constituencies])

  const allViewExtras = useMemo(() => {
    if (activeState !== "ALL") return null
    const rows = STATES.filter((s) => s !== "ALL").map((s) => {
      const cands = Number(candidateCounts?.[s] || 0)
      const crim = Number(criminalCounts?.[s] || 0)
      const rate = cands ? Math.round((crim / cands) * 100) : 0
      return { state: s, cands, crim, rate }
    })
    rows.sort((a, b) => b.rate - a.rate)
    return rows
  }, [activeState, candidateCounts, criminalCounts])

  const overviewCandidateHeadcount = useMemo(
    () => STATES.filter((s) => s !== "ALL").reduce((acc, st) => acc + Number(candidateCounts[st] ?? 0), 0),
    [candidateCounts]
  )

  const constituencyOptions = useMemo(() => {
    if (activeState === "ALL") return []
    const byState = constituencies.filter((c: any) => c.state === activeState)
    return byState
      .map((c: any) => ({ id: String(c.id), name: String(c.name || c.id) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [constituencies, activeState])

  const seatIds = useMemo(() => new Set(filteredSeats.map((c: any) => String(c.id))), [filteredSeats])
  const filteredCandidates = useMemo(() => (candidates as any[]).filter((c) => seatIds.has(String(c.constituency_id))), [candidates, seatIds])

  const kpis = useMemo(() => {
    const seats = filteredSeats.length
    const cands = filteredCandidates.length
    const parties = new Set<string>()
    let crim = 0
    const assets: number[] = []
    let hasParty = 0
    let hasAge = 0
    let hasGender = 0
    let hasAssets = 0
    let hasCriminalField = 0
    for (const c of filteredCandidates) {
      const p = String(c.party || (c.is_independent ? "IND" : "") || "").trim()
      if (p) parties.add(p)
      if (Number(c.criminal_cases || 0) > 0) crim += 1
      if (p) hasParty += 1
      if (c.age != null && !Number.isNaN(Number(c.age))) hasAge += 1
      if (String(c.gender || "").trim()) hasGender += 1
      if (c.criminal_cases != null) hasCriminalField += 1
      const av = Number(c.assets_value || 0)
      if (Number.isFinite(av) && av > 0) {
        hasAssets += 1
        assets.push(av)
      }
    }
    assets.sort((a, b) => a - b)
    const minAssetsRows = Math.max(8, Math.floor(cands * 0.25))
    const medianAssets = assets.length >= minAssetsRows ? assets[Math.floor(assets.length / 2)] : null
    return {
      seats,
      cands,
      parties: parties.size,
      crim,
      medianAssets,
      assetsRows: assets.length,
      coverage: {
        party: fmtPct(hasParty, cands),
        age: fmtPct(hasAge, cands),
        gender: fmtPct(hasGender, cands),
        assets: fmtPct(hasAssets, cands),
        criminal_field: fmtPct(hasCriminalField, cands),
      },
    }
  }, [filteredSeats, filteredCandidates])

  const candidatesByParty = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of filteredCandidates) {
      const key = String(c.party || (c.is_independent ? "IND" : ""))
      if (!key) continue
      m.set(key, (m.get(key) || 0) + 1)
    }
    const rows = Array.from(m.entries()).map(([party, count]) => ({ party, count }))
    rows.sort((a, b) => b.count - a.count)
    return rows.slice(0, 10)
  }, [filteredCandidates])

  const ageBuckets = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of filteredCandidates) {
      const b = bucketAge(c.age)
      m.set(b, (m.get(b) || 0) + 1)
    }
    const order = ["18–25", "26–35", "36–45", "46–60", "60+", "Unknown"]
    return order.map((k) => ({ bucket: k, count: m.get(k) || 0 }))
  }, [filteredCandidates])

  const genderBuckets = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of filteredCandidates) {
      const g = normGender(c.gender)
      m.set(g, (m.get(g) || 0) + 1)
    }
    const order = ["Male", "Female", "Other", "Unknown"]
    return order.map((k) => ({ gender: k, count: m.get(k) || 0 }))
  }, [filteredCandidates])

  const maxParty = Math.max(1, ...candidatesByParty.map((x) => x.count))
  const maxAge = Math.max(1, ...ageBuckets.map((x) => x.count))
  const maxGender = Math.max(1, ...genderBuckets.map((x) => x.count))

  const seatShare = useMemo(() => {
    if (!stateResults2021?.length) return null
    const m = new Map<string, number>()
    for (const r of stateResults2021) {
      const key = seatShareKey(activeState, r.winner_party, seatShareMode)
      m.set(key, (m.get(key) || 0) + 1)
    }
    const counts = Array.from(m.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
    return { total: stateResults2021.length, counts }
  }, [stateResults2021, activeState, seatShareMode])

  const allSeatShares = useMemo(() => {
    if (!allResults2021) return null
    const out: Record<string, { total: number; counts: Array<{ key: string; count: number }> }> = {}
    for (const s of STATES.filter((x) => x !== "ALL")) {
      const rows = allResults2021[s] || []
      if (!rows.length) continue
      const m = new Map<string, number>()
      for (const r of rows) {
        const key = seatShareKey(s, r.winner_party, seatShareMode)
        m.set(key, (m.get(key) || 0) + 1)
      }
      const counts = Array.from(m.entries())
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count)
      out[s] = { total: rows.length, counts }
    }
    return out
  }, [allResults2021, seatShareMode])

  const allGlobalMetrics = useMemo(() => {
    if (activeState !== "ALL" || !allResults2021) return null
    const rows: any[] = []
    for (const st of STATES.filter((s) => s !== "ALL")) {
      for (const r of (allResults2021[st] || []) as any[]) rows.push(r)
    }
    const totalElectors = rows.reduce((s, r) => s + (Number(r?.total_electors) || 0), 0)
    const totalVotesPolled = rows.reduce((s, r) => s + (Number(r?.total_votes_polled) || 0), 0)
    const turnoutWeightedNum = rows.reduce((s, r) => s + (Number(r?.turnout_pct) || 0) * (Number(r?.total_electors) || 0), 0)
    const turnoutWeighted = totalElectors ? turnoutWeightedNum / totalElectors : null
    const closestMargin = rows
      .map((r) => Number(r?.margin_votes))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b)[0]
    const closeSeats5k = rows.map((r) => Number(r?.margin_votes)).filter((n) => Number.isFinite(n) && n > 0 && n <= 5000).length
    return {
      totalElectors: totalElectors || null,
      totalVotesPolled: totalVotesPolled || null,
      turnoutWeighted: turnoutWeighted != null && Number.isFinite(turnoutWeighted) ? turnoutWeighted : null,
      closestMargin: Number.isFinite(closestMargin) ? closestMargin : null,
      closeSeats5k,
    }
  }, [activeState, allResults2021])

  const competitiveSeats = useMemo(() => {
    if (!stateResults2021?.length) return []
    const byId = new Map<string, any>()
    for (const c of constituencies as any[]) byId.set(String(c.id), c)
    const rows = stateResults2021
      .map((r) => {
        const seat = byId.get(String(r.constituency_id))
        return {
          id: String(r.constituency_id),
          name: seat?.name || r.constituency_name_raw || String(r.constituency_id),
          margin_votes: r.margin_votes != null ? Number(r.margin_votes) : null,
          turnout_pct: r.turnout_pct != null ? Number(r.turnout_pct) : null,
          winner_party: String(r.winner_party || ""),
        }
      })
      .filter((r) => r.margin_votes != null && Number.isFinite(r.margin_votes as any))
    rows.sort((a, b) => Number(a.margin_votes) - Number(b.margin_votes))
    return rows.slice(0, 20)
  }, [stateResults2021, constituencies])

  const selectedSeatCompetitiveness = useMemo(() => {
    if (!selectedSeatId || !stateResults2021?.length) return null
    const rows = stateResults2021
      .map((r) => ({
        id: String(r.constituency_id),
        margin_votes: r.margin_votes != null ? Number(r.margin_votes) : null,
      }))
      .filter((r) => r.margin_votes != null && Number.isFinite(r.margin_votes as any))
    if (!rows.length) return null
    rows.sort((a, b) => Number(a.margin_votes) - Number(b.margin_votes))
    const idx = rows.findIndex((r) => r.id === String(selectedSeatId))
    if (idx < 0) return null
    const rank = idx + 1
    const n = rows.length
    const pct = Math.round((rank / n) * 100)
    return { rank, n, pct }
  }, [selectedSeatId, stateResults2021])

  const stateTurnoutAvg2021 = useMemo(() => {
    if (!stateResults2021?.length) return null
    const vals = stateResults2021
      .map((r) => (r.turnout_pct != null ? Number(r.turnout_pct) : null))
      .filter((n) => n != null && Number.isFinite(n as any)) as number[]
    if (!vals.length) return null
    return vals.reduce((s, n) => s + n, 0) / vals.length
  }, [stateResults2021])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--surface-0)]">
      {/* ── Filter bar — state selector always visible, constituency+toggle only when state selected ── */}
      {/* Row 1 — state selector (ALWAYS visible) */}
      <div className="border-b border-[var(--border)] bg-[var(--surface-1)]">
        {/* Desktop: state pills + (All view) seat-share mode */}
        <div className="hidden md:flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-3 pt-2.5 pb-2">
          <div className="eb-pills shrink-0">
            {STATES.map((s) => {
              const active = activeState === s
              return (
                <button
                  key={s}
                  type="button"
                  data-active={active}
                  onClick={() => { setActiveState(s); setSelectedSeatId(null); onChangeGlobalStateFilter(s) }}
                  className="eb-pill shrink-0"
                >
                  {s === "ALL" ? "All" : (STATE_META[s]?.abbr || s)}
                </button>
              )
            })}
          </div>
          {activeState === "ALL" ? (
            <div className="flex w-full min-w-0 flex-wrap items-center justify-center gap-2 border-t border-[var(--border)] pt-2 md:w-auto md:border-t-0 md:pt-0">
              <span className="text-[11px] font-medium text-[var(--text-muted)] whitespace-nowrap">Seat share by</span>
              <div className="eb-pills shrink-0" role="group" aria-label="Seat share mode">
                <button type="button" data-active={seatShareMode === "PARTY"} onClick={() => setSeatShareMode("PARTY")} className="eb-pill">Party</button>
                <button type="button" data-active={seatShareMode === "ALLIANCE"} onClick={() => setSeatShareMode("ALLIANCE")} className="eb-pill">Alliance</button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Mobile: state select, full-width, 44px */}
        <select
          value={activeState}
          onChange={(e) => { const s = e.target.value; setActiveState(s); setSelectedSeatId(null); onChangeGlobalStateFilter(s) }}
          className="md:hidden w-full h-11 border-0 border-b border-[var(--border)] bg-[var(--surface-1)] px-3 text-[14px] font-medium text-[var(--text-primary)] focus:outline-none"
          aria-label="State"
        >
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s === "ALL" ? "All states" : `${STATE_META[s]?.abbr || s} · ${s}`}
            </option>
          ))}
        </select>

        {activeState === "ALL" ? (
          <div className="md:hidden flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface-1)] px-3 py-2.5">
            <span className="text-[12px] font-medium text-[var(--text-muted)]">Seat share by</span>
            <div className="eb-pills shrink-0" role="group" aria-label="Seat share mode">
              <button type="button" data-active={seatShareMode === "PARTY"} onClick={() => setSeatShareMode("PARTY")} className="eb-pill">Party</button>
              <button type="button" data-active={seatShareMode === "ALLIANCE"} onClick={() => setSeatShareMode("ALLIANCE")} className="eb-pill">Alliance</button>
            </div>
          </div>
        ) : null}

      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-[var(--surface-0)]">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {activeState !== "ALL" ? (
          <div className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface-1)] px-3 py-2.5 md:static md:z-auto">
            <div className="flex flex-nowrap items-center gap-3">
              <select
                value={selectedSeatId ?? ""}
                onChange={(e) => {
                  const id = e.target.value
                  if (!id) {
                    setSelectedSeatId(null)
                    onSelectConstituency(null)
                    return
                  }
                  setSelectedSeatId(id)
                  const seat = constituencies.find((c: any) => String(c.id) === String(id))
                  if (seat?.state) onChangeGlobalStateFilter(String(seat.state))
                  onSelectConstituency(id)
                }}
                className="h-11 min-w-0 w-full flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-primary)] md:h-10 md:max-w-[280px]"
                aria-label="Constituency"
              >
                <option value="">All constituencies</option>
                {constituencyOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <div
                className={[
                  "ml-auto flex min-w-0 shrink-0 items-center gap-2",
                  selectedSeatId ? "max-md:hidden" : "",
                ].join(" ")}
              >
                <span className="text-[11px] font-medium text-[var(--text-muted)] whitespace-nowrap">Seat share by</span>
                <div className="eb-pills shrink-0" role="group" aria-label="Seat share mode">
                  <button type="button" data-active={seatShareMode === "PARTY"} onClick={() => setSeatShareMode("PARTY")} className="eb-pill">Party</button>
                  <button type="button" data-active={seatShareMode === "ALLIANCE"} onClick={() => setSeatShareMode("ALLIANCE")} className="eb-pill">Alliance</button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div
          className={
            activeState === "ALL"
              ? "space-y-6 px-4 pb-10 pt-2 md:space-y-8 md:px-8"
              : "space-y-4 px-4 pb-10 pt-2 md:space-y-5 md:px-6 lg:px-7"
          }
        >
        {activeState === "ALL" ? (
          <section className="eb-insights-hero overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-sm">
            <div className="relative z-[1] px-5 py-6 md:px-10 md:py-8">
              <div className="mx-auto max-w-3xl text-center md:mx-0 md:max-w-2xl md:text-left">
                <h2 className="text-[22px] font-semibold tracking-[-0.02em] leading-[1.15] text-[var(--text-primary)]">
                  Start with your state
                </h2>
                <p className="mt-2 text-[13px] leading-[1.5] text-[var(--text-muted)]">
                  Candidates, 2021 results, and live news for any Assembly seat. Sources: Election Commission of India, ADR, MyNeta.
                </p>
              </div>
              <div className="mx-auto mt-6 grid max-w-3xl grid-cols-2 gap-3 md:mx-0 md:max-w-none md:grid-cols-5">
                {STATES.filter((s) => s !== "ALL").map((s) => {
                  const meta = STATE_META[s]
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setActiveState(s)
                        setSelectedSeatId(null)
                        onChangeGlobalStateFilter(s)
                      }}
                      className="group flex flex-col items-start gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-3 text-left shadow-sm transition-colors hover:border-[color:var(--border-strong)] hover:bg-[var(--surface-2)] md:py-3.5"
                    >
                      <span className="text-[13px] font-semibold tracking-[-0.005em] text-[var(--text-primary)]">{meta?.abbr || s}</span>
                      <span className="text-[12px] text-[var(--text-secondary)]">{s}</span>
                      <span className="text-[11px] font-mono tabular-nums text-[var(--text-muted)]">
                        {meta?.seats ? `${meta.seats} seats` : "—"}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </section>
        ) : null}
        {activeState !== "ALL" ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 shadow-sm">
            <p className="text-[13px] leading-[1.5] text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">{activeState}</span>
              {STATE_META[activeState]?.seats ? <span className="text-[var(--text-muted)]"> · {STATE_META[activeState]!.seats} Assembly seats (2021)</span> : null}
              {seatShare?.counts?.[0] ? (
                <>
                  <span className="text-[var(--text-muted)]"> · Top party in 2021: </span>
                  <span className="font-medium text-[var(--text-primary)]">{seatShare.counts[0].key}</span>
                  <span className="text-[var(--text-muted)]"> ({seatShare.counts[0].count} of {seatShare.total} seats)</span>
                </>
              ) : null}
              {kpis.seats > 0 && competitiveSeats?.length != null ? (
                <>
                  <span className="text-[var(--text-muted)]"> · </span>
                  <span className="font-medium text-[var(--text-primary)]">{competitiveSeats.filter((s) => s.margin_votes != null && s.margin_votes <= 5000).length}</span>
                  <span className="text-[var(--text-muted)]"> tight seats (margin &lt; 5,000)</span>
                </>
              ) : null}
            </p>
            <div className="mt-3 flex items-center divide-x divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] sm:hidden">
              <div className="flex-1 px-2 py-2 text-center">
                <div className="num font-mono tabular-nums text-[18px] font-bold text-[var(--text-primary)]">{kpis.seats}</div>
                <div className="font-mono text-[9px] text-[var(--text-muted)] uppercase tracking-wide">Seats</div>
              </div>
              <div className="flex-1 px-2 py-2 text-center">
                <div className="num font-mono tabular-nums text-[18px] font-bold text-[var(--text-primary)]">{kpis.cands}</div>
                <div className="font-mono text-[9px] text-[var(--text-muted)] uppercase tracking-wide">Cands</div>
              </div>
              <div className="flex-1 px-2 py-2 text-center">
                <div className="num font-mono tabular-nums text-[18px] font-bold text-[var(--text-primary)]">{kpis.crim}</div>
                <div className="font-mono text-[9px] text-[var(--text-muted)] uppercase tracking-wide">Cases</div>
              </div>
              <div className="flex-1 px-2 py-2 text-center">
                <div className="num font-mono tabular-nums text-[16px] font-bold text-[var(--text-primary)]">
                  {assetsDb?.median != null ? `₹${(Number(assetsDb.median) / 1e7).toFixed(Number(assetsDb.median) < 1e8 ? 1 : 0)}Cr` : "—"}
                </div>
                <div className="font-mono text-[9px] text-[var(--text-muted)] uppercase tracking-wide">Med. assets</div>
              </div>
            </div>
            <div className="mt-3 hidden sm:grid grid-cols-4 gap-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
              <div className="border-r border-[var(--border)] px-4 py-3">
                <div className="text-[11px] font-medium text-[var(--text-muted)]">Seats</div>
                <div className="mt-1 num font-mono tabular-nums text-[20px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">{kpis.seats}</div>
              </div>
              <div className="border-r border-[var(--border)] px-4 py-3">
                <div className="text-[11px] font-medium text-[var(--text-muted)]">Candidates</div>
                <div className="mt-1 num font-mono tabular-nums text-[20px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">{kpis.cands}</div>
              </div>
              <div className="border-r border-[var(--border)] px-4 py-3">
                <div className="text-[11px] font-medium text-[var(--text-muted)]">
                  With declared cases
                  {kpis.cands > 0 ? (
                    <span className="ml-1 text-[var(--text-muted)]">· {Math.round((Number(kpis.crim) / Number(kpis.cands)) * 100)}% of cands</span>
                  ) : null}
                </div>
                <div className="mt-1 num font-mono tabular-nums text-[20px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">{kpis.crim}</div>
              </div>
              <div className="px-4 py-3">
                <div className="text-[11px] font-medium text-[var(--text-muted)]">Median assets · {assetsDb?.coveragePct != null ? `${assetsDb.coveragePct}% cov` : "—"}</div>
                <div className="mt-1 num font-mono tabular-nums text-[20px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
                  {assetsDb?.median != null ? `₹${(Number(assetsDb.median) / 1e7).toFixed(Number(assetsDb.median) < 1e8 ? 1 : 0)}Cr` : "—"}
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {activeState !== "ALL" ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Coverage</span>
              <span>Party <span className="text-[var(--text-secondary)]">{kpis.coverage.party}</span></span>
              <span>Age <span className="text-[var(--text-secondary)]">{kpis.coverage.age}</span></span>
              <span>Gender <span className="text-[var(--text-secondary)]">{kpis.coverage.gender}</span></span>
              <span>Assets <span className="text-[var(--text-secondary)]">{kpis.coverage.assets}</span></span>
              <span>Cases <span className="text-[var(--text-secondary)]">{kpis.coverage.criminal_field}</span></span>
              <span className="ml-auto">Scope · {activeState}</span>
            </div>
          </div>
        ) : null}

        {activeState === "ALL" && allGlobalMetrics ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-2.5 text-center shadow-sm">
              <div className="font-mono text-[10px] font-bold text-[var(--text-secondary)]">
                {allGlobalMetrics.totalElectors != null ? Number(allGlobalMetrics.totalElectors).toLocaleString("en-IN") : "—"}
              </div>
              <div className="font-mono text-[8px] text-[var(--text-muted)]">TOTAL ELECTORS (2021)</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-2.5 text-center shadow-sm">
              <div className="font-mono text-[10px] font-bold text-[var(--text-secondary)]">
                {allGlobalMetrics.totalVotesPolled != null ? Number(allGlobalMetrics.totalVotesPolled).toLocaleString("en-IN") : "—"}
              </div>
              <div className="font-mono text-[8px] text-[var(--text-muted)]">VOTES POLLED (2021)</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-2.5 text-center shadow-sm">
              <div className="font-mono text-[10px] font-bold text-[var(--text-secondary)]">
                {allGlobalMetrics.turnoutWeighted != null ? `${Number(allGlobalMetrics.turnoutWeighted).toFixed(2)}%` : "—"}
              </div>
              <div className="font-mono text-[8px] text-[var(--text-muted)]">WEIGHTED TURNOUT (2021)</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-2.5 text-center shadow-sm">
              <div className="font-mono text-[10px] font-bold text-[var(--text-secondary)]">
                {allGlobalMetrics.closestMargin != null ? Number(allGlobalMetrics.closestMargin).toLocaleString("en-IN") : "—"}
              </div>
              <div className="font-mono text-[8px] text-[var(--text-muted)]">CLOSEST MARGIN (2021)</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-2.5 text-center shadow-sm">
              <div className="font-mono text-[10px] font-bold text-[var(--text-secondary)]">
                {Number(allGlobalMetrics.closeSeats5k || 0).toLocaleString("en-IN")}
              </div>
              <div className="font-mono text-[8px] text-[var(--text-muted)]">SEATS ≤ 5K MARGIN</div>
            </div>
          </div>
        ) : null}

        {activeState === "ALL" && allSeatShares ? (
          (() => {
            const loadedStates = STATES.filter((s) => s !== "ALL" && allSeatShares[s]?.total)
            if (!loadedStates.length) return null
            return (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
                {loadedStates.map((s) => {
                  const ss = allSeatShares[s]!
                  const SeatShareViz = ss.total < 80 ? SeatShareBar : SeatShareArc
                  return (
                    <SeatShareViz
                      key={s}
                      totalSeats={ss.total}
                      counts={ss.counts}
                      title={`SEAT SHARE (2021) · ${STATE_META[s]?.abbr || s}`}
                      colorMode={seatShareMode}
                    />
                  )
                })}
              </div>
            )
          })()
        ) : null}

        {activeState === "ALL" && allViewExtras ? (
          <MobileCollapsible title="More state comparisons (2021)">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 shadow-sm">
              <div className="eb-eyebrow">CRIMINAL SHARE BY STATE</div>
              <p className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">
                Uses DB head-counts (fast). Declared criminal cases &gt; 0 among candidate filings.
              </p>
              <div className="mt-2 space-y-1.5">
                {allViewExtras.map((r) => (
                  <MiniBar key={r.state} label={STATE_META[r.state]?.abbr || r.state} value={r.rate} max={100} color="#dc2626" />
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 shadow-sm">
              <div className="eb-eyebrow">TOP ASSETS CANDIDATE BY STATE</div>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">Highest declared assets among filed candidates. Candidates with zero or undeclared values are excluded.</p>
              <div className="mt-2 space-y-1.5">
                {(topAssetsByState || []).length ? (
                  (() => {
                    const maxV = Math.max(...(topAssetsByState || []).map((r) => r.assets_value || 0), 1)
                    return (topAssetsByState || []).slice(0, 10).map((r) => (
                      <MiniBar
                        key={r.state}
                        label={STATE_META[r.state]?.abbr || r.state}
                        value={Math.round((r.assets_value / maxV) * 100)}
                        max={100}
                        color="#ea580c"
                      />
                    ))
                  })()
                ) : (
                  <div className="py-6 text-center font-mono text-[10px] text-[var(--text-muted)]">No assets data loaded.</div>
                )}
              </div>
              {(topAssetsByState || []).length ? (
                <div className="mt-2 overflow-hidden rounded border border-[var(--border)]">
                  <div className="max-h-[220px] overflow-auto">
                    {(topAssetsByState || []).slice(0, 10).map((r) => (
                      <div key={`${r.state}-${r.name}`} className="grid grid-cols-12 gap-0 border-t border-[var(--border)] px-2 py-1.5">
                        <div className="col-span-3 font-mono text-[9px] font-bold text-[var(--text-secondary)]">{STATE_META[r.state]?.abbr || r.state}</div>
                        <div className="col-span-6 min-w-0 font-mono text-[9px] text-[var(--text-muted)] truncate">
                          {r.name}{r.party ? ` · ${r.party}` : ""}
                        </div>
                        <div className="col-span-3 text-right font-mono text-[9px] font-bold text-[var(--text-secondary)]">
                          ₹{(Number(r.assets_value) / 1e7).toFixed(Number(r.assets_value) < 1e8 ? 1 : 0)}Cr
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 shadow-sm">
              <div className="eb-eyebrow">CLOSEST SEATS (2021)</div>
              <p className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">
                Where margins were thinnest — most likely to swing next election.
              </p>
              <div className="mt-2 overflow-hidden rounded border border-[var(--border)]">
                <div className="max-h-[220px] overflow-auto">
                  {(() => {
                    const constById = new Map(constituencies.map((c: any) => [String(c.id), c]))
                    const rows: any[] = []
                    for (const st of STATES.filter((s) => s !== "ALL")) {
                      const rs = (allResults2021?.[st] || []) as any[]
                      for (const x of rs) if (x?.margin_votes != null) {
                        const c = constById.get(String(x.constituency_id))
                        rows.push({ state: st, id: x.constituency_id, name: c?.name || null, margin: Number(x.margin_votes) })
                      }
                    }
                    rows.sort((a, b) => a.margin - b.margin)
                    if (!rows.length) return <div className="py-4 text-center font-mono text-[10px] text-[var(--text-muted)]">No result data loaded yet.</div>
                    return rows.slice(0, 20).map((r) => (
                      <button
                        key={`${r.state}-${r.id}`}
                        type="button"
                        onClick={() => onSelectConstituency(String(r.id))}
                        className="flex w-full items-center justify-between gap-2 border-t border-[var(--border)] px-2 py-1.5 text-left hover:bg-[var(--surface-2)]"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-[11px] font-semibold text-[var(--text-primary)] truncate">{r.name ?? String(r.id)}</div>
                          <div className="mt-0.5 font-mono text-[9px] text-[var(--text-muted)]">{r.state}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-[11px] font-bold text-[var(--text-secondary)]">{Number(r.margin).toLocaleString("en-IN")}</div>
                          <div className="font-mono text-[8px] text-[var(--text-muted)]">votes</div>
                        </div>
                      </button>
                    ))
                  })()}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 shadow-sm">
              <div className="eb-eyebrow">TIGHT SEATS BY STATE (2021)</div>
              <p className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">
                Seats where the 2021 margin was under 5,000 votes. More tight seats = more volatile state.
              </p>
              <div className="mt-2 space-y-1.5">
                {(() => {
                  const counts = STATES.filter((s) => s !== "ALL").map((s) => {
                    const rs = (allResults2021?.[s] || []) as any[]
                    const tight = rs.filter((x: any) => x?.margin_votes != null && Number(x.margin_votes) <= 5000).length
                    return { state: s, tight, total: rs.length }
                  }).filter((r) => r.total > 0).sort((a, b) => b.tight - a.tight)
                  const maxTight = Math.max(...counts.map((r) => r.tight), 1)
                  return counts.map((r) => (
                    <MiniBar key={r.state} label={STATE_META[r.state]?.abbr || r.state} value={r.tight} max={maxTight} color="#f59e0b" suffix={` / ${r.total} seats`} />
                  ))
                })()}
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
              <div className="eb-eyebrow">WINNING PARTY AVG TURNOUT (2021)</div>
              <p className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">
                Average turnout % in seats won by each party (min 3 wins, cross-state).
              </p>
              <div className="mt-2 overflow-hidden rounded border border-[var(--border)]">
                <div className="max-h-[200px] overflow-auto">
                  {(() => {
                    const partyTurnout = new Map<string, number[]>()
                    for (const st of STATES.filter((s) => s !== "ALL")) {
                      for (const r of (allResults2021?.[st] || []) as any[]) {
                        if (!r?.winner_party || r.turnout_pct == null) continue
                        const p = String(r.winner_party).toUpperCase()
                        if (!partyTurnout.has(p)) partyTurnout.set(p, [])
                        partyTurnout.get(p)!.push(Number(r.turnout_pct))
                      }
                    }
                    const rows = Array.from(partyTurnout.entries())
                      .map(([party, vals]) => ({ party, avg: vals.reduce((a, b) => a + b, 0) / vals.length, seats: vals.length }))
                      .filter((r) => r.seats >= 3)
                      .sort((a, b) => b.avg - a.avg)
                      .slice(0, 12)
                    if (!rows.length) return <div className="py-4 text-center font-mono text-[10px] text-[var(--text-muted)]">No result data loaded yet.</div>
                    return rows.map((r) => (
                      <div key={r.party} className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-2 py-1.5">
                        <div className="min-w-0 font-mono text-[9px] font-bold text-[var(--text-secondary)] truncate">{r.party}</div>
                        <div className="shrink-0 font-mono text-[9px] text-[var(--text-muted)]">{r.seats}w</div>
                        <div className="shrink-0 font-mono text-[9px] font-bold text-[var(--text-secondary)]">{r.avg.toFixed(1)}%</div>
                      </div>
                    ))
                  })()}
                </div>
              </div>
              
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 shadow-sm">
            <div className="eb-eyebrow">
              CANDIDATE AGE GROUPS (coverage-sensitive)
            </div>
            <div className="mt-2 space-y-1.5">
              {ageBuckets.map((r) => (
                <MiniBar key={r.bucket} label={r.bucket} value={r.count} max={maxAge} color="#16a34a" showPct total={ageBuckets.reduce((a,b)=>a+b.count,0)} />
              ))}
            </div>
          </div>
          </div>
          </MobileCollapsible>
        ) : null}

        {activeState !== "ALL" ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {selectedSeatId && seatResult ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
                <div className="eb-eyebrow">SEAT SNAPSHOT (2021)</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                    <div className="font-mono text-[8px] text-[var(--text-muted)]">MARGIN</div>
                    <div className="mt-0.5 font-mono text-[11px] font-bold text-[var(--text-secondary)]">
                      {seatResult.margin_votes != null ? Number(seatResult.margin_votes).toLocaleString("en-IN") : "—"}
                    </div>
                  </div>
                  <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                    <div className="font-mono text-[8px] text-[var(--text-muted)]">TURNOUT</div>
                    <div className="mt-0.5 font-mono text-[11px] font-bold text-[var(--text-secondary)]">
                      {seatResult.turnout_pct != null ? `${Number(seatResult.turnout_pct).toFixed(1)}%` : "—"}
                    </div>
                  </div>
                  <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                    <div className="font-mono text-[8px] text-[var(--text-muted)]">ELECTORS</div>
                    <div className="mt-0.5 font-mono text-[11px] font-bold text-[var(--text-secondary)]">
                      {seatResult.total_electors != null ? Number(seatResult.total_electors).toLocaleString("en-IN") : "—"}
                    </div>
                  </div>
                  <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                    <div className="font-mono text-[8px] text-[var(--text-muted)]">TURNOUT vs STATE AVG</div>
                    <div className="mt-0.5 font-mono text-[11px] font-bold text-[var(--text-secondary)]">
                      {seatResult.turnout_pct != null && stateTurnoutAvg2021 != null
                        ? `${(Number(seatResult.turnout_pct) - Number(stateTurnoutAvg2021)).toFixed(1)} pts`
                        : "—"}
                    </div>
                  </div>
                  <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                    <div className="font-mono text-[8px] text-[var(--text-muted)]">WINNER SHARE</div>
                    <div className="mt-0.5 font-mono text-[11px] font-bold text-[var(--text-secondary)]">
                      {seatResult.winner_votes != null && seatResult.total_votes_polled != null && Number(seatResult.total_votes_polled) > 0
                        ? `${Math.round((Number(seatResult.winner_votes) / Number(seatResult.total_votes_polled)) * 100)}%`
                        : "—"}
                    </div>
                  </div>
                  <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                    <div className="font-mono text-[8px] text-[var(--text-muted)]">MARGIN % (of polled)</div>
                    <div className="mt-0.5 font-mono text-[11px] font-bold text-[var(--text-secondary)]">
                      {seatResult.margin_votes != null && seatResult.total_votes_polled != null && Number(seatResult.total_votes_polled) > 0
                        ? `${((Number(seatResult.margin_votes) / Number(seatResult.total_votes_polled)) * 100).toFixed(1)}%`
                        : "—"}
                    </div>
                  </div>
                </div>
                <div className="mt-2 font-mono text-[9px] text-[var(--text-muted)]">
                  Margin rank (state):{" "}
                  <span className="font-bold text-[var(--text-secondary)]">{selectedSeatCompetitiveness ? `#${selectedSeatCompetitiveness.rank}/${selectedSeatCompetitiveness.n}` : "—"}</span>
                </div>

                <div className="mt-3 rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                  <div className="eb-eyebrow">CONSTITUENCY INSIGHTS</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded border border-[var(--border)] bg-[var(--surface-1)] p-2">
                      <div className="font-mono text-[8px] text-[var(--text-muted)]">WEALTH CONCENTRATION</div>
                      <div className="mt-0.5 font-mono text-[11px] font-bold text-[var(--text-secondary)]">
                        {seatTopAsset?.assets_value && assetsDb?.median
                          ? `${(Number(seatTopAsset.assets_value) / Number(assetsDb.median)).toFixed(1)}×`
                          : "—"}
                      </div>
                      <div className="mt-0.5 font-mono text-[9px] text-[var(--text-muted)] truncate">
                        {seatTopAsset?.assets_value
                          ? `Top ₹${(Number(seatTopAsset.assets_value) / 1e7).toFixed(Number(seatTopAsset.assets_value) < 1e8 ? 1 : 0)}Cr · median ${
                              assetsDb?.median != null ? `₹${(Number(assetsDb.median) / 1e7).toFixed(Number(assetsDb.median) < 1e8 ? 1 : 0)}Cr` : "—"
                            }`
                          : "no assets data"}
                      </div>
                    </div>

                    <div className="rounded border border-[var(--border)] bg-[var(--surface-1)] p-2">
                      <div className="font-mono text-[8px] text-[var(--text-muted)]">CRIMINAL + CLOSENESS</div>
                      <div className="mt-0.5 font-mono text-[11px] font-bold text-[var(--text-secondary)]">
                        {filteredCandidates.length ? `${Math.round((kpis.crim / Math.max(filteredCandidates.length, 1)) * 100)}%` : "—"}
                      </div>
                      <div className="mt-0.5 font-mono text-[9px] text-[var(--text-muted)] truncate">
                        {selectedSeatCompetitiveness
                          ? `criminal share · margin rank #${selectedSeatCompetitiveness.rank}/${selectedSeatCompetitiveness.n}`
                          : "criminal share · margin rank —"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : seatShare?.total ? (
              (() => {
                const SeatShareViz = seatShare.total < 80 ? SeatShareBar : SeatShareArc
                return (
                  <SeatShareViz
                    totalSeats={seatShare.total}
                    counts={seatShare.counts}
                    title={`SEAT SHARE (2021 winners) · ${seatShareMode === "ALLIANCE" ? "ALLIANCE" : "PARTY"}`}
                    colorMode={seatShareMode}
                  />
                )
              })()
            ) : (
              <div className="flex h-[170px] flex-col items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 text-center">
                <div className="eb-eyebrow">SEAT SHARE (2021)</div>
                <div className="mt-2 font-mono text-[10px] text-[var(--text-muted)]">No results loaded.</div>
              </div>
            )}

            <div className={`grid grid-cols-1 gap-3 ${selectedSeatId ? "md:grid-cols-2" : ""}`}>
              {selectedSeatId ? (
                <MiniSeatMap
                  state={activeState}
                  lat={(() => {
                    const v = selectedSeat?.latitude
                    return typeof v === "number" ? v : null
                  })()}
                  lng={(() => {
                    const v = selectedSeat?.longitude
                    return typeof v === "number" ? v : null
                  })()}
                  title={selectedSeat?.name || null}
                  subtitle={
                    selectedSeat
                      ? `${String(selectedSeat.district || "").trim() ? `${selectedSeat.district} · ` : ""}${selectedSeat.reservation ? `Res ${selectedSeat.reservation} · ` : ""}${selectedSeat.phase ? `Phase ${selectedSeat.phase}` : ""}`.trim()
                      : null
                  }
                />
              ) : null}

              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
                <div className="flex items-center gap-2 border-b border-[var(--border)] px-2 py-1.5">
                  <div className="font-mono text-[9px] font-bold tracking-wider text-[#0ea5e9]">Electors · Gender (2021)</div>
                  <div className="ml-auto font-mono text-[9px] text-[var(--text-muted)]">
                    {selectedSeatId && seatElectorsSummary ? "seat-level" : "state-level"}
                  </div>
                </div>
                <div className="p-2">
                  {selectedSeatId && seatElectorsSummary ? (
                    <div className="overflow-hidden rounded border border-[var(--border)] bg-[var(--surface-2)]">
                      <div className="grid grid-cols-12 gap-0 border-b border-[var(--border)] px-2 py-1 font-mono text-[9px] text-[var(--text-muted)]">
                        <div className="col-span-3">Block</div>
                        <div className="col-span-3 text-right">Male</div>
                        <div className="col-span-3 text-right">Female</div>
                        <div className="col-span-3 text-right">Third</div>
                      </div>
                      {[
                        {
                          k: "ELECTORS",
                          male: seatElectorsSummary.electors_male,
                          female: seatElectorsSummary.electors_female,
                          third: seatElectorsSummary.electors_third,
                          total: seatElectorsSummary.electors_total,
                        },
                        {
                          k: "VOTERS",
                          male: seatElectorsSummary.voters_male,
                          female: seatElectorsSummary.voters_female,
                          third: seatElectorsSummary.voters_third,
                          total: seatElectorsSummary.voters_total,
                        },
                      ].map((r) => (
                        <div key={r.k} className="grid grid-cols-12 gap-0 border-b border-[var(--border)] px-2 py-1.5 font-mono text-[10px]">
                          <div className="col-span-3 font-bold text-[var(--text-secondary)]">{r.k}</div>
                          <div className="col-span-3 text-right text-[var(--text-secondary)]">
                            {r.male != null ? Number(r.male).toLocaleString("en-IN") : "—"}
                          </div>
                          <div className="col-span-3 text-right text-[var(--text-secondary)]">
                            {r.female != null ? Number(r.female).toLocaleString("en-IN") : "—"}
                          </div>
                          <div className="col-span-3 text-right text-[var(--text-secondary)]">
                            {r.third != null ? Number(r.third).toLocaleString("en-IN") : "—"}
                          </div>
                        </div>
                      ))}
                      <div className="grid grid-cols-12 gap-0 px-2 py-1.5 font-mono text-[10px]">
                        <div className="col-span-6 text-[var(--text-muted)]">
                          Poll %:{" "}
                          <span className="font-bold text-[var(--text-secondary)]">
                            {seatElectorsSummary.poll_pct != null ? `${Number(seatElectorsSummary.poll_pct).toFixed(2)}%` : "—"}
                          </span>
                        </div>
                        <div className="col-span-6 text-right text-[var(--text-muted)] truncate">
                          {String(seatElectorsSummary.source_note || "")}
                        </div>
                      </div>
                    </div>
                  ) : selectedSeatId ? (
                    <div className="rounded border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-3 font-sans text-[12px] leading-relaxed text-[var(--text-muted)] md:font-mono md:text-[10px]">
                      We’re still verifying 2021 elector gender numbers for this seat.
                      {SHOW_DEV_HINTS ? (
                        <div className="mt-1">
                          Add more constituency summary CSV “index cards” into <span className="font-bold text-[var(--text-secondary)]">osint_workers/historical_data</span> and rerun{" "}
                          <span className="font-bold text-[var(--text-secondary)]">python osint_workers/eci_constituency_summary_ingestor.py --year 2021</span>.
                        </div>
                      ) : null}
                    </div>
                  ) : Array.isArray(stateElectorsSummary) && stateElectorsSummary.length ? (
                    <div className="overflow-hidden rounded border border-[var(--border)] bg-[var(--surface-2)]">
                      <div className="grid grid-cols-12 gap-0 border-b border-[var(--border)] px-2 py-1 font-mono text-[9px] text-[var(--text-muted)]">
                        <div className="col-span-3">Type</div>
                        <div className="col-span-3 text-right">Male</div>
                        <div className="col-span-3 text-right">Female</div>
                        <div className="col-span-3 text-right">Third</div>
                      </div>
                      {["TOTAL", "GEN", "SC", "ST"].map((t) => {
                        const r = stateElectorsSummary.find((x: any) => String(x.constituency_type || "").toUpperCase() === t) || null
                        const male = r?.electors_male != null ? Number(r.electors_male).toLocaleString("en-IN") : "—"
                        const female = r?.electors_female != null ? Number(r.electors_female).toLocaleString("en-IN") : "—"
                        const third = r?.electors_third != null ? Number(r.electors_third).toLocaleString("en-IN") : "—"
                        return (
                          <div key={t} className="grid grid-cols-12 gap-0 border-b border-[var(--border)] px-2 py-1.5 font-mono text-[10px]">
                            <div className="col-span-3 font-bold text-[var(--text-secondary)]">{t}</div>
                            <div className="col-span-3 text-right text-[var(--text-secondary)]">{male}</div>
                            <div className="col-span-3 text-right text-[var(--text-secondary)]">{female}</div>
                            <div className="col-span-3 text-right text-[var(--text-secondary)]">{third}</div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="rounded border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-3 font-sans text-[12px] leading-relaxed text-[var(--text-muted)] md:font-mono md:text-[10px]">
                      {SHOW_DEV_HINTS
                        ? "No elector gender summary loaded yet. Run `python eci_electors_summary_ingestor.py` (state-level) and `python eci_constituency_summary_ingestor.py` (seat-level)."
                        : "Elector gender numbers are being verified for this state."}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {selectedSeatId && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-mono text-[10px] font-bold tracking-wider text-[#0ea5e9]">
                  CONSTITUENCY BREAKDOWN (2021)
                </div>
                <div className="mt-1 font-mono text-[11px] text-[var(--text-secondary)] truncate">
                  {constituencies.find((c: any) => String(c.id) === String(selectedSeatId))?.name || selectedSeatId}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelectConstituency(selectedSeatId)}
                  className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-1 font-mono text-[9px] font-bold text-[#0ea5e9] hover:bg-sky-500/15"
                >
                  OPEN IN INTEL
                </button>
              </div>
            </div>

            {seatResult?.winner_name ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                  <div className="font-mono text-[9px] text-[var(--text-muted)]">Incumbent (winner)</div>
                  <div className="mt-1 flex items-center gap-2">
                    {selectedSeatWinnerCand?.photo_url ? (
                      <img
                        src={String(selectedSeatWinnerCand.photo_url)}
                        alt={String(seatResult.winner_name || "Winner")}
                        className="h-8 w-8 rounded border border-[var(--border)] object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded border border-[var(--border)] bg-[var(--surface-1)]" />
                    )}
                    <div className="min-w-0 flex-1">
                      {inSeatWinnerCand?.id ? (
                        <button
                          type="button"
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent("openCandidateDossier", { detail: { candidateId: String(inSeatWinnerCand.id) } }))
                          }}
                          className="w-full text-left font-mono text-[11px] font-bold text-[#0ea5e9] hover:text-[#0ea5e9]/80 truncate"
                          title="Open 2026 dossier for this candidate"
                        >
                          {seatResult.winner_name}
                        </button>
                      ) : (
                        <div className="w-full font-mono text-[11px] font-bold text-[var(--text-secondary)] truncate">
                          {seatResult.winner_name}
                        </div>
                      )}
                      <div className="mt-0.5 font-mono text-[9px] text-[var(--text-muted)] truncate">
                        {(seatResult.winner_party || "—") + (seatResult.winner_votes != null ? ` · ${Number(seatResult.winner_votes).toLocaleString("en-IN")} votes` : "")}
                      </div>
                    </div>
                  </div>
                  {movedWinner ? (
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-mono text-[9px] text-[var(--text-muted)]">
                        Now contesting:{" "}
                        <span className="font-bold text-[var(--text-secondary)]">
                          {constNameById.get(String(movedWinner.constituency_id)) || movedWinner.constituency_id}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent("openCandidateDossier", { detail: { candidateId: String(movedWinner.id) } }))
                        }}
                        className="shrink-0 rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#0ea5e9] hover:bg-sky-500/15"
                      >
                        Open 2026 profile
                      </button>
                    </div>
                  ) : null}
                  <div className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">
                    {seatResult.total_electors != null ? `Electors (2021): ${Number(seatResult.total_electors).toLocaleString("en-IN")}` : null}
                  </div>
                </div>
                <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                  <div className="font-mono text-[9px] text-[var(--text-muted)]">Runner-up</div>
                  <div className="mt-1 flex items-center gap-2">
                    {selectedSeatRunnerCand?.photo_url ? (
                      <img
                        src={String(selectedSeatRunnerCand.photo_url)}
                        alt={String(seatResult.runner_up_name || "Runner-up")}
                        className="h-8 w-8 rounded border border-[var(--border)] object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded border border-[var(--border)] bg-[var(--surface-1)]" />
                    )}
                    <div className="min-w-0 flex-1">
                      {inSeatRunnerCand?.id ? (
                        <button
                          type="button"
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent("openCandidateDossier", { detail: { candidateId: String(inSeatRunnerCand.id) } }))
                          }}
                          className="w-full text-left font-mono text-[11px] font-bold text-[#0ea5e9] hover:text-[#0ea5e9]/80 truncate"
                          title="Open 2026 dossier for this candidate"
                        >
                          {seatResult.runner_up_name || "—"}
                        </button>
                      ) : (
                        <div className="w-full font-mono text-[11px] font-bold text-[var(--text-secondary)] truncate">
                          {seatResult.runner_up_name || "—"}
                        </div>
                      )}
                      <div className="mt-0.5 font-mono text-[9px] text-[var(--text-muted)] truncate">
                        {(seatResult.runner_up_party || "—") + (seatResult.runner_up_votes != null ? ` · ${Number(seatResult.runner_up_votes).toLocaleString("en-IN")} votes` : "")}
                      </div>
                    </div>
                  </div>
                  {movedRunner ? (
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-mono text-[9px] text-[var(--text-muted)]">
                        Now contesting:{" "}
                        <span className="font-bold text-[var(--text-secondary)]">
                          {constNameById.get(String(movedRunner.constituency_id)) || movedRunner.constituency_id}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent("openCandidateDossier", { detail: { candidateId: String(movedRunner.id) } }))
                        }}
                        className="shrink-0 rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#0ea5e9] hover:bg-sky-500/15"
                      >
                        Open 2026 profile
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="col-span-2 rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-mono text-[9px] text-[var(--text-muted)]">Margin (votes)</div>
                      <div className="mt-0.5 font-mono text-[11px] font-bold text-[var(--text-secondary)]">
                        {seatResult.margin_votes != null ? Number(seatResult.margin_votes).toLocaleString("en-IN") : "—"}
                      </div>
                    </div>
                    {seatResult.total_votes_polled != null ? (
                      <div>
                        <div className="font-mono text-[9px] text-[var(--text-muted)]">Votes polled</div>
                        <div className="mt-0.5 font-mono text-[11px] font-bold text-[var(--text-secondary)]">
                          {Number(seatResult.total_votes_polled).toLocaleString("en-IN")}
                        </div>
                      </div>
                    ) : null}
                    {seatResult.turnout_pct != null ? (
                      <div>
                        <div className="font-mono text-[9px] text-[var(--text-muted)]">Turnout</div>
                        <div className="mt-0.5 font-mono text-[11px] font-bold text-[var(--text-secondary)]">
                          {Number(seatResult.turnout_pct).toFixed(1)}%
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                {seatResult.source_url ? (
                  <a
                    href={seatResult.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="col-span-2 mt-1 inline-flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[9px] font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-3)]"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Source
                  </a>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 rounded border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-3 text-center font-sans text-[12px] leading-relaxed text-[var(--text-muted)] md:font-mono md:text-[10px]">
                {SHOW_DEV_HINTS
                  ? "No 2021 result ingested for this seat yet. Run `history_ingestor_2021.py` and ensure `constituency_results` exists."
                  : "We’re still verifying 2021 results for this seat."}
              </div>
            )}
          </div>
        )}

        {activeState !== "ALL" && !selectedSeatId ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="eb-eyebrow">COMPETITIVE SEATS (closest margins, 2021)</div>
                <div className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">
                  This is the highest-signal “where to look” list you can build from historical results.
                </div>
              </div>
              <div className="font-mono text-[9px] text-[var(--text-muted)]">{competitiveSeats.length ? "top 20" : "—"}</div>
            </div>
            {competitiveSeats.length ? (
              <div className="mt-2 overflow-hidden rounded border border-[var(--border)]">
                <div className="grid grid-cols-12 gap-0 bg-[var(--surface-2)] px-2 py-1 font-mono text-[9px] text-[var(--text-muted)]">
                  <div className="col-span-7">Seat</div>
                  <div className="col-span-3 text-right">Margin</div>
                  <div className="col-span-2 text-right">Turnout</div>
                </div>
                <div className="max-h-[260px] overflow-auto">
                  {competitiveSeats.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onSelectConstituency(r.id)}
                      className="grid w-full grid-cols-12 gap-0 border-t border-[var(--border)] px-2 py-1.5 text-left hover:bg-[var(--surface-2)]"
                    >
                      <div className="col-span-7 min-w-0">
                        <div className="truncate font-mono text-[10px] font-bold text-[var(--text-secondary)]">{r.name}</div>
                        <div className="mt-0.5 truncate font-mono text-[8px] text-[var(--text-muted)]">{r.winner_party ? `Winner: ${r.winner_party}` : ""}</div>
                      </div>
                      <div className="col-span-3 text-right font-mono text-[10px] font-bold text-[var(--text-secondary)]">
                        {r.margin_votes != null ? Number(r.margin_votes).toLocaleString("en-IN") : "—"}
                      </div>
                      <div className="col-span-2 text-right font-mono text-[10px] text-[var(--text-muted)]">
                        {r.turnout_pct != null ? `${Number(r.turnout_pct).toFixed(1)}%` : "—"}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-2 rounded border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-3 text-center font-mono text-[10px] text-[var(--text-muted)]">
                No 2021 margin data loaded for this state.
              </div>
            )}
          </div>
        ) : null}

        {activeState !== "ALL" && !selectedSeatId ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="eb-eyebrow">TOP RICHEST CANDIDATES (assets)</div>
                <div className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">From DB filings. Best-effort; excludes zeros.</div>
              </div>
              <div className="font-mono text-[9px] text-[var(--text-muted)]">{stateTopAssets?.length ? "top 10" : "—"}</div>
            </div>
            {stateTopAssets?.length ? (
              <div className="mt-2 overflow-hidden rounded border border-[var(--border)]">
                <div className="max-h-[260px] overflow-auto">
                  {stateTopAssets.map((r, idx) => (
                    <div key={r.id} className="grid grid-cols-12 gap-0 border-t border-[var(--border)] px-2 py-1.5">
                      <div className="col-span-1 font-mono text-[9px] text-[var(--text-muted)]">{idx + 1}</div>
                      <div className="col-span-7 min-w-0">
                        <div className="truncate font-mono text-[10px] font-bold text-[var(--text-secondary)]">{r.name}</div>
                        <div className="mt-0.5 truncate font-mono text-[8px] text-[var(--text-muted)]">
                          {r.party ? `${r.party} · ` : ""}{r.constituency_id}
                        </div>
                      </div>
                      <div className="col-span-4 text-right font-mono text-[10px] font-bold text-[var(--text-secondary)]">
                        ₹{(Number(r.assets_value) / 1e7).toFixed(Number(r.assets_value) < 1e8 ? 1 : 0)}Cr
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-2 rounded border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-3 text-center font-mono text-[10px] text-[var(--text-muted)]">
                No assets data available for this state yet.
              </div>
            )}
          </div>
        ) : null}

        {activeState === "ALL" && kpis.cands === 0 ? (
          <div className="border-b border-[var(--border)] bg-[var(--surface-1)] px-4 py-10 text-center md:px-8">
            <p className="text-[14px] font-semibold text-[var(--text-primary)]">
              {overviewCandidateHeadcount > 0 ? "Loading candidate roster…" : "No candidate filings in scope yet"}
            </p>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-[var(--text-muted)]">
              {overviewCandidateHeadcount > 0
                ? "Party, age, and gender charts use full candidate rows for every state. They fill in automatically once downloads finish (first open can take a few seconds)."
                : "Charts will populate when candidate data is available for constituencies in this workspace."}
            </p>
          </div>
        ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 shadow-sm">
            <div className="eb-eyebrow">
              Parties in our dataset · top 10
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              Number of candidate filings we hold per party, in the current scope. Not seat share.
            </p>
            <div className="mt-2 space-y-1.5">
              {candidatesByParty.length === 0 ? (
                <div className="py-6 text-center font-mono text-[10px] text-[var(--text-muted)]">No candidates loaded in scope.</div>
              ) : (
                candidatesByParty.map((r) => (
                  <MiniBar key={r.party} label={r.party} value={r.count} max={maxParty} color="#0ea5e9" showPct total={candidatesByParty.reduce((a,b)=>a+b.count,0)} />
                ))
              )}
            </div>
          </div>



          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 shadow-sm">
            <div className="eb-eyebrow">
              CANDIDATE GENDER (coverage-sensitive)
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[9px] text-[var(--text-muted)]">
              <span>coverage {kpis.coverage.gender}</span>
              <span>·</span>
              <span>
                female{" "}
                {(() => {
                  const total = genderBuckets.reduce((s, x) => s + (Number(x.count) || 0), 0)
                  const f = genderBuckets.find((x) => x.gender === "Female")?.count || 0
                  return total ? `${Math.round((f / total) * 100)}%` : "—"
                })()}
              </span>
            </div>
            <div className="mt-2 space-y-1.5">
              {genderBuckets.map((r) => (
                <MiniBar key={r.gender} label={r.gender} value={r.count} max={maxGender} color="#8b5cf6" showPct total={genderBuckets.reduce((a,b)=>a+b.count,0)} />
              ))}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                <div className="font-mono text-[9px] text-[var(--text-muted)]">Independents</div>
                <div className="mt-0.5 font-mono text-[11px] font-bold text-[var(--text-secondary)]">
                  {filteredCandidates.filter((c: any) => !!c.is_independent).length}
                </div>
                <div className="mt-0.5 font-mono text-[9px] text-[var(--text-muted)]">
                  share {fmtPct(filteredCandidates.filter((c: any) => !!c.is_independent).length, filteredCandidates.length)}
                </div>
              </div>
              <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                <div className="font-mono text-[9px] text-[var(--text-muted)]">Criminal rate</div>
                <div className="mt-0.5 font-mono text-[11px] font-bold text-[var(--text-secondary)]">{kpis.crim}</div>
                <div className="mt-0.5 font-mono text-[9px] text-[var(--text-muted)]">
                  share {fmtPct(kpis.crim, filteredCandidates.length)}
                </div>
              </div>
              <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                <div className="font-mono text-[9px] text-[var(--text-muted)]">Top assets (scope)</div>
                <div className="mt-0.5 font-mono text-[11px] font-bold text-[var(--text-secondary)]">
                  {(() => {
                    const rows = filteredCandidates
                      .map((c: any) => ({
                        name: String(c.full_name || c.name || ""),
                        party: String(c.party || ""),
                        v: Number(c.assets_value || 0),
                      }))
                      .filter((x) => x.v > 0 && Number.isFinite(x.v))
                      .sort((a, b) => b.v - a.v)
                    if (!rows.length) return "—"
                    const top = rows[0]
                    return `₹${(top.v / 1e7).toFixed(top.v < 1e8 ? 1 : 0)}Cr`
                  })()}
                </div>
                <div className="mt-0.5 font-mono text-[9px] text-[var(--text-muted)] truncate">
                  {(() => {
                    const rows = filteredCandidates
                      .map((c: any) => ({
                        name: String(c.full_name || c.name || ""),
                        party: String(c.party || ""),
                        v: Number(c.assets_value || 0),
                      }))
                      .filter((x) => x.v > 0 && Number.isFinite(x.v))
                      .sort((a, b) => b.v - a.v)
                    if (!rows.length) return "no assets data"
                    const top = rows[0]
                    return `${top.name || "—"}${top.party ? ` · ${top.party}` : ""}`
                  })()}
                </div>
              </div>
              <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                <div className="font-mono text-[9px] text-[var(--text-muted)]">Party fragmentation</div>
                <div className="mt-0.5 font-mono text-[11px] font-bold text-[var(--text-secondary)]">
                  {new Set(filteredCandidates.map((c: any) => String(c.party || "").trim()).filter(Boolean)).size}
                </div>
                <div className="mt-0.5 font-mono text-[9px] text-[var(--text-muted)]">distinct parties</div>
              </div>
            </div>
          </div>

          {!selectedSeatId && activeState !== "ALL" ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
              <div className="eb-eyebrow">
                CONSTITUENCIES
              </div>
              <p className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">
                Select a constituency to update Intel + map selection and view the 2021 breakdown.
              </p>
              <div className="mt-2 max-h-[260px] overflow-auto rounded border border-[var(--border)]">
                <div className="grid grid-cols-1 gap-1 p-2">
                  {constituencyOptions.slice(0, 80).map((c) => {
                    const active = String(c.id) === String(selectedSeatId)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedSeatId(c.id)
                          onChangeGlobalStateFilter(activeState)
                          onSelectConstituency(c.id)
                        }}
                        className={[
                          "rounded border px-2 py-1.5 text-left transition-colors",
                          active
                            ? "border-sky-500/35 bg-sky-500/10"
                            : "border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)]",
                        ].join(" ")}
                      >
                        <div className="font-mono text-[10px] font-bold text-[var(--text-secondary)] truncate">{c.name}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : selectedSeatId ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="eb-eyebrow">SEAT SUMMARY</div>
                {selectedSeat?.phase ? (
                  <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[8px] text-[var(--text-muted)]">
                    Phase {selectedSeat.phase}
                  </span>
                ) : null}
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-1.5 text-center">
                  <div className="font-mono text-[10px] font-bold text-[var(--text-secondary)]">
                    {selectedSeat?.electorate ? `${(Number(selectedSeat.electorate) / 1000).toFixed(0)}K` : ""}
                  </div>
                  <div className="font-mono text-[8px] text-[var(--text-muted)]">electors</div>
                </div>
                <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-1.5 text-center">
                  <div className="font-mono text-[10px] font-bold text-[var(--text-secondary)]">
                    {selectedSeatCandidates.length || 0}
                  </div>
                  <div className="font-mono text-[8px] text-[var(--text-muted)]">candidates</div>
                </div>
                <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-1.5 text-center">
                  <div className={`font-mono text-[10px] font-bold ${selectedSeatVoterSpread?.criminal ? "text-[#dc2626]" : "text-[#16a34a]"}`}>
                    {selectedSeatVoterSpread != null ? selectedSeatVoterSpread.criminal : ""}
                  </div>
                  <div className="font-mono text-[8px] text-[var(--text-muted)]">criminal</div>
                </div>
              </div>

              {seatResult ? (
                <div className="space-y-1">
                  <div className="font-mono text-[8px] font-bold tracking-wider text-[var(--text-muted)]">2021 WINNER</div>
                  <div className="flex items-center justify-between gap-2 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[10px] font-bold text-[var(--text-secondary)]">{seatResult.winner_name || ""}</div>
                      <div className="truncate font-mono text-[8px] text-[var(--text-muted)]">{seatResult.winner_party || ""}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-[9px] font-bold text-[var(--text-secondary)]">
                        {seatResult.margin_votes != null ? `+${Number(seatResult.margin_votes).toLocaleString("en-IN")}` : ""}
                      </div>
                      <div className="font-mono text-[8px] text-[var(--text-muted)]">margin</div>
                    </div>
                  </div>
                </div>
              ) : null}

              {selectedSeatCompetitiveness ? (
                <div>
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-[8px] font-bold tracking-wider text-[var(--text-muted)]">MARGIN RANK (2021)</div>
                    <div className="font-mono text-[8px] text-[var(--text-muted)]">#{selectedSeatCompetitiveness.rank} of {selectedSeatCompetitiveness.n}</div>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-[var(--surface-3)]">
                    <div
                      className="h-full rounded"
                      style={{ width: `${100 - selectedSeatCompetitiveness.pct}%`, backgroundColor: selectedSeatCompetitiveness.pct <= 25 ? "#dc2626" : selectedSeatCompetitiveness.pct <= 50 ? "#ea580c" : "#16a34a" }}
                    />
                  </div>
                  <div className="mt-0.5 font-mono text-[8px] text-[var(--text-muted)]">
                    {selectedSeatCompetitiveness.pct <= 25 ? "Very tight" : selectedSeatCompetitiveness.pct <= 50 ? "Competitive" : "Historically safer"}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        )}

        {/* District-level UI intentionally removed per requirement (constituency-only). */}
        </div>
      </div>
      </div>
    </div>
  )
}


