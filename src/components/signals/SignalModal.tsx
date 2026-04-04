"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ExternalLink, AlertTriangle, FileText, Image as ImageIcon, MapPin, ShieldCheck, ShieldAlert } from "lucide-react";
import { relativeTime, severityLabel } from "@/lib/utils/formatting";

interface SignalModalProps {
    signal: any;
    onClose: () => void;
}

export default function SignalModal({ signal, onClose }: SignalModalProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        document.body.style.overflow = "hidden";
        return () => { document.body.style.overflow = "auto"; };
    }, []);

    const isSevere = signal.severity >= 4;
    const isModerate = signal.severity === 3;
    const headerColor = isSevere ? "bg-[#dc2626]" : isModerate ? "bg-[#ea580c]" : "bg-[#16a34a]";
    const textColor = isSevere ? "text-[#dc2626]" : isModerate ? "text-[#ea580c]" : "text-[#16a34a]";

    // Safely parse JSONB data if it exists
    const bullets = Array.isArray(signal.full_summary) ? signal.full_summary : [];
    const entities = Array.isArray(signal.entities_involved) ? signal.entities_involved : [];

    const modalContent = (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in-up">
            <div className="bg-[#ffffff] border border-[#e4e4e7] rounded-lg shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* Tactical Header */}
                <div className={`${headerColor} px-4 py-2 flex items-center justify-between shrink-0`}>
                    <div className="flex items-center gap-2 text-white">
                        <AlertTriangle className="h-4 w-4" />
                        <span className="font-mono text-xs font-bold tracking-widest">
                            INTELLIGENCE DOSSIER // SEV-{signal.severity} {severityLabel(signal.severity)}
                        </span>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-black/20 rounded transition-colors text-white">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                    {/* Main Title & Meta */}
                    <div className="mb-6">
                        <h1 className="font-mono text-xl font-bold text-[#18181b] leading-tight mb-3">
                            {signal.title}
                        </h1>
                        <div className="flex flex-wrap items-center gap-4 border-b border-[#e4e4e7] pb-3">
                            <span className="font-mono text-[10px] text-[#71717a] flex items-center gap-1">
                                <FileText className="h-3 w-3" /> SRC: {signal.source}
                            </span>
                            <span className="font-mono text-[10px] text-[#71717a]">
                                {relativeTime(new Date(signal.created_at || signal.createdAt))}
                            </span>
                            {signal.state && (
                                <span className="font-mono text-[10px] text-[#0284c7] bg-[#0284c7]/10 px-2 py-0.5 rounded border border-[#0284c7]/20 flex items-center gap-1">
                                    <MapPin className="h-3 w-3" /> {signal.state.toUpperCase()}
                                </span>
                            )}
                            {signal.verified ? (
                                <span className="font-mono text-[10px] text-[#16a34a] flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> VERIFIED SOURCE</span>
                            ) : (
                                <span className="font-mono text-[10px] text-[#ea580c] flex items-center gap-1"><ShieldAlert className="h-3 w-3" /> UNVERIFIED RUMOR</span>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col md:flex-row gap-6">
                        {/* Left Col: Media */}
                        <div className="w-full md:w-5/12 shrink-0">
                            <div className="w-full aspect-video bg-[#f4f4f5] border border-[#e4e4e7] rounded flex items-center justify-center overflow-hidden relative shadow-inner">
                                {signal.video_url ? (
                                    <iframe
                                        width="100%"
                                        height="100%"
                                        src={signal.video_url}
                                        title="OSINT Video Feed"
                                        frameBorder="0"
                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                        allowFullScreen
                                        className="z-10 relative"
                                    />
                                ) : signal.image_url ? (
                                    <img src={signal.image_url} alt="News Source Media" className="w-full h-full object-cover z-10 relative" />
                                ) : (
                                    <div className="text-center text-[#a1a1aa] flex flex-col items-center z-10 relative">
                                        <ImageIcon className="h-8 w-8 mb-2 opacity-50" />
                                        <span className="font-mono text-[9px] tracking-wider">NO MEDIA DETECTED</span>
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-[linear-gradient(rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:10px_10px] pointer-events-none" />
                            </div>

                            {entities.length > 0 && (
                                <div className="mt-4 p-3 bg-[#f4f4f5] border border-[#e4e4e7] rounded">
                                    <span className="font-mono text-[9px] font-bold text-[#52525b] tracking-wider block mb-2">IDENTIFIED ENTITIES</span>
                                    <div className="flex flex-wrap gap-1.5">
                                        {entities.map((ent: string, i: number) => (
                                            <span key={i} className="font-mono text-[9px] text-[#27272a] bg-white border border-[#d4d4d8] px-1.5 py-0.5 rounded shadow-sm">
                                                {ent}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Right Col: AI Summary */}
                        <div className="flex-1">
                            <h3 className={`font-mono text-[10px] font-bold tracking-wider mb-3 flex items-center gap-1.5 ${textColor}`}>
                                <AlertTriangle className="h-3 w-3" /> TACTICAL AI SUMMARY
                            </h3>

                            {bullets.length > 0 ? (
                                <ul className="space-y-3">
                                    {bullets.map((bullet: string, i: number) => (
                                        <li key={i} className="text-sm text-[#3f3f46] leading-relaxed flex items-start gap-2">
                                            <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${headerColor}`} />
                                            {bullet}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-[#52525b] leading-relaxed border-l-2 border-[#e4e4e7] pl-3 py-1">
                                    {signal.body}
                                </p>
                            )}

                            <div className="mt-8 pt-4 border-t border-[#e4e4e7]">
                                <a
                                    href={signal.source_url || `https://news.google.com/search?q=${encodeURIComponent(signal.source + ' ' + signal.title)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`w-full py-3 rounded font-mono text-[11px] font-bold tracking-widest flex items-center justify-center gap-2 transition-colors ${isSevere ? "bg-[#dc2626] hover:bg-[#b91c1c] text-white shadow-[0_0_15px_rgba(220,38,38,0.3)]" :
                                        "bg-[#18181b] hover:bg-[#27272a] text-white"
                                        }`}
                                >
                                    OPEN ORIGINAL SOURCE <ExternalLink className="h-3 w-3" />
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    if (!mounted) return null;
    return createPortal(modalContent, document.body);
}