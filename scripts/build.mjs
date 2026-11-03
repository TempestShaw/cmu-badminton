// Production build for Vercel: bundles each page's JS (with shared code in one
// chunk) and the CSS into content-hashed files under dist/assets, which phones
// may cache for a year, copies everything else, and points the HTML at them.
// `npm run dev` keeps serving public/ unbundled.
import { build } from 'esbuild';
import {
  cp, rm, readFile, writeFile,
} from 'node:fs/promises';
import { basename } from 'node:path';

const OUT = 'dist';
const PAGES = { 'index.html': 'phone', 'kiosk.html': 'kiosk', 'host.html': 'host' };

await rm(OUT, { recursive: true, force: true });
await cp('public', OUT, {
  recursive: true,
  filter: (src) => !src.startsWith('public/js') && src !== 'public/styles.css',
});

const { metafile } = await build({
  entryPoints: {
    phone: 'public/js/phone.js',
    kiosk: 'public/js/kiosk.js',
    host: 'public/js/host.js',
    styles: 'public/styles.css',
  },
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: true,
  target: ['es2021', 'safari16'],
  outdir: `${OUT}/assets`,
  entryNames: '[name]-[hash]',
  chunkNames: 'shared-[hash]',
  legalComments: 'none',
  metafile: true,
});

const outputs = Object.entries(metafile.outputs);
const urlOf = (path) => `/assets/${basename(path)}`;
const outputFor = (entry) => outputs.find(([, out]) => out.entryPoint === entry);

const [cssPath] = outputFor('public/styles.css');
for (const [page, name] of Object.entries(PAGES)) {
  const [jsPath, js] = outputFor(`public/js/${name}.js`);
  // Fetch shared chunks alongside the page script instead of after it.
  const preloads = js.imports
    .filter((i) => i.kind === 'import-statement')
    .map((i) => `<link rel="modulepreload" href="${urlOf(i.path)}">`)
    .join('');
  const file = `${OUT}/${page}`;
  const html = (await readFile(file, 'utf8'))
    .replace('href="/styles.css"', `href="${urlOf(cssPath)}"`)
    .replace(`<script type="module" src="/js/${name}.js"></script>`, `${preloads}<script type="module" src="${urlOf(jsPath)}"></script>`);
  if (html.includes('/js/') || html.includes('"/styles.css"')) throw new Error(`${page}: a source path was left unbundled`);
  await writeFile(file, html);
}

const sizes = outputs.map(([path, out]) => `${basename(path)} ${(out.bytes / 1024).toFixed(1)} kB`);
console.log(`built ${OUT}/: ${sizes.join(', ')}`);
