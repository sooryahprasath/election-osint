"use client";

import { useEffect, useRef } from "react";
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

  // Separated refs for Zero-Lag rendering
  const constituenciesGroupRef = useRef<L.LayerGroup | null>(null);
  const signalsGroupRef = useRef<L.LayerGroup | null>(null);
  const statesLayerRef = useRef<L.GeoJSON | null>(null);
  const constMarkersRef = useRef<Record<string, L.CircleMarker>>({});

  const isVotingDay = operationMode === "VOTING_DAY";
  const isCountingDay = operationMode === "COUNTING_DAY";

  // GLOBAL CLICK LISTENER: Maps standard HTML clicks on tooltips back to React Router
  useEffect(() => {
    const handleCustomClick = (e: any) => {
      if (onSelectConstituency && e.detail) onSelectConstituency(e.detail);
    };
    window.addEventListener('selectConst', handleCustomClick);
    return () => window.removeEventListener('selectConst', handleCustomClick);
  }, [onSelectConstituency]);

  // ==========================================
  // 1. HARD INITIALIZATION (Runs exactly once)
  // ==========================================
  useEffect(() => {
    if (!divRef.current || mapRef.current) return;

    const map = L.map(divRef.current, {
      zoomControl: false, attributionControl: false, renderer: L.canvas({ padding: 0.5 }),
      maxBounds: MAX_BOUNDS, maxBoundsViscosity: 0.8, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
    }).setView(INDIA_CENTER, INDIA_ZOOM);

    mapRef.current = map;

    // HIGH PERFORMANCE FIX: Native DOM class toggle (Bypasses React lag completely)
    // TypeScript Fix: Changed from function() to arrow function and used the 'map' variable directly
    map.on('zoomend', () => {
      if (map.getZoom() >= 10) {
        map.getContainer().classList.add('show-tooltips');
      } else {
        map.getContainer().classList.remove('show-tooltips');
      }
    });

    map.createPane('baseBorders'); map.getPane('baseBorders')!.style.zIndex = '390'; map.getPane('baseBorders')!.style.pointerEvents = 'none';
    map.createPane('interactiveStates'); map.getPane('interactiveStates')!.style.zIndex = '400';

    constituenciesGroupRef.current = L.layerGroup().addTo(map);
    signalsGroupRef.current = L.layerGroup().addTo(map);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png", { subdomains: "abcd", noWrap: true, maxZoom: 19 }).addTo(map);

    const loadMapData = async () => {
      try {
        const borderData = await fetch("/india.geojson").then(r => r.json());
        if (mapRef.current) L.geoJSON(borderData, { pane: 'baseBorders', interactive: false, style: { color: "#71717a", weight: 1.5, fill: false } }).addTo(mapRef.current);
      } catch (e) { }

      try {
        const stateData = await fetch("/india-states.geojson").then(r => r.json());
        if (mapRef.current) {

          // NEW: Thick State Borders for Target Election States (Unclickable base layer)
          L.geoJSON(stateData, {
            pane: 'baseBorders',
            interactive: false,
            filter: (feat) => NORMALIZED_TARGETS.includes((feat?.properties?.ST_NM || "").toLowerCase().replace(/\s+/g, '')),
            style: { color: "#52525b", weight: 2.0, fill: false }
          }).addTo(mapRef.current);

          // Clickable Interactive Fills
          statesLayerRef.current = L.geoJSON(stateData, {
            pane: 'interactiveStates',
            style: feat => {
              const name = feat?.properties?.ST_NM as string || "";
              const isElection = NORMALIZED_TARGETS.includes(name.toLowerCase().replace(/\s+/g, ''));
              return isElection
                ? { color: "transparent", weight: 0, fillColor: "#52525b", fillOpacity: 0.15, interactive: true, className: "cursor-pointer outline-none" }
                : { color: "#e4e4e7", weight: 0.8, fillColor: "#ffffff", fillOpacity: 0.0, interactive: false };
            },
            onEachFeature: (feat, layer: any) => {
              const name = feat?.properties?.ST_NM as string || "";
              const normalizedName = name.toLowerCase().replace(/\s+/g, '');
              if (NORMALIZED_TARGETS.includes(normalizedName)) {
                const displayName = ELECTION_STATES.find(s => s.toLowerCase().replace(/\s+/g, '') === normalizedName) || name;
                layer.bindTooltip(`<div class="font-mono text-[10px] font-bold tracking-wider" style="color: #52525b">${displayName.toUpperCase()}<br/><span class="text-[#71717a] text-[8px]">CLICK TO FOCUS</span></div>`, { sticky: true, className: "bg-white border px-2 py-1 rounded shadow-md border-[#52525b]" });
                layer.on({
                  mouseover: (e: any) => { e.target.setStyle({ fillColor: "#52525b", fillOpacity: 0.35 }); e.target.bringToFront(); },
                  mouseout: (e: any) => { e.target.setStyle({ fillColor: "#52525b", fillOpacity: 0.15 }); },
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
  // 2. CREATE CONSTITUENCIES ONCE (Zero-Lag Fix)
  // ==========================================
  useEffect(() => {
    if (!constituenciesGroupRef.current || constituencies.length === 0) return;
    if (Object.keys(constMarkersRef.current).length > 0) return; // Prevent recreation loops

    constituencies.forEach((c: any) => {
      const m = L.circleMarker([c.latitude, c.longitude], {
        radius: 4, color: "#ffffff", fillColor: "#16a34a", fillOpacity: 0.9, weight: 1.2,
      });

      // FIX: Clickable Labels! HTML triggers standard DOM click event captured by React
      const tooltipHtml = `
        <div onclick="window.dispatchEvent(new CustomEvent('selectConst', {detail: '${c.id}'}))" style="cursor:pointer; pointer-events:auto;" class="font-mono text-xs">
          <b>${c.name}</b><br/><span style="color:#71717a">ID: ${c.id}</span>
        </div>
      `;

      m.bindTooltip(tooltipHtml, { permanent: true, direction: "top", offset: L.point(0, -8), className: "smart-tooltip" });

      if (onSelectConstituency) m.on("click", () => onSelectConstituency(c.id));

      constMarkersRef.current[c.id] = m;
      m.addTo(constituenciesGroupRef.current!);
    });
  }, [constituencies, onSelectConstituency]);

  // ==========================================
  // 3. FAST DOM MUTATION (Instant Style Updates)
  // ==========================================
  useEffect(() => {
    if (statesLayerRef.current) {
      statesLayerRef.current.eachLayer((layer: any) => {
        const feat = layer.feature;
        const name = feat?.properties?.ST_NM as string || "";
        const normalizedName = name.toLowerCase().replace(/\s+/g, '');
        if (!NORMALIZED_TARGETS.includes(normalizedName)) return;

        const displayName = ELECTION_STATES.find(s => s.toLowerCase().replace(/\s+/g, '') === normalizedName) || name;

        let fillOpacity = 0.15;
        if (activeState !== "ALL" && activeState !== displayName) fillOpacity = 0.02;
        else if (activeState === displayName) fillOpacity = 0.25;
        layer.setStyle({ fillColor: "#52525b", fillOpacity: fillOpacity });
      });
    }

    constituencies.forEach((c: any) => {
      const m = constMarkersRef.current[c.id];
      if (!m) return;

      const isActiveState = activeState === "ALL" || c.state === activeState;
      const isSelected = c.id === activeConstituencyId;

      if (!isActiveState || (activeConstituencyId && !isSelected)) {
        m.setStyle({ opacity: 0, fillOpacity: 0 }); // Instantly hide
        return;
      }

      const metaColor = STATE_META[c.state]?.color || "#16a34a";
      let color = metaColor;

      if (isCountingDay) {
        const result = liveResults?.find((r: any) => r.constituency_id === c.id);
        if (result && result.leading_party) color = PARTY_COLORS[result.leading_party] || metaColor;
      } else if (isVotingDay) {
        const t = c.turnout_percentage || 0;
        // FIX: Guaranteed not to grey out if 0
        if (t > 0) {
          if (t < 40) color = "#93c5fd";
          else if (t < 60) color = "#3b82f6";
          else if (t < 75) color = "#4338ca";
          else color = "#312e81";
        }
      } else {
        if (c.volatility_score >= 70) color = "#dc2626";
        else if (c.volatility_score >= 40) color = "#ea580c";
      }

      m.setStyle({
        radius: isSelected ? 8 : 4,
        color: isSelected ? "#000000" : "#ffffff",
        fillColor: color,
        fillOpacity: 0.9,
        weight: isSelected ? 2 : 1.2,
        opacity: 1 // Restore visibility
      });

      if (isSelected) m.bringToFront();
    });
  }, [activeState, activeConstituencyId, isVotingDay, isCountingDay, liveResults, constituencies]);

  // ==========================================
  // 4. RENDER SIGNALS/VIDEOS/IMAGES 
  // ==========================================
  useEffect(() => {
    if (!signalsGroupRef.current) return;
    signalsGroupRef.current.clearLayers();

    signals.forEach((s: any, index: number) => {
      if (activeState !== "ALL" && s.state !== activeState && s.state) return;

      let lat = s.latitude; let lng = s.longitude; let isFallback = false;

      if (!lat && s.constituency_id) {
        const c = constituencies.find((x: any) => x.id === s.constituency_id);
        if (c) { lat = c.latitude; lng = c.longitude; }
      }

      if (!lat) {
        isFallback = true;
        if (s.state) {
          const stateConsts = constituencies.filter((c: any) => c.state === s.state);
          if (stateConsts.length > 0) {
            const targetC = stateConsts[(index * 13) % stateConsts.length]; // Scatter
            lat = targetC.latitude; lng = targetC.longitude;
          } else {
            lat = FALLBACK_COORDS[s.state]?.[0]; lng = FALLBACK_COORDS[s.state]?.[1];
          }
        } else {
          lat = FALLBACK_COORDS["National"][0]; lng = FALLBACK_COORDS["National"][1];
        }
      }

      if (lat && lng) {
        if (isFallback) { lat += (Math.random() - 0.5) * 0.05; lng += (Math.random() - 0.5) * 0.05; }

        let borderColor = "#a1a1aa"; // Gray
        if (s.severity >= 4 || s.category === 'breaking') borderColor = "#e4e4e7"; // White
        else if (s.severity === 3 || s.category === 'alert') borderColor = "#d4d4d8"; // Light Gray
        else if (s.category === 'official') borderColor = "#a1a1aa"; // Gray

        // YOUTUBE VIDEO THUMBNAIL
        if (s.video_url) {
          const videoIdMatch = s.video_url.match(/embed\/([^?]+)/);
          const videoId = videoIdMatch ? videoIdMatch[1] : null;
          const thumbnailUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : "";

          const videoIcon = L.divIcon({
            className: "bg-transparent cursor-pointer",
            html: `
              <div style="position: relative; width: 36px; height: 24px; border-radius: 4px; overflow: hidden; border: 2px solid ${borderColor}; box-shadow: 0 2px 4px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; background: #18181b;">
                <img src="${thumbnailUrl}" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.8;" />
                <div style="background: ${borderColor}; color: #18181b; width: 14px; height: 10px; border-radius: 2px; display: flex; align-items: center; justify-content: center; z-index: 10; font-size: 6px;">▶</div>
              </div>
            `,
            iconSize: [36, 24]
          });
          const sm = L.marker([lat, lng], { icon: videoIcon, zIndexOffset: 1000 });
          sm.bindTooltip(`<b style="color:${borderColor}; font-family: monospace;">[VIDEO INTEL]</b><br/><span style="font-size: 10px;">${s.title.substring(0, 40)}...</span>`, { direction: "top", offset: L.point(0, -12) });
          if (onSelectSignal) sm.on("click", () => onSelectSignal(s));
          sm.addTo(signalsGroupRef.current!);
        }

        // NEW: ARTICLE IMAGE THUMBNAIL (No play button)
        else if (s.image_url && s.image_url.trim() !== "") {
          const imgIcon = L.divIcon({
            className: "bg-transparent cursor-pointer",
            html: `
              <div style="position: relative; width: 36px; height: 24px; border-radius: 4px; overflow: hidden; border: 2px solid ${borderColor}; box-shadow: 0 2px 4px rgba(0,0,0,0.5); background: #18181b;">
                <img src="${s.image_url}" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.9;" />
              </div>
            `,
            iconSize: [36, 24]
          });
          const sm = L.marker([lat, lng], { icon: imgIcon, zIndexOffset: 900 });
          sm.bindTooltip(`<b style="color:${borderColor}; font-family: monospace;">[PHOTO INTEL]</b><br/><span style="font-size: 10px;">${s.title.substring(0, 40)}...</span>`, { direction: "top", offset: L.point(0, -12) });
          if (onSelectSignal) sm.on("click", () => onSelectSignal(s));
          sm.addTo(signalsGroupRef.current!);
        }

        // STANDARD RADAR BLIP
        else if (s.severity >= 3 || s.category === 'official') {
          const radarIcon = L.divIcon({
            className: "bg-transparent cursor-pointer",
            html: `<div style="position: relative; width: 16px; height: 16px; transform: translate(-50%, -50%);"><div style="position: absolute; inset: 0; border-radius: 50%; border: 3px solid ${borderColor}; opacity: 0.4;"></div><div style="position: absolute; top: 50%; left: 50%; width: 6px; height: 6px; border-radius: 50%; background: ${borderColor}; transform: translate(-50%, -50%); border: 1px solid #ffffff;"></div></div>`,
            iconSize: [0, 0]
          });
          const sm = L.marker([lat, lng], { icon: radarIcon });
          sm.bindTooltip(`<b style="color:${borderColor}; font-family: monospace;">[SEV-${s.severity} INTEL]</b><br/><span style="font-size: 10px;">${s.title.substring(0, 40)}...</span>`, { direction: "right", offset: L.point(10, 0) });
          if (onSelectSignal) sm.on("click", () => onSelectSignal(s));
          sm.addTo(signalsGroupRef.current!);
        }
      }
    });
  }, [signals, activeState, constituencies, onSelectSignal]);

  // ==========================================
  // 5. CAMERA CONTROLS
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
      {/* HIGH PERFORMANCE CSS: Opacity triggers GPU, bypassing layout recalculations */}
      <style dangerouslySetInnerHTML={{
        __html: `
        .smart-tooltip { opacity: 0 !important; transition: opacity 0.2s; pointer-events: none !important; background: white; border: 1px solid #e4e4e7; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); padding: 4px 8px; }
        .leaflet-container.show-tooltips .smart-tooltip { opacity: 1 !important; pointer-events: auto !important; }
        .leaflet-interactive:hover + .leaflet-tooltip.smart-tooltip { opacity: 1 !important; pointer-events: auto !important; }
        @keyframes ping { 75%, 100% { transform: scale(3); opacity: 0; } }
      `}} />
      <div ref={divRef} style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 0, background: "transparent" }} />
    </>
  );
}