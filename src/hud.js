/* ============================================================================
 * hud.js — DOM HUD overlay: scores, serve-side dots, score callout,
 * center banner (messages), transient shot-name tag, difficulty badge, and the
 * SERVE button (visible only on the human's serve).
 * ==========================================================================*/
'use strict';

export function makeHUD(refs, onServe, onSuper) {
  // refs is a map of pre-built DOM elements (see index.html).
  var disposers = [];
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    disposers.push(function () { target.removeEventListener(type, fn, opts); });
  }
  if (onServe && refs.serveBtn) {
    var fire = function (e) { e.preventDefault(); onServe(); };
    on(refs.serveBtn, 'click', fire);
    on(refs.serveBtn, 'touchstart', fire, { passive: false });
  }
  if (onSuper && refs.superBtn) {
    var fireSuper = function (e) { e.preventDefault(); onSuper(); };
    on(refs.superBtn, 'click', fireSuper);
    on(refs.superBtn, 'touchstart', fireSuper, { passive: false });
  }

  // Opponent/partner pips are built once on first sight of the payload, so the
  // count follows the mode (1 in singles, 3 in doubles) without extra markup.
  var pipEls = [];
  function syncPips(n) {
    if (!refs.powerPips || pipEls.length === n) return;
    refs.powerPips.textContent = '';
    pipEls = [];
    for (var i = 0; i < n; i++) {
      var pip = document.createElement('div');
      pip.className = 'power-pip';
      var fill = document.createElement('i');
      pip.appendChild(fill);
      refs.powerPips.appendChild(pip);
      pipEls.push({ pip: pip, fill: fill });
    }
  }

  function updatePower(s) {
    if (!refs.powerMeter) return;
    var list = s.power || [];
    var practice = s.mode === 'practice';
    // Practice has no rally rules, so no meter.
    refs.powerMeter.style.display = (practice || !list.length) ? 'none' : 'flex';
    if (refs.powerPips) refs.powerPips.style.display = practice ? 'none' : 'flex';
    if (practice || !list.length) {
      if (refs.superBtnWrap) refs.superBtnWrap.classList.remove('armed');
      return;
    }

    var me = list[0];
    refs.powerFill.style.width = Math.round(me.charge * 100) + '%';
    refs.powerMeter.classList.toggle('armed', !!me.armed);
    refs.powerLabel.textContent = me.armed ? 'SUPER READY' : 'SUPER';
    // The unleash button only exists while it can actually do something.
    if (refs.superBtnWrap) refs.superBtnWrap.classList.toggle('armed', !!me.armed);

    syncPips(list.length - 1);
    for (var i = 1; i < list.length; i++) {
      var e = pipEls[i - 1];
      if (!e) continue;
      e.fill.style.width = Math.round(list[i].charge * 100) + '%';
      e.fill.style.background = list[i].color || '#7ce7ff';
      e.pip.classList.toggle('armed', !!list[i].armed);
    }
  }

  function update(s) {
    var practice = s.mode === 'practice';
    refs.scoreNear.textContent = practice ? '--' : s.scores.near;
    refs.scoreFar.textContent = practice ? '--' : s.scores.far;
    refs.dotNear.style.opacity = practice ? '0.15' : (s.server === 'near' ? '1' : '0.15');
    refs.dotFar.style.opacity = practice ? '0.15' : (s.server === 'far' ? '1' : '0.15');
    refs.callout.textContent = s.callout || '';

    if (s.msg) {
      refs.banner.textContent = s.msg;
      refs.banner.style.opacity = String(s.msgOpacity);
    } else {
      refs.banner.style.opacity = '0';
    }

    if (s.shotName) {
      refs.shotTag.textContent = s.shotName;
      refs.shotTag.style.opacity = String(s.shotOpacity);
    } else {
      refs.shotTag.style.opacity = '0';
    }

    refs.levelBadge.textContent = s.level.label;
    refs.levelBadge.style.background = s.level.tint;

    refs.serveBtn.style.display = (!practice && s.isHumanServe) ? 'block' : 'none';

    updatePower(s);
  }

  function dispose() {
    while (disposers.length) disposers.pop()();
    if (refs.serveBtn) refs.serveBtn.style.display = 'none';
    if (refs.superBtnWrap) refs.superBtnWrap.classList.remove('armed');
    if (refs.powerMeter) refs.powerMeter.style.display = 'none';
  }

  return { update: update, dispose: dispose };
}
