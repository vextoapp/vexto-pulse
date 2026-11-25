#!/usr/bin/env bash
# Update Vexto Pulse on the Pi: pull, install, build, restart.
# The checker timer picks up the new build on its next run.
set -euo pipefail
cd "$(dirname "$0")"

git pull --ff-only
npm ci
npm run build
sudo systemctl restart vexto-pulse-web
systemctl --no-pager --lines=0 status vexto-pulse-web vexto-pulse-checker.timer
