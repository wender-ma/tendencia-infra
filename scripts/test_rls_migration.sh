#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="tendencia-rls-test-$$"
IMAGE="${POSTGRES_TEST_IMAGE:-postgres:15-alpine}"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "Iniciando PostgreSQL descartavel ($IMAGE)..."
docker run --rm --detach \
  --name "$CONTAINER" \
  --env POSTGRES_PASSWORD=test \
  --env POSTGRES_DB=tendencia_test \
  --volume "$ROOT_DIR:/workspace:ro" \
  "$IMAGE" >/dev/null

ready=false
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" \
    psql --quiet --tuples-only -U postgres -d tendencia_test -c 'select 1' >/dev/null 2>&1; then
    sleep 2
    if docker exec "$CONTAINER" \
      psql --quiet --tuples-only -U postgres -d tendencia_test -c 'select 1' >/dev/null 2>&1; then
      ready=true
      break
    fi
  fi
  sleep 1
done

if [[ "$ready" != true ]]; then
  echo "Erro: PostgreSQL nao ficou pronto no tempo esperado." >&2
  exit 1
fi

run_sql() {
  local label="$1"
  local path="$2"
  echo "==> $label"
  docker exec -i "$CONTAINER" \
    psql --quiet --set ON_ERROR_STOP=1 -U postgres -d tendencia_test \
    < "$ROOT_DIR/$path"
}

run_sql "Criando baseline auditado" "supabase/tests/fixture_baseline.sql"
run_sql "Aplicando migration RLS" "supabase/migrations/20260720172000_rls_hardening.sql"
run_sql "Validando estado endurecido" "supabase/tests/assert_hardened.sql"
run_sql "Aplicando operacoes administrativas atomicas" "supabase/migrations/20260720203000_admin_transactions.sql"
run_sql "Validando transacoes administrativas" "supabase/tests/assert_admin_transactions.sql"
run_sql "Aplicando snapshots versionados" "supabase/migrations/20260721211500_dashboard_datasets.sql"
run_sql "Validando snapshots versionados" "supabase/tests/assert_dashboard_datasets.sql"
run_sql "Removendo objetos dos snapshots de teste" "supabase/tests/cleanup_dashboard_dataset_objects.sql"
run_sql "Aplicando rollback dos snapshots versionados" "supabase/rollback/20260721211500_dashboard_datasets_rollback.sql"
run_sql "Validando rollback dos snapshots versionados" "supabase/tests/assert_dashboard_datasets_rollback.sql"
run_sql "Aplicando rollback das transacoes administrativas" "supabase/rollback/20260720203000_admin_transactions_rollback.sql"
run_sql "Validando rollback das transacoes administrativas" "supabase/tests/assert_admin_transactions_rollback.sql"
run_sql "Aplicando rollback emergencial" "supabase/rollback/20260720172000_rls_hardening_rollback.sql"
run_sql "Validando estado restaurado" "supabase/tests/assert_rollback.sql"

echo "Resultado: migration e rollback validados com sucesso."
