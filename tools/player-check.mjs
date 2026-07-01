/* Capture Player 1-focused screenshots for imported character review.
 * Output:
 *   tools/shots/player1-closeup-idle.png
 *   tools/shots/player1-closeup-forehand.png
 *   tools/shots/player1-gameplay.png
 *   tools/shots/player1-mobile.png
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startViteServer } from './vite-test-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const testServer = await startViteServer(ROOT);
const server = testServer.server;
const base = testServer.base;
const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
});

const errors = [];

function watchPage(page) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
}

async function selectOption(page, name, value) {
  await page.check('input[name="' + name + '"][value="' + value + '"]', { force: true });
  if (name === 'venue') await page.evaluate(() => window.__pb3dMenu.syncMenuSummary());
}

async function startMatch(page) {
  await page.goto(base, { waitUntil: 'networkidle' });
  await selectOption(page, 'venue', 'park');
  await selectOption(page, 'palette', 'blue');
  await selectOption(page, 'tod', 'day');
  await page.check('input[name="difficulty"][value="4.5"]', { force: true });
  await page.click('#startBtn');
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const g = window.__game;
    if (!g) throw new Error('game not available');
    if (!g.__playerCheckUpdate) {
      g.__playerCheckUpdate = g.update.bind(g);
      g.update = function () {};
    }
  });
}

async function focusPlayerOne(page, swingType) {
  await page.evaluate((type) => {
    const g = window.__game;
    if (!g) throw new Error('game not available');
    const hud = document.getElementById('hud');
    if (hud) hud.style.display = 'none';
    g.msgTimer = 0;
    g.ball.live = false;
    g.ball.pos.x = 0.45;
    g.ball.pos.y = 1.0;
    g.ball.pos.z = 4.85;
    g.players.forEach((pl, i) => {
      pl.pos.x = i === 0 ? 0 : 20 + i * 2;
      pl.pos.z = i === 0 ? 5.1 : 20;
      pl.vel.x = 0;
      pl.vel.z = 0;
      pl.mesh.object.visible = i === 0;
    });
    const human = g.players[0].mesh;
    if (type) {
      human.swing(type);
      human._swing = human._swingDur * (1 - human.contactT);
      if (human.authored && human.authored.active) {
        const clip = human.authored.active.getClip && human.authored.active.getClip();
        if (clip) human.authored.active.time = clip.duration * human.contactT;
      }
    } else {
      human._swing = 0;
    }
    human.update(0.001, { speed: 0, facing: Math.PI - 0.26, ready: true });
    human.object.position.set(0, 0, 5.1);
    g.camera.position.set(0.55, 1.55, 6.75);
    g.camera.lookAt(0, 0.92, 5.05);
    g.camera.updateProjectionMatrix();
    g.render();
  }, swingType || '');
}

async function captureGameplay(page) {
  await page.evaluate(() => {
    const g = window.__game;
    if (!g) throw new Error('game not available');
    g.players.forEach((pl) => { pl.mesh.object.visible = true; });
    g._placeServe();
    g._syncMeshes(0.016);
    g.render();
  });
}

const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
watchPage(desktop);
await startMatch(desktop);
await captureGameplay(desktop);
await desktop.screenshot({ path: path.join(OUT, 'player1-gameplay.png') });
await focusPlayerOne(desktop, '');
await desktop.screenshot({ path: path.join(OUT, 'player1-closeup-idle.png') });
await focusPlayerOne(desktop, 'fh');
await desktop.screenshot({ path: path.join(OUT, 'player1-closeup-forehand.png') });
await desktop.close();

const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1
});
watchPage(mobile);
await startMatch(mobile);
await captureGameplay(mobile);
await mobile.screenshot({ path: path.join(OUT, 'player1-mobile.png') });
await mobile.close();

await browser.close();
await server.close();

if (errors.length) {
  console.error('PAGE ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}

console.log('OK - Player 1 screenshots written to tools/shots/');
