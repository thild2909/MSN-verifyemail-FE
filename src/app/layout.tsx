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
    statusBarStyle: "black-translucent",
    title: "Verifly",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Let the app paint into the notch / home-indicator area; padding is handled
  // with env(safe-area-inset-*) utilities.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#4f46e5" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1020" },
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
