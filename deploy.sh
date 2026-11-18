#!/usr/bin/env bash
set -e; cd "$(dirname "$0")"
# The server's npm rewrites package-lock.json (drops npm 11's "libc" fields), which
# leaves the tree dirty and can block the next --ff-only pull. Restore it, and use
# `npm ci` (installs exactly the lockfile, never writes it).
git checkout -- package-lock.json 2>/dev/null || true
git pull --ff-only origin main
npm ci --no-audit --no-fund; npm run build
pm2 restart msn-frontend --update-env; echo "msn-frontend deployed"
