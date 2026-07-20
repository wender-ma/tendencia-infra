#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups/snapshots"
KEEP_BACKUPS=12
TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
BACKUP_FILE="$BACKUP_DIR/tendencia-infra-$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

tar \
  --exclude=".git" \
  --exclude=".mimocode/node_modules" \
  --exclude="backups/snapshots" \
  -czf "$BACKUP_FILE" \
  -C "$PROJECT_DIR" \
  .

find "$BACKUP_DIR" -maxdepth 1 -type f -name "tendencia-infra-*.tar.gz" \
  | sort \
  | head -n -"${KEEP_BACKUPS}" \
  | xargs -r rm --

echo "Backup criado: $BACKUP_FILE"
echo "Backups mantidos: $(find "$BACKUP_DIR" -maxdepth 1 -type f -name "tendencia-infra-*.tar.gz" | wc -l)"
