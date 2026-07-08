import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (var i = 0, entries = fs.readdirSync(src, { withFileTypes: true }); i < entries.length; i++) {
    var entry = entries[i];
    var from = path.join(src, entry.name);
    var to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

copyDir(path.join(ROOT, 'music', 'active'), path.join(DIST, 'music', 'active'));
console.log('copied music/active to dist/music/active');

copyDir(path.join(ROOT, 'assets'), path.join(DIST, 'assets'));
console.log('copied assets to dist/assets');

// The character editor fetches its raw mocap clips at runtime by string URL
// (character-preview/main.js TOP_PICKS -> ./local-clips/...), so Vite's bundler
// never sees them. Copy the git-TRACKED clips (only the ~10 the editor actually
// uses -- the rest of local-clips/ is an untracked local archive) into dist so
// deployed builds and fresh clones serve them. Falls back gracefully if git or
// the folder is unavailable.
function copyTrackedLocalClips() {
  const REL = 'character-preview/local-clips';
  let tracked = [];
  try {
    tracked = execSync(`git ls-files -- ${REL}`, { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return; // no git / not a repo -- nothing to do
  }
  let n = 0;
  for (const rel of tracked) {
    const from = path.join(ROOT, rel);
    if (!fs.existsSync(from)) continue;
    const to = path.join(DIST, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    n++;
  }
  console.log(`copied ${n} tracked clip(s) to dist/${REL}`);
}

copyTrackedLocalClips();
