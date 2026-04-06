import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DHARMA-OSINT — 2026 Election Intelligence",
    short_name: "D-OSINT",
    description:
      "Situational awareness for 2026 Indian state elections — Kerala, Assam, Tamil Nadu, West Bengal, Puducherry.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f4f5",
    theme_color: "#16a34a",
    orientation: "any",
    icons: [
      {
        src: "/globe.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
