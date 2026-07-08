/* Bakes a bust-framed, slightly-turned portrait PNG for every selectable
 * character, using the same GLBs/lighting the live character preview uses
 * (see characterPreview.js snapshot() + main.js bakePortrait()).
 * Run: node tools/generate-portraits.mjs
 * Output: assets/images/portraits/<id>.png
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startViteServer } from './vite-test-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'images', 'portraits');
fs.mkdirSync(OUT, { recursive: true });

const CHARACTER_IDS = [
  'ch01', 'ch03', 'ch04', 'ch06', 'ch07',
  'ch08', 'ch09', 'ch10', 'ch11', 'ch12', 'ch14', 'ch15'
];

const testServer = await startViteServer(ROOT);
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
});
const page = await browser.newPage({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('page error:', e));

await page.goto(testServer.base, { waitUntil: 'networkidle' });

for (const id of CHARACTER_IDS) {
  const dataUrl = await page.evaluate((characterId) => window.__pb3dMenu.bakePortrait(characterId), id);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  fs.writeFileSync(path.join(OUT, `${id}.png`), Buffer.from(base64, 'base64'));
  console.log('baked', id);
}

await browser.close();
await testServer.server.close();
console.log(`wrote ${CHARACTER_IDS.length} portraits to ${path.relative(ROOT, OUT)}/`);
