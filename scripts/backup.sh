#!/usr/bin/env bash
# Logical backup of the database (custom format, compressed) with a checksum.
#
#   DATABASE_URL=… scripts/backup.sh [output-dir]              # pg_dump on PATH
#   PG_RUN="docker compose exec -T db" scripts/backup.sh         # local docker database
#
# Your host's automatic backups with point-in-time recovery (Neon, Supabase, RDS…) are the first line;
# this is the off-site copy you control. Store the files outside the host (another cloud/bucket),
# keep at least 30 daily + 12 monthly, and run scripts/restore-drill.sh against one every month.
set -euo pipefail

URL="${MIGRATION_DATABASE_URL:-${DATABASE_URL:?Set DATABASE_URL (owner login)}}"
OUT_DIR="${1:-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${OUT_DIR}/gadgethub-${STAMP}.dump"
PG_RUN_ARGS=()
if [[ -n "${PG_RUN:-}" ]]; then read -r -a PG_RUN_ARGS <<<"${PG_RUN}"; fi

mkdir -p "${OUT_DIR}"
# --no-owner/--no-privileges: restorable into any database; the app role is re-granted after restore.
"${PG_RUN_ARGS[@]}" pg_dump --format=custom --compress=9 --no-owner --no-privileges "${URL}" >"${FILE}"
if command -v shasum >/dev/null; then shasum -a 256 "${FILE}" >"${FILE}.sha256"; else sha256sum "${FILE}" >"${FILE}.sha256"; fi
echo "Backup written: ${FILE} ($(wc -c <"${FILE}" | tr -d ' ') bytes)"
