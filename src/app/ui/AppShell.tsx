"use client"

import { useEffect, useRef, useState } from "react"
import { Activity, BarChart3, Database, LayoutPanelTop, Sparkles } from "lucide-react"
import TopBar from "@/components/TopBar"
import BottomBar from "@/components/BottomBar"
import SignalPane from "@/components/signals/SignalPane"
import IntelPane from "@/components/intel/IntelPane"
import SignalModal from "@/components/signals/SignalModal"
import SignalClusterModal from "@/components/signals/SignalClusterModal"
import { useLiveData } from "@/lib/context/LiveDataContext"
import CenterPane from "@/components/center/CenterPane"
import { CenterModeSwitcher, type CenterMode } from "@/components/center/CenterModeSwitcher"
import { centerModeForSignal } from "@/lib/utils/signalClassifier"
import { shouldShowWarRoomCenterTab } from "@/lib/utils/centerDefaultMode"

const TOPBAR_H = 40

export default function AppShell() {
  type Signal = Record<string, unknown>
  const { operationMode, simulatedDate } = useLiveData()

  const [flyToState, setFlyToState] = useState<string | null>(null)
  const [globalStateFilter, setGlobalStateFilter] = useState<string>("ALL")
  const [globalConstituencyId, setGlobalConstituencyId] = useState<string | null>(null)
  const [activeSignal, setActiveSignal] = useState<Signal | null>(null)
  const [activeClusterSignals, setActiveClusterSignals] = useState<Signal[] | null>(null)
  const [mobileTab, setMobileTab] = useState<"briefing" | "center" | "intel">("center")
  const [centerMode, setCenterMode] = useState<CenterMode>("insights")
  const [liveTab, setLiveTab] = useState<"TURNOUT" | "EXIT_POLLS">("TURNOUT")

  const [mapOverlayMode, setMapOverlayMode] = useState<"VIDEOS" | "ALL">("VIDEOS")
  const [mapVerifiedOnly, setMapVerifiedOnly] = useState(false)

  const [, setMapZoom] = useState(1)
  const [resetTrigger] = useState(0)
  const [stateViewSnapTrigger] = useState(0)

  const [isTabletUp, setIsTabletUp] = useState(false)
  useEffect(() => {
    const tabMq = window.matchMedia("(min-width: 820px)")
    const applyTab = () => setIsTabletUp(tabMq.matches)
    applyTab()
    tabMq.addEventListener("change", applyTab)
    return () => {
      tabMq.removeEventListener("change", applyTab)
    }
  }, [])

  const centerDefaultAppliedRef = useRef(false)
  useEffect(() => {
    if (centerDefaultAppliedRef.current) return
    centerDefaultAppliedRef.current = true
    queueMicrotask(() => {
      setCenterMode("insights")
      setMobileTab("center")
    })
  }, [simulatedDate, operationMode])

  const effectiveWallNow = simulatedDate ?? new Date()
  const showWarRoomCenter = shouldShowWarRoomCenterTab(effectiveWallNow) && operationMode !== "PRE-POLL"

  useEffect(() => {
    if (!showWarRoomCenter && centerMode === "live") {
      queueMicrotask(() => setCenterMode("insights"))
    }
  }, [showWarRoomCenter, centerMode])

  const handleStateFilter = (s: string) => {
    setGlobalStateFilter(s)
    setGlobalConstituencyId(null)
    setFlyToState(s === "ALL" ? "India" : s)
  }

  const backToMapFromIntel = () => {
    setMobileTab("center")
    setCenterMode("map")
  }

  const mobilePaneForMapChrome: "signals" | "map" | "intel" | "warroom" =
    mobileTab === "briefing" ? "signals" : mobileTab === "intel" ? "intel" : centerMode === "map" ? "map" : "signals"

  return (
    <>
      <TopBar onSelectTickerSignal={(s) => setActiveSignal(s as Signal)} />

      <main
        className={`fixed z-30 bg-[var(--surface-0)] overflow-hidden left-0 lg:left-[288px] ${
          isTabletUp ? "right-[288px]" : "right-0"
        } ${mobileTab === "center" || isTabletUp ? "block" : "hidden"} lg:block`}
        style={{
          top: TOPBAR_H,
          bottom: "calc(var(--map-footer-stack, 28px) + var(--war-hud-reserve, 0px))",
        }}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex w-full min-w-0 items-center justify-center border-b border-[color:var(--border)] bg-[var(--surface-1)] px-2 py-2.5 sm:px-4">
            <CenterModeSwitcher
              value={centerMode}
              onChange={setCenterMode}
              showLive={showWarRoomCenter}
              liveLabel={
                operationMode === "COUNTING_DAY"
                  ? "Counting live"
                  : operationMode !== "PRE-POLL"
                    ? "Voting live"
                    : "Live"
              }
            />
          </div>

          {centerMode === "live" ? (
            <div className="flex items-center justify-center gap-2 border-b border-[color:var(--border)] bg-[var(--surface-1)] px-3 py-2">
              <div className="eb-pills" role="tablist" aria-label="Live tabs">
                <button
                  type="button"
                  role="tab"
                  aria-selected={liveTab === "TURNOUT"}
                  data-active={liveTab === "TURNOUT"}
                  onClick={() => setLiveTab("TURNOUT")}
                  className="eb-pill"
                >
                  <Activity className="h-3.5 w-3.5" aria-hidden /> Live turnout
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={liveTab === "EXIT_POLLS"}
                  data-active={liveTab === "EXIT_POLLS"}
                  onClick={() => setLiveTab("EXIT_POLLS")}
                  className="eb-pill"
                >
                  <BarChart3 className="h-3.5 w-3.5" aria-hidden /> Exit polls
                </button>
              </div>
            </div>
          ) : null}

          <CenterPane
            mode={centerMode}
            globalStateFilter={globalStateFilter}
            onChangeGlobalStateFilter={handleStateFilter}
            globalConstituencyId={globalConstituencyId}
            setGlobalConstituencyId={setGlobalConstituencyId}
            flyToState={flyToState}
            setFlyToState={setFlyToState}
            resetTrigger={resetTrigger}
            stateViewSnapTrigger={stateViewSnapTrigger}
            onZoomChange={setMapZoom}
            mapOverlayMode={mapOverlayMode}
            setMapOverlayMode={setMapOverlayMode}
            mapVerifiedOnly={mapVerifiedOnly}
            toggleMapVerifiedOnly={() => setMapVerifiedOnly((v) => !v)}
            mobilePaneForMapChrome={mobilePaneForMapChrome}
            liveTab={liveTab}
            onChangeLiveTab={setLiveTab}
            setActiveSignal={(s) => setActiveSignal(s as Signal | null)}
            setActiveClusterSignals={(s) => setActiveClusterSignals(s as Signal[] | null)}
          />
        </div>
      </main>

      <aside
        className={`fixed left-0 z-40 flex w-full flex-col overflow-hidden border-r border-[color:var(--border)] bg-[var(--surface-1)] transition-transform duration-300 lg:w-[288px] ${
          mobileTab === "briefing" ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
        style={{
          top: TOPBAR_H,
          bottom: "calc(var(--map-footer-stack, 28px) + var(--war-hud-reserve, 0px))",
        }}
      >
        <SignalPane
          globalStateFilter={globalStateFilter}
          globalConstituencyId={globalConstituencyId}
          centerMode={centerMode}
          onChangeGlobalStateFilter={handleStateFilter}
          onSelectSignal={(s: Signal) => {
            const sig = s
            setActiveSignal(sig)
            setCenterMode(centerModeForSignal(sig))
            setMobileTab("center")
          }}
          onOpenSignals={() => {
            setMobileTab("center")
            setCenterMode("signals")
          }}
        />
      </aside>

      <aside
        className={`fixed right-0 z-40 flex min-h-0 flex-col overflow-hidden border-l border-[color:var(--border)] bg-[var(--surface-1)] transition-transform duration-300 ${
          isTabletUp ? "w-[288px] translate-x-0" : `w-full ${mobileTab === "intel" ? "translate-x-0" : "translate-x-full"}`
        }`}
        style={{
          top: TOPBAR_H,
          bottom: "calc(var(--map-footer-stack, 28px) + var(--war-hud-reserve, 0px))",
        }}
      >
        <IntelPane
          globalStateFilter={globalStateFilter}
          setGlobalStateFilter={handleStateFilter}
          globalConstituencyId={globalConstituencyId}
          setGlobalConstituencyId={setGlobalConstituencyId}
          onBackToMap={isTabletUp ? undefined : backToMapFromIntel}
        />
      </aside>

      {!isTabletUp ? (
        <nav
          className="fixed bottom-0 left-0 right-0 z-[100] flex min-h-14 items-stretch border-t border-[color:var(--border)] bg-[var(--surface-1)] pb-safe shadow-[0_-4px_24px_rgba(0,0,0,0.06)] lg:hidden"
          style={{ minHeight: 56 }}
          aria-label="Primary"
        >
          <button
            type="button"
            onClick={() => setMobileTab("briefing")}
            aria-label="Feed"
            aria-pressed={mobileTab === "briefing"}
            className={`hit-44 flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              mobileTab === "briefing" ? "text-[var(--brand)]" : "text-[var(--text-muted)]"
            }`}
          >
            <Sparkles className="h-5 w-5 shrink-0" aria-hidden />
            Feed
            <span
              className={`mt-0.5 h-0.5 w-6 rounded-full ${mobileTab === "briefing" ? "bg-[var(--brand)]" : "bg-transparent"}`}
            />
          </button>
          <button
            type="button"
            onClick={() => setMobileTab("center")}
            aria-label="Dashboard"
            aria-pressed={mobileTab === "center"}
            className={`hit-44 flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              mobileTab === "center" ? "text-[var(--brand)]" : "text-[var(--text-muted)]"
            }`}
          >
            <LayoutPanelTop className="h-5 w-5 shrink-0" aria-hidden />
            Dashboard
            <span
              className={`mt-0.5 h-0.5 w-6 rounded-full ${mobileTab === "center" ? "bg-[var(--brand)]" : "bg-transparent"}`}
            />
          </button>
          <button
            type="button"
            onClick={() => setMobileTab("intel")}
            aria-label="Seats"
            aria-pressed={mobileTab === "intel"}
            className={`hit-44 flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              mobileTab === "intel" ? "text-[var(--brand)]" : "text-[var(--text-muted)]"
            }`}
          >
            <Database className="h-5 w-5 shrink-0" aria-hidden />
            Seats
            <span
              className={`mt-0.5 h-0.5 w-6 rounded-full ${mobileTab === "intel" ? "bg-[var(--brand)]" : "bg-transparent"}`}
            />
          </button>
        </nav>
      ) : null}

      <BottomBar />

      {activeSignal ? <SignalModal signal={activeSignal} onClose={() => setActiveSignal(null)} /> : null}

      {activeClusterSignals ? (
        <SignalClusterModal
          signals={activeClusterSignals}
          onClose={() => setActiveClusterSignals(null)}
          onPick={(s: Signal) => setActiveSignal(s)}
        />
      ) : null}
    </>
  )
}

