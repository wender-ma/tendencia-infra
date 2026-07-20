#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INDEX_FILE="$ROOT_DIR/index.html"
PROFILE="${1:-baseline}"

if [[ "$PROFILE" != "baseline" && "$PROFILE" != "hardened" ]]; then
  echo "Uso: $0 [baseline|hardened]" >&2
  exit 2
fi

PROJECT_URL="${SUPABASE_URL:-}"
SUPA_KEY="${SUPABASE_ANON_KEY:-}"

if [[ -z "$PROJECT_URL" ]]; then
  PROJECT_URL="$(sed -n "s/^const SUPA_URL = '\([^']*\)';/\1/p" "$INDEX_FILE" | head -n 1)"
fi

if [[ -z "$SUPA_KEY" ]]; then
  SUPA_KEY="$(sed -n "s/^const SUPA_KEY = '\([^']*\)';/\1/p" "$INDEX_FILE" | head -n 1)"
fi

if [[ -z "$PROJECT_URL" || -z "$SUPA_KEY" ]]; then
  echo "Erro: SUPABASE_URL/SUPABASE_ANON_KEY ou SUPA_URL/SUPA_KEY em index.html nao encontrados." >&2
  exit 1
fi

PROJECT_URL="${PROJECT_URL%/}"
PROJECT_URL="${PROJECT_URL%/rest/v1}"
REST_URL="$PROJECT_URL/rest/v1"

CONTRACTS=(
  "obras|codigo_obra,nome,key_empobratd,observacao,ativa,origem,criada_em"
  "editores_permitidos|email,codigo_obra,nome,observacao,role,status,adicionado_em"
  "flow_classifications|codigo_obra,n_alteracao,insumo_planejamento,insumo_remanejamento,custo_flowmaster,refletido_status,updated_at"
  "flow_manuals|codigo_obra,n_alteracao,n_adt,dep,descricao,data_br,data,aprovador_dep,aprovador,solicitante_dep,solicitante,custo_flowmaster,custo_planejamento,motivo,justificativa,insumo_planejamento,insumo_remanejamento,obs,created_at,created_by"
  "projecao_config|codigo_obra,insumo_controlado,saldo_inicial,data_ref,locked_saldo,locked_data,locked_insumo,updated_at"
  "projecao_movimentacoes|id,codigo_obra,tipo,data,data_br,origem,destino,descricao,justificativa,responsavel,valor,created_at,created_by"
  "dashboard_config|chave,valor,updated_at"
  "upload_history|id,codigo_obra,tipo,nome_arquivo,tamanho_bytes,linhas,enviado_por,storage_path,upload_group_id,is_active,enviado_em"
  "upload_history_latest|id,codigo_obra,tipo,nome_arquivo,tamanho_bytes,linhas,enviado_por,storage_path,upload_group_id,is_active,enviado_em"
)

TMP_BODY="$(mktemp)"
TMP_HEADERS="$(mktemp)"
trap 'rm -f "$TMP_BODY" "$TMP_HEADERS"' EXIT

failures=0
echo "Auditoria publica do contrato Supabase (GET com limit=0)"
echo "Projeto: ${PROJECT_URL#https://}"
echo "Perfil esperado: $PROFILE"
echo

for contract in "${CONTRACTS[@]}"; do
  table="${contract%%|*}"
  columns="${contract#*|}"

  status="$(curl -sS --max-time 20 -G \
    -H "apikey: $SUPA_KEY" \
    -H "Authorization: Bearer $SUPA_KEY" \
    -H "Prefer: count=exact" \
    --data-urlencode "select=$columns" \
    --data-urlencode "limit=0" \
    -D "$TMP_HEADERS" \
    -o "$TMP_BODY" \
    -w '%{http_code}' \
    "$REST_URL/$table")"

  sensitive=false
  case "$table" in
    editores_permitidos|upload_history|upload_history_latest) sensitive=true ;;
  esac

  if [[ "$PROFILE" == "hardened" && "$sensitive" == true ]]; then
    if [[ "$status" == "401" || "$status" == "403" ]]; then
      printf 'OK   %-30s acesso anonimo bloqueado (HTTP %s)\n' "$table" "$status"
    else
      printf 'ERRO %-30s deveria bloquear anonimo; recebeu HTTP %s\n' "$table" "$status"
      failures=$((failures + 1))
    fi
  elif [[ "$status" == "200" || "$status" == "206" ]]; then
    visible_rows="$(sed -n 's/^content-range: .*\/\([0-9][0-9]*\)\r$/\1/p' "$TMP_HEADERS" | tail -n 1)"
    visible_rows="${visible_rows:-desconhecido}"
    printf 'OK   %-30s %2s colunas; linhas anonimas visiveis: %s\n' \
      "$table" "$(awk -F, '{print NF}' <<< "$columns")" "$visible_rows"
  else
    printf 'ERRO %-30s HTTP %s: ' "$table" "$status"
    tr '\n' ' ' < "$TMP_BODY"
    echo
    failures=$((failures + 1))
  fi
done

echo
if (( failures > 0 )); then
  echo "Resultado: $failures contrato(s) com divergencia." >&2
  exit 1
fi

if [[ "$PROFILE" == "hardened" ]]; then
  echo "Resultado: perfil endurecido confirmado para acessos anonimos."
else
  echo "Resultado: baseline publico confirmado."
fi
