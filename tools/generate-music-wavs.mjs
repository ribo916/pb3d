import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'music', 'active');
const SR = 22050;

const TRACKS = [
  { genre: 'kpop', file: 'neon-spark.wav', bpm: 122, bars: 8, style: 'kpopA' },
  { genre: 'kpop', file: 'seoul-rush.wav', bpm: 128, bars: 8, style: 'kpopB' },
  { genre: 'rap', file: 'baseline.wav', bpm: 92, bars: 8, style: 'rapA' },
  { genre: 'rap', file: 'locker-room.wav', bpm: 98, bars: 8, style: 'rapB' },
  { genre: 'country', file: 'sunset-rally.wav', bpm: 108, bars: 8, style: 'countryA' },
  { genre: 'country', file: 'open-road.wav', bpm: 112, bars: 8, style: 'countryB' },
  { genre: 'pop', file: 'match-lights.wav', bpm: 116, bars: 8, style: 'popA' },
  { genre: 'pop', file: 'skyline-set.wav', bpm: 120, bars: 8, style: 'popB' }
];

function clamp(v) {
  return Math.max(-1, Math.min(1, v));
}

function noise() {
  return (Math.random() * 2 - 1);
}

function addTone(buf, start, dur, freq, vol, type) {
  var attack = Math.max(1, Math.floor(SR * 0.005));
  var len = Math.max(1, Math.floor(dur * SR));
  for (var i = 0; i < len && start + i < buf.length; i++) {
    var t = i / SR;
    var env = i < attack ? (i / attack) : Math.exp(-3.6 * (i / len));
    var phase = 2 * Math.PI * freq * t;
    var sample = 0;
    if (type === 'square') sample = Math.sign(Math.sin(phase));
    else if (type === 'saw') sample = 2 * ((t * freq) - Math.floor(0.5 + t * freq));
    else if (type === 'triangle') sample = 2 * Math.abs(2 * ((t * freq) - Math.floor((t * freq) + 0.5))) - 1;
    else sample = Math.sin(phase);
    buf[start + i] += sample * vol * env;
  }
}

function addKick(buf, start, vol) {
  var len = Math.floor(SR * 0.22);
  for (var i = 0; i < len && start + i < buf.length; i++) {
    var t = i / SR;
    var env = Math.exp(-8 * t);
    var freq = 120 - (90 * t / 0.22);
    buf[start + i] += Math.sin(2 * Math.PI * freq * t) * vol * env;
  }
}

function addSnare(buf, start, vol) {
  var len = Math.floor(SR * 0.16);
  for (var i = 0; i < len && start + i < buf.length; i++) {
    var t = i / SR;
    var env = Math.exp(-18 * t);
    buf[start + i] += noise() * vol * env;
  }
}

function addHat(buf, start, vol) {
  var len = Math.floor(SR * 0.04);
  for (var i = 0; i < len && start + i < buf.length; i++) {
    var t = i / SR;
    var env = Math.exp(-42 * t);
    buf[start + i] += noise() * vol * env * 0.6;
  }
}

function noteFreq(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function beatToIndex(beat, spb) {
  return Math.floor(beat * spb * SR);
}

function writeWav(file, samples) {
  var dataBytes = samples.length * 2;
  var buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (var i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.round(clamp(samples[i]) * 32767), 44 + (i * 2));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}

function addChord(buf, start, dur, root, shape, vol, type) {
  shape.forEach(function (offset, idx) {
    addTone(buf, start, dur, noteFreq(root + offset), vol / (1 + idx * 0.35), type);
  });
}

function renderTrack(def) {
  var beats = def.bars * 4;
  var spb = 60 / def.bpm;
  var samples = new Float32Array(Math.floor((beats * spb + 0.5) * SR));
  var chordMap = {
    kpopA: [57, 62, 64, 69],
    kpopB: [59, 64, 66, 71],
    rapA: [45, 45, 48, 43],
    rapB: [43, 46, 41, 48],
    countryA: [50, 55, 57, 55],
    countryB: [48, 53, 55, 57],
    popA: [55, 60, 62, 64],
    popB: [57, 60, 65, 62]
  };
  var leadMap = {
    kpopA: [76, 78, 81, 78, 76, 74, 71, 74],
    kpopB: [78, 81, 83, 81, 78, 76, 74, 76],
    rapA: [57, 0, 60, 0, 62, 0, 60, 0],
    rapB: [55, 0, 58, 0, 60, 0, 58, 0],
    countryA: [69, 71, 74, 71, 69, 67, 66, 67],
    countryB: [67, 69, 71, 74, 71, 69, 67, 64],
    popA: [72, 74, 76, 79, 76, 74, 72, 71],
    popB: [74, 76, 79, 81, 79, 76, 74, 72]
  };
  var chords = chordMap[def.style];
  var lead = leadMap[def.style];
  for (var beat = 0; beat < beats; beat += 1) {
    var start = beatToIndex(beat, spb);
    addKick(samples, start, def.style.startsWith('rap') ? 0.55 : 0.48);
    addHat(samples, beatToIndex(beat + 0.5, spb), 0.18);
    if ((beat % 4) === 1 || (beat % 4) === 3) addSnare(samples, start, 0.22);
    if (def.style.startsWith('kpop') || def.style.startsWith('pop')) addHat(samples, start, 0.15);
    var bassRoot = chords[Math.floor(beat / 2) % chords.length] - 24;
    addTone(samples, start, spb * 0.92, noteFreq(bassRoot), def.style.startsWith('rap') ? 0.18 : 0.14, def.style.startsWith('country') ? 'triangle' : 'saw');
  }

  for (var bar = 0; bar < def.bars; bar++) {
    var root = chords[bar % chords.length];
    addChord(samples, beatToIndex(bar * 4, spb), spb * 3.8, root, [0, 4, 7], 0.12, def.style.startsWith('country') ? 'triangle' : 'sine');
    if (def.style.startsWith('country')) {
      addTone(samples, beatToIndex(bar * 4, spb), spb * 0.36, noteFreq(root + 12), 0.10, 'triangle');
      addTone(samples, beatToIndex(bar * 4 + 1.5, spb), spb * 0.28, noteFreq(root + 7), 0.08, 'triangle');
    }
  }

  for (var step = 0; step < def.bars * 8; step++) {
    var note = lead[step % lead.length];
    if (!note) continue;
    var startBeat = step * 0.5;
    var dur = def.style.startsWith('rap') ? spb * 0.22 : spb * 0.34;
    var type = def.style.startsWith('kpop') ? 'square' : (def.style.startsWith('country') ? 'triangle' : 'sine');
    addTone(samples, beatToIndex(startBeat, spb), dur, noteFreq(note), def.style.startsWith('rap') ? 0.06 : 0.08, type);
  }

  for (var i = 0; i < samples.length; i++) samples[i] *= 0.68;
  return samples;
}

for (const track of TRACKS) {
  const file = path.join(OUT, track.genre, track.file);
  writeWav(file, renderTrack(track));
  console.log('wrote', path.relative(ROOT, file));
}

execFileSync(process.execPath, [path.join(ROOT, 'tools', 'sync-music-catalog.mjs')], { stdio: 'inherit' });
