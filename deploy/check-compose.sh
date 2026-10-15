#!/usr/bin/env bash
# Exercises the public readiness endpoint and Compose process lifecycle on disposable data.
set -euo pipefail
cd "$(dirname "$0")/.."
test_dir=$(mktemp -d)
project="haiji-check-${RANDOM}-${RANDOM}"
cleanup() {
  docker compose --project-name "$project" --env-file "$test_dir/env" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$test_dir"
}
trap cleanup EXIT
openssl rand -hex 32 > "$test_dir/admin-secret"
# Compose file secrets are bind mounts: local Compose does not implement uid/mode remapping.
# Parent directory is 0700; only the mounted file is readable by the non-root process.
chmod 0444 "$test_dir/admin-secret"
cat > "$test_dir/env" <<ENV
APP_IMAGE=haiji-compose-check:local
POSTGRES_PASSWORD=$(openssl rand -hex 32)
ADMIN_SECRET_PATH=$test_dir/admin-secret
PUBLIC_URL=https://haiji.test
ENVIRONMENT_NAME=Compose check
PUSH_MODE=disabled
MODEL_DATA_DESTINATION=No model configured
API_PORT=0
ENV
compose=(docker compose --project-name "$project" --env-file "$test_dir/env")
"${compose[@]}" -f compose.yaml -f deploy/compose.build.yaml build
"${compose[@]}" up -d --wait --wait-timeout 120
api_id=$("${compose[@]}" ps -q api)
# The API's external interface must be ready; DB port never appears on the host.
docker exec "$api_id" node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
"${compose[@]}" stop db
"${compose[@]}" restart api
"${compose[@]}" start db
"${compose[@]}" up -d --wait --wait-timeout 120
"${compose[@]}" down --volumes
cat > "$test_dir/fail.yaml" <<'YAML'
services:
  migration:
    entrypoint: [node, -e, 'process.exit(73)']
    command: []
YAML
if "${compose[@]}" -f compose.yaml -f "$test_dir/fail.yaml" up -d; then
  printf 'FAIL: migration failure allowed successful startup\n' >&2
  exit 1
fi
for service in api agent delivery; do
  if [[ -n $("${compose[@]}" ps --status running -q "$service") ]]; then
    printf 'FAIL: %s running after migration failure\n' "$service" >&2
    exit 1
  fi
done
printf 'PASS: startup, database recovery, and migration failure gating\n'
