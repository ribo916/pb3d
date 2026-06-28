/* ============================================================================
 * camera.js — Broadcast camera: a lower, closer angle behind the near baseline
 * that frames both teams + the full court on landscape AND portrait while
 * keeping the near player large and readable. Gentle follow toward the ball,
 * plus a short shake on points. Extracted from the original js/game.js camera.
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

/* Update camera follow + shake. `rig` is the object returned by makeCamera(),
 * `ball` is the physics ball, `shake` the current shake magnitude (decayed by
 * the game loop). */
export function updateCamera(rig, ball, shake, dt) {
  var bx = ball.pos.x;
  var followX = clamp(bx * CAMERA.FOLLOW_X_SCALE, -CAMERA.FOLLOW_X_RANGE, CAMERA.FOLLOW_X_RANGE);
  // gentle follow; base pose matches makeCamera and keeps framing margin
  var desired = new THREE.Vector3(followX, CAMERA.POS.y, CAMERA.POS.z);
  var look = new THREE.Vector3(bx * CAMERA.FOLLOW_X_SCALE, CAMERA.LOOK.y, CAMERA.LOOK.z + ball.pos.z * 0.06);
  rig.camPos.lerp(desired, Math.min(1, dt * CAMERA.FOLLOW_POS_LERP));
  rig.camTarget.lerp(look, Math.min(1, dt * CAMERA.FOLLOW_LOOK_LERP));
  rig.cam.position.copy(rig.camPos);
  if (shake > 0) {
    rig.cam.position.x += (Math.random() - 0.5) * shake;
    rig.cam.position.y += (Math.random() - 0.5) * shake;
  }
  rig.cam.lookAt(rig.camTarget);
}
