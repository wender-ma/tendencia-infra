#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

(async () => {
  const {
    AGGREGATE_LOG_QUERIES,
    assertAggregateLogQuery,
    auditSupabaseLogs,
    buildLogAuditSummary,
    resolveRange,
    splitRangeIntoWindows,
  } = await import('./audit_supabase_logs.mjs');

  for (const query of Object.values(AGGREGATE_LOG_QUERIES)) {
    assert.doesNotThrow(() => assertAggregateLogQuery(query));
  }
  assert.throws(() => assertAggregateLogQuery('delete from logs'), /recusou/);
  assert.throws(
    () => assertAggregateLogQuery('select event_message from logs'),
    /campo de log sensivel/,
  );
  assert.throws(
    () => assertAggregateLogQuery('select count() from logs; drop table logs'),
    /alterar estado/,
  );

  const now = new Date('2026-07-27T12:00:00.000Z');
  const range = resolveRange({ from: '2026-07-20T00:00:00Z', to: now.toISOString(), now });
  const windows = splitRangeIntoWindows(range);
  assert.strictEqual(windows.length, 8);
  assert.strictEqual(windows[0].from, '2026-07-20T00:00:00.000Z');
  assert.strictEqual(windows.at(-1).to, now.toISOString());
  assert.throws(
    () =>
      resolveRange({
        from: '2026-01-01T00:00:00Z',
        to: now.toISOString(),
        now,
      }),
    /31 dias/,
  );

  const summary = buildLogAuditSummary({
    project: {
      id: 'abcdefghijklmnopqrst',
      name: 'Producao',
      status: 'ACTIVE_HEALTHY',
      region: 'us-east-2',
    },
    range,
    windows,
    writeRows: [
      {
        day: '2026-07-20',
        method: 'POST',
        resource: 'dashboard_config',
        auth_role: 'anon',
        status: 201,
        event_count: 2,
      },
      {
        day: '2026-07-20',
        method: 'POST',
        resource: 'dashboard_config',
        auth_role: 'anon',
        status: '201',
        event_count: '3',
      },
      {
        day: '2026-07-21',
        method: 'DELETE',
        resource: 'upload_history',
        auth_role: 'authenticated',
        status: 403,
        event_count: 1,
      },
    ],
    databaseErrorRows: [
      {
        day: '2026-07-20',
        sql_state: '00000',
        severity: 'LOG',
        database_role: 'postgres',
        event_count: 9,
      },
      {
        day: '2026-07-21',
        sql_state: '42501',
        severity: 'ERROR',
        database_role: 'authenticator',
        event_count: 1,
      },
    ],
    authActionRows: [
      {
        day: '2026-07-21',
        action: 'login',
        provider: 'google',
        event_count: 2,
      },
    ],
    auditedAt: now.toISOString(),
  });
  assert.strictEqual(summary.write_activity.event_count, 6);
  assert.strictEqual(summary.write_activity.successful_event_count, 5);
  assert.strictEqual(summary.write_activity.blocked_event_count, 1);
  assert.strictEqual(summary.write_activity.anonymous_successful_event_count, 5);
  assert.strictEqual(summary.write_activity.rows.length, 2);
  assert.strictEqual(summary.database_errors.event_count, 1);
  assert.strictEqual(summary.auth_activity.event_count, 2);
  assert(!JSON.stringify(summary).match(/email|actor_id|event_message|request\.path/i));

  const responses = [];
  const retryDelays = [];
  let throttled = false;
  const fetchImpl = async (url) => {
    responses.push(String(url));
    if (String(url).endsWith('/projects')) {
      if (!throttled) {
        throttled = true;
        return new Response(JSON.stringify({ message: 'Too Many Requests' }), {
          status: 429,
          headers: { 'retry-after': '1' },
        });
      }
      return new Response(
        JSON.stringify([
          {
            id: 'abcdefghijklmnopqrst',
            name: 'Producao',
            status: 'ACTIVE_HEALTHY',
            region: 'us-east-2',
          },
        ]),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ result: [] }), { status: 200 });
  };
  const remoteSummary = await auditSupabaseLogs({
    projectRef: 'abcdefghijklmnopqrst',
    confirmedProjectRef: 'abcdefghijklmnopqrst',
    expectedProjectName: 'Producao',
    accessToken: 'not-a-real-token',
    from: '2026-07-27T10:00:00Z',
    to: '2026-07-27T12:00:00Z',
    now,
    fetchImpl,
    queryDelayMilliseconds: 0,
    sleepImpl: async (milliseconds) => {
      retryDelays.push(milliseconds);
    },
  });
  assert.strictEqual(responses.length, 5);
  assert.deepStrictEqual(retryDelays, [1000]);
  assert(responses.slice(2).every((url) => url.includes('/analytics/endpoints/logs?')));
  assert(responses.slice(2).every((url) => url.includes('iso_timestamp_start=')));
  assert.strictEqual(remoteSummary.write_activity.event_count, 0);

  const source = fs.readFileSync(path.join(__dirname, 'audit_supabase_logs.mjs'), 'utf8');
  assert(source.includes('analytics/endpoints/logs'));
  assert(!source.includes('analytics/endpoints/logs.all'));
  assert(!source.includes('SUPABASE_DB_PASSWORD'));
  assert(!source.includes('service_role'));

  console.log('Auditoria de logs: alvo confirmado, janelas limitadas e saida agregada OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
