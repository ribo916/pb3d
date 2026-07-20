/* ============================================================================
 * audio.js — Web Audio API SFX + real track-based music playback.
 * makeAudio() -> { unlock, sfx, music }
 * ==========================================================================*/
'use strict';

import { MUSIC_TRACKS } from '../music/catalog.js';
import { SUPER } from './constants.js';

var VOICE_BASE = SUPER.VOICE_BASE;

const STORAGE_KEY = 'pb3d.audio.v1';

export function buildMusicCatalog(tracks) {
  var genres = {};
  (tracks || []).forEach(function (track) {
    if (!track || !track.genre || !track.key || !track.file) return;
    if (!genres[track.genre]) {
      genres[track.genre] = {
        key: track.genre,
        label: track.genreLabel || track.genre.toUpperCase(),
        tracks: []
      };
    }
    genres[track.genre].tracks.push({
      key: track.key,
      genre: track.genre,
      label: track.label || track.key,
      artist: track.artist || '',
      file: track.file
    });
  });
  return Object.keys(genres).map(function (key) { return genres[key]; });
}

export function sanitizeMusicState(raw, catalog) {
  var genres = Array.isArray(catalog) ? catalog : [];
  var fallbackGenre = genres[0] || { key: 'none', label: 'NO TRACK', tracks: [] };
  var volume = (raw && typeof raw.volume === 'number') ? raw.volume : 0.72;
  volume = Math.max(0, Math.min(1, volume));

  var genreKey = raw && raw.genreKey;
  var genre = genres.find(function (item) { return item.key === genreKey; }) || fallbackGenre;

  var trackKey = raw && raw.trackKey;
  var track = genre.tracks.find(function (item) { return item.key === trackKey; }) || genre.tracks[0] || null;

  return {
    genreKey: genre.key,
    trackKey: track ? track.key : null,
    muted: raw && typeof raw.muted === 'boolean' ? raw.muted : true,
    volume: volume
  };
}

export const DEFAULT_MUSIC_CATALOG = buildMusicCatalog(MUSIC_TRACKS);

export function makeAudio() {
  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  var ac = null, master = null;
  var sfxMuted = false;
  var catalog = DEFAULT_MUSIC_CATALOG;
  var trackLookup = {};
  var brokenTracks = {};
  var suppressPlayError = false;

  catalog.forEach(function (genre) {
    genre.tracks.forEach(function (track) {
      trackLookup[track.key] = track;
    });
  });

  var _raw = loadStoredState();
  var musicState = sanitizeMusicState(_raw, catalog);
  if (_raw && typeof _raw.sfxMuted === 'boolean') sfxMuted = _raw.sfxMuted;
  var audioEl = new Audio();
  audioEl.loop = true;
  audioEl.preload = 'none';
  audioEl.volume = musicState.muted ? 0 : musicState.volume;

  syncAudioSource();

  audioEl.addEventListener('error', function () {
    if (musicState.trackKey) brokenTracks[musicState.trackKey] = true;
    var next = pickNextPlayableTrack(musicState.genreKey, musicState.trackKey);
    if (next) {
      musicState.trackKey = next.key;
      syncAudioSource();
      persistState();
      if (!musicState.muted) playCurrent();
      return;
    }
    persistState();
  });

  function loadStoredState() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function persistState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        genreKey: musicState.genreKey,
        trackKey: musicState.trackKey,
        muted: musicState.muted,
        volume: musicState.volume,
        sfxMuted: sfxMuted
      }));
    } catch (err) {
      /* ignore persistence failures */
    }
  }

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
    if (!musicState.muted) playCurrent();
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

  /* ------------------------- synth primitives -------------------------
   * playNote() is a single fixed-frequency oscillator, which can't produce an
   * impact: real impacts are a NOISE burst plus a fast downward PITCH sweep.
   * These three primitives add both, and are what the super-smash boom, the
   * body-hits-ground thud, and the grunt are built from.
   * -------------------------------------------------------------------- */

  var noiseBuf = null;
  function noiseBuffer() {
    if (noiseBuf || !ac) return noiseBuf;
    var n = Math.floor(ac.sampleRate * 0.5);
    noiseBuf = ac.createBuffer(1, n, ac.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // Filtered noise burst. `sweepTo` slides the filter cutoff, which is what
  // turns a flat hiss into a physical-sounding thud.
  function playNoise(dur, vol, filterType, freq, q, sweepTo, when) {
    if (!ac) return;
    var t = (when !== undefined) ? when : ac.currentTime;
    var src = ac.createBufferSource();
    src.buffer = noiseBuffer();
    var flt = ac.createBiquadFilter();
    flt.type = filterType || 'lowpass';
    flt.frequency.setValueAtTime(freq, t);
    if (sweepTo) flt.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    flt.Q.value = q || 1;
    var g = ac.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // Oscillator with a pitch envelope. A fast downward sweep is the single
  // strongest "power" cue available without samples.
  function playSweep(f0, f1, type, dur, vol, when) {
    if (!ac) return;
    var t = (when !== undefined) ? when : ac.currentTime;
    var osc = ac.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    var g = ac.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /* A grunt: a saw at the character's voice pitch pushed through two bandpass
   * "formants", with a fast attack and a downward bend. This is a cartoon
   * "unh!", not a human voice — which suits the game's arcade tone. `base` is
   * the pitch bucket (see SUPER.VOICE_BASE); `detune` spreads characters that
   * share a bucket so they don't sound like one cloned voice. */
  function playGrunt(base, detune, when) {
    if (!ac) return;
    var t = (when !== undefined) ? when : ac.currentTime;
    var f0 = (base || 170) * (1 + (detune || 0));
    var dur = 0.22;
    var osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + dur);
    // Two formants give it a vowel-ish colour rather than a raw buzz.
    var f1 = ac.createBiquadFilter();
    f1.type = 'bandpass'; f1.frequency.value = f0 * 4.2; f1.Q.value = 6;
    var f2 = ac.createBiquadFilter();
    f2.type = 'bandpass'; f2.frequency.value = f0 * 8.5; f2.Q.value = 9;
    var g = ac.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.34, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(f1); f1.connect(f2); f2.connect(g); g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /* Duck the music bed briefly so a super lands in a clear mix. Raising SFX
   * volume instead would just clip against master (0.7, no limiter). */
  var duckTimer = null;
  function duckMusic(amount, holdMs) {
    if (!audioEl || musicState.muted) return;
    var full = musicState.volume;
    audioEl.volume = Math.max(0, full * (1 - (amount || 0.25)));
    if (duckTimer) clearTimeout(duckTimer);
    duckTimer = setTimeout(function () {
      duckTimer = null;
      if (!musicState.muted) audioEl.volume = musicState.volume;
    }, holdMs || 500);
  }

  function currentGenre() {
    return catalog.find(function (genre) { return genre.key === musicState.genreKey; }) || catalog[0] || null;
  }

  function currentTrack() {
    return musicState.trackKey ? trackLookup[musicState.trackKey] || null : null;
  }

  function syncAudioSource() {
    var track = currentTrack();
    var src = track ? track.file : '';
    if (audioEl.getAttribute('src') !== src) {
      audioEl.src = src;
    }
    audioEl.volume = musicState.muted ? 0 : musicState.volume;
  }

  function playCurrent() {
    var track = currentTrack();
    if (!track || brokenTracks[track.key]) return Promise.resolve(false);
    syncAudioSource();
    audioEl.load();
    suppressPlayError = true;
    return audioEl.play().then(function () {
      suppressPlayError = false;
      return true;
    }).catch(function () {
      suppressPlayError = false;
      return false;
    });
  }

  function pauseCurrent() {
    audioEl.pause();
  }

  function setGenre(genreKey) {
    var genre = catalog.find(function (item) { return item.key === genreKey; });
    if (!genre) return getState();
    musicState.genreKey = genre.key;
    var nextTrack = genre.tracks.find(function (item) { return !brokenTracks[item.key]; }) || genre.tracks[0] || null;
    musicState.trackKey = nextTrack ? nextTrack.key : null;
    syncAudioSource();
    persistState();
    if (!musicState.muted) playCurrent();
    return getState();
  }

  function setTrack(trackKey) {
    var track = trackLookup[trackKey];
    if (!track) return getState();
    musicState.genreKey = track.genre;
    musicState.trackKey = track.key;
    syncAudioSource();
    persistState();
    if (!musicState.muted) playCurrent();
    return getState();
  }

  function setMuted(muted, opts) {
    opts = opts || {};
    musicState.muted = !!muted;
    audioEl.volume = musicState.muted ? 0 : musicState.volume;
    if (!opts.deferPlayback) {
      if (musicState.muted) pauseCurrent();
      else playCurrent();
    }
    persistState();
    return musicState.muted;
  }

  function setVolume(volume) {
    musicState.volume = Math.max(0, Math.min(1, volume));
    audioEl.volume = musicState.muted ? 0 : musicState.volume;
    persistState();
    return musicState.volume;
  }

  function pickNextPlayableTrack(genreKey, currentKey, step) {
    var genre = catalog.find(function (item) { return item.key === genreKey; });
    var tracks = genre ? genre.tracks : [];
    if (!tracks.length) return null;
    var dir = step === -1 ? -1 : 1;
    var idx = tracks.findIndex(function (item) { return item.key === currentKey; });
    if (idx < 0) idx = 0;
    for (var tries = 1; tries <= tracks.length; tries++) {
      var next = tracks[(idx + (tries * dir) + tracks.length) % tracks.length];
      if (!brokenTracks[next.key]) return next;
    }
    return null;
  }

  function nextTrack() {
    var next = pickNextPlayableTrack(musicState.genreKey, musicState.trackKey, 1);
    if (next) setTrack(next.key);
    return getState();
  }

  function prevTrack() {
    var prev = pickNextPlayableTrack(musicState.genreKey, musicState.trackKey, -1);
    if (prev) setTrack(prev.key);
    return getState();
  }

  function getCatalog() {
    return catalog.map(function (genre) {
      return {
        key: genre.key,
        label: genre.label,
        tracks: genre.tracks.map(function (track) {
          return {
            key: track.key,
            genre: track.genre,
            label: track.label,
            artist: track.artist || '',
            file: track.file,
            unavailable: !!brokenTracks[track.key]
          };
        })
      };
    });
  }

  function getState() {
    var genre = currentGenre();
    var track = currentTrack();
    return {
      muted: musicState.muted,
      volume: musicState.volume,
      genreKey: genre ? genre.key : null,
      genreLabel: genre ? genre.label : 'NO TRACK',
      trackKey: track ? track.key : null,
      trackLabel: track ? track.label : 'NO TRACK',
      artist: track ? (track.artist || '') : '',
      playing: !musicState.muted && !audioEl.paused && !!track && !brokenTracks[track.key],
      hasTrack: !!track,
      unavailable: !!(track && brokenTracks[track.key])
    };
  }

  audioEl.addEventListener('ended', function () {
    if (!audioEl.loop) nextTrack();
  });
  return {
    unlock: unlock,
    sfx: {
      paddle: function () { if (ac && !sfxMuted) playNote(440,  'square',   0.05, 0.35); },
      bounce: function () { if (ac && !sfxMuted) playNote(220,  'sine',     0.05, 0.22); },
      net:    function () { if (ac && !sfxMuted) playNote(140,  'triangle', 0.09, 0.30); },
      serve:  function () { if (ac && !sfxMuted) playNote(520,  'sine',     0.07, 0.30); },
      point:  function () { if (ac && !sfxMuted) playNote(660,  'sine',     0.22, 0.40); },
      fault:  function () { if (ac && !sfxMuted) playNote(180,  'sawtooth', 0.18, 0.30); },

      // --- super smash ---
      // The bar filling: a short rising two-note tell.
      superReady: function () {
        if (!ac || sfxMuted) return;
        playNote(660, 'triangle', 0.09, 0.22);
        playNote(990, 'triangle', 0.12, 0.20, ac.currentTime + 0.09);
      },
      // Contact: three layers. The downward sweep is the "boom", the noise
      // crack keeps it from sounding like a drum, the sub adds chest weight
      // (inaudible on phone speakers, big on headphones).
      superHit: function () {
        if (!ac || sfxMuted) return;
        playSweep(120, 55, 'sine', 0.18, 0.50);
        playNoise(0.05, 0.35, 'highpass', 2000, 1, null);
        playSweep(70, 40, 'sine', 0.25, 0.30);
        duckMusic(0.25, 550);
      },
      // The victim's grunt. `voice` is 'boy'|'girl' (see src/characters.js —
      // authored per character, never inferred from the name); `detune` spreads
      // characters within a bucket.
      blastGrunt: function (voice, detune) {
        if (!ac || sfxMuted) return;
        playGrunt(VOICE_BASE[voice] || VOICE_BASE.girl, detune || 0);
      },
      // Body hitting the ground — fires on the blown->down transition, not at
      // contact, so it lands when the body actually meets the floor.
      bodyThud: function () {
        if (!ac || sfxMuted) return;
        playNoise(0.12, 0.45, 'lowpass', 180, 1, 90);
        playSweep(60, 35, 'sine', 0.15, 0.35);
      },

      isMuted:  function () { return sfxMuted; },
      setMuted: function (muted) { sfxMuted = !!muted; persistState(); }
    },
    music: {
      play: function () { return playCurrent(); },
      pause: function () { pauseCurrent(); },
      isMuted: function () { return musicState.muted; },
      setMuted: setMuted,
      getState: getState,
      getCatalog: getCatalog,
      setGenre: setGenre,
      setTrack: setTrack,
      nextTrack: nextTrack,
      prevTrack: prevTrack,
      setVolume: setVolume
    }
  };
}
