let xlsxPromise;
let apexChartsPromise;

function loadOnce(currentPromise, importer, resolveModule = (module) => module) {
  if (currentPromise) return currentPromise;
  return importer().then(resolveModule);
}

export function ensureXlsx() {
  xlsxPromise = loadOnce(xlsxPromise, () => import('xlsx')).catch((error) => {
    xlsxPromise = undefined;
    throw error;
  });
  return xlsxPromise;
}

export function ensureApexCharts() {
  apexChartsPromise = loadOnce(
    apexChartsPromise,
    () => import('apexcharts'),
    (module) => module.default,
  ).catch((error) => {
    apexChartsPromise = undefined;
    throw error;
  });
  return apexChartsPromise;
}
