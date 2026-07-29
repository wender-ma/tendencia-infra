#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups/database"
KEEP_BACKUPS="${DATABASE_BACKUP_RETENTION:-14}"
TIMESTAMP="$(date -u +"%Y%m%d-%H%M%S")"
BACKUP_FILE="$BACKUP_DIR/tendencia-production-$TIMESTAMP.dump.enc"
TEMP_FILE="$BACKUP_FILE.tmp.$$"
POSTGRES_IMAGE="${POSTGRES_BACKUP_IMAGE:-postgres:17-alpine}"

: "${SUPABASE_PRODUCTION_DB_URL:?Defina SUPABASE_PRODUCTION_DB_URL com a URI direta ou do pooler}"
: "${BACKUP_ENCRYPTION_PASSWORD:?Defina BACKUP_ENCRYPTION_PASSWORD com uma senha forte e exclusiva}"

if [[ "$KEEP_BACKUPS" -lt 2 ]]; then
  echo "Erro: DATABASE_BACKUP_RETENTION deve ser no minimo 2." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

cleanup_temp() {
  rm -f -- "$TEMP_FILE"
}
trap cleanup_temp EXIT

dump_database() {
  if command -v pg_dump >/dev/null 2>&1; then
    pg_dump \
      --dbname="$SUPABASE_PRODUCTION_DB_URL" \
      --format=custom \
      --no-owner \
      --no-acl
    return
  fi

  if command -v docker >/dev/null 2>&1; then
    docker run --rm \
      --env DATABASE_URL="$SUPABASE_PRODUCTION_DB_URL" \
      "$POSTGRES_IMAGE" \
      sh -c 'pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl'
    return
  fi

  echo "Erro: instale pg_dump ou Docker para gerar o backup." >&2
  return 1
}

export BACKUP_ENCRYPTION_PASSWORD
dump_database |
  openssl enc -aes-256-cbc -salt -pbkdf2 \
    -pass env:BACKUP_ENCRYPTION_PASSWORD \
    -out "$TEMP_FILE"

if [[ ! -s "$TEMP_FILE" ]]; then
  echo "Erro: backup criptografado vazio." >&2
  exit 1
fi

mv -- "$TEMP_FILE" "$BACKUP_FILE"
trap - EXIT

mapfile -d '' BACKUPS < <(
  find "$BACKUP_DIR" -maxdepth 1 -type f -name "tendencia-production-*.dump.enc" -print0 |
    sort -z
)

REMOVE_COUNT=$((${#BACKUPS[@]} - KEEP_BACKUPS))
for ((index = 0; index < REMOVE_COUNT; index += 1)); do
  rm -- "${BACKUPS[$index]}"
done

echo "Backup criptografado criado: $BACKUP_FILE"
echo "Backups de banco mantidos: $(find "$BACKUP_DIR" -maxdepth 1 -type f -name "tendencia-production-*.dump.enc" | wc -l)"
