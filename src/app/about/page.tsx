import type { Metadata } from "next"
import Link from "next/link"
import { getSiteUrl } from "@/lib/site"

export const metadata: Metadata = {
  title: "About",
  description:
    "What DHARMA-OSINT is, who it’s for, and what data sources power the election insights for India’s 2026 state assembly elections.",
  alternates: { canonical: `${getSiteUrl()}/about` },
}

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 pb-16 pt-16 text-[var(--text-primary)]">
      <h1 className="text-[28px] font-semibold tracking-[-0.02em]">About DHARMA-OSINT</h1>
      <p className="mt-3 text-[14px] leading-[1.7] text-[var(--text-secondary)]">
        DHARMA-OSINT is an open-source intelligence dashboard for India’s 2026 state assembly elections. It brings together verified
        candidate disclosures, historical election results, and live news signals into one operational view.
      </p>

      <h2 className="mt-10 text-[16px] font-semibold">What you can do here</h2>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-[14px] leading-[1.7] text-[var(--text-secondary)]">
        <li>Explore constituency-level insights from 2021 results (seat share, margins, turnout)</li>
        <li>Review candidate dossiers (assets, criminal cases) sourced from ECI + ADR/MyNeta style fields</li>
        <li>Track OSINT signals and briefings during campaign and voting-day phases</li>
      </ul>

      <h2 className="mt-10 text-[16px] font-semibold">Data sources</h2>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-[14px] leading-[1.7] text-[var(--text-secondary)]">
        <li>Election Commission of India (ECI) affidavit portal and official releases</li>
        <li>ADR / MyNeta public disclosures</li>
        <li>Public news sources (RSS and structured extraction)</li>
      </ul>

      <p className="mt-10 text-[14px] leading-[1.7] text-[var(--text-secondary)]">
        Next: see the <Link className="underline hover:text-[var(--text-primary)]" href="/methodology">methodology</Link> or go back{" "}
        <Link className="underline hover:text-[var(--text-primary)]" href="/">to the dashboard</Link>.
      </p>
    </main>
  )
}

