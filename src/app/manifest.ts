import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "복지나침반",
    short_name: "복지나침반",
    start_url: "/",
    display: "standalone",
    background_color: "#fbfcf8",
    theme_color: "#fbfcf8",
    icons: [
      { src: "/icons/icon-192.png?v=compass-1", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png?v=compass-1", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png?v=compass-1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
