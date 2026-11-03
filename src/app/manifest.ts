import type { MetadataRoute } from "next";

/**
 * PWA manifest (Next auto-links this at /manifest.webmanifest). Makes the app
 * installable on Android/iOS and gives the standalone window its name, colours
 * and icons. All brand icons live in /public/icons.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mind Supernova — Lead Finder",
    short_name: "Mind Supernova",
    description:
      "Verify email addresses, clean your lists, find professional emails, and improve deliverability.",
    start_url: "/verification",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["business", "productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png?v=2", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png?v=2", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
