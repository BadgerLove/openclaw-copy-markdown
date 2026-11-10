#!/bin/sh
# Real-browser test in a throwaway container (current Chromium + this extension).
# Uses playwright-core from the OpenClaw install; nothing is installed on the host.
set -e
cd "$(dirname "$0")/../.."
exec docker run --rm --network host --ipc=host \
  -v "$PWD/extension:/ext:ro" -v "$PWD/test/browser:/t:ro" \
  -v /usr/lib/node_modules/openclaw/node_modules/playwright-core:/pw:ro \
  -e REAL_URL="${REAL_URL:-http://127.0.0.1:18789/}" \
  mcr.microsoft.com/playwright:v1.64.1-noble node /t/e2e.js
