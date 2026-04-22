import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { LiveDataProvider } from "@/lib/context/LiveDataContext";
import { Analytics } from "@vercel/analytics/next";
import { getSiteUrl } from "@/lib/site";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Election Watch India 2026 — Live Signals, Candidates & Seat Insights",
    template: "%s | Election Watch India 2026",
  },
  description:
    "Election Watch for India’s 2026 state assembly elections: live news signals, candidate dossiers (assets & criminal cases), maps, and 2021 seat results for Tamil Nadu, Kerala, West Bengal, Assam, and Puducherry.",
  applicationName: "Election Watch India 2026",
  keywords: [
    "India elections 2026",
    "election watch",
    "India election watch",
    "voter vibe",
    "OSINT dashboard",
    "election intelligence",
    "Kerala election",
    "Assam election",
    "Tamil Nadu election",
    "West Bengal election",
    "Puducherry election",
    "ECI",
    "candidate assets",
    "criminal cases",
    "assembly elections",
  ],
  authors: [{ name: "Election Watch" }],
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: siteUrl,
    siteName: "Election Watch India 2026",
    title: "Election Watch India 2026",
    description:
      "Live map, signals, and candidate intel for India’s 2026 state assembly elections. 2021 seat results + constituency insights.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Election Watch India 2026",
    description:
      "Live map, signals, and candidate intel for India’s 2026 state assembly elections. 2021 seat results + constituency insights.",
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: siteUrl,
  },
  icons: {
    icon: "/icon.svg",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#16a34a" },
    { media: "(prefers-color-scheme: dark)", color: "#15803d" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="h-full overflow-hidden antialiased">
        <LiveDataProvider>
          {children}
        </LiveDataProvider>
        <Analytics />
      </body>
    </html>
  );
}
