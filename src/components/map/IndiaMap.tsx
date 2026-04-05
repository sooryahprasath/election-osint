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

  const constituenciesGroupRef = useRef<L.LayerGroup | null>(null);
  const signalsGroupRef = useRef<L.LayerGroup | null>(null);
  const statesLayerRef = useRef<L.GeoJSON | null>(null);
  const constMarkersRef = useRef<Record<string, L.CircleMarker>>({});

  const isVotingDay = operationMode === "VOTING_DAY";
  const isCountingDay = operationMode === "COUNTING_DAY";

  // GLOBAL CLICK LISTENER (Bypasses React DOM for faster Tooltip clicks)
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

    // Use Canvas for extreme marker rendering speed
    const map = L.map(divRef.current, {
      zoomControl: false, attributionControl: false, renderer: L.canvas({ padding: 0.5 }),
      maxBounds: MAX_BOUNDS, maxBoundsViscosity: 0.8, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
    }).setView(INDIA_CENTER, INDIA_ZOOM);

    mapRef.current = map;

    // MASSIVE LAG FIX: Remove React `setState` during zoom. Use pure native CSS toggles.
    map.on('zoomend', function () {
      if (this.getZoom() >= 10) {
        this.getContainer().classList.add('show-tooltips');
      } else {
        this.getContainer().classList.remove('show-tooltips');
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
        if (mapRef.current) L.geoJSON(borderData, { pane: 'baseBorders', interactive: false, style: { color: "#d4d4d8", weight: 1.0, fill: false } }).addTo(mapRef.current);
      } catch (e) { }

      try {
        const stateData = await fetch("/india-states.geojson").then(r => r.json());
        if (mapRef.current) {

          // STRICT REQUEST 1: Draw Thick Dark Grey State Borders for Election States
          L.geoJSON(stateData, {
            pane: 'baseBorders',
            interactive: false,
            filter: (feat) => NORMALIZED_TARGETS.includes((feat?.properties?.ST_NM || "").toLowerCase().replace(/\s+/g, '')),
            style: { color: "#3f3f46", weight: 2.5, fillOpacity: 0 } // #3f3f46 is tactical dark grey
          }).addTo(mapRef.current);

          // Invisible layer to handle Hover/Click interactions cleanly without fighting the borders
          statesLayerRef.current = L.geoJSON(stateData, {
            pane: 'interactiveStates',
            style: feat => {
              const name = feat?.properties?.ST_NM as string || "";
              const isElection = NORMALIZED_TARGETS.includes(name.toLowerCase().replace(/\s+/g, ''));
              return isElection
                ? { color: "transparent", weight: 0, fillColor: "#52525b", fillOpacity: 0.15, interactive: true, className: "cursor-pointer outline-none" }
                : { color: "transparent", weight: 0, fillColor: "#ffffff", fillOpacity: 0.0, interactive: false };
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
  // 2. CONST DOTS & FAST MUTATION (No React Lag)
  // ==========================================
  useEffect(() => {
    if (!mapRef.current || !constituenciesGroupRef.current) return;

    // Create markers only if they haven't been created yet
    if (Object.keys(constMarkersRef.current).length === 0 && constituencies.length > 0) {
      constituencies.forEach((c: any) => {
        const m = L.circleMarker([c.latitude, c.longitude], {
          radius: 4, color: "#ffffff", fillColor: "#16a34a", fillOpacity: 0.9, weight: 1.2,
        });

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
    }

    // Fast Update existing markers
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
        opacity: 1
      });

      if (isSelected) m.bringToFront();
    });

    // Update States visibility
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
  }, [activeState, activeConstituencyId, isVotingDay, isCountingDay, liveResults, constituencies, onSelectConstituency]);

  // ==========================================
  // 3. RENDER SIGNALS & VIDEOS (STRICT FILTER)
  // ==========================================
  useEffect(() => {
    if (!signalsGroupRef.current) return;
    signalsGroupRef.current.clearLayers();

    signals.forEach((s: any, index: number) => {
      if (activeState !== "ALL" && s.state !== activeState && s.state) return;

      // STRICT REQUEST 2: Only show Videos OR High Severity (>= 4) News
      const hasVideo = !!s.video_url;
      const isHighSev = s.severity >= 4;
      if (!hasVideo && !isHighSev) return;

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
            const targetC = stateConsts[(index * 13) % stateConsts.length]; // Scatter inland
            lat = targetC.latitude; lng = targetC.longitude;
          } else {
            lat = FALLBACK_COORDS[s.state]?.[0]; lng = FALLBACK_COORDS[s.state]?.[1];
          }
        } else {
          lat = FALLBACK_COORDS["National"][0]; lng = FALLBACK_COORDS["National"][1];
        }
      }

      if (lat && lng) {
        if (isFallback) { lat += (Math.random() - 0.5) * 0.08; lng += (Math.random() - 0.5) * 0.08; }

        if (hasVideo) {
          const videoIdMatch = s.video_url.match(/embed\/([^?]+)/);
          const videoId = videoIdMatch ? videoIdMatch[1] : null;
          const thumbnailUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : "";

          // STRICT REQUEST 3 & 4: Videos are LARGER, wrapped in a pure White/Light Grey OSINT Theme
          const videoIcon = L.divIcon({
            className: "bg-transparent cursor-pointer",
            html: `
              <div style="position: relative; width: 54px; height: 34px; border-radius: 4px; overflow: hidden; border: 2px solid #ffffff; box-shadow: 0 4px 10px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; background: #e4e4e7;">
                <img src="${thumbnailUrl}" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;" />
                <div style="background: #ffffff; color: #18181b; width: 16px; height: 12px; border-radius: 3px; display: flex; align-items: center; justify-content: center; z-index: 10; font-size: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.5);">▶</div>
              </div>
            `,
            iconSize: [54, 34]
          });
          const sm = L.marker([lat, lng], { icon: videoIcon, zIndexOffset: 1000 });
          sm.bindTooltip(`<b style="color:#52525b; font-family: monospace;">[VIDEO]</b><br/><span style="font-size: 10px;">${s.title.substring(0, 40)}...</span>`, { direction: "top", offset: L.point(0, -15) });
          if (onSelectSignal) sm.on("click", () => onSelectSignal(s));
          sm.addTo(signalsGroupRef.current!);
        }
        else if (isHighSev && s.image_url) {
          // STRICT REQUEST 3 & 4: News images are SMALLER, wrapped in Dark Grey Theme
          const imgIcon = L.divIcon({
            className: "bg-transparent cursor-pointer",
            html: `
              <div style="position: relative; width: 36px; height: 24px; border-radius: 4px; overflow: hidden; border: 2px solid #52525b; box-shadow: 0 2px 6px rgba(0,0,0,0.3); background: #18181b;">
                <img src="${s.image_url}" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.9;" />
              </div>
            `,
            iconSize: [36, 24]
          });
          const sm = L.marker([lat, lng], { icon: imgIcon, zIndexOffset: 900 });
          sm.bindTooltip(`<b style="color:#dc2626; font-family: monospace;">[SEV-${s.severity}]</b><br/><span style="font-size: 10px;">${s.title.substring(0, 40)}...</span>`, { direction: "top", offset: L.point(0, -12) });
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
      <style dangerouslySetInnerHTML={{
        __html: `
        /* HIGH PERFORMANCE CSS: GPU Opacity transitions bypass layout recalculation lag */
        .smart-tooltip { opacity: 0 !important; transition: opacity 0.2s; pointer-events: none !important; background: white; border: 1px solid #e4e4e7; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); padding: 4px 8px; }
        .leaflet-container.show-tooltips .smart-tooltip { opacity: 1 !important; pointer-events: auto !important; }
        .leaflet-interactive:hover + .leaflet-tooltip.smart-tooltip { opacity: 1 !important; pointer-events: auto !important; }
      `}} />
      <div ref={divRef} style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 0, background: "#f4f4f5" }} />
    </>
  );
}