"use client";

import VotingHud from "@/components/warroom/VotingHud";

export default function LiveCenterPane({
  activeTab,
  onChangeTab,
}: {
  activeTab: "TURNOUT" | "EXIT_POLLS";
  onChangeTab: (t: "TURNOUT" | "EXIT_POLLS") => void;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--surface-1)]">
      <VotingHud variant="embedded" chrome="content" activeTab={activeTab} onChangeTab={onChangeTab} />
    </section>
  );
}

