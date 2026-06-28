/* ============================================================================
 * hud.js — DOM HUD overlay: scores, serve-side dots, doubles score callout,
 * center banner (messages), transient shot-name tag, difficulty badge, and the
 * SERVE button (visible only on the human's serve).
 * ==========================================================================*/
'use strict';

export function makeHUD(refs, onServe) {
  // refs is a map of pre-built DOM elements (see index.html).
  if (onServe && refs.serveBtn) {
    var fire = function (e) { e.preventDefault(); onServe(); };
    refs.serveBtn.addEventListener('click', fire);
    refs.serveBtn.addEventListener('touchstart', fire, { passive: false });
  }

  function update(s) {
    refs.scoreNear.textContent = s.scores.near;
    refs.scoreFar.textContent = s.scores.far;
    refs.dotNear.style.opacity = s.server === 'near' ? '1' : '0.15';
    refs.dotFar.style.opacity = s.server === 'far' ? '1' : '0.15';
    // doubles callout (serving team's perspective): server–receiver–serverNum
    var sv = s.server, rv = sv === 'near' ? 'far' : 'near';
    refs.callout.textContent = s.scores[sv] + '–' + s.scores[rv] + '–' + s.serverNum;

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

    refs.serveBtn.style.display = s.isHumanServe ? 'block' : 'none';
  }

  return { update: update };
}
