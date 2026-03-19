#!/usr/bin/env bash
# ── contest-platform backup ──────────────────────────────────────────
# Creates timestamped backups of both Postgres databases and the
# uploads directory.  Run from the repo root (or set INFRA_DIR).
#
# Usage:
#   ./infra/backup.sh                 # backs up to infra/backups/<timestamp>/
#   BACKUP_DIR=/mnt/backups ./infra/backup.sh   # custom target
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="${INFRA_DIR:-$SCRIPT_DIR}"
COMPOSE="docker compose -f ${INFRA_DIR}/docker-compose.yml"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-${INFRA_DIR}/backups/${TIMESTAMP}}"
mkdir -p "$BACKUP_DIR"

echo "==> Backing up to ${BACKUP_DIR}"

# ── App database ─────────────────────────────────────────────────────
echo "  • Dumping app database (postgres)…"
$COMPOSE exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-contest_user}" \
  -d "${POSTGRES_DB:-contest_platform}" \
  --format=custom \
  > "${BACKUP_DIR}/app-db.dump"

# ── Keycloak database ───────────────────────────────────────────────
echo "  • Dumping keycloak database (keycloak-postgres)…"
$COMPOSE exec -T keycloak-postgres pg_dump \
  -U "${KEYCLOAK_DB_USER:-keycloak}" \
  -d "${KEYCLOAK_DB_NAME:-keycloak}" \
  --format=custom \
  > "${BACKUP_DIR}/keycloak-db.dump"

# ── Uploads directory ───────────────────────────────────────────────
UPLOADS_SRC="${INFRA_DIR}/uploads"
if [ -d "$UPLOADS_SRC" ]; then
  echo "  • Archiving uploads directory…"
  tar -czf "${BACKUP_DIR}/uploads.tar.gz" -C "$UPLOADS_SRC" .
else
  echo "  • No uploads directory found at ${UPLOADS_SRC}, skipping."
fi

echo "==> Backup complete: ${BACKUP_DIR}"
ls -lh "$BACKUP_DIR"
