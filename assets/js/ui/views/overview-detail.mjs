function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function hasCurrencyValue(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function isUnclassifiedInput(value) {
  const input = String(value || '').trim();
  return (
    !input ||
    input === '-' ||
    input === 'Não encontrado!' ||
    input === 'Aumento de obra' ||
    input.toUpperCase().includes('VERIFICAR')
  );
}

function emptyMetrics() {
  return {
    originalBudget: 0,
    correctedBudget: 0,
    management: 0,
    inflationVariation: 0,
    incorporatedVariation: 0,
    automaticProjection: 0,
    pendingFlows: 0,
    finalTendency: 0,
    difference: 0,
    totalVariation: 0,
  };
}

function flowDetail(flow) {
  return {
    numero: String(flow.n_alteracao || '').trim() || 'Sem número',
    descricao:
      String(flow.descricao || flow.motivo || flow.justificativa || '').trim() || 'Sem descrição',
    insumo: isUnclassifiedInput(flow.insumo_planejamento)
      ? ''
      : String(flow.insumo_planejamento).trim(),
    valor: roundCurrency(flow.custo_flowmaster),
    refletidoMes: String(flow.refletido_mes || '').slice(0, 7),
  };
}

function nodeType(row) {
  if (row.is_folha) return 'insumo';
  if (row.cod_servico) return 'servico';
  const level = Number(row.nivel) || 0;
  if (level <= 1) return 'raiz';
  if (level === 2) return 'grupo';
  return 'subgrupo';
}

function groupCode(group) {
  const codes = {
    'Custos Indiretos': '01.01',
    'Custos Diretos / Infraestrutura': '01.02',
    'Obras Civis': '01.03',
    'Projeção de Gastos': '01.04',
  };
  return codes[group] || '';
}

export function buildOverviewInputDetailModel({
  tendencyRows = [],
  inputProjections = [],
  flows = [],
  correctionIndex = 'ipca',
  dataFim = '',
  projectCode = '',
  managementLabel = 'Atual',
} = {}) {
  const correctionField = correctionIndex === 'incc' ? 'corrigido_incc' : 'corrigido_ipca';
  const nodes = [];
  const containerStack = [];

  for (const [sourceIndex, row] of tendencyRows.entries()) {
    const type = nodeType(row);
    const level = Number(row.nivel) || (type === 'raiz' ? 1 : 4);
    const correctedAvailable = row.is_folha && hasCurrencyValue(row[correctionField]);
    const node = {
      index: nodes.length,
      key: `source:${sourceIndex}`,
      sourceIndex,
      ordem: Number(row.ordem) || sourceIndex,
      cod: String(row.cod || ''),
      cod_servico: String(row.cod_servico || ''),
      cod_insumo: String(row.cod_insumo || ''),
      item: String(row.item || row.cod_insumo || row.cod_servico || row.cod || ''),
      grupo: String(row.grupo || ''),
      nivel: level,
      tipo: type,
      isLeaf: Boolean(row.is_folha),
      isSynthetic: false,
      correctedAvailable,
      parent: null,
      children: [],
      metrics: emptyMetrics(),
      projectionItems: [],
      pendingFlowItems: [],
      reflectedFlowItems: [],
    };
    if (node.isLeaf) {
      node.metrics.originalBudget = hasCurrencyValue(row.licitacao)
        ? roundCurrency(row.licitacao)
        : 0;
      node.metrics.correctedBudget = correctedAvailable ? roundCurrency(row[correctionField]) : 0;
      node.metrics.management = roundCurrency(row.gestao);
      let parent = null;
      for (let index = containerStack.length - 1; index >= 0; index -= 1) {
        const candidate = nodes[containerStack[index]];
        if (
          node.cod_servico &&
          candidate.cod_servico === node.cod_servico &&
          (!candidate.cod || candidate.cod === node.cod)
        ) {
          parent = candidate.index;
          break;
        }
        if (candidate.nivel < node.nivel) {
          parent = candidate.index;
          break;
        }
      }
      node.parent = parent;
    } else {
      while (
        containerStack.length &&
        nodes[containerStack[containerStack.length - 1]].nivel >= node.nivel
      ) {
        containerStack.pop();
      }
      node.parent = containerStack.length ? containerStack[containerStack.length - 1] : null;
      containerStack.push(node.index);
    }
    nodes.push(node);
    if (node.parent !== null) nodes[node.parent].children.push(node.index);
  }

  const rootIndex = nodes.findIndex((node) => node.tipo === 'raiz');
  function findGroupParent(group) {
    const code = groupCode(group);
    return (
      nodes.find((node) => !node.isLeaf && code && node.cod.replace(/^1\./, '01.') === code)
        ?.index ?? rootIndex
    );
  }

  let unlinkedGroup = null;
  function ensureUnlinkedGroup() {
    if (unlinkedGroup) return unlinkedGroup;
    const node = {
      index: nodes.length,
      key: 'synthetic:unlinked-group',
      sourceIndex: null,
      ordem: Number.MAX_SAFE_INTEGER - 1,
      cod: '',
      cod_servico: '',
      cod_insumo: '',
      item: 'Sem vínculo único',
      grupo: 'Outros',
      nivel: 2,
      tipo: 'grupo',
      isLeaf: false,
      isSynthetic: true,
      correctedAvailable: false,
      parent: rootIndex >= 0 ? rootIndex : null,
      children: [],
      metrics: emptyMetrics(),
      projectionItems: [],
      pendingFlowItems: [],
      reflectedFlowItems: [],
    };
    nodes.push(node);
    if (node.parent !== null) nodes[node.parent].children.push(node.index);
    unlinkedGroup = node;
    return node;
  }

  const syntheticInputs = new Map();
  function appendSyntheticInput({ input = '', service = '', group = '', reason = 'projection' }) {
    const key = `${reason}|${service}|${input || '__unclassified__'}`;
    if (syntheticInputs.has(key)) return syntheticInputs.get(key);
    const ambiguous = reason === 'ambiguous-flow' || reason === 'unclassified-flow';
    const parent = ambiguous ? ensureUnlinkedGroup().index : findGroupParent(group);
    const label = input
      ? ambiguous
        ? `${input} · vínculo ambíguo`
        : input
      : 'Sem insumo classificado';
    const node = {
      index: nodes.length,
      key: `synthetic:${key}`,
      sourceIndex: null,
      ordem: Number.MAX_SAFE_INTEGER,
      cod: '',
      cod_servico: service,
      cod_insumo: input,
      item: label,
      grupo: group || 'Outros',
      nivel: 4,
      tipo: 'insumo',
      isLeaf: true,
      isSynthetic: true,
      correctedAvailable: false,
      parent: parent >= 0 ? parent : null,
      children: [],
      metrics: emptyMetrics(),
      projectionItems: [],
      pendingFlowItems: [],
      reflectedFlowItems: [],
    };
    nodes.push(node);
    if (node.parent !== null) nodes[node.parent].children.push(node.index);
    syntheticInputs.set(key, node);
    return node;
  }

  function leafCandidatesByKey(service, input) {
    return nodes.filter(
      (node) =>
        node.isLeaf &&
        !node.isSynthetic &&
        node.cod_servico === String(service || '') &&
        node.cod_insumo === String(input || ''),
    );
  }

  for (const projection of inputProjections) {
    let candidates = leafCandidatesByKey(projection.servico, projection.insumo);
    if (!candidates.length) {
      candidates = [
        appendSyntheticInput({
          input: String(projection.insumo || ''),
          service: String(projection.servico || ''),
          group: String(projection.grupo || ''),
          reason: 'projection',
        }),
      ];
    }
    let weights = candidates.map((node) => Math.max(node.metrics.management, 0));
    let totalWeight = weights.reduce((sum, value) => sum + value, 0);
    if (totalWeight <= 0) {
      weights = candidates.map((node) => Math.max(node.metrics.correctedBudget, 0));
      totalWeight = weights.reduce((sum, value) => sum + value, 0);
    }
    if (totalWeight <= 0) {
      weights = candidates.map((_, index) => (index === 0 ? 1 : 0));
      totalWeight = 1;
    }
    const target = roundCurrency(projection.extrapolacao);
    let allocated = 0;
    candidates.forEach((node, index) => {
      const value =
        index === candidates.length - 1
          ? roundCurrency(target - allocated)
          : roundCurrency(target * (weights[index] / totalWeight));
      allocated = roundCurrency(allocated + value);
      node.metrics.automaticProjection = roundCurrency(node.metrics.automaticProjection + value);
      node.projectionItems.push({
        servico: String(projection.servico || ''),
        insumo: String(projection.insumo || ''),
        ultimoMesPlanejado: String(projection.ultimo_mes_planejado || ''),
        dataFim,
        mesesGap: Number(projection.meses_gap) || 0,
        ritmoHistorico:
          Number(projection.meses_gap) > 0 ? roundCurrency(value / projection.meses_gap) : 0,
        valorProjetado: value,
      });
    });
  }

  function resolveFlowTarget(flow) {
    const input = isUnclassifiedInput(flow.insumo_planejamento)
      ? ''
      : String(flow.insumo_planejamento).trim();
    if (!input) {
      return appendSyntheticInput({ reason: 'unclassified-flow' });
    }
    const candidates = nodes.filter(
      (node) => node.isLeaf && !node.isSynthetic && node.cod_insumo === input,
    );
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      return appendSyntheticInput({ input, reason: 'ambiguous-flow' });
    }
    const projectionCandidate = nodes.find(
      (node) => node.isLeaf && node.isSynthetic && node.cod_insumo === input,
    );
    return projectionCandidate || appendSyntheticInput({ input, reason: 'unclassified-flow' });
  }

  for (const flow of flows) {
    if (flow.dep === 'Cancelado') continue;
    const status = flow.refletido_status || 'pendente';
    if (!['pendente', 'sim'].includes(status)) continue;
    const target = resolveFlowTarget(flow);
    const detail = flowDetail(flow);
    if (status === 'pendente') {
      if (Math.abs(detail.valor) < 0.005) continue;
      target.metrics.pendingFlows = roundCurrency(target.metrics.pendingFlows + detail.valor);
      target.pendingFlowItems.push(detail);
    } else {
      target.reflectedFlowItems.push(detail);
    }
  }

  for (const node of nodes.filter((item) => item.isLeaf)) {
    node.metrics.inflationVariation = roundCurrency(
      node.metrics.correctedBudget - node.metrics.originalBudget,
    );
    node.metrics.incorporatedVariation = roundCurrency(
      node.metrics.management - node.metrics.correctedBudget,
    );
    node.metrics.finalTendency = roundCurrency(
      node.metrics.management + node.metrics.automaticProjection + node.metrics.pendingFlows,
    );
    node.metrics.difference = roundCurrency(
      node.metrics.finalTendency - node.metrics.correctedBudget,
    );
    node.metrics.totalVariation = roundCurrency(
      node.metrics.finalTendency - node.metrics.originalBudget,
    );
    for (const projection of node.projectionItems) {
      projection.finalTendency = node.metrics.finalTendency;
    }
  }

  if (unlinkedGroup && unlinkedGroup.parent !== null) {
    const siblings = nodes[unlinkedGroup.parent].children;
    nodes[unlinkedGroup.parent].children = [
      unlinkedGroup.index,
      ...siblings.filter((index) => index !== unlinkedGroup.index),
    ];
  }

  function aggregate(index) {
    const node = nodes[index];
    if (!node.children.length) return node;
    node.metrics = emptyMetrics();
    node.correctedAvailable = false;
    node.projectionItems = [];
    node.pendingFlowItems = [];
    node.reflectedFlowItems = [];
    for (const childIndex of node.children) {
      const child = aggregate(childIndex);
      for (const key of Object.keys(node.metrics)) {
        node.metrics[key] = roundCurrency(node.metrics[key] + child.metrics[key]);
      }
      node.correctedAvailable ||= child.correctedAvailable;
      node.projectionItems.push(...child.projectionItems);
      node.pendingFlowItems.push(...child.pendingFlowItems);
      node.reflectedFlowItems.push(...child.reflectedFlowItems);
    }
    return node;
  }
  const roots = nodes.filter((node) => node.parent === null).map((node) => node.index);
  roots.forEach(aggregate);

  return {
    projectCode,
    managementLabel,
    correctionIndex,
    dataFim,
    nodes,
    roots,
    root: rootIndex >= 0 ? nodes[rootIndex] : nodes[roots[0]] || null,
  };
}
