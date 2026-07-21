export function createPerformanceMonitor({
  performanceRef = performance,
  documentRef = document,
} = {}) {
  const startedAt = performanceRef.now();
  const operations = {};
  let boot = { completed: false, durationMs: null, domNodes: null };

  function record(name, durationMs) {
    const duration = Number.isFinite(durationMs) ? durationMs : 0;
    const current = operations[name] || { count: 0, totalMs: 0, lastMs: 0, maxMs: 0 };
    current.count += 1;
    current.totalMs += duration;
    current.lastMs = duration;
    current.maxMs = Math.max(current.maxMs, duration);
    operations[name] = current;
    return duration;
  }

  function measure(name, operation) {
    const operationStartedAt = performanceRef.now();
    try {
      const result = operation();
      if (result && typeof result.then === 'function') {
        return result.finally(() => record(name, performanceRef.now() - operationStartedAt));
      }
      record(name, performanceRef.now() - operationStartedAt);
      return result;
    } catch (error) {
      record(name, performanceRef.now() - operationStartedAt);
      throw error;
    }
  }

  function completeBoot() {
    boot = {
      completed: true,
      durationMs: performanceRef.now() - startedAt,
      domNodes: documentRef.getElementsByTagName('*').length,
    };
    return { ...boot };
  }

  function snapshot() {
    return {
      boot: { ...boot },
      operations: Object.fromEntries(
        Object.entries(operations).map(([name, metric]) => [name, { ...metric }]),
      ),
    };
  }

  return Object.freeze({ record, measure, completeBoot, snapshot });
}

export function installPerformanceMonitor(service, target = window) {
  Object.defineProperty(target, 'dashboardPerformance', {
    configurable: true,
    value: service,
  });
}

