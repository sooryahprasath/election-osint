"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { STATE_META } from "@/lib/utils/states";

const INDIA_CENTER: [number, number] = [22.5937, 80.9629];
const INDIA_ZOOM = 5;
const MIN_ZOOM = 4.5;
const MAX_ZOOM = 12;

// Expanded Eastern bounds to 100.0 to fully reveal Assam
const MAX_BOUNDS: L.LatLngBoundsExpression = [[6.0, 68.0], [37.0, 100.0]];

const ELECTION_STATES = ["Kerala", "Assam", "Puducherry", "Tamil Nadu", "West Bengal"];
const NORMALIZED_TARGETS = ELECTION_STATES.map(s => s.toLowerCase().replace(/\s+/g, ''));

const FALLBACK_COORDS: Record<string, [number, number]> = {
  "Kerala": [8.5241, 76.9366],
  "Assam": [26.1445, 91.7362],
  "Tamil Nadu": [13.0827, 80.2707],
  "West Bengal": [22.5726, 88.3639],
  "Puducherry": [11.9416, 79.8083],
  "National": [28.6139, 77.2090]
};

const STATE_VIEWS: Record<string, [number, number, number]> = {
  Kerala: [10.35, 76.50, 7.5],
  Assam: [26.20, 92.50, 7.2],
  Puducherry: [11.90, 79.80, 11],
  "Tamil Nadu": [11.00, 78.50, 7],
  "West Bengal": [24.20, 88.00, 7],
  India: [22.5937, 80.9629, INDIA_ZOOM],
};

const PARTY_COLORS: Record<string, string> = {
  "BJP": "#f97316", "NDA": "#f97316",
  "INC": "#3b82f6", "INDIA": "#3b82f6",
  "CPIM": "#dc2626", "LDF": "#dc2626",
  "AITC": "#10b981", "TMC": "#10b981",
  "DMK": "#ef4444", "AIADMK": "#22c55e",
  "IND": "#71717a"
};

export interface IndiaMapProps {
  flyToState?: string | null;
  activeState?: string;
  activeConstituencyId?: string | null;
  onSelectConstituency?: (id: string) => void;
  onSelectState?: (state: string) => void;
  onSelectSignal?: (signal: any) => void;
}

export default function IndiaMap({ flyToState, activeState, activeConstituencyId, onSelectConstituency, onSelectState, onSelectSignal }: IndiaMapProps) {
  const { constituencies, signals, operationMode, liveResults } = useLiveData();
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const statesLayerRef = useRef<L.GeoJSON | null>(null);

  const isVotingDay = operationMode === "VOTING_DAY";
  const isCountingDay = operationMode === "COUNTING_DAY";

  // NEW: Track camera zoom to auto-open tooltip names
  const [isZoomedIn, setIsZoomedIn] = useState(false);

  // ==========================================
  // 1. INITIALIZE MAP & BORDERS
  // ==========================================
  useEffect(() => {
    if (!divRef.current || mapRef.current) return;

    const map = L.map(divRef.current, {
      zoomControl: false, attributionControl: false, renderer: L.canvas({ padding: 0.5 }),
      maxBounds: MAX_BOUNDS, maxBoundsViscosity: 0.8, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
    }).setView(INDIA_CENTER, INDIA_ZOOM);

    mapRef.current = map;

    // Track Zoom level for smart tooltips
    map.on('zoomend', () => {
      setIsZoomedIn(map.getZoom() >= 10);
    });

    map.createPane('baseBorders'); map.getPane('baseBorders')!.style.zIndex = '390'; map.getPane('baseBorders')!.style.pointerEvents = 'none';
    map.createPane('interactiveStates'); map.getPane('interactiveStates')!.style.zIndex = '400';
    markersGroupRef.current = L.layerGroup().addTo(map);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png", { subdomains: "abcd", noWrap: true, maxZoom: 19 }).addTo(map);

    const loadMapData = async () => {
      try {
        const borderData = await fetch("/india.geojson").then(r => r.json());
        if (mapRef.current) L.geoJSON(borderData, { pane: 'baseBorders', interactive: false, style: { color: "#71717a", weight: 1.5, fill: false } }).addTo(mapRef.current);
      } catch (e) { }

      try {
        const stateData = await fetch("/india-states.geojson").then(r => r.json());
        if (mapRef.current) {
          statesLayerRef.current = L.geoJSON(stateData, {
            pane: 'interactiveStates',
            style: feat => {
              const name = feat?.properties?.ST_NM as string || "";
              const isElection = NORMALIZED_TARGETS.includes(name.toLowerCase().replace(/\s+/g, ''));
              return isElection
                ? { color: "#52525b", weight: 1.5, fillColor: "#52525b", fillOpacity: 0.15, interactive: true, className: "cursor-pointer outline-none" }
                : { color: "#e4e4e7", weight: 0.8, fillColor: "#ffffff", fillOpacity: 0.0, interactive: false };
            },
            onEachFeature: (feat, layer: any) => {
              const name = feat?.properties?.ST_NM as string || "";
              const normalizedName = name.toLowerCase().replace(/\s+/g, '');
              if (NORMALIZED_TARGETS.includes(normalizedName)) {
                const displayName = ELECTION_STATES.find(s => s.toLowerCase().replace(/\s+/g, '') === normalizedName) || name;
                layer.bindTooltip(`<div class="font-mono text-[10px] font-bold tracking-wider" style="color: #52525b">${displayName.toUpperCase()}<br/><span class="text-[#71717a] text-[8px]">CLICK TO FOCUS</span></div>`, { sticky: true, className: "bg-white border px-2 py-1 rounded shadow-md border-[#52525b]" });
                layer.on({
                  mouseover: (e: any) => { e.target.setStyle({ fillColor: "#52525b", fillOpacity: 0.35, weight: 2.5 }); e.target.bringToFront(); },
                  mouseout: (e: any) => { e.target.setStyle({ fillColor: "#52525b", fillOpacity: 0.15, weight: 1.5 }); },
                  click: () => { if (onSelectState) onSelectState(displayName); }
                });
              }
            }
          }).addTo(mapRef.current);
        }
      } catch (e) { }
    };

    loadMapData();
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==========================================
  // 2. GREY OUT NON-SELECTED STATES
  // ==========================================
  useEffect(() => {
    if (!statesLayerRef.current) return;
    statesLayerRef.current.eachLayer((layer: any) => {
      const feat = layer.feature;
      const name = feat?.properties?.ST_NM as string || "";
      const normalizedName = name.toLowerCase().replace(/\s+/g, '');
      const isElection = NORMALIZED_TARGETS.includes(normalizedName);
      const displayName = ELECTION_STATES.find(s => s.toLowerCase().replace(/\s+/g, '') === normalizedName) || name;

      if (!isElection) return;

      let fillOpacity = 0.15; let strokeColor = "#52525b"; let weight = 1.5;
      if (activeState !== "ALL" && activeState !== displayName) { fillOpacity = 0.02; strokeColor = "#a1a1aa"; weight = 1; }
      else if (activeState === displayName) { fillOpacity = 0.25; weight = 2; }
      layer.setStyle({ color: strokeColor, weight: weight, fillColor: "#52525b", fillOpacity: fillOpacity, interactive: true });
    });
  }, [activeState]);

  // ==========================================
  // 3. RENDER MARKERS, VIDEOS & HOTSPOTS
  // ==========================================
  useEffect(() => {
    if (!mapRef.current || !markersGroupRef.current) return;
    markersGroupRef.current.clearLayers();

    // --- CONSTITUENCY DOTS ---
    constituencies.forEach((c: any) => {
      if (activeState !== "ALL" && c.state !== activeState) return;

      const metaColor = STATE_META[c.state]?.color || "#16a34a";
      let color = metaColor;

      // WAR ROOM: Map Colors Override
      if (isCountingDay) {
        const result = liveResults?.find((r: any) => r.constituency_id === c.id);
        if (result && result.leading_party) color = PARTY_COLORS[result.leading_party] || metaColor;
      } else if (isVotingDay) {
        const t = c.turnout_percentage || 0;
        if (t > 0 && t < 40) color = "#93c5fd";
        else if (t >= 40 && t < 60) color = "#3b82f6";
        else if (t >= 60 && t < 75) color = "#4338ca";
        else if (t >= 75) color = "#312e81";
        // If 0, it falls back to the default metaColor (doesn't turn grey!)
      } else {
        if (c.volatility_score >= 70) color = "#dc2626";
        else if (c.volatility_score >= 40) color = "#ea580c";
      }

      const isSelected = c.id === activeConstituencyId;
      if (activeConstituencyId && !isSelected) return;

      const m = L.circleMarker([c.latitude, c.longitude], {
        radius: isSelected ? 8 : 4, color: isSelected ? "#000000" : "#ffffff", fillColor: color, fillOpacity: 0.9, weight: isSelected ? 2 : 1.2,
      });

      // NEW: Show tooltip permanently if zoomed in, otherwise just on hover
      m.bindTooltip(
        `<div class="font-mono text-xs"><b>${c.name}</b><br/><span style="color:#71717a">ID: ${c.id}</span></div>`,
        { permanent: isZoomedIn, direction: "top", offset: L.point(0, -8), className: "bg-white border border-gray-200 px-2 py-1 rounded shadow-md" }
      );

      if (onSelectConstituency) m.on("click", () => onSelectConstituency(c.id));
      m.addTo(markersGroupRef.current!);
    });

    // --- SIGNAL VIDEOS & RADARS ---
    signals.forEach((s: any, index: number) => {
      if (activeState !== "ALL" && s.state !== activeState && s.state) return;

      let lat = s.latitude;
      let lng = s.longitude;
      let isFallback = false;

      // Map to exact constituency if available
      if (!lat && s.constituency_id) {
        const c = constituencies.find((x: any) => x.id === s.constituency_id);
        if (c) { lat = c.latitude; lng = c.longitude; }
      }

      // If no constituency match, spread the news/videos ACROSS the state's actual internal coordinates
      if (!lat) {
        isFallback = true;
        if (s.state) {
          const stateConsts = constituencies.filter((c: any) => c.state === s.state);
          if (stateConsts.length > 0) {
            const targetC = stateConsts[(index * 7) % stateConsts.length];
            lat = targetC.latitude;
            lng = targetC.longitude;
          } else {
            lat = FALLBACK_COORDS[s.state]?.[0];
            lng = FALLBACK_COORDS[s.state]?.[1];
          }
        } else {
          lat = FALLBACK_COORDS["National"][0];
          lng = FALLBACK_COORDS["National"][1];
        }
      }

      if (lat && lng) {
        // Micro-jitter so markers don't perfectly stack
        if (isFallback) {
          lat += (Math.random() - 0.5) * 0.08;
          lng += (Math.random() - 0.5) * 0.08;
        }

        let borderColor = "#3b82f6";
        if (s.severity >= 4 || s.category === 'breaking') borderColor = "#dc2626";
        else if (s.severity === 3 || s.category === 'alert') borderColor = "#ea580c";
        else if (s.category === 'official') borderColor = "#16a34a";

        if (s.video_url) {
          const videoIdMatch = s.video_url.match(/embed\/([^?]+)/);
          const videoId = videoIdMatch ? videoIdMatch[1] : null;

          // FIX: Corrected the typo in the thumbnail URL 
          const thumbnailUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : "";

          // FIX: Reduced Size by 30% (from 64x40 to 44x28)
          const videoIcon = L.divIcon({
            className: "bg-transparent cursor-pointer",
            html: `
              <div style="position: relative; width: 44px; height: 28px; border-radius: 4px; overflow: hidden; border: 2px solid #ffffff; box-shadow: 0 4px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; background: #e4e4e7;">
                <img src="${thumbnailUrl}" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;" />
                <div style="background: ${borderColor}; color: white; width: 14px; height: 10px; border-radius: 2px; display: flex; align-items: center; justify-content: center; z-index: 10; font-size: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">▶</div>
              </div>
            `,
            iconSize: [44, 28]
          });
          const sm = L.marker([lat, lng], { icon: videoIcon, zIndexOffset: 1000 });
          sm.bindTooltip(`<b style="color:${borderColor}; font-family: monospace;">[VIDEO INTEL]</b><br/><span style="font-size: 10px;">${s.title.substring(0, 40)}...</span>`, { direction: "top", offset: L.point(0, -15) });
          if (onSelectSignal) sm.on("click", () => onSelectSignal(s));
          sm.addTo(markersGroupRef.current!);
        } else if (s.severity >= 3 || s.category === 'official') {
          const radarIcon = L.divIcon({
            className: "bg-transparent cursor-pointer",
            html: `<div style="position: relative; width: 24px; height: 24px; transform: translate(-50%, -50%);"><div style="position: absolute; inset: 0; border-radius: 50%; background: ${borderColor}99; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div><div style="position: absolute; top: 50%; left: 50%; width: 8px; height: 8px; border-radius: 50%; background: ${borderColor}; transform: translate(-50%, -50%); box-shadow: 0 0 4px rgba(0,0,0,0.3); border: 1px solid #ffffff;"></div></div>`,
            iconSize: [0, 0]
          });
          const sm = L.marker([lat, lng], { icon: radarIcon });
          sm.bindTooltip(`<b style="color:${borderColor}; font-family: monospace;">[SEV-${s.severity} INTEL]</b><br/><span style="font-size: 10px;">${s.title.substring(0, 40)}...</span>`, { direction: "right", offset: L.point(15, 0) });
          if (onSelectSignal) sm.on("click", () => onSelectSignal(s));
          sm.addTo(markersGroupRef.current!);
        }
      }
    });
    // Added isZoomedIn to deps to recalculate tooltips
  }, [constituencies, signals, activeState, activeConstituencyId, onSelectConstituency, onSelectSignal, isVotingDay, isCountingDay, liveResults, isZoomedIn]);

  // ==========================================
  // 4. CAMERA CONTROLS
  // ==========================================
  useEffect(() => {
    if (!mapRef.current || !flyToState) return;
    const v = STATE_VIEWS[flyToState];
    if (v) mapRef.current.flyTo([v[0], v[1]], v[2], { duration: 1.2 });
  }, [flyToState]);

  useEffect(() => {
    if (!mapRef.current || !activeConstituencyId) return;
    const target = constituencies.find((c: any) => c.id === activeConstituencyId);
    if (target && target.latitude && target.longitude) {
      mapRef.current.flyTo([target.latitude, target.longitude], 10, { duration: 1.5 });
    }
  }, [activeConstituencyId, constituencies]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `@keyframes ping { 75%, 100% { transform: scale(3); opacity: 0; } }` }} />
      <div ref={divRef} style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 0, background: "transparent" }} />
    </>
  );
}