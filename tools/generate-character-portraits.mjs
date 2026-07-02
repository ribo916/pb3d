/* Renders a front-facing, full-body portrait PNG for each selectable player
 * model, used by the main-menu character picker.
 * Output: assets/images/characters/<playerModelKey>.png
 *
 * Renders every model in its own native roster slot (not forced through the
 * nearYou slot) so each portrait keeps that slot's real colors/hair/headwear
 * instead of borrowing nearYou's cosmetic options.
 * Run: node tools/generate-character-portraits.mjs (HEADED=1 to watch)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startViteServer } from './vite-test-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'images', 'characters');
fs.mkdirSync(OUT, { recursive: true });

// index into g.players -> the playerModelKey that slot uses by default
// (src/game.js palettes.*.playerModelKey). rotation.y=0 faces our portrait
// camera for every slot (near and far alike).
const SLOTS = [
  { index: 0, key: 'player-human-v1' },
  { index: 1, key: 'player-partner-v1' },
  { index: 2, key: 'player-opponent-a-v1' },
  { index: 3, key: 'player-opponent-b-v1' }
];

const testServer = await startViteServer(ROOT);
const server = testServer.server;
const base = testServer.base;
const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
});

const errors = [];
const page = await browser.newPage({ viewport: { width: 480, height: 640 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(base, { waitUntil: 'networkidle' });
await page.check('input[name="difficulty"][value="4.5"]', { force: true });
await page.click('#startBtn');
await page.waitForFunction(() => window.__game && window.__game.players && window.__game.players.length === 4, { timeout: 15000 });
await page.waitForTimeout(900); // let all 4 authored GLBs + materials finish attaching

await page.evaluate(() => {
  window.__game.update = function () {}; // freeze the rAF-driven sim so our manual poses stick
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = 'none';
  window.__game.ball.live = false;
});

for (const slot of SLOTS) {
  await page.evaluate((index) => {
    const g = window.__game;
    g.players.forEach((pl, i) => { pl.mesh.object.visible = i === index; });
    const mesh = g.players[index].mesh;
    mesh._swing = 0;
    mesh.update(0.001, { speed: 0, facing: 0, ready: false }); // idle: relaxed, paddle-in-hand stance
    if (mesh.authored && mesh.authored.mixer) mesh.authored.mixer.update(0.15);
    mesh._facing = 0;
    mesh.object.rotation.y = 0; // facing interpolates gradually; force it for a static shot
    mesh.object.position.set(0, 0, 0);
    g.camera.position.set(0, 1.05, 3.35);
    g.camera.lookAt(0, 1.0, 0);
    g.camera.updateProjectionMatrix();
    g.render();
  }, slot.index);

  await page.screenshot({ path: path.join(OUT, slot.key + '.png') });
  console.log('wrote', slot.key + '.png');
}

await page.close();
await browser.close();
await server.close();

if (errors.length) {
  console.error('PAGE ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}

console.log('OK - character portraits written to assets/images/characters/');
