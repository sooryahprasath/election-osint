"use client";

import dynamic from "next/dynamic";
import type { CenterMode } from "./CenterModeSwitcher";
import SignalsCenterPane from "./SignalsCenterPane";
import VideosCenterPane from "./VideosCenterPane";
import LiveCenterPane from "./LiveCenterPane";

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
  setActiveSignal: (s: any | null) => void;
  setActiveClusterSignals: (s: any[] | null) => void;
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
      <SignalsCenterPane
        globalStateFilter={globalStateFilter}
        setGlobalStateFilter={onChangeGlobalStateFilter}
        globalConstituencyId={globalConstituencyId}
        onSelectSignal={(s) => setActiveSignal(s)}
      />
    );
  if (mode === "videos") return <VideosCenterPane globalStateFilter={globalStateFilter} onSelectSignal={(s) => setActiveSignal(s)} />;
  if (mode === "live") return <LiveCenterPane activeTab={liveTab} onChangeTab={onChangeLiveTab} />;

  return (
    <IndiaMap
      flyToState={flyToState}
      activeState={globalStateFilter}
      activeConstituencyId={globalConstituencyId}
      onSelectConstituency={(id) => {
        setGlobalConstituencyId(id);
      }}
      onSelectState={(s) => {
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
  );
}

