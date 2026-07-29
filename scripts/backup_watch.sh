#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERVAL_SECONDS="${SOURCE_BACKUP_INTERVAL_SECONDS:-1800}"
LOCK_FILE="$PROJECT_DIR/backups/.backup-watch.lock"

if [[ "$INTERVAL_SECONDS" -lt 60 ]]; then
  echo "Erro: SOURCE_BACKUP_INTERVAL_SECONDS deve ser no minimo 60." >&2
  exit 1
fi

mkdir -p "$PROJECT_DIR/backups"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Backup frequente ja esta em execucao."
  exit 0
fi

echo "Backup frequente ativo a cada $INTERVAL_SECONDS segundos."
while true; do
  "$PROJECT_DIR/scripts/backup.sh"
  sleep "$INTERVAL_SECONDS"
done
