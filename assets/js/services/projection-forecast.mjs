import { normalizePhysicalScheduleCurve } from '../parsers/physical-schedule-parser.mjs';

const METHODS = Object.freeze(['run_rate', 'ramp_down', 'physical']);

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function addMonths(month, count) {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(year, value - 1 + count, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(start, end) {
  if (!/^\d{4}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}$/.test(end || '') || start > end) {
    return [];
  }
  const result = [];
  for (let current = start; current <= end; current = addMonths(current, 1)) result.push(current);
  return result;
}

function interpolate(values, position) {
  if (!values.length) return 0;
  if (position <= 0) return values[0];
  if (position >= values.length - 1) return values.at(-1);
  const left = Math.floor(position);
  const fraction = position - left;
  return values[left] + (values[left + 1] - values[left]) * fraction;
}

export function buildPhysicalForecastContext({
  schedule,
  officialEvolution,
  dataCorte,
  dataFim,
} = {}) {
  if (!schedule?.curve?.length || !schedule.cutoffMonth) return null;
  const normalized = normalizePhysicalScheduleCurve(
    schedule.curve,
    officialEvolution,
    schedule.cutoffMonth,
  );
  const cutoffIndex = normalized.findIndex((point) => point.month === schedule.cutoffMonth);
  if (cutoffIndex < 0) return null;
  const sourceFuture = normalized.slice(cutoffIndex).map((point) => point.planned);
  const targetMonths = monthRange(schedule.cutoffMonth, dataFim || normalized.at(-1).month);
  const plannedByMonth = {};
  targetMonths.forEach((month, index) => {
    const position =
      targetMonths.length <= 1
        ? sourceFuture.length - 1
        : (index / (targetMonths.length - 1)) * (sourceFuture.length - 1);
    plannedByMonth[month] = Math.min(100, Math.max(0, interpolate(sourceFuture, position)));
  });
  const actualByMonth = Object.fromEntries(
    normalized
      .filter((point) => point.month <= schedule.cutoffMonth)
      .map((point) => [point.month, point.actual]),
  );
  return {
    available: true,
    sourceCutoff: schedule.cutoffMonth,
    dataCorte,
    dataFim,
    officialEvolution: Math.min(100, Math.max(0, Number(officialEvolution) || 0)),
    plannedByMonth,
    actualByMonth,
    sourceFile: schedule.sourceFile || '',
  };
}

function weightedRunRate(values) {
  if (!values.length) return 0;
  let weighted = 0;
  let weights = 0;
  values.forEach((value, index) => {
    const weight = index + 1;
    weighted += (Number(value) || 0) * weight;
    weights += weight;
  });
  return Math.max(0, weighted / weights);
}

function recentValues(monthlyValues, beforeMonth, windowMonths) {
  return monthRange(addMonths(beforeMonth, -windowMonths), addMonths(beforeMonth, -1)).map(
    (month) => Number(monthlyValues?.[month]) || 0,
  );
}

function physicalValueAt(context, month, series = 'plannedByMonth') {
  const values = context?.[series] || {};
  if (values[month] != null) return Number(values[month]) || 0;
  const candidates = Object.keys(values)
    .filter((key) => key <= month)
    .sort();
  return candidates.length ? Number(values[candidates.at(-1)]) || 0 : 0;
}

function candidateMonthlyValues({
  monthlyValues,
  extrapolationMonths,
  dataCorte,
  windowMonths,
  physicalContext,
}) {
  const history = recentValues(monthlyValues, dataCorte, windowMonths);
  const runRate = weightedRunRate(history);
  const runRateValues = Object.fromEntries(extrapolationMonths.map((month) => [month, runRate]));
  const official = physicalContext?.officialEvolution || 0;
  const remainingAtCutoff = Math.max(0.0001, 100 - official);
  const rampDownValues = Object.fromEntries(
    extrapolationMonths.map((month) => {
      const previousMonth = addMonths(month, -1);
      const remaining = Math.max(0, 100 - physicalValueAt(physicalContext, previousMonth));
      return [month, runRate * Math.min(1, remaining / remainingAtCutoff)];
    }),
  );

  const physicalStart = addMonths(dataCorte, -windowMonths);
  const progressStart = physicalValueAt(physicalContext, physicalStart, 'actualByMonth');
  const progressEnd = physicalValueAt(physicalContext, addMonths(dataCorte, -1), 'actualByMonth');
  const physicalDelta = progressEnd - progressStart;
  const historicalCost = history.reduce((sum, value) => sum + value, 0);
  const costPerPoint = physicalDelta > 0 ? Math.max(0, historicalCost / physicalDelta) : null;
  const physicalValues = Object.fromEntries(
    extrapolationMonths.map((month) => {
      const increment = Math.max(
        0,
        physicalValueAt(physicalContext, month) -
          physicalValueAt(physicalContext, addMonths(month, -1)),
      );
      return [month, costPerPoint == null ? 0 : costPerPoint * increment];
    }),
  );
  return {
    runRate,
    costPerPoint,
    byMethod: {
      run_rate: runRateValues,
      ramp_down: rampDownValues,
      physical: physicalValues,
    },
  };
}

function backtestMethod(method, monthlyValues, closedMonths, windowMonths, physicalContext) {
  const results = [];
  for (const target of closedMonths) {
    const history = recentValues(monthlyValues, target, windowMonths);
    const runRate = weightedRunRate(history);
    let predicted = runRate;
    if (method === 'ramp_down') {
      const start = physicalValueAt(
        physicalContext,
        addMonths(target, -windowMonths),
        'actualByMonth',
      );
      const previous = physicalValueAt(physicalContext, addMonths(target, -1), 'actualByMonth');
      const current = physicalValueAt(physicalContext, target, 'actualByMonth');
      const observedWindow = Math.max(0.0001, 100 - start);
      predicted = runRate * Math.min(1, Math.max(0, 100 - previous) / observedWindow);
      if (current >= 100) predicted = 0;
    } else if (method === 'physical') {
      const startMonth = addMonths(target, -windowMonths);
      const progressStart = physicalValueAt(physicalContext, startMonth, 'actualByMonth');
      const progressPrevious = physicalValueAt(
        physicalContext,
        addMonths(target, -1),
        'actualByMonth',
      );
      const progressCurrent = physicalValueAt(physicalContext, target, 'actualByMonth');
      const delta = progressPrevious - progressStart;
      if (delta <= 0) continue;
      predicted =
        (history.reduce((sum, value) => sum + value, 0) / delta) *
        Math.max(0, progressCurrent - progressPrevious);
    }
    results.push({ predicted: Math.max(0, predicted), actual: Number(monthlyValues[target]) || 0 });
  }
  if (results.length < 3) return { samples: results.length, wape: null, mae: null };
  const absoluteError = results.reduce(
    (sum, result) => sum + Math.abs(result.predicted - result.actual),
    0,
  );
  const actualTotal = results.reduce((sum, result) => sum + Math.abs(result.actual), 0);
  return {
    samples: results.length,
    wape: actualTotal > 0 ? absoluteError / actualTotal : null,
    mae: absoluteError / results.length,
  };
}

function selectMethod(diagnostics, override) {
  if (METHODS.includes(override)) return override;
  const eligible = METHODS.filter((method) => diagnostics[method].samples >= 3).sort(
    (left, right) => {
      const leftScore = diagnostics[left].wape ?? diagnostics[left].mae ?? Infinity;
      const rightScore = diagnostics[right].wape ?? diagnostics[right].mae ?? Infinity;
      if (Math.abs(leftScore - rightScore) <= 0.01 && [left, right].includes('ramp_down')) {
        return left === 'ramp_down' ? -1 : 1;
      }
      return leftScore - rightScore;
    },
  );
  return eligible[0] || 'ramp_down';
}

function confidenceFor(diagnostic) {
  if (diagnostic.samples >= 6 && diagnostic.wape != null && diagnostic.wape <= 0.15) return 'high';
  if (diagnostic.samples >= 3 && diagnostic.wape != null && diagnostic.wape <= 0.3) return 'medium';
  return 'low';
}

export function buildHybridInputForecast({
  monthlyValues = {},
  dataCorte,
  dataFim,
  windowMonths = 6,
  group,
  physicalContext,
  override = 'auto',
} = {}) {
  const relevantMonths = Object.keys(monthlyValues)
    .filter((month) => month <= dataFim && (Number(monthlyValues[month]) || 0) > 0)
    .sort();
  const lastPlannedMonth = relevantMonths.at(-1) || null;
  const canExtrapolate = ['Custos Indiretos', 'Projeção de Gastos'].includes(group);
  const extrapolationMonths =
    canExtrapolate && lastPlannedMonth && lastPlannedMonth < dataFim
      ? monthRange(addMonths(lastPlannedMonth, 1), dataFim)
      : [];
  if (!physicalContext?.available || !extrapolationMonths.length) {
    return {
      available: false,
      selectedMethod: 'legacy',
      confidence: 'low',
      extrapolationByMonth: {},
      extrapolation: 0,
      lastPlannedMonth,
      diagnostics: {},
    };
  }

  const candidates = candidateMonthlyValues({
    monthlyValues,
    extrapolationMonths,
    dataCorte,
    windowMonths,
    physicalContext,
  });
  const closedMonths = Object.keys(monthlyValues)
    .filter((month) => month < dataCorte && month > addMonths(dataCorte, -12))
    .sort();
  const diagnostics = Object.fromEntries(
    METHODS.map((method) => [
      method,
      backtestMethod(method, monthlyValues, closedMonths, windowMonths, physicalContext),
    ]),
  );
  if (candidates.costPerPoint == null) diagnostics.physical = { samples: 0, wape: null, mae: null };
  const selectedMethod = selectMethod(diagnostics, override);
  const extrapolationByMonth = Object.fromEntries(
    Object.entries(candidates.byMethod[selectedMethod]).map(([month, value]) => [
      month,
      roundCurrency(value),
    ]),
  );
  return {
    available: true,
    selectedMethod,
    confidence: confidenceFor(diagnostics[selectedMethod]),
    extrapolationByMonth,
    extrapolation: roundCurrency(
      Object.values(extrapolationByMonth).reduce((sum, value) => sum + value, 0),
    ),
    lastPlannedMonth,
    runRate: roundCurrency(candidates.runRate),
    costPerPoint: candidates.costPerPoint == null ? null : roundCurrency(candidates.costPerPoint),
    diagnostics,
  };
}

export const FORECAST_METHOD_LABELS = Object.freeze({
  legacy: 'Média simples atual',
  run_rate: 'Ritmo histórico ponderado',
  ramp_down: 'Desmobilização física',
  physical: 'Custo por avanço físico',
});
