/* ============================================================================
 * characterPreview.js — Live 3D close-up of a selectable character.
 *
 * Small standalone Three.js viewport used by the character picker modal:
 * renders one makePlayer() model in an idle stance on a slow turntable.
 * Owns its renderer/scene; call start()/stop() with modal open/close and
 * dispose() when tearing the modal down for good.
 * ==========================================================================*/
'use strict';

import * as THREE from 'three';
import { makePlayer } from './players.js';
import { preloadPlayerModels, preloadClipLibraries } from './assets.js';

var FOV = 28;
// Shots the preview cycles through, at each clip's NATURAL duration (timeScale
// 1 — the same speed the character-preview viewer plays them), with a short
// idle beat between each.
var SHOT_SEQUENCE = ['fh', 'bh', 'smash'];
var SHOT_GAP = 0.85;      // idle seconds between shots
var SHOT_START_DELAY = 0.6; // idle beat before the first shot on a new character
// Framing presets as fractions of the model's bounding-box height.
var FRAMINGS = {
  bust: { lookY: 0.8, visibleH: 0.55 },
  waist: { lookY: 0.73, visibleH: 0.68 },
  full: { lookY: 0.53, visibleH: 1.14 }
};

export function makeCharacterPreview(container, options) {
  options = options || {};
  var canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.touchAction = 'none'; // let pointer-drag rotate instead of scrolling on touch
  canvas.style.userSelect = 'none';
  canvas.style.webkitUserSelect = 'none';
  container.appendChild(canvas);

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Match the in-game look (game.js renderer) so jersey colors read the same.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.setClearColor(0x000000, 0);

  var scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x39485c, 1.05));
  var key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(1.6, 3.0, 2.6);
  scene.add(key);
  var rim = new THREE.DirectionalLight(0x7fb4ff, 0.55);
  rim.position.set(-2.2, 1.8, -2.0);
  scene.add(rim);

  var camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 30);

  var turntable = new THREE.Group();
  scene.add(turntable);

  var state = {
    player: null,
    characterKey: '',
    framing: options.framing || 'waist',
    rotationMode: options.rotationMode || 'turntable',
    raf: 0,
    running: false,
    last: 0,
    yaw: 0,
    dragging: false,
    dragX: 0,
    disposed: false,
    shotsReady: false,
    shotIdx: 0,
    shotCooldown: SHOT_START_DELAY
  };

  // Trigger a swing at the clip's natural duration (timeScale 1) instead of the
  // compressed gameplay speed. Setting _swingDur to the clip length makes
  // playOnce()'s scale = duration/_swingDur = 1, and keeps isSwinging() true for
  // the whole clip so the player's own update() won't cut back to idle mid-shot.
  function previewSwing(type) {
    var player = state.player;
    if (!player || !player.swing) return;
    var authored = player.authored;
    var actions = authored && authored.actions;
    var action = actions && (actions[type] || actions.fh);
    var clip = action && action.getClip && action.getClip();
    if (clip && clip.duration) player._swingDur = clip.duration;
    // Fade the idle loop fully out so the swing plays at FULL amplitude. The
    // player's own playOnce() only fades the previous *swing*, not the idle
    // locomotion — leaving idle at weight 1 blends 50/50 with the swing and
    // makes it look sluggish/subdued vs. the character-preview viewer (which
    // stops its idle outright before playing a swing).
    if (authored && authored.locomotion) {
      authored.locomotion.fadeOut(0.06);
      authored.locomotion = null;
      authored.locomotionName = '';
    }
    player.swing(type);
  }

  function resize() {
    var w = container.clientWidth || 1;
    var h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  var ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  function disposeObject(root) {
    root.traverse(function (node) {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        (Array.isArray(node.material) ? node.material : [node.material]).forEach(function (m) {
          if (m && m.dispose) m.dispose();
        });
      }
    });
  }

  function frameCamera() {
    if (!state.player) return;
    state.player.object.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(state.player.object);
    var h = Math.max(box.max.y - box.min.y, 0.5);
    var f = FRAMINGS[state.framing] || FRAMINGS.waist;
    var lookY = box.min.y + h * f.lookY;
    var dist = (h * f.visibleH * 0.5) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    camera.position.set(0, lookY + h * 0.03, dist);
    camera.lookAt(0, lookY, 0);
  }

  function tick(now) {
    if (!state.running) return;
    state.raf = requestAnimationFrame(tick);
    var dt = state.last ? Math.min((now - state.last) / 1000, 0.05) : 0.016;
    state.last = now;
    if (state.player) {
      // Cycle forehand → backhand → overhead with an idle beat between each.
      if (state.shotsReady) {
        var swinging = state.player.isSwinging && state.player.isSwinging();
        if (!swinging) {
          state.shotCooldown -= dt;
          if (state.shotCooldown <= 0) {
            previewSwing(SHOT_SEQUENCE[state.shotIdx]);
            state.shotIdx = (state.shotIdx + 1) % SHOT_SEQUENCE.length;
            state.shotCooldown = SHOT_GAP;
          }
        }
      }
      state.player.update(dt, { speed: 0, facing: 0, ready: false });
      state.player.object.rotation.y = 0; // facing lerps; pin it so only the turntable spins
      state.player.object.position.set(0, 0, 0); // pin root so swing clips don't drift
      if (state.rotationMode === 'turntable' && !state.dragging) state.yaw += dt * 0.55;
      turntable.rotation.y = state.yaw;
    }
    renderer.render(scene, camera);
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (state.rotationMode === 'none') return;
    state.dragging = true;
    state.dragX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!state.dragging) return;
    state.yaw += (e.clientX - state.dragX) * 0.012;
    state.dragX = e.clientX;
  });
  function endDrag() { state.dragging = false; }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  var api = {
    /* Resolves once player GLBs are available (cached after first call). */
    ready: function () { return preloadPlayerModels(); },

    /* character: a resolved cosmetics object (see characters.js
     * resolveSlotCharacter()) with a `.key` field used to de-dupe repeat
     * calls for the same combo. */
    show: async function (character) {
      if (state.disposed || character.key === state.characterKey) return;
      state.characterKey = character.key;
      var pack = null;
      try {
        pack = await preloadPlayerModels([character.playerModelKey]);
        // Merge the shared swing/locomotion clip libraries so the preview can
        // idle and perform shots (the model GLBs carry no clips of their own).
        var clipLibs = await preloadClipLibraries();
        if (pack && clipLibs) {
          Object.keys(clipLibs).forEach(function (k) {
            if (!pack.animations[k]) pack.animations[k] = clipLibs[k];
          });
        }
      } catch (e) {
        console.warn('Character preview: player model preload failed; using primitive fallback.', e);
      }
      if (state.disposed || state.characterKey !== character.key) return;
      if (state.player) {
        turntable.remove(state.player.object);
        disposeObject(state.player.object);
        state.player = null;
      }
      var player = makePlayer(Object.assign({}, character, { assets: pack }));
      player._facing = 0;
      player.object.rotation.y = 0;
      player.object.position.set(0, 0, 0);
      // Settle into the relaxed idle stance before measuring for the camera
      // (same warm-up the portrait generator uses).
      player.update(0.001, { speed: 0, facing: 0, ready: false });
      if (player.authored && player.authored.mixer) player.authored.mixer.update(0.15);
      turntable.add(player.object);
      state.player = player;
      // Enable the shot cycle only if the swing clips actually loaded.
      var actions = player.authored && player.authored.actions;
      state.shotsReady = !!(actions && (actions.fh || actions.bh || actions.smash));
      state.shotIdx = 0;
      state.shotCooldown = SHOT_START_DELAY;
      frameCamera();
      if (!state.running) renderer.render(scene, camera);
    },

    /* Renders the current character face-on and returns a PNG data URL —
     * used to generate picker thumbnails from the same models/lighting. */
    snapshot: function () {
      turntable.rotation.y = 0;
      renderer.render(scene, camera);
      return canvas.toDataURL('image/png');
    },

    setFraming: function (framing) {
      state.framing = FRAMINGS[framing] ? framing : 'waist';
      frameCamera();
      if (!state.running) renderer.render(scene, camera);
    },

    setRotationMode: function (mode) {
      state.rotationMode = mode === 'drag' ? 'drag' : 'turntable';
      if (state.rotationMode === 'drag') { state.yaw = 0; turntable.rotation.y = 0; }
    },

    start: function () {
      if (state.running || state.disposed) return;
      state.running = true;
      state.last = 0;
      state.raf = requestAnimationFrame(tick);
    },

    stop: function () {
      state.running = false;
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
    },

    dispose: function () {
      api.stop();
      state.disposed = true;
      ro.disconnect();
      if (state.player) {
        turntable.remove(state.player.object);
        disposeObject(state.player.object);
        state.player = null;
      }
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }
  };

  return api;
}
