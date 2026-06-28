/* ============================================================================
 * camera.js — Broadcast camera: a lower, closer angle behind the near baseline
 * that frames both teams + the full court on landscape AND portrait while
 * keeping the near player large and readable. Gentle follow toward the ball,
 * plus a short shake on points. Extracted from the original js/game.js camera.
 *
 * Supports three modes (0–2): Broadcast, Follow, Top-Down.
 * ==========================================================================*/
'use strict';

import * as THREE from 'three';
import { CAMERA } from './constants.js';
import { clamp } from './utils.js';

export function makeCamera(aspect) {
  var cam = new THREE.PerspectiveCamera(CAMERA.FOV, aspect, 0.1, 200);
  cam.position.set(CAMERA.POS.x, CAMERA.POS.y, CAMERA.POS.z);
  cam.lookAt(CAMERA.LOOK.x, CAMERA.LOOK.y, CAMERA.LOOK.z);
  return {
    cam: cam,
    camTarget: new THREE.Vector3(CAMERA.LOOK.x, CAMERA.LOOK.y, CAMERA.LOOK.z),
    camPos: cam.position.clone()
  };
}

/* Update camera follow + shake.
 * rig      — object from makeCamera()
 * ball     — physics ball { pos }
 * humanPos — human player pos { x, z }
 * mode     — 0 broadcast | 1 follow | 2 topdown
 * shake    — current shake magnitude (decayed by game loop)
 * dt       — delta time in seconds
 * opts     — { isMobile } */
export function updateCamera(rig, ball, humanPos, mode, shake, dt, opts) {
  var bx = ball.pos.x, bz = ball.pos.z;
  var desired, look, posLerp, lookLerp;
  var isMobile = !!(opts && opts.isMobile);
  var targetFov = CAMERA.FOV;

  if (mode === 1) {
    // Follow: camera trails behind/above the human player
    var followY = CAMERA.FOLLOW.Y;
    var zOffset = CAMERA.FOLLOW.Z_OFFSET;
    if (isMobile) {
      var pullT = 1 - ((humanPos.z - CAMERA.FOLLOW.MOBILE_PULLBACK_END_Z) /
        (CAMERA.FOLLOW.MOBILE_PULLBACK_START_Z - CAMERA.FOLLOW.MOBILE_PULLBACK_END_Z || 1));
      pullT = clamp(pullT, 0, 1);
      zOffset += CAMERA.FOLLOW.MOBILE_PULLBACK_Z * pullT;
      followY += CAMERA.FOLLOW.MOBILE_PULLBACK_Y * pullT;
    }
    desired = new THREE.Vector3(humanPos.x, followY, humanPos.z + zOffset);
    look    = new THREE.Vector3(bx * 0.3, 0.9, bz * 0.2);
    posLerp = lookLerp = CAMERA.FOLLOW.LERP;
  } else if (mode === 2) {
    // Top-Down: aerial view, very soft ball tracking
    var td = CAMERA.TOPDOWN;
    desired = new THREE.Vector3(td.POS.x, td.POS.y, td.POS.z);
    look    = new THREE.Vector3(td.LOOK.x + bx * 0.1, td.LOOK.y, td.LOOK.z + bz * 0.05);
    posLerp = CAMERA.FOLLOW_POS_LERP;
    lookLerp = CAMERA.FOLLOW_LOOK_LERP;
  } else {
    // Broadcast (default): horizontal ball tracking, gentle depth follow
    var followX = clamp(bx * CAMERA.FOLLOW_X_SCALE, -CAMERA.FOLLOW_X_RANGE, CAMERA.FOLLOW_X_RANGE);
    desired = new THREE.Vector3(followX, CAMERA.POS.y, CAMERA.POS.z);
    look    = new THREE.Vector3(bx * CAMERA.FOLLOW_X_SCALE, CAMERA.LOOK.y, CAMERA.LOOK.z + bz * 0.06);
    posLerp = CAMERA.FOLLOW_POS_LERP;
    lookLerp = CAMERA.FOLLOW_LOOK_LERP;
  }

  rig.camPos.lerp(desired, Math.min(1, dt * posLerp));
  rig.camTarget.lerp(look, Math.min(1, dt * lookLerp));
  rig.cam.fov += (targetFov - rig.cam.fov) * Math.min(1, dt * 5.0);
  rig.cam.updateProjectionMatrix();
  rig.cam.position.copy(rig.camPos);
  if (shake > 0) {
    rig.cam.position.x += (Math.random() - 0.5) * shake;
    rig.cam.position.y += (Math.random() - 0.5) * shake;
  }
  rig.cam.lookAt(rig.camTarget);
}
