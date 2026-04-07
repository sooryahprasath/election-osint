"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps";
import { geoMercator, geoPath } from "d3-geo";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { AlertTriangle, Layers } from "lucide-react";
import { STATE_META } from "@/lib/utils/states";

const ELECTION_STATES = ["Kerala", "Assam", "Puducherry", "Tamil Nadu", "West Bengal"];

// Ensure these files exist inside public/maps/
const STATE_MAP_FILES: Record<string, string> = {
  "Kerala": "kerala.json",
  "Assam": "assam.json",
  "Puducherry": "puducherry.json",
  "Tamil Nadu": "tamilnadu.json",
  "West Bengal": "westbengal.json"
};

const STATE_CODES: Record<string, string> = {
  "Andaman and Nicobar": "AN", "Andhra Pradesh": "AP", "Arunachal Pradesh": "AR",
  "Assam": "AS", "Bihar": "BR", "Chandigarh": "CH", "Chhattisgarh": "CT",
  "Delhi": "DL", "Goa": "GA", "Gujarat": "GJ", "Haryana": "HR", "Himachal Pradesh": "HP",
  "Jammu and Kashmir": "JK", "Jharkhand": "JH", "Karnataka": "KA", "Kerala": "KL",
  "Madhya Pradesh": "MP", "Maharashtra": "MH", "Manipur": "MN", "Meghalaya": "ML",
  "Mizoram": "MZ", "Nagaland": "NL", "Orissa": "OD", "Puducherry": "PY",
  "Punjab": "PB", "Rajasthan": "RJ", "Sikkim": "SK", "Tamil Nadu": "TN",
  "Telangana": "TG", "Tripura": "TR", "Uttar Pradesh": "UP", "Uttaranchal": "UT",
  "West Bengal": "WB", "Ladakh": "LA", "Lakshadweep": "LD", "Dādra and Nagar Haveli and Damān and Diu": "DD/DN"
};

const PARTY_COLORS: Record<string, string> = {
  "BJP": "#f97316", "NDA": "#f97316", "INC": "#3b82f6", "INDIA": "#3b82f6",
  "CPIM": "#dc2626", "LDF": "#dc2626", "AITC": "#10b981", "TMC": "#10b981",
  "DMK": "#ef4444", "AIADMK": "#22c55e", "IND": "#71717a"
};

const THEME = {
  districtFill: "#f1f5f9",
  districtStroke: "#64748b",
};

/** Hex #RRGGBB + alpha suffix for SVG fill (8-digit hex). */
const withAlpha = (hex6: string, aa: string) => {
  const h = hex6.replace("#", "");
  if (h.length !== 6) return `${hex6}${aa}`;
  return `#${h}${aa}`;
};

function isValidSignalCoords(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= 6 && lat <= 38 && lng >= 67 && lng <= 98;
}

/** Prefer constituency centroid when AI coords are missing or implausibly far from the linked seat (e.g. ocean / wrong state). */
function displayCoordsForSignal(s: any, constById: Map<string, any>): { lat: number; lng: number } | null {
  const c = s.constituency_id ? constById.get(String(s.constituency_id)) : null;
  const aiOk = isValidSignalCoords(s.latitude, s.longitude);
  if (c && typeof c.latitude === "number" && typeof c.longitude === "number") {
    if (!aiOk) return { lat: c.latitude, lng: c.longitude };
    const d = Math.hypot(Number(s.latitude) - c.latitude, Number(s.longitude) - c.longitude);
    if (d > 0.65) return { lat: c.latitude, lng: c.longitude };
  }
  if (aiOk) return { lat: Number(s.latitude), lng: Number(s.longitude) };
  if (c && typeof c.latitude === "number" && typeof c.longitude === "number") {
    return { lat: c.latitude, lng: c.longitude };
  }
  return null;
}

export interface IndiaMapProps {
  flyToState?: string | null;
  activeState?: string;
  activeConstituencyId?: string | null;
  onSelectConstituency?: (id: string) => void;
  onSelectState?: (state: string) => void;
  onSelectSignal?: (signal: any) => void;
  resetTrigger?: number;
  /** Increment (from parent) to snap camera to default framing for the current state view without going national. */
  stateViewSnapTrigger?: number;
  onZoomChange?: (zoom: number) => void;
  overlayMode?: "VIDEOS" | "ALL";
  verifiedOnly?: boolean;
  onChangeOverlayMode?: (mode: "VIDEOS" | "ALL") => void;
  onToggleVerifiedOnly?: () => void;
  /** When set, clustered pins (ALL mode) with 2+ items open this instead of only the top signal. */
  onSelectSignalCluster?: (signals: any[]) => void;
  /** Hide floating map chrome on mobile when Signals/Intel sheet is open (avoids overlap). */
  mobilePane?: "signals" | "map" | "intel" | "warroom";
}

// Map Centers Dictionary for perfectly locked zooming
const getCenterCoords = (view: string): [number, number] => {
  if (view === "Kerala") return [76.2, 10.5];
  if (view === "Assam") return [92.9, 26.2];
  if (view === "Tamil Nadu") return [78.30, 10.9];
  if (view === "West Bengal") return [87.9, 24.3];
  if (view === "Puducherry") return [79.73, 11.91];
  return [83.0, 24.0]; // India
}

export default function IndiaMap({
  activeState,
  activeConstituencyId,
  onSelectConstituency,
  onSelectState,
  onSelectSignal,
  resetTrigger,
  stateViewSnapTrigger = 0,
  onZoomChange,
  overlayMode = "VIDEOS",
  verifiedOnly = false,
  onChangeOverlayMode,
  onToggleVerifiedOnly,
  onSelectSignalCluster,
  mobilePane = "map",
}: IndiaMapProps) {
  const { constituencies, signals, operationMode, liveResults } = useLiveData();

  const [currentView, setCurrentView] = useState("India");
  const [geoData, setGeoData] = useState<any>(null);
  const [tooltipContent, setTooltipContent] = useState("");
  const [mapError, setMapError] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [hoveredConst, setHoveredConst] = useState<string | null>(null);
  const [constituencyTip, setConstituencyTip] = useState<any | null>(null);
  const [mapShellOpacity, setMapShellOpacity] = useState(1);
  const [mapLayersOpen, setMapLayersOpen] = useState(false);
  const mapLayersWrapRef = useRef<HTMLDivElement>(null);
  const hideMapChrome = isMobile && mobilePane !== "map";

  const tooltipRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef({ coordinates: getCenterCoords("India") as [number, number], zoom: 1 });
  const viewTransitionRef = useRef(false);
  const skipViewLerpRef = useRef(false);
  /** ZoomableGroup fires onMoveEnd when controlled center/zoom change — ignore during programmatic moves to avoid setState loops. */
  const suppressMoveEndRef = useRef(false);
  const onZoomChangeRef = useRef<IndiaMapProps["onZoomChange"]>(undefined);

  const releaseSuppressMoveEndSoon = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        suppressMoveEndRef.current = false;
      });
    });
  };

  const [position, setPosition] = useState({ coordinates: getCenterCoords("India"), zoom: 1 });

  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

  const isVotingDay = operationMode === "VOTING_DAY";
  const isCountingDay = operationMode === "COUNTING_DAY";

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (tooltipRef.current) {
        tooltipRef.current.style.left = `${e.clientX}px`;
        tooltipRef.current.style.top = `${e.clientY}px`;
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (!mapLayersOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = mapLayersWrapRef.current;
      if (el && !el.contains(e.target as Node)) setMapLayersOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [mapLayersOpen]);

  useEffect(() => {
    if (activeState && activeState !== "ALL" && STATE_MAP_FILES[activeState]) {
      setCurrentView(activeState);
    } else {
      setCurrentView("India");
    }
  }, [activeState]);

  useEffect(() => {
    if (resetTrigger === undefined || resetTrigger < 1) return;
    skipViewLerpRef.current = true;
    suppressMoveEndRef.current = true;
    setCurrentView("India");
    const snap = { coordinates: getCenterCoords("India"), zoom: 1 };
    positionRef.current = snap;
    setPosition(snap);
    releaseSuppressMoveEndSoon();
  }, [resetTrigger]);

  useEffect(() => {
    if (stateViewSnapTrigger === undefined || stateViewSnapTrigger < 1) return;
    const view = currentView;
    if (view === "India") return;
    suppressMoveEndRef.current = true;
    const snap = { coordinates: getCenterCoords(view) as [number, number], zoom: 1 };
    positionRef.current = snap;
    setPosition(snap);
    onZoomChangeRef.current?.(1);
    releaseSuppressMoveEndSoon();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to parent snap trigger bumps, not view switches
  }, [stateViewSnapTrigger]);

  const isFirstViewLerp = useRef(true);
  /**
   * Do not animate camera with setState every rAF — ZoomableGroup + onMoveEnd causes
   * "Maximum update depth exceeded". Snap camera once; shell opacity still softens the cut.
   */
  useEffect(() => {
    if (isFirstViewLerp.current) {
      isFirstViewLerp.current = false;
      return;
    }
    if (skipViewLerpRef.current) {
      skipViewLerpRef.current = false;
      return;
    }
    suppressMoveEndRef.current = true;
    const target = { coordinates: getCenterCoords(currentView), zoom: 1 };
    positionRef.current = target;
    setPosition(target);
    onZoomChangeRef.current?.(target.zoom);
    viewTransitionRef.current = true;
    setMapShellOpacity(0.82);
    const fallback = window.setTimeout(() => setMapShellOpacity(1), 450);
    const release = window.setTimeout(() => {
      suppressMoveEndRef.current = false;
    }, 160);
    return () => {
      clearTimeout(fallback);
      clearTimeout(release);
    };
  }, [currentView]);

  useEffect(() => {
    if (!geoData || !viewTransitionRef.current) return;
    viewTransitionRef.current = false;
    const t = window.setTimeout(() => setMapShellOpacity(1), 40);
    return () => clearTimeout(t);
  }, [geoData, currentView]);

  useEffect(() => {
    if (!activeConstituencyId || currentView === "India") return;
    const c = constituencies.find((x) => x.id === activeConstituencyId);
    if (!c) return;
    suppressMoveEndRef.current = true;
    setPosition((prev) => {
      const next = {
        coordinates: [c.longitude, c.latitude] as [number, number],
        zoom: Math.max(prev.zoom, 3.5),
      };
      positionRef.current = next;
      return next;
    });
    releaseSuppressMoveEndSoon();
  }, [activeConstituencyId, constituencies, currentView]);

  // Load GeoJSON Data
  useEffect(() => {
    const fetchMap = async () => {
      setMapError(false);
      let fetchUrl = "/maps/india-states.json";
      if (currentView !== "India" && STATE_MAP_FILES[currentView]) {
        fetchUrl = `/maps/${STATE_MAP_FILES[currentView]}`;
      }
      try {
        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error("Map file not found");
        const data = await response.json();
        setGeoData(data);
      } catch (error) {
        setMapError(true);
      }
    };
    fetchMap();
  }, [currentView]);

  // 📍 D3 Projection - STRICTLY UNTOUCHED
  const projectionConfig = useMemo(() => {
    const p = geoMercator();
    if (currentView === "India") return p.scale(isMobile ? 1400 : 1150).center([85.5, 28.5]);
    if (currentView === "Kerala") return p.scale(isMobile ? 14500 : 7555).center([75.3, 11.6]);
    if (currentView === "Assam") return p.scale(isMobile ? 7000 : 7500).center([93.5, 26.9]);
    if (currentView === "Tamil Nadu") return p.scale(isMobile ? 11000 : 6000).center([78.70, 11.9]);
    if (currentView === "West Bengal") return p.scale(isMobile ? 10000 : 5500).center([87.9, 25.3]);
    if (currentView === "Puducherry") return p.scale(isMobile ? 125000 : 99000).center([79.74, 12.00]);
    return p.scale(1150).center([85.5, 28.5]);
  }, [currentView, isMobile]);

  const pathGenerator = geoPath().projection(projectionConfig);

  const visibleSignals = useMemo(() => {
    const scoped = signals.filter((s: any) => {
      if (verifiedOnly && !s.verified) return false;
      if (currentView !== "India" && s.state !== currentView) return false;
      return true;
    });
    return scoped;
  }, [signals, verifiedOnly, currentView]);

  // FILTER: ONLY Videos, NO News. Mathematically Distribute & Isolate by State View.
  const videoSignals = useMemo(() => {
    // 1. Strictly keep ONLY signals that have a valid YouTube video URL
    const vids = visibleSignals.filter((s: any) => s.video_url && String(s.video_url).trim() !== "");

    const stateGroups: Record<string, any[]> = {};

    vids.forEach(v => {
      const st = v.state || "National";
      if (!stateGroups[st]) stateGroups[st] = [];
      stateGroups[st].push(v);
    });

    const constById = new Map<string, any>();
    for (const c of constituencies) constById.set(String(c.id), c);

    const mapped: any[] = [];
    Object.keys(stateGroups).forEach(st => {
      const stateSignals = stateGroups[st];
      const stateConsts = constituencies.filter(c => c.state === st);

      stateSignals.forEach((sig, index) => {
        const snapped = displayCoordsForSignal(sig, constById);
        if (snapped) {
          sig.render_lng = snapped.lng;
          sig.render_lat = snapped.lat;
        } else if (stateConsts.length > 0) {
          const step = Math.max(1, Math.floor(stateConsts.length / stateSignals.length));
          const targetConst = stateConsts[(index * step) % stateConsts.length];
          sig.render_lng = targetConst.longitude;
          sig.render_lat = targetConst.latitude;
        } else {
          sig.render_lng = getCenterCoords("India")[0];
          sig.render_lat = getCenterCoords("India")[1];
        }
        mapped.push(sig);
      });
    });

    return mapped;
  }, [visibleSignals, constituencies]);

  const allSignalClusters = useMemo(() => {
    if (overlayMode !== "ALL") return [];

    const constById = new Map<string, any>();
    for (const c of constituencies) constById.set(String(c.id), c);

    // choose a grid size based on zoom/view (simple clustering)
    const z = Math.max(1, position.zoom);
    const cellDeg =
      currentView === "India"
        ? (z < 1.8 ? 2.0 : z < 3 ? 1.0 : 0.6)
        : (z < 2.2 ? 0.35 : z < 4 ? 0.18 : 0.10);

    const groups = new Map<string, { lat: number; lng: number; items: any[]; newestTs: number }>();

    for (const s of visibleSignals) {
      const pos = displayCoordsForSignal(s, constById);
      if (!pos) continue;

      const keyLat = Math.round(pos.lat / cellDeg) * cellDeg;
      const keyLng = Math.round(pos.lng / cellDeg) * cellDeg;
      const key = `${keyLat.toFixed(4)}_${keyLng.toFixed(4)}`;

      const createdAt = Date.parse(s.created_at || "") || 0;

      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, { lat: keyLat, lng: keyLng, items: [s], newestTs: createdAt });
      } else {
        existing.items.push(s);
        if (createdAt > existing.newestTs) existing.newestTs = createdAt;
      }
    }

    const clusters = Array.from(groups.values()).map((g) => {
      const items = [...g.items].sort((a, b) => {
        const ds = (b.severity || 1) - (a.severity || 1);
        if (ds !== 0) return ds;
        return (Date.parse(b.created_at || "") || 0) - (Date.parse(a.created_at || "") || 0);
      });
      return { ...g, items, count: items.length, top: items[0] };
    });

    return clusters.sort((a, b) => b.newestTs - a.newestTs);
  }, [overlayMode, visibleSignals, constituencies, currentView, position.zoom]);

  // ------------------------------------------------------------------
  // INVERSE SCALING ENGINE (Prevents "Circle Blobs" when zoomed in)
  // ------------------------------------------------------------------
  const zoomFactor = Math.max(1, position.zoom);
  const mR = 2.5 / zoomFactor;             // Constituency Dot
  const vW = 44 / zoomFactor;              // Video Width
  const vH = 28 / zoomFactor;              // Video Height
  const bR = 3.0 / zoomFactor;             // Dynamic Border Radius
  const fS = Math.max(1.2, 4.5 / zoomFactor); // Dynamic Font Size
  const sW = 1.0 / zoomFactor;             // FIX: Restored Stroke Width Variable!

  /* TopBar is position:fixed and does not consume flow. Do NOT subtract 36px from height + start at y=0
   * (that leaves a topbar-sized gap above the footer). Use pt-9 and height = 100vh − footer − HUD only. */
  const mapShellStyle = {
    height: "calc(100vh - var(--war-hud-reserve, 0px) - var(--map-footer-stack, 28px))",
  } as const;

  if (mapError)
    return (
      <div
        className="box-border flex w-full min-h-0 flex-col pt-9"
        style={mapShellStyle}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center font-mono text-red-500">
          <b>Map Data Missing!</b>
        </div>
      </div>
    );
  if (!geoData)
    return (
      <div
        className="box-border flex w-full min-h-0 flex-col bg-transparent pt-9"
        style={mapShellStyle}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center font-mono text-zinc-400">
          INITIALIZING TACTICAL MAP...
        </div>
      </div>
    );

  return (
    <div className="box-border flex w-full min-h-0 flex-col pt-9" style={mapShellStyle}>
      <div
        className="relative min-h-0 w-full flex-1 overflow-hidden"
        style={{
          backgroundColor: "#cbd5e1",
          backgroundImage: "radial-gradient(rgba(51,65,85,0.14) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      >
      {/* Map chrome hidden on mobile when Signals/Intel sheet is open; z-55 clears the thumb tab bar on map view */}
      {!hideMapChrome && (
      <div
        ref={mapLayersWrapRef}
        className="absolute bottom-16 right-2 z-[55] flex flex-col items-end gap-1.5 pointer-events-auto select-none max-md:bottom-[6.75rem] md:bottom-3 md:right-[292px] md:z-40"
      >
        {mapLayersOpen && (
          <div
            className="w-[min(17rem,calc(100vw-3.5rem))] rounded-lg border border-[#e4e4e7] bg-white/95 py-2 pl-2 pr-2 shadow-lg backdrop-blur-md"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-1.5 font-mono text-[8px] font-bold tracking-wider text-[#71717a]">MAP LAYERS</div>
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  title="Video-linked signals as thumbnails (AI lat/long when present)."
                  onClick={() => onChangeOverlayMode && onChangeOverlayMode("VIDEOS")}
                  className={`rounded-md px-2 py-1.5 font-mono text-[8px] font-bold transition-colors ${overlayMode === "VIDEOS" ? "bg-sky-50 text-[#0284c7] ring-1 ring-sky-200" : "bg-[#fafafa] text-[#52525b] ring-1 ring-[#e4e4e7] hover:bg-[#f4f4f5]"}`}
                >
                  VIDEOS
                </button>
                <button
                  type="button"
                  title="All signals clustered by coordinates (or constituency centroid)."
                  onClick={() => onChangeOverlayMode && onChangeOverlayMode("ALL")}
                  className={`rounded-md px-2 py-1.5 font-mono text-[8px] font-bold transition-colors ${overlayMode === "ALL" ? "bg-emerald-50 text-[#16a34a] ring-1 ring-emerald-200" : "bg-[#fafafa] text-[#52525b] ring-1 ring-[#e4e4e7] hover:bg-[#f4f4f5]"}`}
                >
                  ALL SIGNALS
                </button>
                <button
                  type="button"
                  title="Verified sources only"
                  onClick={() => onToggleVerifiedOnly && onToggleVerifiedOnly()}
                  className={`rounded-md px-2 py-1.5 font-mono text-[8px] font-bold transition-colors ${verifiedOnly ? "bg-emerald-50 text-[#16a34a] ring-1 ring-emerald-200" : "bg-[#fafafa] text-[#52525b] ring-1 ring-[#e4e4e7] hover:bg-[#f4f4f5]"}`}
                >
                  VERIFIED
                </button>
              </div>
              <p className="font-mono text-[7px] leading-snug text-[#a1a1aa]">
                {overlayMode === "ALL"
                  ? "Clusters every in-scope signal (precise when lat/long is ingested)."
                  : "Thumbnails for video-linked signals only."}
              </p>
            </div>
          </div>
        )}
        <button
          type="button"
          aria-expanded={mapLayersOpen}
          aria-label={mapLayersOpen ? "Close map layers" : "Map layers"}
          onClick={(e) => {
            e.stopPropagation();
            setMapLayersOpen((o) => !o);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[#e4e4e7] bg-white/95 text-[#52525b] shadow-md backdrop-blur-md transition-colors hover:border-sky-300 hover:text-[#0284c7] active:scale-95"
        >
          <Layers className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
      )}

      {!hideMapChrome && (
      <div className="pointer-events-none absolute bottom-16 left-2 z-[55] max-w-[9.5rem] select-none max-md:bottom-[6.75rem] md:bottom-3 md:left-[292px] md:z-30 md:max-w-[13rem]">
        <div className="rounded-md border border-[#e4e4e7]/80 bg-white/85 px-2 py-1 shadow-sm backdrop-blur-sm">
          <div className="mb-0.5 font-mono text-[7px] font-bold tracking-wider text-[#71717a]">LEGEND</div>
          {operationMode === "VOTING_DAY" ? (
            <p className="font-mono text-[7px] leading-snug text-[#52525b] md:text-[8px]">Dots = turnout (low→high).</p>
          ) : operationMode === "COUNTING_DAY" ? (
            <p className="font-mono text-[7px] leading-snug text-[#52525b] md:text-[8px]">Dots = leading party.</p>
          ) : (
            <p className="font-mono text-[7px] leading-snug text-[#52525b] md:text-[8px]">
              Seat dots: calmer (green) → busier score (orange/red). Not a forecast.
            </p>
          )}
          <p className="mt-0.5 font-mono text-[7px] leading-snug text-[#a1a1aa] md:text-[8px]">
            {overlayMode === "VIDEOS" ? "Tiles = video signals." : "Rings = signal clusters."}
          </p>
        </div>
      </div>
      )}

      <div
        className="absolute inset-0 transition-opacity duration-300 ease-out"
        style={{ opacity: mapShellOpacity }}
      >
        <ComposableMap
          projection={projectionConfig as any}
          width={800}
          height={isMobile ? 900 : 700}
          style={{ width: "100%", height: "100%", display: "block", outline: "none" }}
        >
          <ZoomableGroup
            zoom={position.zoom}
            center={position.coordinates as [number, number]}
            onMoveEnd={(pos) => {
              if (suppressMoveEndRef.current) return;
              const z = pos.zoom;
              const c = pos.coordinates as [number, number];
              const prev = positionRef.current;
              const same =
                Math.abs(prev.zoom - z) < 0.015 &&
                Math.abs(prev.coordinates[0] - c[0]) < 1e-5 &&
                Math.abs(prev.coordinates[1] - c[1]) < 1e-5;
              if (same) return;
              const next = { coordinates: c, zoom: z };
              positionRef.current = next;
              setPosition(next);
              onZoomChange?.(z);
            }}
            minZoom={1}
            maxZoom={12}
          >
            <defs>
              <filter id="video-tile-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feDropShadow dx="0" dy="1.2" stdDeviation="1.4" floodColor="#000000" floodOpacity="0.2" />
              </filter>
            </defs>
            {/* --- LAYER 1: BASE GEOGRAPHY --- */}
            <Geographies geography={geoData}>
              {({ geographies }) =>
                geographies.map((geo) => {
                  let rawName = geo.properties.name || geo.properties.NAME_1 || geo.properties.st_nm || geo.properties.ST_NM || "";
                  if (rawName.toLowerCase() === "tamilnadu") rawName = "Tamil Nadu";

                  const stateName = rawName;
                  const displayName = currentView === "India" ? stateName : geo.properties.district;
                  const isTargetState = ELECTION_STATES.includes(stateName);
                  const metaColor = STATE_META[stateName]?.color || "#16a34a";

                  let fill = "#ffffff";
                  let stroke = "#64748b";
                  let strokeWidth = 0.65 / zoomFactor;

                  const isStateView = currentView !== "India";
                  if (currentView === "India") {
                    if (isTargetState) {
                      fill = withAlpha(metaColor, "28");
                      stroke = withAlpha(metaColor, "aa");
                      strokeWidth = 1.05 / zoomFactor;
                    }
                  } else {
                    fill = THEME.districtFill;
                    stroke = THEME.districtStroke;
                    strokeWidth = 0.45 / zoomFactor;
                  }
                  let centroid: [number, number] | null = null;
                  if (currentView === "India") {
                    try {
                      const c = pathGenerator.centroid(geo);
                      // Add the strict checking to satisfy TypeScript
                      if (c && !isNaN(c[0]) && !isNaN(c[1]) && projectionConfig.invert) {
                        centroid = projectionConfig.invert(c) as [number, number];
                      }
                    } catch (e) { }
                  }

                  return (
                    <React.Fragment key={geo.rsmKey}>
                      <Geography
                        geography={geo}
                        onMouseEnter={() => {
                          if (isStateView) return;
                          if (isTargetState) setTooltipContent(displayName);
                        }}
                        onMouseLeave={() => {
                          if (!isStateView) setTooltipContent("");
                        }}
                        onClick={() => {
                          if (currentView === "India" && isTargetState) {
                            setCurrentView(stateName);
                            if (onSelectState) onSelectState(stateName);
                            setTooltipContent("");
                          }
                        }}
                        style={
                          isStateView
                            ? {
                                default: {
                                  fill,
                                  stroke,
                                  strokeWidth,
                                  outline: "none",
                                  pointerEvents: "none" as const,
                                  transition: "fill 0.25s ease, stroke 0.25s ease",
                                },
                                hover: {
                                  fill,
                                  stroke,
                                  strokeWidth,
                                  outline: "none",
                                  cursor: "default",
                                  pointerEvents: "none" as const,
                                },
                                pressed: { fill, stroke, strokeWidth, outline: "none" },
                              }
                            : {
                                default: { fill, stroke, strokeWidth, outline: "none", transition: "all 0.2s ease" },
                                hover: {
                                  fill: isTargetState ? withAlpha(metaColor, "33") : fill,
                                  stroke: isTargetState ? withAlpha(metaColor, "88") : stroke,
                                  strokeWidth: isTargetState ? 1.35 / zoomFactor : strokeWidth,
                                  outline: "none",
                                  cursor: isTargetState ? "pointer" : "default",
                                },
                                pressed: { fill: withAlpha(metaColor, "44"), outline: "none" },
                              }
                        }
                      />

                      {/* National State Labels */}
                      {currentView === "India" && centroid && (
                        <Marker coordinates={centroid}>
                          <text textAnchor="middle" y={fS} style={{ fontFamily: "monospace", fontSize: `${fS * 2}px`, fontWeight: "bold", fill: metaColor, pointerEvents: "none" }}>
                            {STATE_CODES[stateName] || ""}
                          </text>
                        </Marker>
                      )}
                    </React.Fragment>
                  );
                })
              }
            </Geographies>

            {/* --- LAYER 2: CONSTITUENCIES & SMART LABELS --- */}
            {currentView !== "India" && constituencies.filter(c => c.state === currentView).map((c: any) => {
              const isSelected = activeConstituencyId === c.id;
              const isHovered = hoveredConst === c.id;
              const showText = position.zoom >= 2.5 || isSelected || isHovered;
              const accent = STATE_META[c.state]?.color || "#16a34a";

              let dotColor = accent;

              if (isCountingDay) {
                const result = liveResults?.find((r: any) => r.constituency_id === c.id);
                if (result && result.leading_party) dotColor = PARTY_COLORS[result.leading_party] || dotColor;
              } else if (isVotingDay) {
                const t = c.turnout_percentage || 0;
                if (t > 0 && t < 40) dotColor = "#93c5fd";
                else if (t >= 40 && t < 60) dotColor = "#3b82f6";
                else if (t >= 60 && t < 75) dotColor = "#4338ca";
                else if (t >= 75) dotColor = "#312e81";
              } else {
                if (c.volatility_score >= 70) dotColor = "#dc2626";
                else if (c.volatility_score >= 40) dotColor = "#ea580c";
              }

              return (
                <Marker key={c.id} coordinates={[c.longitude, c.latitude]}>
                  <g
                    className="cursor-pointer"
                    onMouseEnter={() => {
                      setHoveredConst(c.id);
                      setConstituencyTip(c);
                      setTooltipContent("");
                    }}
                    onMouseLeave={() => {
                      setHoveredConst(null);
                      setConstituencyTip(null);
                    }}
                    onClick={() => {
                      if (onSelectConstituency) onSelectConstituency(c.id);
                      setPosition((prev) => ({
                        coordinates: [c.longitude, c.latitude],
                        zoom: Math.max(prev.zoom, 4),
                      }));
                    }}
                  >
                    <circle
                      r={isSelected ? mR * 2 : isHovered ? mR * 1.35 : mR}
                      fill={dotColor}
                      stroke={isSelected ? "#18181b" : isHovered ? withAlpha(accent, "cc") : "#ffffff"}
                      strokeWidth={(isSelected || isHovered ? 1.0 : 0.5) / zoomFactor}
                      style={{ filter: isHovered ? "drop-shadow(0 1px 2px rgb(0 0 0 / 0.12))" : undefined }}
                    />

                    {showText && (
                      <text
                        x={(isSelected ? mR * 2 : mR) + (3 / zoomFactor)}
                        y={0}
                        textAnchor="start"
                        alignmentBaseline="middle"
                        style={{
                          fontFamily: "monospace",
                          fontSize: `${fS}px`,
                          fontWeight: "bold",
                          fill: isSelected ? "#0369a1" : "#3f3f46",
                          paintOrder: "stroke fill",
                          stroke: "#ffffff",
                          strokeWidth: 1.5 / zoomFactor,
                          pointerEvents: "auto" // Makes the text clickable!
                        }}
                      >
                        {c.name.toUpperCase()}
                      </text>
                    )}
                  </g>
                </Marker>
              );
            })}

            {/* --- LAYER 3: PURE SVG VIDEO THUMBNAILS (ONLY VIDEOS) --- */}
            {overlayMode === "VIDEOS" && videoSignals.map((s: any) => {
              let borderColor = "#94a3b8"; // Muted OSINT Grey
              if (s.severity >= 4) borderColor = "#ef4444"; // Red for Critical incidents

              const videoIdMatch = s.video_url.match(/embed\/([^?]+)/);
              const videoId = videoIdMatch ? videoIdMatch[1] : null;
              const thumbnailUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : "";

              return (
                <Marker key={`vid-${s.id}`} coordinates={[s.render_lng, s.render_lat]}>
                  <g
                    className="cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); if (onSelectSignal) onSelectSignal(s); }}
                    onMouseEnter={() => {
                      setConstituencyTip(null);
                      setTooltipContent("[VIDEO] " + (s.title || "").substring(0, 42));
                    }}
                    onMouseLeave={() => setTooltipContent("")}
                  >
                    <rect
                      x={-vW / 2}
                      y={-vH / 2}
                      width={vW}
                      height={vH}
                      fill="#f8fafc"
                      stroke={borderColor}
                      strokeWidth={sW * 2.2}
                      rx={bR}
                      filter="url(#video-tile-glow)"
                    />
                    <image href={thumbnailUrl} x={(-vW / 2) + sW * 1.5} y={(-vH / 2) + sW * 1.5} width={vW - sW * 3} height={vH - sW * 3} preserveAspectRatio="xMidYMid slice" opacity="0.92" />
                    <rect x={-(16 / zoomFactor) / 2} y={-(11 / zoomFactor) / 2} width={16 / zoomFactor} height={11 / zoomFactor} fill="#ffffff" rx={2.5 / zoomFactor} opacity="0.95" />
                    <text x={0} y={(3.2 / zoomFactor)} textAnchor="middle" fontSize={`${6.5 / zoomFactor}px`} fill="#0f172a">▶</text>
                  </g>
                </Marker>
              );
            })}

            {/* --- LAYER 3B: CLUSTERED SIGNALS (ALL) --- */}
            {overlayMode === "ALL" && allSignalClusters.map((c: any, idx: number) => {
              const top = c.top;
              const sev = top?.severity || 1;
              const color = sev >= 4 ? "#dc2626" : sev >= 3 ? "#ea580c" : "#16a34a";
              const r = (2.2 + Math.min(8, Math.log2(Math.max(1, c.count)) * 2.2)) / zoomFactor;
              const rawTitle = String(top?.title || "Signal");
              const label = rawTitle.length > 20 ? `${rawTitle.slice(0, 20)}…` : rawTitle;
              const fs = Math.max(2.8, 6.2 / zoomFactor);
              const subFs = Math.max(2.4, 5.4 / zoomFactor);
              return (
                <Marker key={`cluster-${idx}-${c.lat}-${c.lng}`} coordinates={[c.lng, c.lat]}>
                  <g
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (c.items.length > 1 && onSelectSignalCluster) onSelectSignalCluster(c.items);
                      else if (onSelectSignal) onSelectSignal(top);
                    }}
                    onMouseEnter={() => {
                      setConstituencyTip(null);
                      setTooltipContent(
                        c.count > 1
                          ? `${c.count} SIGNALS · ${rawTitle.slice(0, 56)}${rawTitle.length > 56 ? "…" : ""}`
                          : rawTitle.slice(0, 72)
                      );
                    }}
                    onMouseLeave={() => setTooltipContent("")}
                  >
                    <circle r={r + 0.15 / zoomFactor} fill="#ffffff" opacity={0.35} stroke="none" />
                    <circle r={r} fill={color} opacity={0.92} stroke="#ffffff" strokeWidth={0.85 / zoomFactor} />
                    {c.count > 1 ? (
                      <text
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{ fontFamily: "monospace", fontSize: `${Math.max(2.5, 7 / zoomFactor)}px`, fontWeight: "bold", fill: "#ffffff", pointerEvents: "none" }}
                      >
                        {c.count}
                      </text>
                    ) : null}
                    <text
                      textAnchor="middle"
                      y={r + subFs * 1.35}
                      style={{
                        fontFamily: "monospace",
                        fontSize: `${subFs}px`,
                        fontWeight: "600",
                        fill: "#1e293b",
                        stroke: "#ffffff",
                        strokeWidth: 0.35 / zoomFactor,
                        paintOrder: "stroke fill",
                        pointerEvents: "none",
                      }}
                    >
                      {label}
                    </text>
                    {c.count > 1 ? (
                      <text
                        textAnchor="middle"
                        y={r + subFs * 2.65}
                        style={{
                          fontFamily: "monospace",
                          fontSize: `${fs * 0.85}px`,
                          fill: "#64748b",
                          stroke: "#ffffff",
                          strokeWidth: 0.25 / zoomFactor,
                          paintOrder: "stroke fill",
                          pointerEvents: "none",
                        }}
                      >
                        {c.count} stacked · tap for list
                      </text>
                    ) : null}
                  </g>
                </Marker>
              );
            })}

          </ZoomableGroup>
        </ComposableMap>
      </div>
      </div>

      {(tooltipContent || constituencyTip) && (
        <div
          ref={tooltipRef}
          className={`fixed z-[100] pointer-events-none bg-white text-zinc-800 border border-zinc-200 shadow-lg rounded-md transform -translate-x-1/2 -translate-y-[150%] max-w-[240px] ${constituencyTip ? "px-3 py-2" : "px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider"}`}
          style={{ display: "block" }}
        >
          {constituencyTip ? (
            <div className="space-y-1">
              <div className="font-mono text-[10px] font-bold text-[#16a34a] leading-tight">{String(constituencyTip.name || "").toUpperCase()}</div>
              <div className="font-mono text-[9px] text-[#71717a]">
                {(constituencyTip.district || "—") + ", " + (constituencyTip.state || "")}
              </div>
              <div className="font-mono text-[9px] text-[#52525b]">
                VOL {(Number(constituencyTip.volatility_score) || 0).toFixed(0)}% · PH-{constituencyTip.phase ?? "—"}
              </div>
              <div className="font-mono text-[8px] text-[#a1a1aa] pt-0.5 border-t border-zinc-100">Click dot or label → intel filter</div>
            </div>
          ) : (
            tooltipContent
          )}
        </div>
      )}
    </div>
  );
}