"use client";

import { useState, useEffect, useRef } from "react";
import { Sparkles, Database, LayoutPanelTop, Activity, BarChart3, ChevronDown, Layers, Globe2, MapPinned, Clapperboard } from "lucide-react";
import TopBar from "@/components/TopBar";
import BottomBar from "@/components/BottomBar";
import SignalPane from "@/components/signals/SignalPane";
import IntelPane from "@/components/intel/IntelPane";
import SignalModal from "@/components/signals/SignalModal";
import SignalClusterModal from "@/components/signals/SignalClusterModal";
import { useLiveData } from "@/lib/context/LiveDataContext";
import CenterPane from "@/components/center/CenterPane";
import { CenterModeSwitcher, type CenterMode } from "@/components/center/CenterModeSwitcher";
import { centerModeForSignal } from "@/lib/utils/signalClassifier";

const TOPBAR_H = 36;
const SIDEBAR_W = 280;

export default function Home() {
  type Signal = Record<string, unknown>;
  const { operationMode } = useLiveData();
  const [flyToState, setFlyToState] = useState<string | null>(null);
  const [globalStateFilter, setGlobalStateFilter] = useState<string>("ALL");
  const [globalConstituencyId, setGlobalConstituencyId] = useState<string | null>(null);
  const [activeSignal, setActiveSignal] = useState<Signal | null>(null);
  const [activeClusterSignals, setActiveClusterSignals] = useState<Signal[] | null>(null);
  const [mobileTab, setMobileTab] = useState<"briefing" | "center" | "intel">("center");
  const [centerMode, setCenterMode] = useState<CenterMode>("signals");
  const [moreOpen, setMoreOpen] = useState(false);
  const [liveTab, setLiveTab] = useState<"TURNOUT" | "EXIT_POLLS">("TURNOUT");
  const [mapActionsOpen, setMapActionsOpen] = useState(false);
  // Tracks whether the Intel pane was opened from the map chrome on mobile.
  const [, setIntelBackToMap] = useState(false);
  const mapActionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapActionsOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = mapActionsRef.current;
      if (el && !el.contains(e.target as Node)) setMapActionsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [mapActionsOpen]);

  // Map overlay toggles (clarifies what the tiles represent)
  const [mapOverlayMode, setMapOverlayMode] = useState<"VIDEOS" | "ALL">("VIDEOS");
  const [mapVerifiedOnly, setMapVerifiedOnly] = useState(false);

  // FIX: Added state to track map zoom level for the reset button
  const [mapZoom, setMapZoom] = useState(1);
  const [resetTrigger, setResetTrigger] = useState(0);
  /** Bump to snap map camera back to default for current state (without going national). */
  const [stateViewSnapTrigger, setStateViewSnapTrigger] = useState(0);

  /** Map reset chrome: only show when Map is the active center mode. */
  const [isMdUp, setIsMdUp] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setIsMdUp(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // When voting/counting starts, bias toward the Live monitor in Center (mobile-first).
  useEffect(() => {
    if (operationMode === "PRE-POLL") return;
    queueMicrotask(() => {
      setMobileTab("center");
      setCenterMode("live");
    });
  }, [operationMode]);

  const showMapResetButton = centerMode === "map" && (isMdUp || mobileTab === "center");

  const handleStateFilter = (s: string) => {
    setGlobalStateFilter(s);
    setGlobalConstituencyId(null);
    setFlyToState(s === "ALL" ? "India" : s);
  };

  const handleResetZoom = () => {
    setGlobalStateFilter("ALL");
    setGlobalConstituencyId(null);
    setFlyToState("India");
    setResetTrigger(prev => prev + 1); // Triggers the map to completely reset viewport
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setMobileTab("center");
      setCenterMode("map");
    }
  };

  const openIntelFromMap = () => {
    setIntelBackToMap(true);
    setMobileTab("intel");
    setMapActionsOpen(false);
  };

  const backToMapFromIntel = () => {
    setIntelBackToMap(false);
    setMobileTab("center");
    setCenterMode("map");
  };

  /** True when map is already at “state default” (no AC selected, zoom not pinched past baseline). */
  const atStateDefaultView =
    globalStateFilter !== "ALL" && !globalConstituencyId && mapZoom <= 1.12;

  const handleMapChromeResetClick = () => {
    if (globalStateFilter === "ALL") {
      handleResetZoom();
      return;
    }
    if (!atStateDefaultView) {
      setGlobalConstituencyId(null);
      setStateViewSnapTrigger((n) => n + 1);
      return;
    }
    handleResetZoom();
  };

  const mobilePaneForMapChrome: "signals" | "map" | "intel" | "warroom" =
    mobileTab === "briefing"
      ? "signals"
      : mobileTab === "intel"
        ? "intel"
        : centerMode === "map"
          ? "map"
          : "signals";

  return (
    <>
      <TopBar onSelectTickerSignal={(s) => setActiveSignal(s as Signal)} />

      {/* Center Pane Shell (desktop: between sidebars; mobile: full content under Center tab) */}
      <main
        className="fixed z-30 bg-[var(--surface-1)]/95 backdrop-blur-md border-x border-[color:var(--border)] overflow-hidden"
        style={{
          top: TOPBAR_H,
          bottom: "calc(var(--map-footer-stack, 28px) + var(--war-hud-reserve, 0px))",
          left: isMdUp ? SIDEBAR_W : 0,
          right: isMdUp ? SIDEBAR_W : 0,
          display: isMdUp || mobileTab === "center" ? "block" : "none",
        }}
      >
        <div className="flex h-full min-h-0 flex-col">
          {/* Keep map full-bleed: show mode switcher as a floating pill on map. */}
          {centerMode === "map" ? (
            <div className="pointer-events-none absolute right-2 top-2 z-[60]">
              <div className="pointer-events-auto">
                <CenterModeSwitcher
                  value={centerMode}
                  onChange={setCenterMode}
                  showLive={operationMode !== "PRE-POLL"}
                  liveLabel={operationMode === "VOTING_DAY" ? "VOTING LIVE" : operationMode === "COUNTING_DAY" ? "COUNTING LIVE" : "LIVE"}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 border-b border-[color:var(--border)] bg-[var(--surface-1)]/90 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <LayoutPanelTop className="h-4 w-4 text-[var(--text-secondary)]" />
                <span className="font-mono text-[10px] font-bold tracking-wider text-[var(--text-secondary)]">
                  CENTER
                </span>
              </div>
              <div className="flex items-center gap-2">
                <CenterModeSwitcher
                  value={centerMode}
                  onChange={setCenterMode}
                  showLive={operationMode !== "PRE-POLL"}
                  liveLabel={operationMode === "VOTING_DAY" ? "VOTING LIVE" : operationMode === "COUNTING_DAY" ? "COUNTING LIVE" : "LIVE"}
                />
                {/* Hidden for now (per UX feedback). */}
              </div>
            </div>
          )}

          {centerMode === "live" ? (
            <div className="flex items-center gap-2 border-b border-[color:var(--border)] bg-[var(--surface-1)]/80 px-2.5 py-2">
              <div className="flex flex-1 overflow-hidden rounded-none border border-[color:var(--border)] bg-[var(--surface-2)] p-0.5 md:max-w-md">
                <button
                  type="button"
                  onClick={() => setLiveTab("TURNOUT")}
                  className={`flex flex-1 items-center justify-center gap-1 px-2 py-1 font-mono text-[9px] font-bold tracking-wide transition-colors ${
                    liveTab === "TURNOUT" ? "bg-[var(--surface-1)] text-[#0284c7] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-3)]"
                  }`}
                >
                  <Activity className="h-3 w-3 shrink-0" /> LIVE TURNOUT
                </button>
                <button
                  type="button"
                  onClick={() => setLiveTab("EXIT_POLLS")}
                  className={`flex flex-1 items-center justify-center gap-1 px-2 py-1 font-mono text-[9px] font-bold tracking-wide transition-colors ${
                    liveTab === "EXIT_POLLS" ? "bg-[var(--surface-1)] text-[#ea580c] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-3)]"
                  }`}
                >
                  <BarChart3 className="h-3 w-3 shrink-0" /> EXIT POLLS
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex-1 min-h-0">
            <CenterPane
              mode={centerMode}
              globalStateFilter={globalStateFilter}
              onChangeGlobalStateFilter={handleStateFilter}
              liveTab={liveTab}
              onChangeLiveTab={setLiveTab}
              globalConstituencyId={globalConstituencyId}
              setGlobalConstituencyId={setGlobalConstituencyId}
              flyToState={flyToState}
              setFlyToState={setFlyToState}
              setActiveSignal={(s) => setActiveSignal(s == null ? null : (s as Signal))}
              setActiveClusterSignals={(s) => setActiveClusterSignals(s == null ? null : (s as Signal[]))}
              mapOverlayMode={mapOverlayMode}
              setMapOverlayMode={setMapOverlayMode}
              mapVerifiedOnly={mapVerifiedOnly}
              toggleMapVerifiedOnly={() => setMapVerifiedOnly((v) => !v)}
              resetTrigger={resetTrigger}
              stateViewSnapTrigger={stateViewSnapTrigger}
              onZoomChange={setMapZoom}
              mobilePaneForMapChrome={mobilePaneForMapChrome}
            />
          </div>
        </div>
      </main>

      <aside className={`fixed top-[36px] bottom-[48px] md:bottom-[28px] left-0 w-full md:w-[280px] z-40 bg-[var(--surface-1)]/95 backdrop-blur-md border-r border-[color:var(--border)] transition-transform duration-300 ${mobileTab === "briefing" ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
        <SignalPane
          globalStateFilter={globalStateFilter}
          globalConstituencyId={globalConstituencyId}
          centerMode={centerMode}
          onChangeGlobalStateFilter={handleStateFilter}
          onSelectSignal={(s: unknown) => {
            setActiveSignal(s as Signal);
            const nextMode = centerModeForSignal(s);
            setCenterMode(nextMode);
            if (typeof window !== "undefined" && window.innerWidth < 768) setMobileTab("center");
          }}
          onOpenSignals={() => {
            setMobileTab("center");
            setCenterMode("signals");
          }}
        />
      </aside>

      <aside className={`fixed top-[36px] bottom-[48px] md:bottom-[28px] right-0 flex min-h-0 w-full flex-col overflow-hidden md:w-[280px] z-40 bg-[var(--surface-1)]/95 backdrop-blur-md border-l border-[color:var(--border)] transition-transform duration-300 ${mobileTab === "intel" ? "translate-x-0" : "translate-x-full md:translate-x-0"}`}>
        <IntelPane
          globalStateFilter={globalStateFilter}
          setGlobalStateFilter={handleStateFilter}
          globalConstituencyId={globalConstituencyId}
          setGlobalConstituencyId={setGlobalConstituencyId}
          // Mobile: always allow jumping to map for the current state, even if Intel was opened directly.
          onBackToMap={backToMapFromIntel}
        />
      </aside>

      {/* DESKTOP & MOBILE FLOATING RESET BUTTON */}
      {/* FIX: Button appears if a state is selected, a constituency is selected, OR if the user manually zoomed the map in! */}
      {showMapResetButton &&
        (globalConstituencyId != null ||
          mapZoom > 1.15 ||
          globalStateFilter !== "ALL") && (
        <div
          className="fixed left-1/2 z-[58] flex -translate-x-1/2 flex-col items-center gap-2 animate-fade-in-up md:flex-row"
          style={{
            bottom: "calc(var(--map-footer-stack, 28px) + 22px + var(--war-hud-reserve, 0px))",
          }}
        >
          <div ref={mapActionsRef} className="relative">
            <button
              type="button"
              onClick={() => setMapActionsOpen((v) => !v)}
              className="flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[var(--surface-1)]/95 px-4 py-2 text-sm font-medium text-[var(--text-primary)] shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.06)] backdrop-blur-md transition-[transform,box-shadow] hover:bg-[var(--surface-2)] active:scale-[0.98]"
              aria-expanded={mapActionsOpen}
              aria-haspopup="menu"
            >
              <Layers className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />
              Map
              <ChevronDown className={`h-4 w-4 text-[var(--text-muted)] transition-transform duration-200 ${mapActionsOpen ? "rotate-180" : ""}`} aria-hidden />
            </button>

            {mapActionsOpen ? (
              <div
                className="absolute bottom-full left-1/2 z-[59] mb-2 w-[min(288px,calc(100vw-1.5rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[var(--surface-1)] shadow-[0_8px_32px_rgba(0,0,0,0.2)] backdrop-blur-md"
                role="menu"
                aria-label="Map actions"
              >
                <div className="border-b border-[color:var(--border)] px-3 py-2">
                  <p className="text-xs font-medium text-[var(--text-muted)]">Map actions</p>
                </div>
                <div className="p-1.5">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      handleMapChromeResetClick();
                      setMapActionsOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text-muted)]">
                      {globalStateFilter === "ALL" || atStateDefaultView ? (
                        <Globe2 className="h-5 w-5" aria-hidden />
                      ) : (
                        <MapPinned className="h-5 w-5" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-[var(--text-primary)]">
                        {globalStateFilter === "ALL" || atStateDefaultView ? "National overview" : "State overview"}
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-[var(--text-muted)]">
                        {globalStateFilter === "ALL" || atStateDefaultView
                          ? "Reset zoom and show all states"
                          : "Fit map to this state again"}
                      </span>
                    </span>
                  </button>

                  {!isMdUp && mobileTab === "center" && centerMode === "map" ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={openIntelFromMap}
                      className="mt-0.5 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text-muted)]">
                        <Database className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-[var(--text-primary)]">State intel</span>
                        <span className="mt-0.5 block text-xs leading-snug text-[var(--text-muted)]">Constituencies, list &amp; hotspots</span>
                      </span>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMapOverlayMode((m) => (m === "VIDEOS" ? "ALL" : "VIDEOS"));
                      setMapActionsOpen(false);
                    }}
                    className="mt-0.5 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-[var(--surface-2)] active:bg-[var(--surface-2)]"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text-muted)]">
                      {mapOverlayMode === "VIDEOS" ? (
                        <Layers className="h-5 w-5" aria-hidden />
                      ) : (
                        <Clapperboard className="h-5 w-5" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-[var(--text-primary)]">
                        {mapOverlayMode === "VIDEOS" ? "All signal markers" : "Video markers only"}
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-[var(--text-muted)]">
                        {mapOverlayMode === "VIDEOS"
                          ? "Show every OSINT point on the map"
                          : "Limit the map to video tiles"}
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div className="md:hidden fixed bottom-0 left-0 right-0 h-[48px] bg-[var(--surface-1)] border-t border-[color:var(--border)] z-50 flex shadow-lg">
        <button onClick={() => setMobileTab("briefing")} className={`flex-1 flex flex-col items-center justify-center gap-1 font-mono text-[10px] ${mobileTab === "briefing" ? "text-[#16a34a] bg-[#16a34a]/10 border-t-2 border-[#16a34a]" : "text-[var(--text-muted)]"}`}><Sparkles className="h-4 w-4" /> AI BRIEFING</button>
        <button
          onClick={() => { setMobileTab('center'); }}
          className={`flex-1 flex flex-col items-center justify-center gap-1 font-mono text-[10px] ${mobileTab === 'center' ? 'text-[#16a34a] bg-[#16a34a]/10 border-t-2 border-[#16a34a]' : 'text-[var(--text-muted)]'}`}
        >
          <LayoutPanelTop className="h-4 w-4" /> CENTER
        </button>
        <button onClick={() => { setIntelBackToMap(false); setMobileTab('intel'); }} className={`flex-1 flex flex-col items-center justify-center gap-1 font-mono text-[10px] ${mobileTab === 'intel' ? 'text-[#ea580c] bg-[#ea580c]/10 border-t-2 border-[#ea580c]' : 'text-[var(--text-muted)]'}`}><Database className="h-4 w-4" /> INTEL</button>
      </div>

      <BottomBar />
      {activeClusterSignals && activeClusterSignals.length > 0 && (
        <SignalClusterModal
          signals={activeClusterSignals}
          onClose={() => setActiveClusterSignals(null)}
          onPick={(s) => {
            setActiveClusterSignals(null);
            setActiveSignal(s as Signal);
          }}
        />
      )}
      {activeSignal && <SignalModal signal={activeSignal} onClose={() => setActiveSignal(null)} />}

      {moreOpen ? (
        <div className="fixed inset-0 z-[90] flex items-end md:items-center justify-center bg-black/40 p-2" role="dialog" aria-modal="true">
          <div className="w-full max-w-[520px] rounded-xl border border-[color:var(--border)] bg-[var(--surface-1)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-3">
              <div className="font-mono text-[11px] font-bold tracking-wider text-[var(--text-secondary)]">MORE</div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="rounded-md border border-[color:var(--border)] bg-[var(--surface-1)] px-2 py-1 font-mono text-[10px] font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
              >
                CLOSE
              </button>
            </div>
            <div className="px-4 py-3">
              <div className="grid gap-2">
                <button
                  type="button"
                  className="w-full rounded-lg border border-[color:var(--border)] bg-[var(--surface-1)] px-3 py-2 text-left hover:bg-[var(--surface-2)]"
                  onClick={() => {
                    setCenterMode("signals");
                    setMobileTab("center");
                    setMoreOpen(false);
                  }}
                >
                  <div className="font-mono text-[10px] font-bold text-[#16a34a] tracking-wider">OPEN INTELLIGENCE FEED</div>
                  <div className="text-[12px] text-[var(--text-secondary)]">Center → Signals tab: full OSINT list with state filters.</div>
                </button>
                <div className="rounded-lg border border-[color:var(--border)] bg-[var(--surface-2)] px-3 py-2">
                  <div className="font-mono text-[10px] font-bold text-[var(--text-secondary)] tracking-wider">PHASE 1</div>
                  <div className="mt-1 text-[12px] text-[var(--text-secondary)] leading-relaxed">
                    Shell + navigation first. Next: true corroboration logic, handle allowlists, and archive-backed timelines.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}