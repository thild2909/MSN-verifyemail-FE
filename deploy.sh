#!/usr/bin/env bash
set -e; cd "$(dirname "$0")"
# The server's npm rewrites package-lock.json (drops npm 11's "libc" fields), which
# leaves the tree dirty and can block the next --ff-only pull. Restore it, and use
# `npm ci` (installs exactly the lockfile, never writes it).
git checkout -- package-lock.json 2>/dev/null || true
git pull --ff-only origin main
# Preflight: both secrets are required (auth fails closed without them).
for k in AUTH_JWT_SECRET INTERNAL_API_TOKEN; do
  v=$(grep -E "^${k}=" .env.local 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')
  if [ ${#v} -lt 32 ]; then echo "FE preflight FAILED: $k missing/short in .env.local" >&2; exit 1; fi
done
npm ci --no-audit --no-fund; npm run build
pm2 restart msn-frontend --update-env; echo "msn-frontend deployed"
