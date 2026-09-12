import type { MetadataRoute } from "next";

/**
 * PWA manifest (Next auto-links this at /manifest.webmanifest). Makes the app
 * installable on Android/iOS and gives the standalone window its name, colours
 * and icons. Icons are real PNGs generated into /public (see scripts/icons).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Verifly — Email Intelligence",
    short_name: "Verifly",
    description:
      "Verify email addresses, clean your lists, find professional emails, and improve deliverability.",
    start_url: "/verification",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0b1020",
    theme_color: "#4f46e5",
    categories: ["business", "productivity", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
