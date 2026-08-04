import {
  inflationIndexFromReflectionStatus,
  isReflectedStatus,
  normalizeReflectionStatus,
} from './flow-reflection.mjs';

export function managementCutoffMonth(label, now = new Date()) {
  const match = String(label || '').match(/GEST(?:ÃO|AO)\s+(\d{2})-(\d{4})/i);
  if (match) return `${match[2]}-${match[1]}`;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return '';
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function isCancelled(flow) {
  return flow.dep === 'Cancelado' || flow.tipo === 'cancelado';
}

function reflectedMonth(flow) {
  return String(flow.refletido_mes || '').slice(0, 7);
}

export function buildManagementDeviationBreakdown({ flows = [], managementLabel = '', now } = {}) {
  const cutoffMonth = managementCutoffMonth(managementLabel, now);
  const inflationFlows = [];
  const otherReflectedFlows = [];
  const incompleteInflationFlows = [];
  const totalsByIndex = { ipca: 0, incc: 0 };

  for (const flow of flows) {
    if (isCancelled(flow)) continue;
    const status = normalizeReflectionStatus(flow.refletido_status);
    const index = inflationIndexFromReflectionStatus(status);
    const month = reflectedMonth(flow);
    const reflected = isReflectedStatus(status);

    if (index && !month) {
      incompleteInflationFlows.push(flow);
      continue;
    }
    if (!reflected || !month || (cutoffMonth && month > cutoffMonth)) continue;

    const value = Number(flow.custo_flowmaster) || 0;
    if (index) {
      inflationFlows.push(flow);
      totalsByIndex[index] += value;
      continue;
    }
    if (flow.tipo === 'aumento_real' || flow.tipo === 'economia') {
      otherReflectedFlows.push(flow);
    }
  }

  const sum = (items) =>
    items.reduce((total, flow) => total + (Number(flow.custo_flowmaster) || 0), 0);
  return {
    cutoffMonth,
    inflation: sum(inflationFlows),
    otherReflected: sum(otherReflectedFlows),
    inflationFlows,
    otherReflectedFlows,
    incompleteInflationFlows,
    totalsByIndex,
  };
}
