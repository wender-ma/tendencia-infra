import { defineConfig } from 'vite';
import { minify } from 'terser';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const legacyPath = fileURLToPath(new URL('./assets/js/dashboard-legacy.js', import.meta.url));

function minifyClassicLegacyAsset() {
  return {
    name: 'minify-classic-legacy-asset',
    enforce: 'pre',
    async load(id) {
      if (!id.endsWith('/assets/js/dashboard-legacy.js?url')) return null;

      const result = await minify(await readFile(legacyPath, 'utf8'), {
        compress: { passes: 2 },
        mangle: { toplevel: false },
        format: { comments: false },
      });
      if (!result.code) throw new Error('Terser não gerou o script legado minificado');

      const referenceId = this.emitFile({
        type: 'asset',
        name: 'dashboard-legacy.js',
        source: result.code,
      });
      return `export default import.meta.ROLLUP_FILE_URL_${referenceId};`;
    },
  };
}

export default defineConfig({
  plugins: [minifyClassicLegacyAsset()],
});
