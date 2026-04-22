"use client";

import dynamic from "next/dynamic";
import type { CenterMode } from "./CenterModeSwitcher";
import SignalsCenterPane from "./SignalsCenterPane";
import VideosCenterPane from "./VideosCenterPane";
import LiveCenterPane from "./LiveCenterPane";
import { OpinionPollsPane } from "@/components/polls/OpinionPollsPane";
import InsightsCenterPane from "./InsightsCenterPane";

// Dynamic import with no SSR (react-simple-maps)
const IndiaMap = dynamic(() => import("@/components/map/IndiaMap"), { ssr: false });

export default function CenterPane({
  mode,
  globalStateFilter,
  onChangeGlobalStateFilter,
  liveTab,
  onChangeLiveTab,
  globalConstituencyId,
  setGlobalConstituencyId,
  flyToState,
  setFlyToState,
  setActiveSignal,
  setActiveClusterSignals,
  mapOverlayMode,
  setMapOverlayMode,
  mapVerifiedOnly,
  toggleMapVerifiedOnly,
  resetTrigger,
  stateViewSnapTrigger,
  onZoomChange,
  mobilePaneForMapChrome,
}: {
  mode: CenterMode;
  globalStateFilter: string;
  onChangeGlobalStateFilter: (s: string) => void;
  liveTab: "TURNOUT" | "EXIT_POLLS";
  onChangeLiveTab: (t: "TURNOUT" | "EXIT_POLLS") => void;
  globalConstituencyId: string | null;
  setGlobalConstituencyId: (id: string | null) => void;
  flyToState: string | null;
  setFlyToState: (s: string | null) => void;
  setActiveSignal: (s: unknown | null) => void;
  setActiveClusterSignals: (s: unknown[] | null) => void;
  mapOverlayMode: "VIDEOS" | "ALL";
  setMapOverlayMode: (m: "VIDEOS" | "ALL") => void;
  mapVerifiedOnly: boolean;
  toggleMapVerifiedOnly: () => void;
  resetTrigger: number;
  stateViewSnapTrigger: number;
  onZoomChange: (z: number) => void;
  mobilePaneForMapChrome: "signals" | "map" | "intel" | "warroom";
}) {
  if (mode === "signals")
    return (
      <div data-view="news" className="h-full min-h-0">
        <SignalsCenterPane
          globalStateFilter={globalStateFilter}
          setGlobalStateFilter={onChangeGlobalStateFilter}
          globalConstituencyId={globalConstituencyId}
          onSelectSignal={(s) => setActiveSignal(s)}
        />
      </div>
    );
  if (mode === "videos")
    return (
      <div data-view="videos" className="h-full min-h-0">
        <VideosCenterPane globalStateFilter={globalStateFilter} onSelectSignal={(s) => setActiveSignal(s)} />
      </div>
    );
  if (mode === "live")
    return (
      <div data-view="live" className="h-full min-h-0">
        <LiveCenterPane activeTab={liveTab} onChangeTab={onChangeLiveTab} />
      </div>
    );
  if (mode === "polls")
    return (
      <div data-view="polls" className="h-full min-h-0">
        <OpinionPollsPane />
      </div>
    );
  if (mode === "insights")
    return (
      <div data-view="insights" className="h-full min-h-0 overflow-y-auto">
        <InsightsCenterPane
          globalStateFilter={globalStateFilter}
          globalConstituencyId={globalConstituencyId}
          onChangeGlobalStateFilter={onChangeGlobalStateFilter}
          onSelectConstituency={(id) => {
            if (typeof setGlobalConstituencyId !== "function") return;
            setGlobalConstituencyId(id);
          }}
        />
      </div>
    );

  return (
    <div data-view="map" className="h-full min-h-0">
      <IndiaMap
        flyToState={flyToState}
        activeState={globalStateFilter}
        activeConstituencyId={globalConstituencyId}
        onSelectConstituency={(id) => {
          if (typeof setGlobalConstituencyId !== "function") return;
          setGlobalConstituencyId(id);
        }}
        onSelectState={(s) => {
          if (typeof setGlobalConstituencyId !== "function") return;
          setGlobalConstituencyId(null);
          onChangeGlobalStateFilter(s);
          setFlyToState(s === "ALL" ? "India" : s);
        }}
        onSelectSignal={setActiveSignal}
        onSelectSignalCluster={setActiveClusterSignals}
        mobilePane={mobilePaneForMapChrome}
        resetTrigger={resetTrigger}
        stateViewSnapTrigger={stateViewSnapTrigger}
        onZoomChange={onZoomChange}
        overlayMode={mapOverlayMode}
        verifiedOnly={mapVerifiedOnly}
        onChangeOverlayMode={setMapOverlayMode}
        onToggleVerifiedOnly={toggleMapVerifiedOnly}
      />
    </div>
  );
}

