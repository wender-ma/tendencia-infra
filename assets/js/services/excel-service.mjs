function readFileBuffer(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('progress', (event) => {
      if (!event.lengthComputable || typeof onProgress !== 'function') return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    });
    reader.addEventListener('load', () => resolve(reader.result));
    reader.addEventListener('error', () =>
      reject(reader.error || new Error('Falha ao ler arquivo')),
    );
    reader.addEventListener('abort', () => reject(new Error('Leitura cancelada')));
    reader.readAsArrayBuffer(file);
  });
}

export function parseExcelBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/excel-reader.worker.mjs', import.meta.url), {
      type: 'module',
    });

    const finish = (callback) => (value) => {
      worker.terminate();
      callback(value);
    };

    worker.addEventListener(
      'message',
      finish((event) => {
        if (event.data?.error) {
          reject(new Error(event.data.error));
          return;
        }
        resolve(event.data);
      }),
    );
    worker.addEventListener(
      'error',
      finish((event) => reject(new Error(event.message || 'Falha ao processar planilha'))),
    );
    worker.postMessage({ buffer }, [buffer]);
  });
}

export async function parseExcelFile(file, options = {}) {
  const buffer = await readFileBuffer(file, options.onProgress);
  options.onReadComplete?.();
  return parseExcelBuffer(buffer);
}

export function createExcelService() {
  return Object.freeze({ parseBuffer: parseExcelBuffer, parseFile: parseExcelFile });
}

export function installLegacyExcelGlobals(service, target = window) {
  target.readExcelBuffer = service.parseBuffer;
  target.readExcelFile = service.parseFile;
}
