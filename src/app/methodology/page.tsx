import type { Metadata } from "next"
import Link from "next/link"
import { getSiteUrl } from "@/lib/site"

export const metadata: Metadata = {
  title: "Methodology",
  description:
    "How DHARMA-OSINT computes election insights: seat share, tight seats, candidate metrics, and the OSINT signal pipeline.",
  alternates: { canonical: `${getSiteUrl()}/methodology` },
}

export default function MethodologyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 pb-16 pt-16 text-[var(--text-primary)]">
      <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Methodology</h1>
      <p className="mt-3 text-[14px] leading-[1.7] text-[var(--text-secondary)]">
        This project combines historical results, candidate disclosures, and live OSINT signals. The intent is to make election
        monitoring more transparent and easier to validate.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold">Definitions used in Insights</h2>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-[14px] leading-[1.7] text-[var(--text-secondary)]">
        <li>
          <span className="font-medium text-[var(--text-primary)]">Tight seats</span>: constituencies with 2021 margin ≤ 5,000 votes.
        </li>
        <li>
          <span className="font-medium text-[var(--text-primary)]">Seat share</span>: 2021 winner aggregation by party or alliance.
        </li>
        <li>
          <span className="font-medium text-[var(--text-primary)]">Criminal share</span>: share of filed candidates with declared cases &gt; 0.
        </li>
        <li>
          <span className="font-medium text-[var(--text-primary)]">Assets coverage</span>: % of filed candidates with declared assets value &gt; 0.
        </li>
      </ul>

      <h2 className="mt-10 text-[16px] font-semibold">OSINT signals</h2>
      <p className="mt-2 text-[14px] leading-[1.7] text-[var(--text-secondary)]">
        Signals are collected from public feeds and structured into consistent fields (location hints, severity, and verification
        cues). During voting day, turnout and official PDFs are ingested in scheduled windows.
      </p>

      <p className="mt-10 text-[14px] leading-[1.7] text-[var(--text-secondary)]">
        Back to <Link className="underline hover:text-[var(--text-primary)]" href="/">the dashboard</Link>.
      </p>
    </main>
  )
}

