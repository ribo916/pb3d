/* ============================================================================
 * input.js — Unified touch / mouse / keyboard controls.
 * Left half of screen = virtual joystick (move). Right half = swing + aim
 * (drag horizontally to aim, release to hit). Desktop: WASD/arrows move,
 * Space or click to swing, mouse X aims.
 * Ported from the original Picklelife js/input.js (ESM).
 *
 * makeInput(el, joyEl, joyKnob) -> { state, poll(), consumeSwing(), consumeServe() }
 * ==========================================================================*/
'use strict';

import { dist2D } from './utils.js';

export function makeInput(el, joyEl, joyKnob) {
  var state = {
    move: { x: 0, z: 0 },   // -1..1 each
    aim: 0,                  // -1 (left) .. 1 (right)
    swingQueued: false,      // one-shot
    swingType: 'fh',         // 'fh' | 'bh'
    swingPower: 'power',     // 'power' | 'touch'  (intent: drive/speedup vs drop/dink)
    swingShot: null,         // null | 'lob'       (explicit shot override)
    serveQueued: false,
    usingJoystick: false,
    joystickReleased: false,
    camCycleQueued: false    // one-shot: cycle camera mode
  };
  var keys = {};
  var joy = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0, rect: null, knobQueued: false, knobX: 0, knobY: 0 };
  var rightTouch = { active: false, id: null, sx: 0, sy: 0, lastx: 0, lasty: 0, t0: 0 };

  // --- keyboard --- Space = power swing, V = touch swing, B = lob.
  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    var fhbh = (state.aim < -0.25) ? 'bh' : 'fh';
    if (e.code === 'Space') { queueSwing(fhbh, 'power'); e.preventDefault(); }
    else if (e.code === 'KeyV') { queueSwing(fhbh, 'touch'); e.preventDefault(); }
    else if (e.code === 'KeyB') { queueSwing(fhbh, 'touch', 'lob'); e.preventDefault(); }
    if (e.code === 'Enter') state.serveQueued = true;
    if (e.code === 'KeyC') { state.camCycleQueued = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });

  function queueSwing(type, power, shot) {
    state.swingQueued = true;
    state.swingType = type || 'fh';
    state.swingPower = power || 'power';
    state.swingShot = shot || null;
    state.serveQueued = true; // a swing also serves when in serve state
  }

  // --- pointer helpers ---
  function rel(t) {
    var r = el.getBoundingClientRect();
    return relFromRect(t, r);
  }
  function relFromRect(t, r) {
    return { x: t.clientX - r.left, y: t.clientY - r.top, w: r.width, h: r.height };
  }
  function applyJoystickMove(x, y) {
    var dx = x - joy.ox, dy = y - joy.oy;
    var max = 60, d = Math.min(max, dist2D(dx, dy)) || 0;
    var ang = Math.atan2(dy, dx);
    var ux = d ? Math.cos(ang) : 0, uy = d ? Math.sin(ang) : 0;
    state.move.x = ux * (d / max);
    state.move.z = uy * (d / max); // screen-down = toward camera (+z)
    state.usingJoystick = true;
    state.joystickReleased = false;
    queueKnob(ux * d, uy * d);
  }
  function queueKnob(x, y) {
    if (!joyKnob) return;
    joy.knobX = x; joy.knobY = y;
    if (joy.knobQueued) return;
    joy.knobQueued = true;
    var raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame
        : function (fn) { return setTimeout(fn, 0); };
    raf(function () {
      joy.knobQueued = false;
      joyKnob.style.transform = 'translate(' + joy.knobX + 'px,' + joy.knobY + 'px)';
    });
  }

  function onStart(t) {
    var startRect = el.getBoundingClientRect();
    var p = relFromRect(t, startRect);
    if (p.x < p.w * 0.5) {
      joy.active = true; joy.id = t.identifier; joy.ox = p.x; joy.oy = p.y; joy.x = p.x; joy.y = p.y;
      joy.rect = startRect;
      state.usingJoystick = true; state.joystickReleased = false;
      applyJoystickMove(p.x, p.y);
      if (joyEl) { joyEl.style.display = 'block'; joyEl.style.left = p.x + 'px'; joyEl.style.top = p.y + 'px'; }
    } else {
      rightTouch.active = true; rightTouch.id = t.identifier;
      rightTouch.sx = p.x; rightTouch.sy = p.y; rightTouch.lastx = p.x; rightTouch.lasty = p.y;
      rightTouch.t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    }
  }
  function onMove(t) {
    if (joy.active && t.identifier === joy.id) {
      var p = relFromRect(t, joy.rect || el.getBoundingClientRect());
      joy.x = p.x; joy.y = p.y;
      applyJoystickMove(joy.x, joy.y);
    } else if (rightTouch.active && t.identifier === rightTouch.id) {
      var p2 = rel(t);
      rightTouch.lastx = p2.x; rightTouch.lasty = p2.y;
      state.aim = Math.max(-1, Math.min(1, (p2.x - rightTouch.sx) / 120));
    }
  }
  function onEnd(t) {
    if (joy.active && t.identifier === joy.id) {
      joy.active = false; joy.rect = null;
      state.move.x = 0; state.move.z = 0; state.usingJoystick = false; state.joystickReleased = true;
      if (joyEl) joyEl.style.display = 'none';
      queueKnob(0, 0);
    } else if (rightTouch.active && t.identifier === rightTouch.id) {
      rightTouch.active = false;
      var swung = state.aim < -0.25 ? 'bh' : 'fh';
      // Classify the gesture: a strong upward flick = lob; otherwise a long or
      // fast horizontal swipe = power, a short/slow one = touch.
      var dx = rightTouch.lastx - rightTouch.sx, dy = rightTouch.lasty - rightTouch.sy;
      var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      var ms = Math.max(1, now - rightTouch.t0);
      var dist = dist2D(dx, dy), speed = dist / ms; // px per ms
      if (dy < -55 && -dy > Math.abs(dx)) { queueSwing(swung, 'touch', 'lob'); return; }
      var power = (dist > 70 || speed > 0.7) ? 'power' : 'touch';
      queueSwing(swung, power);
    }
  }

  el.addEventListener('touchstart', function (e) {
    for (var i = 0; i < e.changedTouches.length; i++) onStart(e.changedTouches[i]);
    e.preventDefault();
  }, { passive: false });
  el.addEventListener('touchmove', function (e) {
    for (var i = 0; i < e.changedTouches.length; i++) onMove(e.changedTouches[i]);
    e.preventDefault();
  }, { passive: false });
  el.addEventListener('touchend', function (e) {
    for (var i = 0; i < e.changedTouches.length; i++) onEnd(e.changedTouches[i]);
    e.preventDefault();
  }, { passive: false });
  el.addEventListener('touchcancel', function (e) {
    for (var i = 0; i < e.changedTouches.length; i++) onEnd(e.changedTouches[i]);
  });

  // --- mouse (desktop) --- left = power, right = touch, middle/shift = lob.
  el.addEventListener('mousedown', function (e) {
    var r = el.getBoundingClientRect();
    state.aim = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
    var fhbh = state.aim < -0.25 ? 'bh' : 'fh';
    if (e.button === 1 || e.shiftKey) { queueSwing(fhbh, 'touch', 'lob'); }
    else if (e.button === 2) { queueSwing(fhbh, 'touch'); }
    else { queueSwing(fhbh, 'power'); }
    e.preventDefault();
  });
  el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  el.addEventListener('mousemove', function (e) {
    var r = el.getBoundingClientRect();
    state.aim = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
  });

  // --- per-frame poll: fold keyboard into move vector ---
  function poll() {
    var kx = 0, kz = 0;
    if (keys['KeyA'] || keys['ArrowLeft']) kx -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) kx += 1;
    if (keys['KeyW'] || keys['ArrowUp']) kz -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) kz += 1;
    if (kx || kz) {
      var l = dist2D(kx, kz) || 1;
      state.move.x = kx / l; state.move.z = kz / l;
      state.usingJoystick = false; state.joystickReleased = false;
    } else if (joy.active) {
      applyJoystickMove(joy.x, joy.y);
    } else if (!joy.active) {
      state.move.x = 0; state.move.z = 0;
      state.usingJoystick = false;
    }
    return state;
  }

  function consumeSwing() {
    if (state.swingQueued) { state.swingQueued = false; return state.swingType; }
    return null;
  }
  function consumeServe() {
    if (state.serveQueued) { state.serveQueued = false; return true; }
    return false;
  }
  function consumeCamCycle() {
    if (state.camCycleQueued) { state.camCycleQueued = false; return true; }
    return false;
  }

  return { state: state, poll: poll, consumeSwing: consumeSwing, consumeServe: consumeServe, consumeCamCycle: consumeCamCycle };
}
