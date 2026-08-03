export const WORKFORCE_INPUTS = Object.freeze(['ADM5189', 'CONDH271']);

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizedDistribution(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([month]) => /^\d{4}-\d{2}$/.test(month))
      .map(([month, quantity]) => [month, Math.max(0, Math.trunc(Number(quantity) || 0))]),
  );
}

export function normalizeWorkforceState({ settings = [], rows = [] } = {}) {
  const enabledByInput = Object.fromEntries(WORKFORCE_INPUTS.map((input) => [input, false]));
  for (const setting of settings || []) {
    if (WORKFORCE_INPUTS.includes(setting.insumo)) {
      enabledByInput[setting.insumo] = Boolean(setting.ativo);
    }
  }
  const normalizedRows = (rows || [])
    .filter((row) => WORKFORCE_INPUTS.includes(row.insumo))
    .map((row, index) => ({
      id: String(row.id || ''),
      codigo_obra: String(row.codigo_obra || ''),
      insumo: row.insumo,
      cargo: String(row.cargo || '').trim(),
      custo_mensal: roundCurrency(Math.max(0, Number(row.custo_mensal) || 0)),
      distribuicao: normalizedDistribution(row.distribuicao),
      ordem: Number.isFinite(Number(row.ordem)) ? Number(row.ordem) : index,
    }))
    .sort((left, right) => left.ordem - right.ordem || left.cargo.localeCompare(right.cargo));
  return { enabledByInput, rows: normalizedRows };
}

export function buildWorkforcePlan({ settings = [], rows = [], months = [] } = {}) {
  const normalized = normalizeWorkforceState({ settings, rows });
  const byInput = Object.fromEntries(
    WORKFORCE_INPUTS.map((input) => [input, Object.fromEntries(months.map((month) => [month, 0]))]),
  );
  const effectiveByMonth = Object.fromEntries(months.map((month) => [month, 0]));
  const costByMonth = Object.fromEntries(months.map((month) => [month, 0]));
  const series = normalized.rows.map((row) => {
    const quantities = months.map((month) => row.distribuicao[month] || 0);
    const costs = quantities.map((quantity) => roundCurrency(quantity * row.custo_mensal));
    months.forEach((month, index) => {
      effectiveByMonth[month] += quantities[index];
      costByMonth[month] = roundCurrency(costByMonth[month] + costs[index]);
      byInput[row.insumo][month] = roundCurrency(byInput[row.insumo][month] + costs[index]);
    });
    return { ...row, quantities, costs };
  });
  return {
    ...normalized,
    months: [...months],
    byInput,
    effectiveByMonth,
    costByMonth,
    series,
    totalCost: roundCurrency(Object.values(costByMonth).reduce((sum, value) => sum + value, 0)),
  };
}
