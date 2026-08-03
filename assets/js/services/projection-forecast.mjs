import { normalizePhysicalScheduleCurve } from '../parsers/physical-schedule-parser.mjs';

const CONFIGURABLE_METHODS = Object.freeze(['fixed', 'physical', 'mixed', 'manual', 'none']);
const SAMPLE_OPTIONS = Object.freeze([6, 12, 18, 0]);
const DEFAULT_INPUT_CONFIG = Object.freeze({
  method: 'fixed',
  sampleMonths: 12,
  lagMonths: 0,
  fixedShare: 70,
  manualMonthlyValue: 0,
});

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function addMonths(month, count) {
  const [year, value] = String(month || '')
    .split('-')
    .map(Number);
  if (!year || !value) return '';
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

function median(values) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function interpolate(values, position) {
  if (!values.length) return 0;
  if (position <= 0) return values[0];
  if (position >= values.length - 1) return values.at(-1);
  const left = Math.floor(position);
  const fraction = position - left;
  return values[left] + (values[left + 1] - values[left]) * fraction;
}

function physicalValueAt(context, month, series = 'plannedByMonth') {
  const values = context?.[series] || {};
  if (values[month] != null) return Number(values[month]) || 0;
  const candidates = Object.keys(values)
    .filter((key) => key <= month)
    .sort();
  return candidates.length ? Number(values[candidates.at(-1)]) || 0 : 0;
}

function physicalIncrement(context, month, series = 'plannedByMonth', lagMonths = 0) {
  const referenceMonth = addMonths(month, -Math.max(0, lagMonths));
  return Math.max(
    0,
    physicalValueAt(context, referenceMonth, series) -
      physicalValueAt(context, addMonths(referenceMonth, -1), series),
  );
}

function pearsonCorrelation(points) {
  if (points.length < 3) return null;
  const xAverage = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const yAverage = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const numerator = points.reduce(
    (sum, point) => sum + (point.x - xAverage) * (point.y - yAverage),
    0,
  );
  const xScale = Math.sqrt(points.reduce((sum, point) => sum + (point.x - xAverage) ** 2, 0));
  const yScale = Math.sqrt(points.reduce((sum, point) => sum + (point.y - yAverage) ** 2, 0));
  return xScale && yScale ? numerator / (xScale * yScale) : null;
}

function normalizeLegacyMethod(value) {
  if (value === 'run_rate' || value === 'auto' || value === 'legacy') return 'fixed';
  if (value === 'ramp_down') return 'mixed';
  return value;
}

export function normalizeInputForecastConfig(value = {}) {
  const source = typeof value === 'string' ? { method: normalizeLegacyMethod(value) } : value || {};
  const method = normalizeLegacyMethod(source.method);
  const sampleMonths = Number(source.sampleMonths);
  return {
    method: CONFIGURABLE_METHODS.includes(method) ? method : DEFAULT_INPUT_CONFIG.method,
    sampleMonths: SAMPLE_OPTIONS.includes(sampleMonths)
      ? sampleMonths
      : DEFAULT_INPUT_CONFIG.sampleMonths,
    lagMonths: Math.round(clamp(source.lagMonths, 0, 2)),
    fixedShare: Math.round(clamp(source.fixedShare ?? DEFAULT_INPUT_CONFIG.fixedShare, 0, 100)),
    manualMonthlyValue: roundCurrency(Math.max(0, Number(source.manualMonthlyValue) || 0)),
  };
}

function historicalSeries(monthlyValues, dataCorte, sampleMonths) {
  const available = Object.keys(monthlyValues || {})
    .filter((month) => /^\d{4}-\d{2}$/.test(month) && month < dataCorte)
    .sort();
  if (!available.length) return [];
  const requestedStart = sampleMonths > 0 ? addMonths(dataCorte, -sampleMonths) : available[0];
  const start = requestedStart > available[0] ? requestedStart : available[0];
  return monthRange(start, addMonths(dataCorte, -1)).map((month) => ({
    month,
    value: Number(monthlyValues?.[month]) || 0,
  }));
}

function robustStatistics(series) {
  const values = series.map((point) => point.value);
  const center = median(values);
  const mad = median(values.map((value) => Math.abs(value - center)));
  const outliers = series.filter((point) => {
    if (mad <= 0) return point.value !== center;
    const modifiedZ = (0.6745 * (point.value - center)) / mad;
    return Math.abs(modifiedZ) > 3.5;
  });
  return {
    center: roundCurrency(Math.max(0, center)),
    mad: roundCurrency(mad),
    outliers: outliers.map((point) => ({ month: point.month, value: roundCurrency(point.value) })),
  };
}

function physicalPairs(series, physicalContext, lagMonths, fixedMonthly = 0) {
  return series
    .map((point) => ({
      month: point.month,
      cost: Math.max(0, point.value - fixedMonthly),
      progress: physicalIncrement(physicalContext, point.month, 'actualByMonth', lagMonths),
    }))
    .filter((point) => point.progress >= 0.05);
}

function coefficientFromPairs(pairs) {
  return roundCurrency(median(pairs.map((point) => point.cost / point.progress)));
}

function candidateValues({ extrapolationMonths, physicalContext, config, statistics, series }) {
  const robustMonthly = statistics.center;
  const fixedMonthly = roundCurrency(robustMonthly * (config.fixedShare / 100));
  const physicalPairsOnly = physicalPairs(series, physicalContext, config.lagMonths, 0);
  const mixedPairs = physicalPairs(series, physicalContext, config.lagMonths, fixedMonthly);
  const physicalCoefficient = coefficientFromPairs(physicalPairsOnly);
  const mixedCoefficient = coefficientFromPairs(mixedPairs);
  const progressPoints = series.map((point) => ({
    x: physicalIncrement(physicalContext, point.month, 'actualByMonth', config.lagMonths),
    y: point.value,
  }));
  const correlation = pearsonCorrelation(progressPoints);
  const values = Object.fromEntries(
    extrapolationMonths.map((month) => {
      const progress = physicalIncrement(
        physicalContext,
        month,
        'plannedByMonth',
        config.lagMonths,
      );
      let value = robustMonthly;
      if (config.method === 'physical') value = physicalCoefficient * progress;
      if (config.method === 'mixed') value = fixedMonthly + mixedCoefficient * progress;
      if (config.method === 'manual') value = config.manualMonthlyValue;
      if (config.method === 'none') value = 0;
      return [month, roundCurrency(Math.max(0, value))];
    }),
  );
  return {
    values,
    robustMonthly,
    fixedMonthly,
    physicalCoefficient,
    mixedCoefficient,
    correlation,
    usefulPhysicalSamples: physicalPairsOnly.length,
  };
}

function predictHistoricalMonth(method, priorSeries, target, physicalContext, config) {
  if (!priorSeries.length) return null;
  const statistics = robustStatistics(priorSeries);
  if (method === 'fixed') return statistics.center;
  if (method === 'manual') return config.manualMonthlyValue;
  if (method === 'none') return 0;
  const fixedMonthly = roundCurrency(statistics.center * (config.fixedShare / 100));
  const pairs = physicalPairs(
    priorSeries,
    physicalContext,
    config.lagMonths,
    method === 'mixed' ? fixedMonthly : 0,
  );
  if (pairs.length < 3) return null;
  const coefficient = coefficientFromPairs(pairs);
  const progress = physicalIncrement(
    physicalContext,
    target.month,
    'actualByMonth',
    config.lagMonths,
  );
  return roundCurrency((method === 'mixed' ? fixedMonthly : 0) + coefficient * progress);
}

function backtestMethod(method, series, physicalContext, config) {
  const results = [];
  for (let index = 3; index < series.length; index += 1) {
    const target = series[index];
    const start = config.sampleMonths > 0 ? Math.max(0, index - config.sampleMonths) : 0;
    const predicted = predictHistoricalMonth(
      method,
      series.slice(start, index),
      target,
      physicalContext,
      config,
    );
    if (predicted == null) continue;
    results.push({ predicted: Math.max(0, predicted), actual: target.value });
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

function confidenceFor(diagnostic, method, correlation, physicalSamples) {
  if (method === 'none' || method === 'manual') return 'manual';
  if (['physical', 'mixed'].includes(method) && physicalSamples < 6) return 'low';
  if (diagnostic.samples >= 6 && diagnostic.wape != null && diagnostic.wape <= 0.15) {
    if (method === 'physical' && (correlation == null || correlation < 0.4)) return 'medium';
    return 'high';
  }
  if (diagnostic.samples >= 3 && diagnostic.wape != null && diagnostic.wape <= 0.3) return 'medium';
  return 'low';
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

export function buildHybridInputForecast({
  monthlyValues = {},
  dataCorte,
  dataFim,
  windowMonths = 6,
  group,
  physicalContext,
  override = 'fixed',
} = {}) {
  const config = normalizeInputForecastConfig(
    typeof override === 'object' ? override : { method: override, sampleMonths: windowMonths },
  );
  const relevantMonths = Object.keys(monthlyValues)
    .filter((month) => month <= dataFim && (Number(monthlyValues[month]) || 0) > 0)
    .sort();
  const lastPlannedMonth = relevantMonths.at(-1) || null;
  const canExtrapolate = ['Custos Indiretos', 'Projeção de Gastos'].includes(group);
  const extrapolationMonths =
    canExtrapolate && lastPlannedMonth && lastPlannedMonth < dataFim
      ? monthRange(addMonths(lastPlannedMonth, 1), dataFim)
      : [];
  const series = historicalSeries(monthlyValues, dataCorte, config.sampleMonths);
  const statistics = robustStatistics(series);
  if (!extrapolationMonths.length) {
    return {
      available: false,
      selectedMethod: 'legacy',
      confidence: 'low',
      extrapolationByMonth: {},
      extrapolation: 0,
      lastPlannedMonth,
      diagnostics: {},
      config,
      details: {
        sampleStart: series[0]?.month || null,
        sampleEnd: series.at(-1)?.month || null,
        samples: series.length,
        robustMonthly: statistics.center,
        outliers: statistics.outliers,
      },
    };
  }
  if (!series.length && ['manual', 'none'].includes(config.method)) {
    const value = config.method === 'manual' ? config.manualMonthlyValue : 0;
    const extrapolationByMonth = Object.fromEntries(
      extrapolationMonths.map((month) => [month, value]),
    );
    return {
      available: true,
      selectedMethod: config.method,
      configuredMethod: config.method,
      confidence: 'manual',
      extrapolationByMonth,
      extrapolation: roundCurrency(value * extrapolationMonths.length),
      lastPlannedMonth,
      runRate: 0,
      costPerPoint: null,
      diagnostics: {},
      config,
      details: {
        sampleStart: null,
        sampleEnd: null,
        samples: 0,
        robustMonthly: 0,
        mad: 0,
        outliers: [],
        fixedMonthly: 0,
        physicalCoefficient: 0,
        mixedCoefficient: 0,
        correlation: null,
        usefulPhysicalSamples: 0,
        fallbackReason: '',
      },
    };
  }
  if (!series.length) {
    return {
      available: false,
      selectedMethod: 'legacy',
      confidence: 'low',
      extrapolationByMonth: {},
      extrapolation: 0,
      lastPlannedMonth,
      diagnostics: {},
      config,
      details: {
        sampleStart: null,
        sampleEnd: null,
        samples: 0,
        robustMonthly: 0,
        outliers: [],
        fallbackReason: 'Histórico financeiro insuficiente para calcular a metodologia.',
      },
    };
  }
  const recentSixMonths = series.slice(-6);
  const inactiveByRecency =
    recentSixMonths.length === 6 &&
    recentSixMonths.every((point) => Math.abs(point.value) < 0.005) &&
    !['manual', 'none'].includes(config.method);
  if (inactiveByRecency) {
    return {
      available: true,
      selectedMethod: config.method,
      configuredMethod: config.method,
      confidence: 'low',
      extrapolationByMonth: Object.fromEntries(extrapolationMonths.map((month) => [month, 0])),
      extrapolation: 0,
      lastPlannedMonth,
      runRate: 0,
      costPerPoint: null,
      diagnostics: {},
      config,
      details: {
        sampleStart: series[0]?.month || null,
        sampleEnd: series.at(-1)?.month || null,
        samples: series.length,
        robustMonthly: 0,
        mad: statistics.mad,
        outliers: statistics.outliers,
        fixedMonthly: 0,
        physicalCoefficient: 0,
        mixedCoefficient: 0,
        correlation: null,
        usefulPhysicalSamples: 0,
        fallbackReason: 'Sem custo nos seis últimos meses encerrados; projeção automática zerada.',
      },
    };
  }

  const candidates = candidateValues({
    extrapolationMonths,
    physicalContext,
    config,
    statistics,
    series,
  });
  const diagnostics = Object.fromEntries(
    CONFIGURABLE_METHODS.map((method) => [
      method,
      backtestMethod(method, series, physicalContext, { ...config, method }),
    ]),
  );
  const selectedDiagnostic = diagnostics[config.method];
  const missingPhysicalData =
    ['physical', 'mixed'].includes(config.method) && candidates.usefulPhysicalSamples < 3;
  const selectedMethod = missingPhysicalData ? 'fixed' : config.method;
  const extrapolationByMonth = missingPhysicalData
    ? Object.fromEntries(extrapolationMonths.map((month) => [month, candidates.robustMonthly]))
    : candidates.values;
  const extrapolation = roundCurrency(
    Object.values(extrapolationByMonth).reduce((sum, value) => sum + value, 0),
  );
  return {
    available: true,
    selectedMethod,
    configuredMethod: config.method,
    confidence: confidenceFor(
      selectedDiagnostic,
      config.method,
      candidates.correlation,
      candidates.usefulPhysicalSamples,
    ),
    extrapolationByMonth,
    extrapolation,
    lastPlannedMonth,
    runRate: candidates.robustMonthly,
    costPerPoint:
      config.method === 'mixed' ? candidates.mixedCoefficient : candidates.physicalCoefficient,
    diagnostics,
    config,
    details: {
      sampleStart: series[0]?.month || null,
      sampleEnd: series.at(-1)?.month || null,
      samples: series.length,
      robustMonthly: candidates.robustMonthly,
      mad: statistics.mad,
      outliers: statistics.outliers,
      fixedMonthly: candidates.fixedMonthly,
      physicalCoefficient: candidates.physicalCoefficient,
      mixedCoefficient: candidates.mixedCoefficient,
      correlation: candidates.correlation,
      usefulPhysicalSamples: candidates.usefulPhysicalSamples,
      fallbackReason: missingPhysicalData
        ? 'Histórico físico insuficiente; aplicado Fixo mensal robusto.'
        : '',
    },
  };
}

export const FORECAST_METHOD_LABELS = Object.freeze({
  legacy: 'Média simples atual',
  auto: 'Fixo mensal robusto',
  run_rate: 'Fixo mensal robusto',
  ramp_down: 'Misto · fixo + evolução física',
  fixed: 'Fixo mensal robusto',
  physical: 'Evolução física',
  mixed: 'Misto · fixo + evolução física',
  manual: 'Valor mensal manual',
  none: 'Não extrapolar',
});
