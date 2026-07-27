#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups/snapshots"
KEEP_BACKUPS=12
TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
BACKUP_FILE="$BACKUP_DIR/tendencia-infra-$TIMESTAMP.tar.gz"
TEMP_FILE="$BACKUP_FILE.tmp.$$"

mkdir -p "$BACKUP_DIR"

TAR_EXCLUDES=(
  --exclude=".git"
  --exclude="node_modules"
  --exclude="dist"
  --exclude="playwright-report"
  --exclude="test-results"
  --exclude=".lighthouseci"
  --exclude="supabase/.temp"
  --exclude=".mimocode/.cron-lock"
  --exclude="backups/snapshots"
  --exclude="backups/database"
  --exclude="backups/backup.log"
)

while IFS= read -r -d '' env_file; do
  env_name="${env_file#"$PROJECT_DIR/"}"
  if [[ "$env_name" != *.example ]]; then
    TAR_EXCLUDES+=("--exclude=$env_name")
  fi
done < <(find "$PROJECT_DIR/config/env" -maxdepth 1 -type f -name ".env*" -print0)

cleanup_temp() {
  rm -f -- "$TEMP_FILE"
}
trap cleanup_temp EXIT

tar \
  "${TAR_EXCLUDES[@]}" \
  -czf "$TEMP_FILE" \
  -C "$PROJECT_DIR" \
  .

mv -- "$TEMP_FILE" "$BACKUP_FILE"
trap - EXIT

mapfile -d '' BACKUPS < <(
  find "$BACKUP_DIR" -maxdepth 1 -type f -name "tendencia-infra-*.tar.gz" -print0 |
    sort -z
)

REMOVE_COUNT=$((${#BACKUPS[@]} - KEEP_BACKUPS))
for ((index = 0; index < REMOVE_COUNT; index += 1)); do
  rm -- "${BACKUPS[$index]}"
done

echo "Backup criado: $BACKUP_FILE"
echo "Backups mantidos: $(find "$BACKUP_DIR" -maxdepth 1 -type f -name "tendencia-infra-*.tar.gz" | wc -l)"
