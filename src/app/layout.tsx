import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { LiveDataProvider } from "@/lib/context/LiveDataContext";
import { Analytics } from "@vercel/analytics/next"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DHARMA-OSINT | 2026 Election Intelligence",
  description:
    "Real-time situational awareness dashboard for the 2026 Indian State Assembly Elections — Kerala, Assam, Tamil Nadu, West Bengal, Puducherry.",
  keywords: [
    "India elections 2026",
    "OSINT dashboard",
    "election intelligence",
  ],
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
      </body>
    </html>
  );
}
