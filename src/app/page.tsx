import Link from "next/link"
import AppShell from "@/app/ui/AppShell"
import { getSiteUrl } from "@/lib/site"

export default function Home() {
  const siteUrl = getSiteUrl()

  return (
    <>
      <section className="sr-only">
        <h1>DHARMA-OSINT Election Watch — India state elections 2026</h1>
        <p>
          Live election intelligence dashboard for Indian state assembly elections 2026: maps, candidate dossiers, OSINT signals, and
          2021 historical results for Tamil Nadu, Kerala, West Bengal, Assam, and Puducherry.
        </p>
        <p>
          Keywords: India election watch, state election results 2021, constituency insights, candidate assets, criminal cases, election
          news signals.
        </p>
        <nav aria-label="Site">
          <ul>
            <li>
              <Link href="/about">About</Link>
            </li>
            <li>
              <Link href="/methodology">Methodology</Link>
            </li>
          </ul>
        </nav>
      </section>

      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "DHARMA-OSINT",
            url: siteUrl,
            description:
              "Election intelligence dashboard for Indian state assembly elections 2026: maps, candidate dossiers, OSINT signals, and historical 2021 results.",
            inLanguage: "en-IN",
          }),
        }}
      />

      <AppShell />
    </>
  )
}

