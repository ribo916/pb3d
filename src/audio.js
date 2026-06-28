/* ============================================================================
 * audio.js — Web Audio API music sequencer + SFX.
 * makeAudio() -> { unlock, sfx, music }
 * Starts muted; call music.setMuted(false) to begin playback.
 * ==========================================================================*/
'use strict';

export function makeAudio() {
  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  var ac = null, master = null;
  var muted = true;
  var genreKey = 'upbeat';
  var seqTimer = null;
  var seqStep = 0;

  // Three procedural MIDI-style genres. Each has a 16-step melody + bass
  // pattern (0 = rest), oscillator types, and envelope params.
  var GENRES = {
    upbeat: {
      label: 'UPBEAT', bpm: 128,
      mel: [261.63,0,329.63,0,392,0,523.25,0,440,0,392,0,329.63,293.66,261.63,0],
      bas: [130.81,0,0,0,220,0,0,0,174.61,0,0,0,196,0,0,0],
      mt: 'triangle', bt: 'sawtooth',
      mv: 0.12, md: 0.16, bv: 0.16, bd: 0.22,
    },
    relaxing: {
      label: 'RELAXING', bpm: 72,
      mel: [293.66,0,0,0,440,0,0,0,392,0,587.33,0,440,0,329.63,0],
      bas: [146.83,0,0,0,220,0,0,0,196,0,0,0,220,0,0,0],
      mt: 'sine', bt: 'sine',
      mv: 0.09, md: 0.55, bv: 0.12, bd: 0.65,
    },
    retro: {
      label: 'RETRO', bpm: 160,
      mel: [440,523.25,659.25,523.25,440,392,329.63,392,440,523.25,659.25,880,392,440,329.63,0],
      bas: [220,0,0,0,164.81,0,0,0,220,0,0,0,174.61,0,196,0],
      mt: 'square', bt: 'square',
      mv: 0.08, md: 0.09, bv: 0.11, bd: 0.12,
    }
  };
  var KEYS = ['upbeat', 'relaxing', 'retro'];

  function init() {
    if (ac || !AudioCtx) return;
    ac = new AudioCtx();
    master = ac.createGain();
    master.gain.value = 0.7;
    master.connect(ac.destination);
  }

  function unlock() {
    init();
    if (ac && ac.state === 'suspended') ac.resume();
  }

  function playNote(freq, type, dur, vol, when) {
    if (!ac || !freq) return;
    var t = (when !== undefined) ? when : ac.currentTime;
    var osc = ac.createOscillator();
    var g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function tick() {
    if (!ac || muted) return;
    var g = GENRES[genreKey];
    var i = seqStep % g.mel.length;
    var now = ac.currentTime;
    if (g.mel[i]) playNote(g.mel[i], g.mt, g.md, g.mv, now);
    if (g.bas[i]) playNote(g.bas[i], g.bt, g.bd, g.bv, now);
    seqStep++;
  }

  function startSeq() {
    if (seqTimer) { clearInterval(seqTimer); seqTimer = null; }
    if (muted) return;
    var ms = (60 / GENRES[genreKey].bpm / 4) * 1000; // 16th-note steps
    seqStep = 0;
    tick();
    seqTimer = setInterval(tick, ms);
  }

  function stopSeq() {
    if (seqTimer) { clearInterval(seqTimer); seqTimer = null; }
  }

  return {
    unlock: unlock,
    sfx: {
      paddle: function() { if (ac) playNote(440,  'square',   0.05, 0.35); },
      bounce: function() { if (ac) playNote(220,  'sine',     0.05, 0.22); },
      net:    function() { if (ac) playNote(140,  'triangle', 0.09, 0.30); },
      serve:  function() { if (ac) playNote(520,  'sine',     0.07, 0.30); },
      point:  function() { if (ac) playNote(660,  'sine',     0.22, 0.40); },
      fault:  function() { if (ac) playNote(180,  'sawtooth', 0.18, 0.30); },
    },
    music: {
      isMuted:       function() { return muted; },
      setMuted:      function(m) {
        muted = !!m;
        if (muted) stopSeq(); else { init(); startSeq(); }
      },
      getGenreLabel: function() { return GENRES[genreKey].label; },
      cycleGenre:    function() {
        genreKey = KEYS[(KEYS.indexOf(genreKey) + 1) % KEYS.length];
        seqStep = 0;
        if (!muted) startSeq();
        return GENRES[genreKey].label;
      },
    }
  };
}
