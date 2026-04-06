"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps";
import { geoMercator, geoPath } from "d3-geo";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { AlertTriangle } from "lucide-react";
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
  "West Bengal": "WB", "Ladakh": "LA"
};

const PARTY_COLORS: Record<string, string> = {
  "BJP": "#f97316", "NDA": "#f97316", "INC": "#3b82f6", "INDIA": "#3b82f6",
  "CPIM": "#dc2626", "LDF": "#dc2626", "AITC": "#10b981", "TMC": "#10b981",
  "DMK": "#ef4444", "AIADMK": "#22c55e", "IND": "#71717a"
};

// 🎨 Muted Tactical OSINT Theme
const THEME = {
  districtFill: "#f8fafc",
  districtStroke: "#cbd5e1",
};

export interface IndiaMapProps {
  flyToState?: string | null;
  activeState?: string;
  activeConstituencyId?: string | null;
  onSelectConstituency?: (id: string) => void;
  onSelectState?: (state: string) => void;
  onSelectSignal?: (signal: any) => void;
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
  flyToState,
  activeState,
  activeConstituencyId,
  onSelectConstituency,
  onSelectState,
  onSelectSignal
}: IndiaMapProps) {
  const { constituencies, signals, operationMode, liveResults } = useLiveData();

  const [currentView, setCurrentView] = useState("India");
  const [geoData, setGeoData] = useState<any>(null);
  const [tooltipContent, setTooltipContent] = useState("");
  const [mapError, setMapError] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [hoveredConst, setHoveredConst] = useState<string | null>(null);

  // Native Tooltip Ref (Bypasses React Re-rendering lag)
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Hardware Accelerated Zoom State
  const [position, setPosition] = useState({ coordinates: getCenterCoords("India"), zoom: 1 });

  const isVotingDay = operationMode === "VOTING_DAY";
  const isCountingDay = operationMode === "COUNTING_DAY";

  // Native Mouse Move Listener (ZERO LAG)
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

  // Handle external State selections (Locks the zoom to 1 to prevent zooming out into whitespace)
  useEffect(() => {
    if (activeState && activeState !== "ALL") {
      if (STATE_MAP_FILES[activeState]) {
        setCurrentView(activeState);
        setTimeout(() => setPosition({ coordinates: getCenterCoords(activeState), zoom: 1 }), 10);
      }
    } else {
      setCurrentView("India");
      setTimeout(() => setPosition({ coordinates: getCenterCoords("India"), zoom: 1 }), 10);
    }
  }, [activeState]);

  // Handle external Constituency selections
  useEffect(() => {
    if (activeConstituencyId && currentView !== "India") {
      const c = constituencies.find(c => c.id === activeConstituencyId);
      if (c) {
        // Zoom in to focus the constituency smoothly
        setPosition({ coordinates: [c.longitude, c.latitude], zoom: Math.max(position.zoom, 3.5) });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConstituencyId, constituencies]);

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

  // FILTER: ONLY Videos, NO News. Mathematically Distribute & Isolate by State View.
  const videoSignals = useMemo(() => {
    // 1. Strictly keep ONLY signals that have a valid YouTube video URL
    const vids = signals.filter(s => s.video_url && s.video_url.trim() !== "");

    // 2. ISOLATE: If we are in a State view, completely ignore neighboring states
    const visibleVids = vids.filter(s => currentView === "India" || s.state === currentView);

    const stateGroups: Record<string, any[]> = {};

    visibleVids.forEach(v => {
      const st = v.state || "National";
      if (!stateGroups[st]) stateGroups[st] = [];
      stateGroups[st].push(v);
    });

    const mapped: any[] = [];
    Object.keys(stateGroups).forEach(st => {
      const stateSignals = stateGroups[st];
      const stateConsts = constituencies.filter(c => c.state === st);

      stateSignals.forEach((sig, index) => {
        if (stateConsts.length > 0) {
          // Spread perfectly using Modulo across the state's internal coordinates
          const step = Math.max(1, Math.floor(stateConsts.length / stateSignals.length));
          const targetConst = stateConsts[(index * step) % stateConsts.length];
          sig.render_lng = targetConst.longitude;
          sig.render_lat = targetConst.latitude;
        } else {
          // Fallback to National Center if no coordinates match
          sig.render_lng = getCenterCoords("India")[0];
          sig.render_lat = getCenterCoords("India")[1];
        }
        mapped.push(sig);
      });
    });

    return mapped;
  }, [signals, constituencies, currentView]);

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

  if (mapError) return <div className="w-full h-[calc(100vh-36px)] flex items-center justify-center font-mono text-red-500"><b>Map Data Missing!</b></div>;
  if (!geoData) return <div className="w-full h-[calc(100vh-36px)] flex items-center justify-center font-mono text-zinc-400 bg-transparent">INITIALIZING TACTICAL MAP...</div>;

  return (
    <div
      className="relative w-full h-[calc(100vh-36px)] flex flex-col items-center justify-center overflow-hidden"
      style={{
        backgroundColor: "#f1f5f9",
        backgroundImage: "radial-gradient(#cbd5e1 1px, transparent 1px)",
        backgroundSize: "24px 24px"
      }}
    >
      <div className="w-full h-full relative flex items-center justify-center">
        <ComposableMap projection={projectionConfig} width={800} height={isMobile ? 900 : 700} style={{ width: "100%", height: "100%", outline: "none" }}>
          <ZoomableGroup
            zoom={position.zoom}
            center={position.coordinates as [number, number]}
            onMoveEnd={(pos) => setPosition(pos)}
            minZoom={1}
            maxZoom={12}
          >
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
                  let stroke = "#e4e4e7";
                  let strokeWidth = 0.5 / zoomFactor;

                  if (currentView === "India") {
                    if (isTargetState) {
                      fill = `${metaColor}20`; // Pastel State Fill
                      stroke = "#52525b";      // Dark Tactical Grey Borders
                      strokeWidth = 1.2 / zoomFactor;
                    }
                  } else {
                    fill = THEME.districtFill;
                    stroke = metaColor;
                    strokeWidth = 0.8 / zoomFactor;
                  }

                  let centroid: [number, number] | null = null;
                  if (currentView === "India" && isTargetState) {
                    try {
                      const c = pathGenerator.centroid(geo);
                      if (c && !isNaN(c[0]) && !isNaN(c[1])) centroid = projectionConfig.invert(c) as [number, number];
                    } catch (e) { }
                  }

                  return (
                    <React.Fragment key={geo.rsmKey}>
                      <Geography
                        geography={geo}
                        onMouseEnter={() => { if (isTargetState || currentView !== "India") setTooltipContent(displayName); }}
                        onMouseLeave={() => setTooltipContent("")}
                        onClick={() => {
                          if (currentView === "India" && isTargetState) {
                            setCurrentView(stateName);
                            if (onSelectState) onSelectState(stateName);
                            setTooltipContent("");
                          }
                        }}
                        style={{
                          default: { fill, stroke, strokeWidth, outline: "none", transition: "all 0.2s ease" },
                          hover: {
                            fill: isTargetState || currentView !== "India" ? `${metaColor}40` : fill,
                            stroke: isTargetState || currentView !== "India" ? stroke : stroke,
                            strokeWidth: isTargetState || currentView !== "India" ? 1.8 / zoomFactor : strokeWidth,
                            outline: "none", cursor: isTargetState || currentView !== "India" ? "pointer" : "default"
                          },
                          pressed: { fill: `${metaColor}60`, outline: "none" }
                        }}
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

              let dotColor = STATE_META[c.state]?.color || "#16a34a";

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
                    onMouseEnter={() => setHoveredConst(c.id)}
                    onMouseLeave={() => setHoveredConst(null)}
                    onClick={() => {
                      if (onSelectConstituency) onSelectConstituency(c.id);
                      setPosition({ coordinates: [c.longitude, c.latitude], zoom: Math.max(position.zoom, 4) });
                    }}
                  >
                    <circle r={isSelected ? mR * 2 : mR} fill={dotColor} stroke={isSelected ? "#000" : "#fff"} strokeWidth={0.5 / zoomFactor} />

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
            {videoSignals.map((s: any) => {
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
                    onMouseEnter={() => setTooltipContent("[VIDEO] " + s.title.substring(0, 35) + "...")}
                    onMouseLeave={() => setTooltipContent("")}
                  >
                    {/* Outer Border */}
                    <rect x={-vW / 2} y={-vH / 2} width={vW} height={vH} fill="#0f172a" stroke={borderColor} strokeWidth={sW * 2} rx={bR} />

                    {/* Embedded YouTube Thumbnail (Native SVG) */}
                    <image href={thumbnailUrl} x={(-vW / 2) + sW} y={(-vH / 2) + sW} width={vW - (sW * 2)} height={vH - (sW * 2)} preserveAspectRatio="xMidYMid slice" opacity="0.85" />

                    {/* Tactical Play Button Indicator */}
                    <rect x={-(14 / zoomFactor) / 2} y={-(10 / zoomFactor) / 2} width={14 / zoomFactor} height={10 / zoomFactor} fill="#ffffff" rx={2 / zoomFactor} opacity="0.9" />
                    <text x={0} y={(3 / zoomFactor)} textAnchor="middle" fontSize={`${6 / zoomFactor}px`} fill="#18181b">▶</text>
                  </g>
                </Marker>
              );
            })}

          </ZoomableGroup>
        </ComposableMap>
      </div>

      {/* Floating Mouse Tooltip */}
      {tooltipContent && (
        <div
          ref={tooltipRef}
          className="fixed z-[100] pointer-events-none bg-white text-zinc-800 font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md border border-zinc-200 shadow-md transform -translate-x-1/2 -translate-y-[150%]"
          style={{ display: tooltipContent ? "block" : "none" }}
        >
          {tooltipContent}
        </div>
      )}
    </div>
  );
}