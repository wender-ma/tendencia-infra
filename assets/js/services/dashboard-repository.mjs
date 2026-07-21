export const DASHBOARD_DATA_KEYS = Object.freeze({
  DATA_T: 'dados_tendencia',
  DATA_F: 'dados_flows',
  HISTORICO: 'dados_historico',
  PROJ_RAW: 'dados_projraw',
  GESTAO_LABEL: 'gestao_label',
});

const CLASSIFICATION_FIELDS = new Set([
  'insumo_planejamento',
  'insumo_remanejamento',
  'custo_flowmaster',
  'refletido_status',
]);

function classificationMap(rows = []) {
  return Object.fromEntries(
    rows.map((row) => [
      `${row.codigo_obra || ''}:${row.n_alteracao}`,
      {
        codigo_obra: row.codigo_obra,
        insumo_planejamento: row.insumo_planejamento,
        insumo_remanejamento: row.insumo_remanejamento,
        custo_flowmaster: row.custo_flowmaster,
        refletido_status: row.refletido_status,
        refletido: row.refletido_status === 'sim',
      },
    ]),
  );
}

function manualFromRow(row) {
  return {
    n_alteracao: row.n_alteracao,
    n_adt: row.n_adt || '',
    dep: row.dep || '',
    descricao: row.descricao || '',
    data_br: row.data_br || '',
    data: row.data || '',
    aprovador_dep: row.aprovador_dep || '',
    aprovador: row.aprovador || '',
    solicitante_dep: row.solicitante_dep || '',
    solicitante: row.solicitante || '',
    custo_flowmaster: row.custo_flowmaster,
    custo_planejamento: row.custo_planejamento,
    motivo: row.motivo || '',
    justificativa: row.justificativa || '',
    insumo_planejamento: row.insumo_planejamento || '',
    insumo_remanejamento: row.insumo_remanejamento || '',
    obs: row.obs || '',
    incl_orcamento: '',
    incl_planej: '',
    incl_tendencia: '',
    revisao_tendencia: '',
  };
}

function movementFromRow(row) {
  return {
    id: row.id,
    tipo: row.tipo,
    data: row.data,
    data_br: row.data_br,
    origem: row.origem,
    destino: row.destino,
    descricao: row.descricao,
    justificativa: row.justificativa,
    responsavel: row.responsavel,
    valor: row.valor,
    created_at: row.created_at,
    created_by: row.created_by,
  };
}

export function createDashboardRepository({
  getClient,
  getActiveProject,
  getCurrentUser,
  canEditActiveProject,
  isAdmin,
  retry = (operation) => operation(),
  onMutation = () => {},
  onRead = () => {},
  warn = () => {},
  now = () => new Date(),
}) {
  const client = () => getClient?.() || null;
  const activeProject = () => String(getActiveProject?.() || '').trim();

  async function read(context, fallback, operation) {
    try {
      const result = await retry(operation);
      if (result.error) {
        warn(context, result.error);
        onRead(result.error);
        return fallback;
      }
      onRead(null);
      return result.data;
    } catch (error) {
      warn(context, error);
      onRead(error);
      return fallback;
    }
  }

  async function mutate(operation) {
    const result = await operation();
    if (result.error) {
      onMutation(result.error);
      throw result.error;
    }
    onMutation(null);
    return result.data;
  }

  async function loadClassifications() {
    const supabase = client();
    const project = activeProject();
    if (!supabase || !project) return null;
    const rows = await read('Classificações/carregar', null, () =>
      supabase
        .from('flow_classifications')
        .select(
          'codigo_obra,n_alteracao,insumo_planejamento,insumo_remanejamento,custo_flowmaster,refletido_status',
        )
        .eq('codigo_obra', project),
    );
    return rows ? classificationMap(rows) : null;
  }

  async function patchClassification(changeNumber, patch, projectCode) {
    const supabase = client();
    const project = activeProject();
    const scopedProject = String(projectCode || project).trim();
    if (!supabase || !canEditActiveProject?.() || !project || scopedProject !== project) return;

    const fields = Object.fromEntries(
      Object.entries(patch || {}).filter(([field]) => CLASSIFICATION_FIELDS.has(field)),
    );
    if (!Object.keys(fields).length) return;

    const updatePatch = { ...fields, updated_at: now().toISOString() };
    const email = getCurrentUser?.()?.email;
    if (email) updatePatch.updated_by = email;

    const updateExisting = () =>
      supabase
        .from('flow_classifications')
        .update(updatePatch)
        .eq('codigo_obra', project)
        .eq('n_alteracao', changeNumber)
        .select('codigo_obra,n_alteracao')
        .maybeSingle();

    let result = await updateExisting();
    if (!result.error && !result.data) {
      result = await supabase.from('flow_classifications').insert({
        codigo_obra: project,
        n_alteracao: changeNumber,
        ...updatePatch,
      });
      if (result.error?.code === '23505') result = await updateExisting();
    }
    if (result.error) {
      onMutation(result.error);
      throw result.error;
    }
    onMutation(null);
  }

  async function loadManuals() {
    const supabase = client();
    const project = activeProject();
    if (!supabase || !project) return null;
    const rows = await read('Manuais/carregar', null, () =>
      supabase.from('flow_manuals').select('*').eq('codigo_obra', project),
    );
    return rows ? rows.map(manualFromRow) : null;
  }

  async function upsertManual(manual) {
    const supabase = client();
    const project = activeProject();
    if (!supabase || !canEditActiveProject?.() || !project) return;
    return mutate(() =>
      supabase.from('flow_manuals').upsert(
        {
          codigo_obra: project,
          n_alteracao: manual.n_alteracao,
          n_adt: manual.n_adt,
          dep: manual.dep,
          descricao: manual.descricao,
          data: manual.data,
          data_br: manual.data_br,
          aprovador_dep: manual.aprovador_dep,
          aprovador: manual.aprovador,
          solicitante_dep: manual.solicitante_dep,
          solicitante: manual.solicitante,
          custo_flowmaster: manual.custo_flowmaster,
          custo_planejamento: manual.custo_planejamento,
          motivo: manual.motivo,
          justificativa: manual.justificativa,
          insumo_planejamento: manual.insumo_planejamento,
          insumo_remanejamento: manual.insumo_remanejamento,
          obs: manual.obs,
        },
        { onConflict: 'codigo_obra,n_alteracao' },
      ),
    );
  }

  async function deleteManual(changeNumber) {
    const supabase = client();
    const project = activeProject();
    if (!supabase || !canEditActiveProject?.() || !project) return;
    return mutate(() =>
      supabase
        .from('flow_manuals')
        .delete()
        .eq('codigo_obra', project)
        .eq('n_alteracao', changeNumber),
    );
  }

  async function loadProjectionConfig() {
    const supabase = client();
    const project = activeProject();
    if (!supabase || !project) return null;
    return read('Projeção/carregar configuração', null, () =>
      supabase.from('projecao_config').select('*').eq('codigo_obra', project).maybeSingle(),
    );
  }

  async function saveProjectionConfig(config) {
    const supabase = client();
    const project = activeProject();
    if (!supabase || !canEditActiveProject?.() || !project) return;
    const locks = config.locks || { saldo: false, data: false, insumo: false };
    return mutate(() =>
      supabase.from('projecao_config').upsert(
        {
          codigo_obra: project,
          insumo_controlado: config.insumo || 'I011890',
          saldo_inicial: config.saldo_inicial ?? null,
          data_ref: config.data_ref || null,
          locked_saldo: !!locks.saldo,
          locked_data: !!locks.data,
          locked_insumo: !!locks.insumo,
          updated_at: now().toISOString(),
        },
        { onConflict: 'codigo_obra' },
      ),
    );
  }

  async function loadMovements() {
    const supabase = client();
    const project = activeProject();
    if (!supabase || !project) return null;
    const rows = await read('Projeção/carregar movimentações', null, () =>
      supabase.from('projecao_movimentacoes').select('*').eq('codigo_obra', project),
    );
    return rows ? rows.map(movementFromRow) : null;
  }

  async function upsertMovement(movement) {
    const supabase = client();
    const project = activeProject();
    if (!supabase || !canEditActiveProject?.() || !project) return;
    return mutate(() =>
      supabase.from('projecao_movimentacoes').upsert(
        {
          codigo_obra: project,
          id: movement.id,
          tipo: movement.tipo,
          data: movement.data,
          data_br: movement.data_br,
          origem: movement.origem,
          destino: movement.destino,
          descricao: movement.descricao,
          justificativa: movement.justificativa,
          responsavel: movement.responsavel,
          valor: movement.valor,
        },
        { onConflict: 'id' },
      ),
    );
  }

  async function deleteMovement(id) {
    const supabase = client();
    const project = activeProject();
    if (!supabase || !canEditActiveProject?.() || !project) return;
    return mutate(() =>
      supabase.from('projecao_movimentacoes').delete().eq('codigo_obra', project).eq('id', id),
    );
  }

  async function loadDashboardConfig() {
    const supabase = client();
    const project = activeProject();
    if (!supabase || !project) return {};
    const prefix = `${project}:`;
    const requiredKeys = [
      'header_title',
      'indice_correcao',
      'card3_modo',
      DASHBOARD_DATA_KEYS.DATA_F,
      DASHBOARD_DATA_KEYS.HISTORICO,
      DASHBOARD_DATA_KEYS.PROJ_RAW,
      `${prefix}evol_global`,
      prefix + DASHBOARD_DATA_KEYS.GESTAO_LABEL,
      prefix + DASHBOARD_DATA_KEYS.DATA_T,
      prefix + DASHBOARD_DATA_KEYS.DATA_F,
    ];
    const rows = await read('Configuração/carregar', [], () =>
      supabase.from('dashboard_config').select('chave,valor').in('chave', requiredKeys),
    );
    return Object.fromEntries(rows.map((row) => [row.chave, row.valor]));
  }

  async function saveDashboardKey(key, value) {
    const supabase = client();
    const project = activeProject();
    if (!supabase) return;
    const normalizedKey = String(key || '');
    const keyProject = normalizedKey.includes(':') ? normalizedKey.split(':', 1)[0] : null;
    if (!(isAdmin?.() || (keyProject === project && canEditActiveProject?.()))) return;
    return mutate(() =>
      supabase.from('dashboard_config').upsert(
        {
          chave: normalizedKey,
          valor: String(value || ''),
          updated_at: now().toISOString(),
        },
        { onConflict: 'chave' },
      ),
    );
  }

  return Object.freeze({
    loadClassifications,
    patchClassification,
    loadManuals,
    upsertManual,
    deleteManual,
    loadProjectionConfig,
    saveProjectionConfig,
    loadMovements,
    upsertMovement,
    deleteMovement,
    loadDashboardConfig,
    saveDashboardKey,
  });
}

export function installLegacyDashboardRepository(repository, target = window) {
  Object.assign(target, {
    DATA_KEYS: DASHBOARD_DATA_KEYS,
    supaLoadClassifications: repository.loadClassifications,
    supaPatchClassification: repository.patchClassification,
    supaLoadManuals: repository.loadManuals,
    supaUpsertManual: repository.upsertManual,
    supaDeleteManual: repository.deleteManual,
    supaLoadProjConfig: repository.loadProjectionConfig,
    supaSaveProjConfig: repository.saveProjectionConfig,
    supaLoadMovs: repository.loadMovements,
    supaUpsertMov: repository.upsertMovement,
    supaDeleteMov: repository.deleteMovement,
    supaLoadDashboardConfig: repository.loadDashboardConfig,
    supaSaveDashboardKey: repository.saveDashboardKey,
  });
}
