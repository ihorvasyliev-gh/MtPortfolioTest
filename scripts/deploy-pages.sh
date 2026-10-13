#!/usr/bin/env bash
# Production deploy to Cloudflare Pages (project mariia-troian): public/ + src/worker.js bundled as _worker.js.
# The Pages project itself holds the bindings (R2 BUCKET, D1 DB) and the ADMIN_PASSWORD secret.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=${PAGES_PROJECT:-mariia-troian}
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

cp -r public/. "$OUT/"
npx --no-install esbuild src/worker.js --bundle --format=esm --platform=neutral --outfile="$OUT/_worker.js" --log-level=warning

# Run from the temp dir so wrangler doesn't read the Workers-style wrangler.jsonc.
REPO=$PWD
cd "$OUT"
"$REPO/node_modules/.bin/wrangler" pages deploy . --project-name "$PROJECT" --branch main \
  --commit-hash "$(git -C "$REPO" rev-parse HEAD)" --commit-message "$(git -C "$REPO" log -1 --format=%s)" --commit-dirty="$([ -n "$(git -C "$REPO" status --porcelain)" ] && echo true || echo false)"
