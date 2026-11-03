import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { THEME_INIT_SCRIPT } from "@/components/theme/theme-script";

const ICON_V = "?v=2";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  applicationName: "Mind Supernova",
  title: {
    default: "Mind Supernova · Email Verification & Finder",
    template: "%s · Mind Supernova",
  },
  description:
    "Verify email addresses, clean your lists, find professional emails, and improve deliverability.",
  // Rounded brand tile. The SVG adapts to the browser's light/dark UI on its
  // own; PNG fallbacks pick a light or dark tile per colour scheme. Bump ICON_V
  // when the icon files change so browsers drop the cached favicon.
  icons: {
    icon: [
      { url: `/icons/favicon.svg${ICON_V}`, type: "image/svg+xml" },
      { url: `/icons/favicon-32.png${ICON_V}`, sizes: "32x32", type: "image/png", media: "(prefers-color-scheme: light)" },
      { url: `/icons/favicon-dark-32.png${ICON_V}`, sizes: "32x32", type: "image/png", media: "(prefers-color-scheme: dark)" },
      { url: `/icons/icon-192.png${ICON_V}`, sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: `/icons/apple-touch-icon.png${ICON_V}`, sizes: "180x180", type: "image/png" }],
  },
  // Standalone (installed) PWA behaviour on iOS.
  appleWebApp: {
    capable: true,
    // `default` keeps the status bar opaque so iOS confines the web view to the
    // safe area — the header lands BELOW the notch automatically.
    statusBarStyle: "default",
    title: "Mind Supernova",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // `contain` lets iOS inset the whole app into the display's safe area.
  viewportFit: "contain",
  // Match the top bar so the iOS status-bar / notch strip blends with the app.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#14161f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint so there is no light/dark flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${inter.variable} font-sans`} style={{ fontFamily: "var(--font-sans), system-ui, sans-serif" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
