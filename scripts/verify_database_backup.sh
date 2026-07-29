#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups/database"
POSTGRES_IMAGE="${POSTGRES_BACKUP_IMAGE:-postgres:17-alpine}"
FORCE_DOCKER="${POSTGRES_BACKUP_FORCE_DOCKER:-false}"

: "${BACKUP_ENCRYPTION_PASSWORD:?Defina BACKUP_ENCRYPTION_PASSWORD para verificar o backup}"

BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" ]]; then
  BACKUP_FILE="$(
    find "$BACKUP_DIR" -maxdepth 1 -type f -name "tendencia-production-*.dump.enc" |
      sort |
      tail -n 1
  )"
fi

if [[ -z "$BACKUP_FILE" || ! -s "$BACKUP_FILE" ]]; then
  echo "Erro: nenhum backup de banco valido foi encontrado." >&2
  exit 1
fi

list_dump() {
  if [[ "$FORCE_DOCKER" == "true" ]]; then
    if ! command -v docker >/dev/null 2>&1; then
      echo "Erro: Docker nao esta disponivel para o cliente PostgreSQL solicitado." >&2
      return 1
    fi
    docker run --rm --interactive "$POSTGRES_IMAGE" pg_restore --list
    return
  fi

  if command -v pg_restore >/dev/null 2>&1; then
    pg_restore --list
    return
  fi

  if command -v docker >/dev/null 2>&1; then
    docker run --rm --interactive "$POSTGRES_IMAGE" pg_restore --list
    return
  fi

  echo "Erro: instale pg_restore ou Docker para verificar o backup." >&2
  return 1
}

export BACKUP_ENCRYPTION_PASSWORD
ENTRY_COUNT="$(
  openssl enc -d -aes-256-cbc -pbkdf2 \
    -pass env:BACKUP_ENCRYPTION_PASSWORD \
    -in "$BACKUP_FILE" |
    list_dump |
    grep -c '^'
)"

if [[ "$ENTRY_COUNT" -lt 10 ]]; then
  echo "Erro: catalogo do backup contem apenas $ENTRY_COUNT entradas." >&2
  exit 1
fi

echo "Backup verificavel: $BACKUP_FILE ($ENTRY_COUNT entradas no catalogo)"
