"use client";

import SignalCardBase from "@/components/signals/SignalCardBase";

interface SignalCardProps {
  signal: any;
  tick?: number; // 🔥 FIX: Accept the tick to force re-evaluation of relativeTime
  onClick: () => void;
}

export default function SignalCard({ signal, tick, onClick }: SignalCardProps) {
  void tick;
  return <SignalCardBase signal={signal} onClick={onClick} tone="plain" />;
}