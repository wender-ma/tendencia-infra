#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import {
  assertTarget,
  auditSupabaseInventory,
  parseArguments,
} from './audit_supabase_inventory.mjs';
import {
  assertBackfillMode,
  assertProductionTarget,
  buildBackfillPlan,
  summarizeBackfillPlan,
} from './lib/production_dataset_backfill.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function requiredEnvironment(environment, name) {
  const value = String(environment[name] || '').trim();
  if (!value) throw new Error(`${name} ausente`);
  return value;
}

async function authenticateAdmin({ projectUrl, anonKey, email, password }) {
  const client = createClient(projectUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data?.user) {
    throw new Error(`Login administrativo recusado: ${error?.message || 'sem usuario'}`);
  }

  const { data: profile, error: profileError } = await client
    .from('editores_permitidos')
    .select('role,status')
    .eq('email', data.user.email)
    .maybeSingle();
  if (profileError || profile?.role !== 'admin' || profile?.status !== 'active') {
    await client.auth.signOut();
    throw new Error('A conta informada nao e um administrador ativo');
  }
  return client;
}

async function loadLegacyRows(client) {
  const { data, error } = await client
    .from('dashboard_config')
    .select('chave,valor')
    .or(
      'chave.eq.dados_flows,chave.eq.dados_historico,chave.eq.dados_projraw,chave.like.*:dados_tendencia,chave.like.*:dados_flows',
    );
  if (error) throw error;
  return data || [];
}

async function countActiveSnapshots(client) {
  const { count, error } = await client
    .from('dashboard_datasets')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');
  if (error) throw error;
  return Number(count || 0);
}

async function executeBackfill(client, entries) {
  const moduleUrl = pathToFileURL(
    path.join(root, 'assets/js/services/dashboard-dataset-repository.mjs'),
  );
  const { createDashboardDatasetRepository } = await import(moduleUrl.href);
  const repositories = new Map();
  const repositoryFor = (projectCode = '_global') => {
    if (!repositories.has(projectCode)) {
      repositories.set(
        projectCode,
        createDashboardDatasetRepository({
          getClient: () => client,
          getActiveProject: () => projectCode,
          allowLegacyFallback: false,
        }),
      );
    }
    return repositories.get(projectCode);
  };

  const activations = [];
  const rollbackRepository = repositoryFor('_global');
  try {
    for (const entry of entries.filter((candidate) => candidate.type === 'tendencia')) {
      const repository = repositoryFor(entry.projectCode);
      const result = await repository.saveForUpload(['tendencia'], {
        tendency: entry.data,
      });
      if (!result.available || result.activations.length !== 1) {
        throw new Error('Backfill de Tendencia nao criou exatamente uma versao');
      }
      activations.push(...result.activations);
    }

    const globalRepository = repositoryFor('_global');
    const flows = entries.find((entry) => entry.type === 'flows');
    const history = entries.find((entry) => entry.type === 'historico');
    const projectionRaw = entries.find((entry) => entry.type === 'projecao_raw');
    const globalResult = await globalRepository.saveForUpload(['flows', 'gestoes'], {
      flows: flows.data,
      history: history.data,
      projectionRaw: projectionRaw.data,
    });
    if (!globalResult.available || globalResult.activations.length !== 3) {
      throw new Error('Backfill global nao criou exatamente tres versoes');
    }
    activations.push(...globalResult.activations);

    for (const entry of entries) {
      const repository = repositoryFor(entry.projectCode || '_global');
      const loaded = await repository.loadSnapshot(entry.type, entry.projectCode);
      if (!isDeepStrictEqual(loaded?.data, entry.data)) {
        throw new Error(`Conteudo divergente em ${entry.type}`);
      }
    }

    const finalLegacyEntries = buildBackfillPlan(await loadLegacyRows(client));
    if (finalLegacyEntries.length !== entries.length) {
      throw new Error('A quantidade de blobs legados mudou durante o backfill');
    }
    for (const entry of entries) {
      const finalEntry = finalLegacyEntries.find((candidate) => candidate.key === entry.key);
      if (!finalEntry || !isDeepStrictEqual(finalEntry.data, entry.data)) {
        throw new Error(`O dataset legado ${entry.type} mudou durante o backfill`);
      }
    }
    const activeSnapshotCount = await countActiveSnapshots(client);
    if (activeSnapshotCount !== entries.length) {
      throw new Error('Contagem final de snapshots ativos diverge do plano');
    }
    return { activations, activeSnapshotCount };
  } catch (error) {
    try {
      await rollbackRepository.rollbackSnapshots(activations);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Backfill falhou e o rollback compensatorio ficou incompleto',
      );
    }
    throw error;
  }
}

export async function runBackfill({
  argumentsMap,
  environment = process.env,
  dependencies = {},
} = {}) {
  const auditInventory = dependencies.auditInventory || auditSupabaseInventory;
  const authenticate = dependencies.authenticate || authenticateAdmin;
  const loadRows = dependencies.loadRows || loadLegacyRows;
  const execute = dependencies.execute || executeBackfill;
  const countActive = dependencies.countActive || countActiveSnapshots;
  const projectRef = argumentsMap['project-ref'];
  const confirmedProjectRef = argumentsMap['confirm-project-ref'];
  const expectedProjectName = argumentsMap['expected-project-name'];
  const mode = argumentsMap.mode || 'plan';
  assertTarget({ projectRef, confirmedProjectRef });
  if (!expectedProjectName) throw new Error('--expected-project-name e obrigatorio');

  const projectUrl = requiredEnvironment(environment, 'VITE_SUPABASE_URL');
  const accessToken = requiredEnvironment(environment, 'SUPABASE_ACCESS_TOKEN');

  assertProductionTarget({
    environment: environment.VITE_APP_ENV,
    projectUrl,
    projectRef,
  });
  assertBackfillMode({
    mode,
    writeOptIn: environment.ALLOW_PRODUCTION_BACKFILL,
    confirmation: argumentsMap.confirmation,
  });

  const inventory = await auditInventory({
    projectRef,
    confirmedProjectRef,
    expectedProjectName,
    accessToken,
  });
  if (!inventory.dashboard_datasets_deployment.complete) {
    throw new Error('Deployment de snapshots incompleto; aplique as migrations pendentes primeiro');
  }
  if (!inventory.data_inventory.backfill_review_required) {
    return {
      project: inventory.project,
      inventory_before: inventory.data_inventory,
      backfill: { mode, applied: false, dataset_count: 0, reason: 'no_legacy_datasets' },
    };
  }
  if (inventory.data_inventory.active_snapshot_count !== 0) {
    throw new Error('Ja existem snapshots ativos; backfill automatico recusado');
  }

  const anonKey = requiredEnvironment(environment, 'VITE_SUPABASE_ANON_KEY');
  const email = requiredEnvironment(environment, 'SUPABASE_BACKFILL_ADMIN_EMAIL');
  const password = requiredEnvironment(environment, 'SUPABASE_BACKFILL_ADMIN_PASSWORD');
  const client = await authenticate({ projectUrl, anonKey, email, password });
  try {
    if ((await countActive(client)) !== 0) {
      throw new Error('Snapshots ativos surgiram depois do inventario; backfill recusado');
    }
    const rows = await loadRows(client);
    const plan = buildBackfillPlan(rows);
    if (plan.length !== inventory.data_inventory.legacy_dataset_key_count) {
      throw new Error('Contagem dos blobs mudou depois do inventario; repita a operacao');
    }
    const summary = summarizeBackfillPlan(plan, { mode, applied: false });
    if (summary.legacy_bytes !== inventory.data_inventory.legacy_dataset_bytes) {
      throw new Error('O tamanho dos blobs mudou depois do inventario; repita a operacao');
    }
    if (mode === 'plan') {
      return {
        project: inventory.project,
        inventory_before: inventory.data_inventory,
        backfill: summary,
      };
    }

    const execution = await execute(client, plan);
    return {
      project: inventory.project,
      inventory_before: inventory.data_inventory,
      backfill: {
        ...summarizeBackfillPlan(plan, { mode, applied: true }),
        activated_snapshot_count: execution.activations.length,
        verified_snapshot_count: execution.activeSnapshotCount,
      },
    };
  } finally {
    await client.auth.signOut().catch(() => {});
  }
}

async function main() {
  const argumentsMap = parseArguments(process.argv.slice(2));
  const result = await runBackfill({ argumentsMap, environment: process.env });
  console.log(JSON.stringify(result, null, 2));
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main().catch((error) => {
    const message = String(error?.message || error).replace(
      /[^\s/]+\/(tendencia|flows|historico|projecao_raw)\/[^\s]+/g,
      '[escopo]/$1/[objeto]',
    );
    console.error(`Backfill interrompido: ${message}`);
    process.exitCode = 1;
  });
}
