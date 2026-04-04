"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useLiveData } from "@/lib/context/LiveDataContext";

// ─────────────────────────────────────────────────────────────────────────────
// KEY FIX: The div this map mounts into must be position:fixed + full viewport.
// That way Leaflet gets real pixel dimensions the instant useEffect fires
// (same pattern as the working reference project), so the chained .setView()
// works correctly without any invalidateSize hack.
// ─────────────────────────────────────────────────────────────────────────────

const INDIA_CENTER: [number, number] = [22.5937, 80.9629]; // geographic centroid
const INDIA_ZOOM = 5;
const MIN_ZOOM   = 4.5;
const MAX_ZOOM   = 12;

const ELECTION_STATES = ["Kerala", "Assam", "Puducherry", "Tamil Nadu", "West Bengal"];

const STATE_VIEWS: Record<string, [number, number, number]> = {
  // [lat, lng, zoom]
  Kerala:          [10.35,  76.50, 7.5],
  Assam:           [26.20,  92.50, 7.2],
  Puducherry:      [11.90,  79.80, 11],
  "Tamil Nadu":    [11.00,  78.50, 7],
  "West Bengal":   [24.20,  88.00, 7],
  India:           [22.5937, 80.9629, INDIA_ZOOM],
};

export interface IndiaMapProps {
  flyToState?:           string | null;
  debugModeEnabled?:     boolean;
  onSelectConstituency?: (id: string) => void;
}

export default function IndiaMap({ flyToState, debugModeEnabled, onSelectConstituency }: IndiaMapProps) {
  const { constituencies, signals } = useLiveData();
  const divRef   = useRef<HTMLDivElement>(null);
  const mapRef   = useRef<L.Map | null>(null);
  const [debug, setDebug] = useState({ lat: INDIA_CENTER[0], lng: INDIA_CENTER[1], zoom: INDIA_ZOOM });

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!divRef.current || mapRef.current) return;

    // ✅ The div is position:fixed covering the entire viewport.
    //    Leaflet reads its offsetWidth/offsetHeight here — they are real.
    //    We chain .setView() immediately, no setTimeout/ResizeObserver needed.
    const map = L.map(divRef.current, {
      zoomControl:        false,
      attributionControl: false,
      maxBounds: [[6.0, 68.0], [37.0, 98.0]] as L.LatLngBoundsExpression,
      maxBoundsViscosity: 1.0,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
    }).setView(INDIA_CENTER, INDIA_ZOOM);          // ← single, authoritative setView

    mapRef.current = map;

    // ── Tile layer ──────────────────────────────────────────────────────────
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
      { subdomains: "abcd", noWrap: true, maxZoom: 19 }
    ).addTo(map);

    // ── GeoJSON — India outer border (incl. POK & Arunachal Pradesh) ────────
    fetch("/india.geojson")
      .then(r => r.json())
      .then(data =>
        L.geoJSON(data, {
          style: { color: "#6b7280", weight: 2.5, fillOpacity: 0, dashArray: "" },
        }).addTo(map)
      )
      .catch(e => console.warn("[IndiaMap] india.geojson:", e));

    // ── GeoJSON — State fills with election highlighting ────────────────────
    fetch("/india-states.geojson")
      .then(r => r.json())
      .then(data =>
        L.geoJSON(data, {
          style: feat => {
            const name       = feat?.properties?.ST_NM as string | undefined;
            const isElection = !!name && ELECTION_STATES.includes(name);
            return isElection
              ? { color: "#f97316", weight: 2, fillColor: "#ea580c", fillOpacity: 0.25 }
              : { color: "#d1d5db", weight: 0.6, fillColor: "#f1f5f9", fillOpacity: 0.55 };
          },
          onEachFeature: (feat, layer) => {
            const name = feat?.properties?.ST_NM as string | undefined;
            if (name) layer.bindTooltip(name, { sticky: true, className: "india-map-tooltip" });
          },
        }).addTo(map)
      )
      .catch(e => console.warn("[IndiaMap] india-states.geojson:", e));

    // ── Constituency markers ────────────────────────────────────────────────
    const markers: L.CircleMarker[] = [];
    const sigMarkers: L.CircleMarker[] = [];

    const renderMarkers = () => {
      // Clear existing temporary markers
      markers.forEach(m => m.remove());
      sigMarkers.forEach(m => m.remove());
      markers.length = 0;
      sigMarkers.length = 0;

      const currentMap = mapRef.current;
      if (!currentMap) return;

      constituencies.forEach((c: any) => {
        // Determine fill color by current status/party eventually, defaulting to green.
        let color = "#16a34a"; // Green default
        if (c.status === "declared" || c.status === "counting") {
          // Future enhancement: map c.leading_candidate_id to party color
          // For now, if turnout > 75%, mark darker
          if (c.turnout_percentage && c.turnout_percentage > 75) color = "#15803d";
        }
        
        const m = L.circleMarker([c.latitude, c.longitude], {
          radius: 4, color, fillColor: color, fillOpacity: 0.55, weight: 1,
        });
        m.bindTooltip(
          `<b>${c.name}</b><br/><span style="color:#6b7280">Vol: ${(c.volatility_score || 0).toFixed(0)}%</span>`,
          { direction: "top", offset: L.point(0, -6) }
        );
        if (onSelectConstituency) m.on("click", () => onSelectConstituency(c.id));
        m.addTo(currentMap);
        markers.push(m);
      });

      // ── Signal markers ──────────────────────────────────────────────────────
      // To place signal markers we need their lat/lng. If the signal doesn't have it, 
      // look up the constituency it belongs to.
      signals.forEach((s: any) => {
        let lat = s.latitude;
        let lng = s.longitude;
        
        if (!lat && s.constituency_id) {
          const c = constituencies.find((x: any) => x.id === s.constituency_id);
          if (c) {
            // Offset slightly so it doesn't exactly overlap the constituency center
            lat = c.latitude + (Math.random() * 0.05 - 0.025);
            lng = c.longitude + (Math.random() * 0.05 - 0.025);
          }
        }

        if (lat && lng) {
          const clr = s.severity >= 4 ? "#dc2626" : s.severity >= 3 ? "#ea580c" : "#16a34a";
          const sm = L.circleMarker([lat, lng], {
            radius: 8, color: clr, fillColor: clr, fillOpacity: 0.82, weight: 2,
          });
          sm.bindTooltip(
            `<b style="color:${clr}">${s.title}</b><div style="color:#6b7280;max-width:200px;margin-top:3px">${s.body}</div>`,
            { direction: "right", offset: L.point(10, 0) }
          );
          sm.addTo(currentMap);
          sigMarkers.push(sm);
        }
      });
    };

    // Render initially
    renderMarkers();

    // ── Debug sync ──────────────────────────────────────────────────────────
    const onMoveEnd = () => {
      const c = map.getCenter();
      setDebug({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    };
    map.on("moveend zoomend", onMoveEnd);

    return () => {
      map.off("moveend zoomend", onMoveEnd);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constituencies, signals]); // Re-render markers if LiveData context updates

  // ── Fly to state ───────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToState) return;
    const v = STATE_VIEWS[flyToState];
    if (v) map.flyTo([v[0], v[1]], v[2], { duration: 1.2 });
  }, [flyToState]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ✅ KEY: position:fixed + full viewport — identical to the working reference */}
      <div
        ref={divRef}
        style={{
          position: "fixed",
          top:    0,
          left:   0,
          width:  "100%",
          height: "100%",
          zIndex: 0,
          background: "#e8ecee",
        }}
      />

      {/* Debug HUD — floats above the map, below sidebars */}
      {debugModeEnabled && (
        <div
          style={{
            position:   "fixed",
            bottom:     40,
            left:       "50%",
            transform:  "translateX(-50%)",
            zIndex:     25,
            pointerEvents: "none",
            background: "rgba(0,0,0,0.85)",
            color:      "#22c55e",
            fontFamily: "monospace",
            fontSize:   10,
            padding:    "8px 14px",
            borderRadius: 6,
            border:     "1px solid rgba(34,197,94,0.3)",
            display:    "flex",
            gap:        16,
          }}
        >
          <span>● MAP DEBUG</span>
          <span>LAT: {debug.lat.toFixed(5)}</span>
          <span>LNG: {debug.lng.toFixed(5)}</span>
          <span>ZOOM: {debug.zoom.toFixed(1)}</span>
        </div>
      )}
    </>
  );
}
