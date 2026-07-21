let xlsxPromise;
let apexChartsPromise;

function loadOnce(currentPromise, importer, install) {
  if (currentPromise) return currentPromise;

  return importer().then((module) => {
    install(module);
    return module;
  });
}

export function ensureXlsx() {
  if (window.XLSX?.read) return Promise.resolve(window.XLSX);

  xlsxPromise = loadOnce(
    xlsxPromise,
    () => import('xlsx'),
    (module) => {
      window.XLSX = module;
    },
  ).catch((error) => {
    xlsxPromise = undefined;
    throw error;
  });
  return xlsxPromise;
}

export function ensureApexCharts() {
  if (typeof window.ApexCharts === 'function') return Promise.resolve(window.ApexCharts);

  apexChartsPromise = loadOnce(
    apexChartsPromise,
    () => import('apexcharts'),
    (module) => {
      window.ApexCharts = module.default;
    },
  )
    .then(() => window.ApexCharts)
    .catch((error) => {
      apexChartsPromise = undefined;
      throw error;
    });
  return apexChartsPromise;
}

export function installLegacyDependencyGlobals(target = window) {
  target.ensureXlsx = ensureXlsx;
}
