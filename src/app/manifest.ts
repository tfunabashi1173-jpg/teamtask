import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Team Task",
    short_name: "Team Task",
    description: "チームで使うタスク管理PWA",
    start_url: "/",
    display: "standalone",
    background_color: "#eef3ec",
    theme_color: "#1f6b4f",
    lang: "ja",
    orientation: "portrait",
    icons: [
      {
        src: "/pwa-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/pwa-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
