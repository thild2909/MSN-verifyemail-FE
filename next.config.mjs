/** @type {import('next').NextConfig} */
// Baseline security headers for every response (pages + API).
// CSP: Next.js inlines bootstrap scripts, so script-src needs 'unsafe-inline'
// (no nonce pipeline yet); everything else is locked to same-origin. Images
// allow data:/blob: (avatars are data URLs, exports use blob:).
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'" + (process.env.NODE_ENV === "development" ? " ws: wss:" : ""),
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework (X-Powered-By: Next.js).
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // API responses carry PII — never cache them in browsers or proxies.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
  webpack: (config, { dev }) => {
    // Next.js 15.1.3 dev mode persists a webpack module cache under
    // `.next/cache/webpack`. On incremental HMR recompiles (every file edit)
    // that on-disk cache intermittently corrupts — a chunk isn't regenerated,
    // so `__webpack_require__` receives an `undefined` module factory and
    // throws `TypeError: Cannot read properties of undefined (reading 'call')`.
    // Restarting the dev server does NOT clear it (the cache is on disk); only
    // deleting `.next` does, and it recurs. Using an in-memory cache in dev
    // keeps fast rebuilds within a session but never persists corruption to
    // disk, so the error stops recurring. (Production builds keep the default
    // filesystem cache for speed.)
    if (dev) {
      config.cache = { type: "memory" };
    }
    return config;
  },
};

export default nextConfig;
