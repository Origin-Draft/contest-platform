#!/usr/bin/env bash
# ── contest-platform restore ────────────────────────────────────────
# Restores from a backup created by backup.sh.
#
# Usage:
#   ./infra/restore.sh infra/backups/20250101-120000
#
# WARNING: This replaces all existing data.  Make a fresh backup first.
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <backup-dir>"
  echo "Example: $0 infra/backups/20250101-120000"
  exit 1
fi

BACKUP_DIR="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="${INFRA_DIR:-$SCRIPT_DIR}"
COMPOSE="docker compose -f ${INFRA_DIR}/docker-compose.yml"

if [ ! -d "$BACKUP_DIR" ]; then
  echo "Error: backup directory not found: $BACKUP_DIR"
  exit 1
fi

echo "==> Restoring from ${BACKUP_DIR}"
echo "    This will REPLACE existing data. Press Ctrl-C within 5s to abort."
sleep 5

echo "==> Stopping API and Keycloak during restore…"
$COMPOSE stop api keycloak web 2>/dev/null || true

ERRORS=0

# ── App database ─────────────────────────────────────────────────────
if [ -f "${BACKUP_DIR}/app-db.dump" ]; then
  echo "  • Restoring app database…"
  if $COMPOSE exec -T postgres pg_restore \
    -U "${POSTGRES_USER:-contest_user}" \
    -d "${POSTGRES_DB:-contest_platform}" \
    --clean --if-exists \
    < "${BACKUP_DIR}/app-db.dump"; then
    echo "    Done."
  else
    echo "    ⚠ pg_restore exited with warnings/errors (exit $?). Review output above."
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "  • No app-db.dump found, skipping."
fi

# ── Keycloak database ───────────────────────────────────────────────
if [ -f "${BACKUP_DIR}/keycloak-db.dump" ]; then
  echo "  • Restoring keycloak database…"
  if $COMPOSE exec -T keycloak-postgres pg_restore \
    -U "${KEYCLOAK_DB_USER:-keycloak}" \
    -d "${KEYCLOAK_DB_NAME:-keycloak}" \
    --clean --if-exists \
    < "${BACKUP_DIR}/keycloak-db.dump"; then
    echo "    Done."
  else
    echo "    ⚠ pg_restore exited with warnings/errors (exit $?). Review output above."
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "  • No keycloak-db.dump found, skipping."
fi

# ── Uploads directory ───────────────────────────────────────────────
if [ -f "${BACKUP_DIR}/uploads.tar.gz" ]; then
  UPLOADS_DST="${INFRA_DIR}/uploads"
  echo "  • Restoring uploads to ${UPLOADS_DST}…"
  mkdir -p "$UPLOADS_DST"
  tar -xzf "${BACKUP_DIR}/uploads.tar.gz" -C "$UPLOADS_DST"
  echo "    Done."
else
  echo "  • No uploads.tar.gz found, skipping."
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "==> Restore finished with $ERRORS warning(s). Review output above."
  echo "==> Restarting services…"
  $COMPOSE start api keycloak web 2>/dev/null || true
  exit 1
fi

echo "==> Restarting services…"
$COMPOSE start api keycloak web 2>/dev/null || true

echo "==> Restore complete."
