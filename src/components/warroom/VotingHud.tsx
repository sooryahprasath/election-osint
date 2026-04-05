"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown, Activity, BarChart3, Clock, PieChart, CheckCircle2, ExternalLink, X } from "lucide-react";
import { useLiveData } from "@/lib/context/LiveDataContext";
import { ELECTION_DATES } from "@/lib/utils/countdown";

export default function VotingHud({ isMobileOpen, onCloseMobile }: { isMobileOpen?: boolean; onCloseMobile?: () => void }) {
    const { operationMode, simulatedDate, turnoutData, exitPolls } = useLiveData();
    const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);
    const [activeTab, setActiveTab] = useState<"TURNOUT" | "EXIT_POLLS">("TURNOUT");
    const [countingState, setCountingState] = useState<string>("West Bengal");

    if (operationMode === "PRE-POLL") return null;

    const now = simulatedDate || new Date();
    const isVoting = operationMode === "VOTING_DAY";
    const isCounting = operationMode === "COUNTING_DAY";

    // EMBARGO LOGIC: Exit polls unlock at 7:00 PM IST (19:00 hours)
    const currentHour = now.getHours();
    const isExitPollUnlocked = currentHour >= 19;

    let activeStates: string[] = [];
    if (now >= ELECTION_DATES.phase2b) activeStates = ["West Bengal"];
    else if (now >= ELECTION_DATES.phase2) activeStates = ["Tamil Nadu", "West Bengal"];
    else activeStates = ["Kerala", "Assam", "Puducherry"];

    return (
        <div className={`fixed z-30 transition-all duration-500 ease-in-out bg-white/95 backdrop-blur-md border-[#e4e4e7] shadow-xl overflow-hidden
          md:top-[36px] md:left-[280px] md:right-[280px] md:bottom-auto md:border-b md:border-x md:rounded-b-lg md:translate-y-0
          top-auto bottom-[76px] left-0 right-0 border-t rounded-t-lg
          ${isMobileOpen ? "translate-y-0 h-[65vh]" : "translate-y-[150%] md:translate-y-0"}
          ${isDesktopCollapsed ? "md:h-[28px]" : "md:h-[240px]"}`}
        >
            {/* TOP HEADER */}
            <div
                className="flex items-center justify-between px-4 py-1.5 bg-[#f4f4f5] border-b border-[#e4e4e7] cursor-pointer"
                onClick={() => { if (window.innerWidth >= 768) setIsDesktopCollapsed(!isDesktopCollapsed); }}
            >
                <div className="flex items-center gap-4">
                    {isVoting && (
                        <>
                            <button onClick={(e) => { e.stopPropagation(); setActiveTab("TURNOUT"); }} className={`font-mono text-[10px] font-bold tracking-widest flex items-center gap-1 ${activeTab === 'TURNOUT' ? 'text-[#0284c7]' : 'text-[#a1a1aa] hover:text-[#52525b]'}`}>
                                <Activity className="h-3.5 w-3.5" /> LIVE TURNOUT
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); setActiveTab("EXIT_POLLS"); }} className={`font-mono text-[10px] font-bold tracking-widest flex items-center gap-1 ${activeTab === 'EXIT_POLLS' ? 'text-[#ea580c]' : 'text-[#a1a1aa] hover:text-[#52525b]'}`}>
                                <BarChart3 className="h-3.5 w-3.5" /> EXIT POLLS
                            </button>
                        </>
                    )}
                    {isCounting && (
                        <div className="font-mono text-[11px] font-bold tracking-widest text-[#dc2626] flex items-center gap-2">
                            <PieChart className="h-4 w-4" /> ECI LIVE RESULTS
                        </div>
                    )}
                </div>

                {/* Desktop Collapse Icon */}
                <div className="hidden md:flex items-center gap-2">
                    <span className="font-mono text-[9px] text-[#71717a]"><Clock className="inline w-3 h-3 mb-0.5" /> ECI SYNC</span>
                    {isDesktopCollapsed ? <ChevronDown className="h-4 w-4 text-[#71717a]" /> : <ChevronUp className="h-4 w-4 text-[#71717a]" />}
                </div>

                {/* Mobile Close Icon */}
                <div className="md:hidden flex items-center" onClick={(e) => { e.stopPropagation(); if (onCloseMobile) onCloseMobile(); }}>
                    <X className="h-4 w-4 text-[#71717a]" />
                </div>
            </div>

            {/* MAIN CONTENT BODY */}
            {!isDesktopCollapsed && (
                <div className="p-4 h-full overflow-y-auto pb-10">

                    {/* ======================= VOTING DAY: TURNOUT ======================= */}
                    {isVoting && activeTab === "TURNOUT" && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {activeStates.map((state) => {
                                const stateData = turnoutData.filter(t => t.state === state).sort((a, b) => b.id.localeCompare(a.id))[0];
                                const minT = stateData ? stateData.turnout_min : 0;
                                const maxT = stateData ? stateData.turnout_max : 0;
                                const avgT = stateData ? ((minT + maxT) / 2) : 0;
                                const newsBullets = stateData?.booth_news || [];

                                return (
                                    <div key={state} className="bg-[#f8fafc] border border-[#e4e4e7] p-3 rounded flex flex-col">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="font-mono text-[11px] font-bold text-[#52525b]">{state.toUpperCase()}</span>
                                            <span className="font-mono text-[9px] text-[#0284c7] font-bold bg-[#0284c7]/10 px-2 py-0.5 rounded">{stateData?.time_slot || "AWAITING SYNC"}</span>
                                        </div>

                                        <div className="flex items-end gap-2 mb-2">
                                            <span className="text-3xl font-bold text-[#27272a] leading-none">{avgT > 0 ? `${minT}-${maxT}%` : "0%"}</span>
                                            <span className="font-mono text-[9px] text-[#71717a] mb-1">CONSENSUS RANGE</span>
                                        </div>

                                        <div className="w-full bg-[#e4e4e7] h-1.5 rounded-full overflow-hidden mb-3">
                                            <div className="bg-[#0284c7] h-full transition-all duration-1000" style={{ width: `${avgT}%` }} />
                                        </div>

                                        {/* AI Polling Booth News - Removed the EVM/Demographic junk stats as requested */}
                                        <div className="mt-auto pt-2 border-t border-[#e4e4e7] flex flex-col gap-1">
                                            <span className="font-mono text-[8px] font-bold text-[#71717a] tracking-wider mb-1">BOOTH DISPATCHES:</span>
                                            {newsBullets.length > 0 ? newsBullets.map((n: any, idx: number) => (
                                                <div key={idx} className="text-[10px] text-[#52525b] leading-tight flex items-start gap-1">
                                                    <span className="text-[#ea580c] mt-0.5">▸</span>
                                                    <span>
                                                        {n.text}
                                                        {n.source && <a href={n.source} target="_blank" rel="noopener noreferrer" className="text-[#0284c7] ml-1 hover:underline inline-flex items-center"><ExternalLink className="h-2 w-2" /></a>}
                                                    </span>
                                                </div>
                                            )) : (
                                                <div className="text-[10px] text-[#a1a1aa] italic">Monitoring local networks...</div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* ======================= VOTING DAY: EXIT POLLS ======================= */}
                    {isVoting && activeTab === "EXIT_POLLS" && (
                        <div className="w-full h-full">
                            {!isExitPollUnlocked ? (
                                <div className="flex flex-col items-center justify-center h-full pt-4">
                                    <BarChart3 className="h-8 w-8 text-[#a1a1aa] mb-2 opacity-50" />
                                    <p className="font-mono text-sm font-bold text-[#52525b]">EMBARGO ACTIVE</p>
                                    <p className="font-mono text-[10px] text-[#71717a] mt-1">Exit polls data will be shown after 7 PM IST.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {exitPolls.filter(ep => activeStates.includes(ep.state)).map((poll, idx) => (
                                        <div key={idx} className="border border-[#e4e4e7] rounded p-3">
                                            <div className="flex justify-between items-center mb-3">
                                                <span className="font-mono text-xs font-bold text-[#27272a]">{poll.state.toUpperCase()}</span>
                                                <span className="font-mono text-[9px] bg-[#f4f4f5] px-2 py-1 rounded text-[#71717a]">AGENCY: {poll.agency}</span>
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <div>
                                                    <div className="flex justify-between font-mono text-[10px] mb-1">
                                                        <span className="font-bold text-[#ea580c]">{poll.party_a_name}</span>
                                                        <span>{poll.party_a_min} - {poll.party_a_max} Seats</span>
                                                    </div>
                                                    <div className="w-full bg-[#f4f4f5] h-2 rounded overflow-hidden"><div className="bg-[#ea580c] h-full" style={{ width: `${(poll.party_a_max / 200) * 100}%` }}></div></div>
                                                </div>
                                                <div>
                                                    <div className="flex justify-between font-mono text-[10px] mb-1">
                                                        <span className="font-bold text-[#16a34a]">{poll.party_b_name}</span>
                                                        <span>{poll.party_b_min} - {poll.party_b_max} Seats</span>
                                                    </div>
                                                    <div className="w-full bg-[#f4f4f5] h-2 rounded overflow-hidden"><div className="bg-[#16a34a] h-full" style={{ width: `${(poll.party_b_max / 200) * 100}%` }}></div></div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {exitPolls.length === 0 && <div className="font-mono text-xs text-[#a1a1aa] mt-4 text-center w-full">Awaiting Exit Poll Aggregation...</div>}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ======================= COUNTING DAY: ECI RESULTS ======================= */}
                    {isCounting && (
                        <div className="flex flex-col h-full">
                            <div className="flex gap-2 mb-3 overflow-x-auto border-b border-[#e4e4e7] pb-2">
                                {["Kerala", "Assam", "Tamil Nadu", "West Bengal", "Puducherry"].map(s => (
                                    <button
                                        key={s} onClick={() => setCountingState(s)}
                                        className={`font-mono text-[10px] font-bold px-3 py-1 rounded transition-colors ${countingState === s ? 'bg-[#dc2626] text-white' : 'bg-[#f4f4f5] text-[#71717a] hover:bg-[#e4e4e7]'}`}
                                    >{s.toUpperCase()}</button>
                                ))}
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="bg-white border border-[#16a34a] p-3 rounded text-center shadow-sm">
                                    <div className="text-2xl font-bold text-[#16a34a]">115</div>
                                    <div className="font-mono text-[9px] text-[#71717a]">AITC (WON + LEAD)</div>
                                </div>
                                <div className="bg-white border border-[#ea580c] p-3 rounded text-center shadow-sm">
                                    <div className="text-2xl font-bold text-[#ea580c]">92</div>
                                    <div className="font-mono text-[9px] text-[#71717a]">BJP (WON + LEAD)</div>
                                </div>
                                <div className="bg-white border border-[#3b82f6] p-3 rounded text-center shadow-sm">
                                    <div className="text-2xl font-bold text-[#3b82f6]">12</div>
                                    <div className="font-mono text-[9px] text-[#71717a]">INC (WON + LEAD)</div>
                                </div>
                                <div className="bg-[#f4f4f5] border border-[#e4e4e7] p-3 rounded flex flex-col justify-center items-center text-center">
                                    <CheckCircle2 className="h-5 w-5 text-[#16a34a] mb-1" />
                                    <div className="font-mono text-[9px] font-bold text-[#27272a]">COUNTING IN PROGRESS</div>
                                    <div className="font-mono text-[8px] text-[#71717a]">219 / 294 SEATS TRENDING</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}