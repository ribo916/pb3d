import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
