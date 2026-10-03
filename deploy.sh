#!/usr/bin/env bash
set -e; cd "$(dirname "$0")"; git pull --ff-only origin main
npm install --no-audit --no-fund; npm run build
pm2 restart msn-frontend --update-env; echo "msn-frontend deployed"
