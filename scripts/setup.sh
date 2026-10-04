#!/usr/bin/env bash
# One-shot production setup: R2 bucket -> Pages project -> deploy -> admin password -> copy the old photos into R2.
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment (or an interactive `wrangler login`).
# Safe to re-run: an existing bucket, password and published content are left alone.
set -euo pipefail
cd "$(dirname "$0")/.."

BUCKET=mtportfolio-photos
PROJECT=mariia-troian
wr() { npx --no-install wrangler "$@"; }

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && ! wr whoami 2>/dev/null | grep -q "logged in"; then
  echo "Set CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID) or run 'npx wrangler login' first." >&2
  exit 1
fi

echo "==> 1/4 R2 bucket"
if out=$(wr r2 bucket create "$BUCKET" 2>&1); then
  echo "created $BUCKET"
elif grep -qi "already exists" <<<"$out"; then
  echo "$BUCKET already exists"
else
  echo "$out" >&2
  echo "If this says R2 is not enabled: Cloudflare dashboard -> R2 Object Storage -> enable it once, then re-run." >&2
  exit 1
fi

echo "==> 2/4 Pages project + first deploy"
# Created through the REST API: `wrangler pages project create` may create a Worker instead of a Pages project.
curl -sS -X POST "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}/pages/projects" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}" -H 'content-type: application/json' \
  --data "{\"name\":\"$PROJECT\",\"production_branch\":\"main\"}" >/dev/null || true   # already exists is fine
npm run deploy

echo "==> 3/4 Admin password"
if wr pages secret list --project-name "$PROJECT" 2>/dev/null | grep -q ADMIN_PASSWORD; then
  echo "ADMIN_PASSWORD already set (not changed). To change: npx wrangler pages secret put ADMIN_PASSWORD --project-name $PROJECT"
else
  PASS="${ADMIN_PASSWORD:-$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)}"
  printf '%s' "$PASS" | wr pages secret put ADMIN_PASSWORD --project-name "$PROJECT" >/dev/null
  npm run deploy   # secrets reach the site on the next deploy
  echo "ADMIN_PASSWORD set. Password: $PASS"
fi

echo "==> 4/4 Move the existing photos into R2"
node scripts/migrate-photos.mjs --remote

echo "Done. Admin: <your site>/admin/"
