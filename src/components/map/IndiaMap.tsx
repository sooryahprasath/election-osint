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

const ELECTION_STATES = ["Kerala", "Assam", "Puducherry", "Tamil Nadu", "West Bengal"];
const NORMALIZED_TARGETS = ELECTION_STATES.map(s => s.toLowerCase().replace(/\s+/g, ''));

const STATE_VIEWS: Record<string, [number, number, number]> = {
  Kerala: [10.35, 76.50, 7.5],
  Assam: [26.20, 92.50, 7.2],
  Puducherry: [11.90, 79.80, 11],
  "Tamil Nadu": [11.00, 78.50, 7],
  "West Bengal": [24.20, 88.00, 7],
  India: [22.5937, 80.9629, INDIA_ZOOM],
};

export interface IndiaMapProps {
  flyToState?: string | null;
  activeState?: string;
  activeConstituencyId?: string | null;
  onSelectConstituency?: (id: string) => void;
  onSelectState?: (state: string) => void;
  onSelectSignal?: (signal: any) => void; // NEW
}

export default function IndiaMap({ flyToState, activeState, activeConstituencyId, onSelectConstituency, onSelectState, onSelectSignal }: IndiaMapProps) {
  const { constituencies, signals } = useLiveData();
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const statesLayerRef = useRef<L.GeoJSON | null>(null);

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;

    const map = L.map(divRef.current, {
      zoomControl: false,
      attributionControl: false,
      renderer: L.canvas({ padding: 0.5 }),
      maxBounds: [[6.0, 68.0], [37.0, 98.0]] as L.LatLngBoundsExpression,
      maxBoundsViscosity: 1.0,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
    }).setView(INDIA_CENTER, INDIA_ZOOM);

    mapRef.current = map;

    map.createPane('baseBorders');
    map.getPane('baseBorders')!.style.zIndex = '390';
    map.getPane('baseBorders')!.style.pointerEvents = 'none';

    map.createPane('interactiveStates');
    map.getPane('interactiveStates')!.style.zIndex = '400';

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
      { subdomains: "abcd", noWrap: true, maxZoom: 19 }
    ).addTo(map);

    const loadMapData = async () => {
      try {
        const borderData = await fetch("/india.geojson").then(r => r.json());
        if (mapRef.current) {
          L.geoJSON(borderData, {
            pane: 'baseBorders',
            interactive: false,
            style: { color: "#a1a1aa", weight: 1.5, fill: false }
          }).addTo(mapRef.current);
        }
      } catch (e) { }

      try {
        const stateData = await fetch("/india-states.geojson").then(r => r.json());
        if (mapRef.current) {
          statesLayerRef.current = L.geoJSON(stateData, {
            pane: 'interactiveStates',
            style: feat => {
              const name = feat?.properties?.ST_NM as string || "";
              const normalizedName = name.toLowerCase().replace(/\s+/g, '');
              const isElection = NORMALIZED_TARGETS.includes(normalizedName);

              return isElection
                ? { color: "#52525b", weight: 1.5, fillColor: "#52525b", fillOpacity: 0.15, interactive: true, className: "cursor-pointer outline-none" }
                : { color: "#e4e4e7", weight: 0.8, fillColor: "#ffffff", fillOpacity: 0.0, interactive: false };
            },
            onEachFeature: (feat, layer: any) => {
              const name = feat?.properties?.ST_NM as string || "";
              const normalizedName = name.toLowerCase().replace(/\s+/g, '');

              if (NORMALIZED_TARGETS.includes(normalizedName)) {
                const displayName = ELECTION_STATES.find(s => s.toLowerCase().replace(/\s+/g, '') === normalizedName) || name;

                layer.bindTooltip(
                  `<div class="font-mono text-[10px] font-bold tracking-wider" style="color: #52525b">${displayName.toUpperCase()}<br/><span class="text-[#71717a] text-[8px]">CLICK TO FOCUS</span></div>`,
                  { sticky: true, className: "bg-white border px-2 py-1 rounded shadow-md", style: { borderColor: "#52525b" } }
                );

                layer.on({
                  mouseover: (e: any) => {
                    e.target.setStyle({ fillColor: "#52525b", fillOpacity: 0.35, weight: 2.5 });
                    e.target.bringToFront();
                  },
                  mouseout: (e: any) => {
                    // Reset to current active state opacity
                    const isGlobalActive = window.location.href; // Cheap way to trigger react lifecycle bypass
                    e.target.setStyle({ fillColor: "#52525b", fillOpacity: 0.15, weight: 1.5 });
                  },
                  click: () => {
                    if (onSelectState) onSelectState(displayName);
                  }
                });
              }
            }
          }).addTo(mapRef.current);
        }
      } catch (e) { }

      if (mapRef.current) markersGroupRef.current = L.layerGroup().addTo(mapRef.current);
    };

    loadMapData();

    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // DYNAMIC MAP STYLING
  useEffect(() => {
    if (!statesLayerRef.current) return;

    statesLayerRef.current.eachLayer((layer: any) => {
      const feat = layer.feature;
      const name = feat?.properties?.ST_NM as string || "";
      const normalizedName = name.toLowerCase().replace(/\s+/g, '');
      const isElection = NORMALIZED_TARGETS.includes(normalizedName);
      const displayName = ELECTION_STATES.find(s => s.toLowerCase().replace(/\s+/g, '') === normalizedName) || name;

      if (!isElection) {
        layer.setStyle({ color: "#e4e4e7", weight: 0.8, fillColor: "#ffffff", fillOpacity: 0.0, interactive: false });
        return;
      }

      let fillOpacity = 0.15;
      let strokeColor = "#52525b";
      let weight = 1.5;

      if (activeState !== "ALL" && activeState !== displayName) {
        fillOpacity = 0.02;
        strokeColor = "#d4d4d8";
        weight = 1;
      } else if (activeState === displayName) {
        fillOpacity = 0.25;
        weight = 2;
      }

      layer.setStyle({ color: strokeColor, weight: weight, fillColor: "#52525b", fillOpacity: fillOpacity, interactive: true });
    });
  }, [activeState]);

  // RENDER MARKERS & HOTSPOTS
  useEffect(() => {
    if (!mapRef.current || !markersGroupRef.current) return;
    markersGroupRef.current.clearLayers();

    constituencies.forEach((c: any) => {
      if (activeState !== "ALL" && c.state !== activeState) return;

      const metaColor = STATE_META[c.state]?.color || "#16a34a";
      let color = metaColor;
      if (c.volatility_score >= 70) color = "#dc2626";
      else if (c.volatility_score >= 40) color = "#ea580c";

      const isSelected = c.id === activeConstituencyId;
      if (activeConstituencyId && !isSelected) return;

      const m = L.circleMarker([c.latitude, c.longitude], {
        radius: isSelected ? 8 : 4,
        color: isSelected ? "#000000" : "#ffffff",
        fillColor: color,
        fillOpacity: 0.9,
        weight: isSelected ? 2 : 1.2,
      });

      m.bindTooltip(`<div class="font-mono text-xs"><b>${c.name}</b><br/><span style="color:#71717a">ID: ${c.id}</span></div>`, { direction: "top", offset: L.point(0, -8), className: "bg-white border border-gray-200 px-2 py-1 rounded shadow-md" });
      if (onSelectConstituency) m.on("click", () => onSelectConstituency(c.id));
      m.addTo(markersGroupRef.current!);
    });

    signals.forEach((s: any) => {
      if (activeState !== "ALL" && s.state !== activeState) return;

      let lat = s.latitude; let lng = s.longitude;
      if (!lat && s.constituency_id) {
        const c = constituencies.find((x: any) => x.id === s.constituency_id);
        if (c) { lat = c.latitude; lng = c.longitude; }
      }

      if (lat && lng) {
        if (s.video_url) {
          const videoIcon = L.divIcon({
            className: "bg-transparent cursor-pointer",
            html: `<div style="background: #ef4444; color: white; width: 24px; height: 18px; border-radius: 4px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 5px rgba(0,0,0,0.5); font-size: 10px;">▶</div>`,
            iconSize: [24, 18]
          });
          const sm = L.marker([lat, lng], { icon: videoIcon });
          sm.bindTooltip(`<b style="color:#ef4444; font-family: monospace;">[VIDEO INTEL]</b><br/><span style="font-size: 10px;">${s.title.substring(0, 40)}...</span>`, { direction: "right", offset: L.point(15, 0) });
          if (onSelectSignal) sm.on("click", () => onSelectSignal(s)); // NEW: Opens Video popup
          sm.addTo(markersGroupRef.current!);
        }
        else if (s.severity >= 3) {
          const isCritical = s.severity >= 4;
          const radarColor = isCritical ? "rgba(220, 38, 38, 0.6)" : "rgba(234, 88, 12, 0.6)";
          const coreColor = isCritical ? "#dc2626" : "#ea580c";

          const radarIcon = L.divIcon({
            className: "bg-transparent cursor-pointer",
            html: `<div style="position: relative; width: 24px; height: 24px; transform: translate(-50%, -50%);"><div style="position: absolute; inset: 0; border-radius: 50%; background: ${radarColor}; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div><div style="position: absolute; top: 50%; left: 50%; width: 8px; height: 8px; border-radius: 50%; background: ${coreColor}; transform: translate(-50%, -50%); box-shadow: 0 0 8px ${coreColor};"></div></div>`,
            iconSize: [0, 0]
          });
          const sm = L.marker([lat, lng], { icon: radarIcon });
          sm.bindTooltip(`<b style="color:${coreColor}; font-family: monospace;">[SEV-${s.severity} ALERT]</b><br/><span style="font-size: 10px;">${s.title.substring(0, 40)}...</span>`, { direction: "right", offset: L.point(15, 0) });
          if (onSelectSignal) sm.on("click", () => onSelectSignal(s)); // NEW: Opens Radar popup
          sm.addTo(markersGroupRef.current!);
        }
      }
    });

  }, [constituencies, signals, activeState, activeConstituencyId, onSelectConstituency, onSelectSignal]);

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
      <div ref={divRef} style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 0, background: "#f4f4f5" }} />
    </>
  );
}