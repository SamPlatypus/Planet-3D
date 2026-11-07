import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

// Writes dist/sw.js after the build: a service worker that precaches every
// built file so the web app works fully offline once it has been opened.
function offlineServiceWorker() {
  let outDir;
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return {
    name: 'offline-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = walk(outDir)
        .map((f) => relative(outDir, f).split(sep).join('/'))
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map'))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) {
        hash.update(f);
        hash.update(readFileSync(join(outDir, f)));
      }
      const version = hash.digest('hex').slice(0, 12);
      const assets = ['./', ...files.map((f) => `./${f}`)];
      const sw = readFileSync(resolve('src/sw-template.js'), 'utf8')
        .replace('__VERSION__', version)
        .replace('__ASSETS__', JSON.stringify(assets, null, 2));
      writeFileSync(join(outDir, 'sw.js'), sw);
      console.log(`sw.js: ${assets.length} files precached (version ${version})`);
    },
  };
}

export default defineConfig({
  base: './',
  build: {
    target: ['es2020', 'chrome87', 'safari14'],
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
  server: { host: true },
  preview: { host: true },
  plugins: [offlineServiceWorker()],
});
