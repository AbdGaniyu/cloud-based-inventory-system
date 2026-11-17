#!/usr/bin/env bash
# Restore drill: restores a backup into a scratch database next to the real one, runs the ledger
# integrity checks against it, then drops it. A backup you haven't restored isn't a backup.
#
#   DATABASE_URL=… scripts/restore-drill.sh backups/gadgethub-….dump
#   PG_RUN="docker compose exec -T db" scripts/restore-drill.sh backups/…dump   # local docker database
set -euo pipefail

DUMP="${1:?Pass the .dump file to restore}"
URL="${MIGRATION_DATABASE_URL:-${DATABASE_URL:?Set DATABASE_URL (owner login)}}"
PG_RUN_ARGS=()
if [[ -n "${PG_RUN:-}" ]]; then read -r -a PG_RUN_ARGS <<<"${PG_RUN}"; fi

if [[ -f "${DUMP}.sha256" ]]; then
  (cd "$(dirname "${DUMP}")" && { shasum -a 256 -c "$(basename "${DUMP}").sha256" 2>/dev/null || sha256sum -c "$(basename "${DUMP}").sha256"; }) >/dev/null
  echo "Checksum ok"
fi

DB_NAME="$(node -e 'console.log(new URL(process.argv[1]).pathname.slice(1))' "${URL}")"
DRILL_DB="${DB_NAME}_restore_drill"
ADMIN_URL="$(node -e 'const u=new URL(process.argv[1]);u.pathname="/postgres";u.search="";console.log(u.toString())' "${URL}")"
DRILL_URL="$(node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];console.log(u.toString())' "${URL}" "${DRILL_DB}")"

"${PG_RUN_ARGS[@]}" psql "${ADMIN_URL}" -q -c "DROP DATABASE IF EXISTS \"${DRILL_DB}\" WITH (FORCE)" -c "CREATE DATABASE \"${DRILL_DB}\""
trap '"${PG_RUN_ARGS[@]}" psql "${ADMIN_URL}" -q -c "DROP DATABASE IF EXISTS \"${DRILL_DB}\" WITH (FORCE)"' EXIT

START=$(date +%s)
"${PG_RUN_ARGS[@]}" pg_restore --no-owner --no-privileges --exit-on-error --dbname="${DRILL_URL}" <"${DUMP}"
echo "Restored into ${DRILL_DB} in $(( $(date +%s) - START ))s"

# The integrity checker connects from this machine: with PG_RUN (docker), the drill database is on the same server.
pnpm exec tsx scripts/verify-ledger.ts "${DRILL_URL}"
echo "Restore drill passed. (The scratch database is dropped now.)"
