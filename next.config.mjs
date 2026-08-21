/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
