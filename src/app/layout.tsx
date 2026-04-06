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
    default: "DHARMA-OSINT | 2026 Election Intelligence",
    template: "%s | DHARMA-OSINT",
  },
  description:
    "Real-time situational awareness dashboard for the 2026 Indian State Assembly Elections — Kerala, Assam, Tamil Nadu, West Bengal, Puducherry.",
  applicationName: "DHARMA-OSINT",
  keywords: [
    "India elections 2026",
    "OSINT dashboard",
    "election intelligence",
    "Kerala election",
    "Assam election",
    "Tamil Nadu election",
    "West Bengal election",
    "Puducherry election",
    "ECI",
    "assembly elections",
  ],
  authors: [{ name: "DHARMA-OSINT" }],
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: siteUrl,
    siteName: "DHARMA-OSINT",
    title: "DHARMA-OSINT | 2026 Election Intelligence",
    description:
      "Live map, signals, and intel for 2026 state assembly elections across five regions.",
  },
  twitter: {
    card: "summary_large_image",
    title: "DHARMA-OSINT | 2026 Election Intelligence",
    description:
      "Live map, signals, and intel for 2026 state assembly elections across five regions.",
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: siteUrl,
  },
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
      <body className="h-full overflow-hidden bg-[#f4f4f5] text-[#27272a] antialiased">
        <LiveDataProvider>
          {children}
        </LiveDataProvider>
        <Analytics />
      </body>
    </html>
  );
}
