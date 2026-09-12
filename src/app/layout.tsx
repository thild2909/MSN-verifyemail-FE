import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  applicationName: "Verifly",
  title: {
    default: "Verifly · Email Verification & Finder",
    template: "%s · Verifly",
  },
  description:
    "Verify email addresses, clean your lists, find professional emails, and improve deliverability.",
  // Standalone (installed) PWA behaviour on iOS.
  appleWebApp: {
    capable: true,
    // `default` keeps the status bar opaque so iOS confines the web view to the
    // safe area — the header lands BELOW the notch automatically and the status
    // bar text stays legible on the light header. (`black-translucent` would
    // draw the page under the notch, which needs pixel-perfect safe-area padding
    // on every edge and renders white status text on our light chrome.)
    statusBarStyle: "default",
    title: "Verifly",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // `contain` (the default) lets iOS inset the whole app into the display's safe
  // area, so the notch / home-indicator never overlap content. We intentionally
  // do NOT use `cover` — the safe-area utility classes stay as harmless no-ops.
  viewportFit: "contain",
  // Match the app background so the iOS status-bar / notch strip blends with the
  // app instead of showing the indigo brand colour.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b101e" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans`} style={{ fontFamily: "var(--font-sans), system-ui, sans-serif" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
