"use client"

import { useEffect, useRef, useState } from "react"
import { Activity, BarChart3 } from "lucide-react"
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
  const [moreOpen, setMoreOpen] = useState(false)
  const [liveTab, setLiveTab] = useState<"TURNOUT" | "EXIT_POLLS">("TURNOUT")
  const [mapActionsOpen, setMapActionsOpen] = useState(false)
  const mapActionsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mapActionsOpen) return
    const onDown = (e: MouseEvent) => {
      const el = mapActionsRef.current
      if (el && !el.contains(e.target as Node)) setMapActionsOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [mapActionsOpen])

  const [mapOverlayMode, setMapOverlayMode] = useState<"VIDEOS" | "ALL">("VIDEOS")
  const [mapVerifiedOnly, setMapVerifiedOnly] = useState(false)

  const [mapZoom, setMapZoom] = useState(1)
  const [resetTrigger, setResetTrigger] = useState(0)
  const [stateViewSnapTrigger, setStateViewSnapTrigger] = useState(0)

  const [isMdUp, setIsMdUp] = useState(false)
  const [isTabletUp, setIsTabletUp] = useState(false)
  useEffect(() => {
    const lgMq = window.matchMedia("(min-width: 1024px)")
    const tabMq = window.matchMedia("(min-width: 820px)")
    const applyLg = () => setIsMdUp(lgMq.matches)
    const applyTab = () => setIsTabletUp(tabMq.matches)
    applyLg()
    applyTab()
    lgMq.addEventListener("change", applyLg)
    tabMq.addEventListener("change", applyTab)
    return () => {
      lgMq.removeEventListener("change", applyLg)
      tabMq.removeEventListener("change", applyTab)
    }
  }, [])

  const centerDefaultAppliedRef = useRef(false)
  useEffect(() => {
    if (centerDefaultAppliedRef.current) return
    centerDefaultAppliedRef.current = true
    setCenterMode("insights")
    setMobileTab("center")
  }, [simulatedDate, operationMode])

  const effectiveWallNow = simulatedDate ?? new Date()
  const showWarRoomCenter = shouldShowWarRoomCenterTab(effectiveWallNow) && operationMode !== "PRE-POLL"

  useEffect(() => {
    if (!showWarRoomCenter && centerMode === "live") setCenterMode("insights")
  }, [showWarRoomCenter, centerMode])

  const showMapResetButton = centerMode === "map" && (isMdUp || mobileTab === "center")

  const handleStateFilter = (s: string) => {
    setGlobalStateFilter(s)
    setGlobalConstituencyId(null)
    setFlyToState(s === "ALL" ? "India" : s)
  }

  const handleResetZoom = () => {
    setGlobalStateFilter("ALL")
    setGlobalConstituencyId(null)
    setFlyToState("India")
    setResetTrigger((prev) => prev + 1)
    if (!isTabletUp) {
      setMobileTab("center")
      setCenterMode("map")
    }
  }

  const backToMapFromIntel = () => {
    setMobileTab("center")
    setCenterMode("map")
  }

  const atStateDefaultView = globalStateFilter !== "ALL" && !globalConstituencyId && mapZoom <= 1.12

  void showMapResetButton
  void handleResetZoom
  void atStateDefaultView

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

      <aside className="fixed top-10 left-0 hidden h-[calc(100%-40px)] w-[288px] border-r border-[color:var(--border)] bg-[var(--surface-1)] lg:flex flex-col">
        <SignalPane
          globalStateFilter={globalStateFilter}
          onChangeGlobalStateFilter={handleStateFilter}
          onSelectSignal={(s: Signal) => {
            const sig = s
            setActiveSignal(sig)
            setCenterMode(centerModeForSignal(sig))
            setMobileTab("center")
          }}
          onSelectSignalCluster={(s: Signal[]) => setActiveClusterSignals(s)}
        />
      </aside>

      <aside
        className={`fixed top-10 right-0 h-[calc(100%-40px)] w-[288px] border-l border-[color:var(--border)] bg-[var(--surface-1)] ${
          isTabletUp ? "flex" : "hidden"
        } flex-col`}
      >
        <IntelPane
          globalStateFilter={globalStateFilter}
          setGlobalStateFilter={handleStateFilter}
          globalConstituencyId={globalConstituencyId}
          setGlobalConstituencyId={setGlobalConstituencyId}
        />
      </aside>

      {!isTabletUp ? (
        <div className={mobileTab === "intel" ? "block" : "hidden"}>
          <IntelPane
            globalStateFilter={globalStateFilter}
            setGlobalStateFilter={handleStateFilter}
            globalConstituencyId={globalConstituencyId}
            setGlobalConstituencyId={setGlobalConstituencyId}
            onBackToMap={backToMapFromIntel}
          />
        </div>
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

