#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

import { assertTarget, parseArguments } from './audit_supabase_inventory.mjs';

const MANAGEMENT_API = 'https://api.supabase.com/v1';
const LOGS_ENDPOINT = 'analytics/endpoints/logs';
const DEFAULT_RANGE_DAYS = 7;
const MAX_RANGE_DAYS = 31;
const WINDOW_MILLISECONDS = 23 * 60 * 60 * 1000;
const DEFAULT_QUERY_DELAY_MILLISECONDS = 2_100;
const MAX_REQUEST_ATTEMPTS = 4;

export const AGGREGATE_LOG_QUERIES = Object.freeze({
  writes: `
    select
      toString(toDate(timestamp)) as day,
      upperUTF8(log_attributes['request.method']) as method,
      multiIf(
        startsWith(log_attributes['request.path'], '/rest/v1/'),
          extract(log_attributes['request.path'], '^/rest/v1/([^/?]+)'),
        startsWith(log_attributes['request.path'], '/storage/v1/'), 'storage',
        'other'
      ) as resource,
      coalesce(
        nullIf(log_attributes['request.sb.jwt.authorization.payload.role'], ''),
        nullIf(log_attributes['request.sb.jwt.apikey.payload.role'], ''),
        'none'
      ) as auth_role,
      toInt32OrZero(log_attributes['response.status_code']) as status,
      count() as event_count
    from logs
    where source = 'edge_logs'
      and upperUTF8(log_attributes['request.method']) in ('POST', 'PUT', 'PATCH', 'DELETE')
      and (
        startsWith(log_attributes['request.path'], '/rest/v1/')
        or startsWith(log_attributes['request.path'], '/storage/v1/')
      )
    group by day, method, resource, auth_role, status
    order by day, resource, method, auth_role, status
    limit 1000
  `,
  database_errors: `
    select
      toString(toDate(timestamp)) as day,
      coalesce(nullIf(log_attributes['parsed.sql_state_code'], ''), 'unknown') as sql_state,
      coalesce(nullIf(log_attributes['parsed.error_severity'], ''), severity_text, 'unknown')
        as severity,
      coalesce(nullIf(log_attributes['parsed.user_name'], ''), 'unknown') as database_role,
      count() as event_count
    from logs
    where source = 'postgres_logs'
      and (
        (
          log_attributes['parsed.sql_state_code'] != ''
          and log_attributes['parsed.sql_state_code'] != '00000'
        )
        or match(log_attributes['parsed.error_severity'], 'ERROR|FATAL|PANIC')
      )
    group by day, sql_state, severity, database_role
    order by day, sql_state, database_role
    limit 1000
  `,
  auth_actions: `
    select
      toString(toDate(timestamp)) as day,
      coalesce(nullIf(log_attributes['auth_audit_event.action'], ''), 'unknown') as action,
      coalesce(
        nullIf(log_attributes['auth_audit_event.traits.provider'], ''),
        'unspecified'
      ) as provider,
      count() as event_count
    from logs
    where source = 'auth_audit_logs'
    group by day, action, provider
    order by day, action, provider
    limit 1000
  `,
});

function stripQuotedLiterals(query) {
  return query.replace(/'(?:''|[^'])*'/g, "''");
}

export function assertAggregateLogQuery(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized.startsWith('select')) {
    throw new Error('A auditoria recusou uma consulta de logs que nao inicia com SELECT.');
  }

  const withoutLiterals = stripQuotedLiterals(query);
  const forbidden =
    /\b(insert|update|delete|merge|truncate|alter|create|drop|grant|revoke|attach|detach)\b/i;
  if (forbidden.test(withoutLiterals) || /;\s*\S/.test(query)) {
    throw new Error('A auditoria recusou uma instrucao de logs capaz de alterar estado.');
  }

  const sensitiveOutput =
    /\b(event_message|actor_id|actor_username|actor_name|auth_user|subject|objectpath)\b/i;
  if (sensitiveOutput.test(query)) {
    throw new Error('A auditoria recusou um campo de log sensivel.');
  }
}

function parseTimestamp(value, label) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${label} invalido; use uma data ISO-8601.`);
  }
  return timestamp;
}

export function resolveRange({ from, to, now = new Date() }) {
  const toTimestamp = to ? parseTimestamp(to, '--to') : now.getTime();
  const fromTimestamp = from
    ? parseTimestamp(from, '--from')
    : toTimestamp - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000;

  if (fromTimestamp >= toTimestamp) {
    throw new Error('--from deve ser anterior a --to.');
  }
  if (toTimestamp - fromTimestamp > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    throw new Error(`A auditoria aceita no maximo ${MAX_RANGE_DAYS} dias por execucao.`);
  }
  if (toTimestamp > now.getTime() + 60_000) {
    throw new Error('--to nao pode estar no futuro.');
  }

  return {
    from: new Date(fromTimestamp).toISOString(),
    to: new Date(toTimestamp).toISOString(),
  };
}

export function splitRangeIntoWindows(range) {
  const windows = [];
  let cursor = Date.parse(range.from);
  const end = Date.parse(range.to);

  while (cursor < end) {
    const windowEnd = Math.min(cursor + WINDOW_MILLISECONDS, end);
    windows.push({
      from: new Date(cursor).toISOString(),
      to: new Date(windowEnd).toISOString(),
    });
    cursor = windowEnd;
  }

  return windows;
}

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.data)) return payload.data;
  throw new Error('A API de logs retornou um formato desconhecido.');
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestJson(url, options, accessToken, fetchImpl, sleepImpl = wait) {
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    const response = await fetchImpl(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...options?.headers,
      },
      signal: AbortSignal.timeout(30_000),
    });

    const body = await response.text();
    let payload;
    try {
      payload = body ? JSON.parse(body) : null;
    } catch {
      payload = null;
    }

    if (response.ok) return payload;

    if (response.status === 429 && attempt < MAX_REQUEST_ATTEMPTS) {
      const retryAfterSeconds = Number(response.headers.get('retry-after'));
      const delay =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.min(retryAfterSeconds * 1000, 30_000)
          : Math.min(5_000 * 2 ** (attempt - 1), 30_000);
      await sleepImpl(delay);
      continue;
    }

    const message =
      payload?.message || payload?.error || `HTTP ${response.status} ${response.statusText}`;
    throw new Error(`Supabase Management API: ${String(message).slice(0, 300)}`);
  }

  throw new Error('Supabase Management API: limite de tentativas excedido.');
}

async function queryAggregateLogs({
  projectRef,
  query,
  window,
  accessToken,
  fetchImpl,
  sleepImpl,
}) {
  assertAggregateLogQuery(query);
  const url = new URL(`${MANAGEMENT_API}/projects/${projectRef}/${LOGS_ENDPOINT}`);
  url.searchParams.set('sql', query);
  url.searchParams.set('iso_timestamp_start', window.from);
  url.searchParams.set('iso_timestamp_end', window.to);

  const payload = await requestJson(url, {}, accessToken, fetchImpl, sleepImpl);
  return normalizeRows(payload);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function mergeRows(rows, dimensions) {
  const merged = new Map();

  for (const row of rows) {
    const normalized = Object.fromEntries(
      dimensions.map((dimension) => [dimension, String(row[dimension] ?? 'unknown')]),
    );
    const key = dimensions.map((dimension) => normalized[dimension]).join('\u001f');
    const current = merged.get(key);
    if (current) {
      current.event_count += toNumber(row.event_count);
    } else {
      merged.set(key, {
        ...normalized,
        event_count: toNumber(row.event_count),
      });
    }
  }

  return [...merged.values()].sort((left, right) => {
    for (const dimension of dimensions) {
      const comparison = left[dimension].localeCompare(right[dimension]);
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
}

function sumRows(rows, predicate = () => true) {
  return rows.filter(predicate).reduce((total, row) => total + toNumber(row.event_count), 0);
}

export function buildLogAuditSummary({
  project,
  range,
  windows,
  writeRows,
  databaseErrorRows,
  authActionRows,
  auditedAt = new Date().toISOString(),
}) {
  const writes = mergeRows(writeRows, ['day', 'method', 'resource', 'auth_role', 'status']);
  const databaseErrors = mergeRows(databaseErrorRows, [
    'day',
    'sql_state',
    'severity',
    'database_role',
  ]).filter((row) => row.sql_state !== '00000' || /ERROR|FATAL|PANIC/i.test(row.severity));
  const authActions = mergeRows(authActionRows, ['day', 'action', 'provider']);
  const isSuccess = (row) => {
    const status = toNumber(row.status);
    return status >= 200 && status < 300;
  };
  const isBlocked = (row) => ['401', '403'].includes(row.status);
  const isAnonymous = (row) => ['anon', 'none'].includes(row.auth_role);

  return {
    audited_at: auditedAt,
    audit_mode: 'supabase-management-api-aggregate-logs-read-only',
    privacy: 'aggregate-only-no-event-content-no-identity-no-paths',
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      region: project.region,
    },
    requested_range: range,
    queried_window_count: windows.length,
    write_activity: {
      event_count: sumRows(writes),
      successful_event_count: sumRows(writes, isSuccess),
      blocked_event_count: sumRows(writes, isBlocked),
      anonymous_successful_event_count: sumRows(
        writes,
        (row) => isSuccess(row) && isAnonymous(row),
      ),
      rows: writes,
    },
    database_errors: {
      event_count: sumRows(databaseErrors),
      rows: databaseErrors,
    },
    auth_activity: {
      event_count: sumRows(authActions),
      rows: authActions,
    },
    limitations: [
      'Logs agregados indicam atividade, mas nao comprovam intencao ou legitimidade.',
      'A cobertura depende da retencao de logs disponivel no plano do projeto.',
      'Operacoes diretas sem log retido nao podem ser reconstruidas por esta auditoria.',
    ],
  };
}

export async function auditSupabaseLogs({
  projectRef,
  confirmedProjectRef,
  expectedProjectName,
  accessToken,
  from,
  to,
  now = new Date(),
  fetchImpl = fetch,
  queryDelayMilliseconds = DEFAULT_QUERY_DELAY_MILLISECONDS,
  sleepImpl = wait,
}) {
  assertTarget({ projectRef, confirmedProjectRef });
  if (!accessToken) {
    throw new Error('SUPABASE_ACCESS_TOKEN ausente. Configure-o somente em .env.supabase.local.');
  }

  const range = resolveRange({ from, to, now });
  const windows = splitRangeIntoWindows(range);
  const projects = await requestJson(
    `${MANAGEMENT_API}/projects`,
    {},
    accessToken,
    fetchImpl,
    sleepImpl,
  );
  const project = projects.find((candidate) => candidate.id === projectRef);
  if (!project) {
    throw new Error(`O token nao possui acesso ao projeto ${projectRef}.`);
  }
  if (expectedProjectName && project.name !== expectedProjectName) {
    throw new Error(
      `Nome do alvo divergente: esperado "${expectedProjectName}", recebido "${project.name}".`,
    );
  }

  const collected = {
    writes: [],
    database_errors: [],
    auth_actions: [],
  };
  const queryCount = windows.length * Object.keys(AGGREGATE_LOG_QUERIES).length;
  let completedQueryCount = 0;
  for (const window of windows) {
    for (const [name, query] of Object.entries(AGGREGATE_LOG_QUERIES)) {
      const rows = await queryAggregateLogs({
        projectRef,
        query,
        window,
        accessToken,
        fetchImpl,
        sleepImpl,
      });
      collected[name].push(...rows);
      completedQueryCount += 1;
      if (queryDelayMilliseconds > 0 && completedQueryCount < queryCount) {
        await sleepImpl(queryDelayMilliseconds);
      }
    }
  }

  return buildLogAuditSummary({
    project,
    range,
    windows,
    writeRows: collected.writes,
    databaseErrorRows: collected.database_errors,
    authActionRows: collected.auth_actions,
  });
}

async function main() {
  const argumentsMap = parseArguments(process.argv.slice(2));
  const projectRef = argumentsMap['project-ref'] || process.env.SUPABASE_PROJECT_REF?.trim();
  const summary = await auditSupabaseLogs({
    projectRef,
    confirmedProjectRef: argumentsMap['confirm-project-ref'],
    expectedProjectName: argumentsMap['expected-project-name'],
    accessToken: process.env.SUPABASE_ACCESS_TOKEN?.trim(),
    from: argumentsMap.from,
    to: argumentsMap.to,
  });
  console.log(JSON.stringify(summary, null, 2));
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error) => {
    console.error(`Auditoria de logs interrompida: ${error.message || error}`);
    process.exitCode = 1;
  });
}
