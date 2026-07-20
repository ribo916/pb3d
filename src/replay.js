/* ============================================================================
 * replay.js — Instant replay (DVR review of the last ~10s of live play).
 *
 * Three cooperating pieces, all fed plain-number snapshots (no live sim):
 *   - makeRecorder(windowSec): a fixed-size ring buffer the live loop pushes a
 *     per-frame snapshot into (+ that frame's wall-clock dt, so the timeline is
 *     real seconds). snapshotWindow() freezes the trailing windowSec for playback.
 *   - makePlayback(window): owns the playhead/speed/play state, samples the frozen
 *     window with linear interpolation (smooth slow-mo), and reports swing events
 *     crossed while playing forward.
 *   - makeOrbitCam(cfg): a free spherical camera (drag to orbit, wheel/pinch to
 *     zoom) around the sampled ball position.
 *
 * This module is a rendering/UX concern — it may import three-free helpers but
 * touches no live gameplay state and is not part of the node-tested pure set.
 * ==========================================================================*/
'use strict';

import { clamp } from './utils.js';

function lerp(a, b, f) { return a + (b - a) * f; }
function lerp3(a, b, f) { return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f) }; }
function lerp2(a, b, f) { return { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f) }; }

/* ---------------------------------------------------------------- Recorder */
export function makeRecorder(windowSec) {
  // Generously sized for high-refresh displays; the ring never reallocates.
  var cap = Math.max(1, Math.ceil(windowSec * 130));
  var frames = new Array(cap);
  var dts = new Float64Array(cap);
  var head = 0;    // next write slot
  var count = 0;

  function record(frame, dt) {
    frames[head] = frame;
    dts[head] = dt > 0 ? dt : 1 / 60;
    head = (head + 1) % cap;
    if (count < cap) count++;
  }

  function clear() { head = 0; count = 0; for (var i = 0; i < cap; i++) frames[i] = null; }

  // Freeze the trailing windowSec of recorded frames into a chronological
  // timeline: [{ t, frame }] with t seconds from the window start.
  function snapshotWindow() {
    var start = (head - count + cap) % cap;
    var ordered = [];
    for (var i = 0; i < count; i++) ordered.push({ idx: (start + i) % cap });
    // Walk backward from newest, keeping frames until we've covered windowSec.
    var kept = [];
    var total = 0;
    for (var j = ordered.length - 1; j >= 0; j--) {
      var slot = ordered[j].idx;
      kept.unshift({ frame: frames[slot], dt: dts[slot] });
      total += dts[slot];
      if (total >= windowSec) break;
    }
    var out = [];
    var t = 0;
    for (var k = 0; k < kept.length; k++) {
      out.push({ t: t, frame: kept[k].frame });
      if (k < kept.length - 1) t += kept[k + 1].dt;
    }
    return { frames: out, duration: out.length ? out[out.length - 1].t : 0 };
  }

  return { record: record, clear: clear, snapshotWindow: snapshotWindow };
}

/* ------------------------------------------------------------- Playback */
export function makePlayback(window, defaultSpeed) {
  var frames = (window && window.frames) || [];
  var duration = (window && window.duration) || 0;
  var playhead = 0;
  var playing = false;
  var speed = defaultSpeed || 1;
  var firedThrough = 0;   // swings up to this playhead-time have been dispatched

  function _bracket(t) {
    if (frames.length === 0) return null;
    if (t <= frames[0].t) return { a: frames[0].frame, b: frames[0].frame, f: 0 };
    var last = frames[frames.length - 1];
    if (t >= last.t) return { a: last.frame, b: last.frame, f: 0 };
    var lo = 0, hi = frames.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (frames[mid].t <= t) lo = mid; else hi = mid;
    }
    var span = frames[hi].t - frames[lo].t || 1;
    return { a: frames[lo].frame, b: frames[hi].frame, f: (t - frames[lo].t) / span };
  }

  // Interpolated frame at the current playhead (shaped like the live snapshot).
  function sample() {
    var br = _bracket(playhead);
    if (!br) return null;
    var a = br.a, b = br.b, f = br.f;
    var players = [];
    for (var i = 0; i < a.players.length; i++) {
      var pa = a.players[i], pb = (b.players[i] || pa);
      players.push({
        pos: lerp2(pa.pos, pb.pos, f),
        vel: lerp2(pa.vel, pb.vel, f),
        move: pa.move,
        // Discrete per-player state is SNAPPED from the earlier keyframe, never
        // interpolated. Anything added to _captureFrame must be listed here or
        // it is silently dropped: sample() rebuilds the frame rather than
        // passing it through, so a missing field reads as undefined downstream.
        power: pa.power,
        armed: pa.armed,
        stun: pa.stun
      });
    }
    return {
      ball: {
        pos: lerp3(a.ball.pos, b.ball.pos, f),
        vel: lerp3(a.ball.vel, b.ball.vel, f),
        spin: lerp3(a.ball.spin, b.ball.spin, f),
        live: a.ball.live,
        superHot: a.ball.superHot
      },
      players: players,
      hud: a.hud
    };
  }

  // Swing triggers whose frame-time falls in (firedThrough, playhead], in order.
  // Only fires while moving forward; seeking resets the marker (see seek()).
  function consumeSwings() {
    var out = [];
    if (playhead > firedThrough) {
      for (var i = 0; i < frames.length; i++) {
        var fr = frames[i];
        if (fr.t > firedThrough && fr.t <= playhead && fr.frame.swings) {
          for (var j = 0; j < fr.frame.swings.length; j++) out.push(fr.frame.swings[j]);
        }
      }
    }
    firedThrough = playhead;
    return out;
  }

  function advance(dtRender) {
    if (!playing || frames.length === 0) return;
    playhead = clamp(playhead + dtRender * speed, 0, duration);
    if (playhead >= duration) playing = false;   // stop at the end
  }

  function seek(t) {
    playhead = clamp(t, 0, duration);
    firedThrough = playhead;   // don't replay a burst of swings after a scrub
  }

  function stepFrames(n) {
    // Move to the n-th neighboring recorded frame boundary and pause there.
    if (frames.length === 0) return;
    var i = 0;
    while (i < frames.length && frames[i].t <= playhead + 1e-4) i++;
    var cur = clamp(i - 1, 0, frames.length - 1);
    var target = clamp(cur + n, 0, frames.length - 1);
    playing = false;
    seek(frames[target].t);
  }

  return {
    sample: sample,
    advance: advance,
    consumeSwings: consumeSwings,
    seek: seek,
    stepFrames: stepFrames,
    play: function () { if (playhead >= duration) seek(0); playing = true; },
    pause: function () { playing = false; },
    toggle: function () { if (playing) playing = false; else { if (playhead >= duration) seek(0); playing = true; } },
    setSpeed: function (s) { speed = s; },
    getSpeed: function () { return speed; },
    isPlaying: function () { return playing; },
    getPlayhead: function () { return playhead; },
    getDuration: function () { return duration; },
    isEmpty: function () { return frames.length === 0; }
  };
}

/* ------------------------------------------------------------- Orbit cam */
export function makeOrbitCam(cfg) {
  var az = cfg.AZIMUTH, el = cfg.ELEVATION, r = cfg.RADIUS;

  function onDrag(dx, dy) {
    az -= dx * cfg.DRAG_SENS;
    el = clamp(el + dy * cfg.DRAG_SENS, cfg.MIN_ELEVATION, cfg.MAX_ELEVATION);
  }
  function onZoom(delta) {
    r = clamp(r + delta * cfg.ZOOM_SENS, cfg.MIN_RADIUS, cfg.MAX_RADIUS);
  }
  function reset() { az = cfg.AZIMUTH; el = cfg.ELEVATION; r = cfg.RADIUS; }

  // Position `cam` on the spherical shell around target (tx,ty,tz) and look at it.
  function applyTo(cam, tx, ty, tz) {
    var cosEl = Math.cos(el);
    cam.position.set(
      tx + r * cosEl * Math.sin(az),
      ty + r * Math.sin(el),
      tz + r * cosEl * Math.cos(az)
    );
    if (cam.fov !== 62) { cam.fov = 62; cam.updateProjectionMatrix(); }
    cam.lookAt(tx, ty, tz);
  }

  return { onDrag: onDrag, onZoom: onZoom, reset: reset, applyTo: applyTo };
}
