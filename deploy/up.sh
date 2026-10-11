#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
config=$(docker compose --env-file "${1:-deploy/.env}" config --format json)
image=$(printf '%s' "$config" | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["api"]["image"])')
if [[ ! "$image" =~ @sha256:[0-9a-f]{64}$ ]]; then
  printf 'APP_IMAGE must end with an immutable @sha256:<64 hex characters> digest.\n' >&2
  exit 1
fi
docker compose --env-file "${1:-deploy/.env}" pull
docker compose --env-file "${1:-deploy/.env}" up -d --wait
