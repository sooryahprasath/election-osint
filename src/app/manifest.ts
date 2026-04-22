import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Election Watch India 2026",
    short_name: "Election Watch",
    description:
      "Election Watch for India’s 2026 state assembly elections: live signals, candidate intel, maps, and 2021 seat results.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0f14",
    theme_color: "#16a34a",
    orientation: "any",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
