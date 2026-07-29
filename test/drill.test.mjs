/* Node tests for drill mode: schema/validation (drillStore.js), the
 * director (drillDirector.js), and — via lightweight Game.prototype stubs
 * that never touch three.js/DOM (see the "engine" section) — the drill-
 * specific movement/contact/poach decisions inside game.js. Split out of
 * logic.test.mjs once this section grew to ~20% of that file.
 * Run: node test/drill.test.mjs   (or node test/run-all.mjs for everything)
 */
import assert from 'node:assert';
import * as Physics from '../src/physics.js';
import * as AI from '../src/ai.js';
import * as Rules from '../src/rules.js';
import * as Power from '../src/power.js';
import { Game } from '../src/game.js';
import {
  DEFAULT_DRILLS, getDrillById, validateDrill, activeSlotsOf, normalizeDrill, gridToWorld
} from '../src/drillStore.js';
import { getScriptedShot, armNextScriptedShot, armMovesForBeat, resetRep } from '../src/drillDirector.js';
import { makeRunner } from './helpers.mjs';

const { test, report } = makeRunner();

/* ---------------------------- drill mode ---------------------------- */
test('DEFAULT_DRILLS: ships drill-drip, drill-dink-rally, and the 1v1/2v1 test drills, each with a non-empty script', () => {
  assert.equal(DEFAULT_DRILLS.length, 4);
  const ids = DEFAULT_DRILLS.map(d => d.id);
  assert.ok(ids.includes('drill-drip'));
  assert.ok(ids.includes('drill-dink-rally'));
  assert.ok(ids.includes('drill-1v1-test'));
  assert.ok(ids.includes('drill-2v1-test'));
  for (const drill of DEFAULT_DRILLS) {
    assert.ok(Array.isArray(drill.script) && drill.script.length > 0, drill.id + ' carries a non-empty script');
  }
});

test('DEFAULT_DRILLS: every shipped drill validates clean, including the 2/3-player test drills', () => {
  for (const drill of DEFAULT_DRILLS) {
    const errors = validateDrill(drill);
    assert.deepEqual(errors, [], drill.id + ' should have zero validation errors: ' + errors.join('; '));
  }
});

test('activeSlotsOf: 1v1/2v1 test drills report the right roster size and slots', () => {
  assert.deepEqual(activeSlotsOf(getDrillById('drill-1v1-test')), ['P1', 'P3']);
  assert.deepEqual(activeSlotsOf(getDrillById('drill-2v1-test')), ['P1', 'P2', 'P3']);
  assert.deepEqual(activeSlotsOf(getDrillById('drill-drip')), ['P1', 'P2', 'P3', 'P4']);
});

test('drill-drip: startPositions resolved for all 4 players (the only field the director reads)', () => {
  const drill = getDrillById('drill-drip');
  assert.ok(drill, 'drill-drip exists');
  const positions = drill.startPositions;
  for (const slot of ['P1', 'P2', 'P3', 'P4']) {
    assert.ok(positions[slot] && typeof positions[slot].x === 'number' && typeof positions[slot].z === 'number',
      slot + ' has a resolved world position');
  }
});

test('drill-dink-rally: startPositions resolved for all 4 players', () => {
  const drill = getDrillById('drill-dink-rally');
  assert.ok(drill, 'drill-dink-rally exists');
  const positions = drill.startPositions;
  for (const slot of ['P1', 'P2', 'P3', 'P4']) {
    assert.ok(positions[slot] && typeof positions[slot].x === 'number' && typeof positions[slot].z === 'number',
      slot + ' has a resolved world position');
  }
});

test('drill-dink-rally: script has 5 alternating P1<->P3 touches, matching its own "5 touches" narration', () => {
  const drill = getDrillById('drill-dink-rally');
  assert.equal(drill.script.length, 5);
  const hitters = drill.script.map(entry => entry.hitter);
  assert.deepEqual(hitters, ['P1', 'P3', 'P1', 'P3', 'P1'], 'hitters alternate P1<->P3');
  for (const entry of drill.script) {
    const expectedTarget = entry.hitter === 'P1' ? 'P3' : 'P1';
    assert.equal(entry.target, expectedTarget, entry.hitter + ' always dinks to the other cross-court player');
    assert.equal(entry.shotType, 'dink');
  }
});

test('drill-dink-rally: shadow moves cues (P2/P4) are well-formed on every beat that carries them', () => {
  const drill = getDrillById('drill-dink-rally');
  for (const entry of drill.script) {
    if (!entry.moves) continue;
    const players = entry.moves.map(m => m.player);
    assert.deepEqual(players.sort(), ['P2', 'P4'], 'shadow cues are for the off-ball P2/P4 pair');
    for (const mv of entry.moves) {
      assert.ok(typeof mv.to.x === 'number' && typeof mv.to.z === 'number', mv.player + ' move resolved to a world position');
    }
  }
});

test('drill-drip: P2/P4 carry moves cues matching their own narration (regression: used to rely on removed default-AI drift)', () => {
  const drill = getDrillById('drill-drip');
  const cuedPlayers = drill.script.flatMap(entry => (entry.moves || []).map(m => m.player));
  assert.ok(cuedPlayers.includes('P4'), 'P4 ("moves in alongside P3") has at least one cue');
  assert.ok(cuedPlayers.includes('P2'), 'P2 ("shades toward the middle") has at least one cue');
});

test('drill steps carry no positions field (pure narration, decoupled from startPositions)', () => {
  for (const drill of DEFAULT_DRILLS) {
    for (const step of drill.steps) {
      assert.equal(step.positions, undefined, drill.id + ' step "' + step.title + '" should not carry positions');
    }
  }
});

// Stub 4-player roster shared by the getScriptedShot/armNextScriptedShot
// tests below. Mid-court z values (not the baseline) so these tests
// exercise plain targeting, not the out-of-bounds clamp (that gets its own
// test). .drillSlot tags match how game.js's _initWorld now tags each real
// player — resolvePlayer (drillDirector.js) looks players up by this tag,
// not by array index, so these stubs need it too.
function stubDrillGame() {
  return { players: [
    { pos: { x: -1.5, z: 4.0 }, drillSlot: 'P1' },
    { pos: { x: 0, z: 2 }, drillSlot: 'P2' },
    { pos: { x: -1.5, z: -4.0 }, drillSlot: 'P3' },
    { pos: { x: 1.5, z: -6.7 }, drillSlot: 'P4' }
  ] };
}

test('getScriptedShot: aims at the named target\'s live position (far-team hitter needs no z-flip)', () => {
  const stubGame = stubDrillGame();
  const drillData = { script: [
    { hitter: 'P1', shotType: 'drive', target: 'P3' },
    { hitter: 'P3', shotType: 'drop', target: 'P1' }
  ] };
  const shot = getScriptedShot(stubGame, drillData, 1, { team: 'far' });
  assert.equal(shot.type, 'drop');
  assert.equal(shot.target.x, -1.5, 'aims at P1\'s x');
  assert.equal(shot.target.z, 4.0, 'aims at P1\'s real (near-side, positive) z');
  assert.ok(shot.apex > 0 && shot.margin > 0, 'carries a real physical envelope from Shots.specV2');
});

test('getScriptedShot: near-team hitter gets target.z pre-flipped so it still lands at the target\'s real z', () => {
  const stubGame = stubDrillGame();
  const drillData = { script: [{ hitter: 'P4', shotType: 'lob', target: 'P3' }] };
  const shot = getScriptedShot(stubGame, drillData, 0, { team: 'near' });
  // _cpuHit later computes tgtZ = (hitter.team==='near') ? -shot.target.z : shot.target.z.
  // For this to land at P3's real z (-4.0), shot.target.z must be +4.0 so the flip cancels out.
  assert.equal(shot.target.z, 4.0);
});

test('getScriptedShot: returns null past the end of the script', () => {
  const stubGame = stubDrillGame();
  const drillData = { script: [{ hitter: 'P1', shotType: 'drive', target: 'P3' }] };
  assert.equal(getScriptedShot(stubGame, drillData, 1, { team: 'near' }), null);
});

test('getScriptedShot: clamps a target standing behind the baseline to a safe in-bounds landing depth', () => {
  // Grid rows 1/10 (drillStore.js) resolve to z=±7.5, deliberately just
  // behind the real baseline (HALF_L=6.706) to match a natural standing
  // position — aiming a shot's LANDING point exactly there (as the opener,
  // script[0], would before the target has moved) sends it out of bounds.
  const stubGame = { players: [
    { pos: { x: 1.5, z: 7.5 }, drillSlot: 'P1' },
    { pos: { x: 0, z: 2 }, drillSlot: 'P2' },
    { pos: { x: -1.5, z: -6.706 }, drillSlot: 'P3' },
    { pos: { x: 1.5, z: -7.5 }, drillSlot: 'P4' }  // standing just behind the far baseline
  ] };
  const drillData = { script: [{ hitter: 'P1', shotType: 'drive', target: 'P4' }] };
  const shot = getScriptedShot(stubGame, drillData, 0, { team: 'near' });
  assert.ok(Math.abs(shot.target.z) < Physics.COURT.HALF_L, 'clamped landing sits inside the real baseline');
  assert.ok(Math.abs(shot.target.z) > Physics.COURT.HALF_L * 0.8, 'still lands deep, close to where P4 actually stands');
});

test('getScriptedShot: marks scripted smash shots as smashes for animation and quality handling', () => {
  const stubGame = stubDrillGame();
  const drillData = { script: [{ hitter: 'P1', shotType: 'smash', target: 'P3' }] };
  const shot = getScriptedShot(stubGame, drillData, 0, { team: 'near' });
  assert.equal(shot.type, 'smash');
  assert.equal(shot.isSmash, true);
});

test('getScriptedShot: v2 receiver and landing are separate (receiver owns contact, landing owns ball target)', () => {
  const stubGame = stubDrillGame();
  const drillData = { script: [
    { hitter: 'P1', receiver: 'P3', shotType: 'lob', landing: { x: 1.8, z: -6.2 } }
  ] };
  const shot = getScriptedShot(stubGame, drillData, 0, { team: 'near' });
  assert.equal(shot.target.x, 1.8, 'aims at authored landing x, not P3 body x');
  assert.equal(shot.target.z, 6.2, 'pre-flipped for near-team _cpuHit while preserving authored far-side landing');
});

test('armNextScriptedShot: arms drillForcedShot for the next scripted shot, clears it once the script runs out', () => {
  const stubGame = stubDrillGame();
  stubGame.drillScriptIndex = 1;
  stubGame.drillForcedShot = null;
  const drillData = { script: [
    { hitter: 'P1', shotType: 'drive', target: 'P3' },
    { hitter: 'P3', shotType: 'drop', target: 'P1' }
  ] };
  armNextScriptedShot(stubGame, drillData);
  assert.equal(stubGame.drillForcedShot.hitter, stubGame.players[2], 'arms P3 (script[1].hitter)');

  stubGame.drillScriptIndex = 2; // beyond the script
  armNextScriptedShot(stubGame, drillData);
  assert.equal(stubGame.drillForcedShot, null, 'clears once the script runs out');
});

test('armNextScriptedShot: v2 receiver is resolved separately from landing', () => {
  const stubGame = stubDrillGame();
  stubGame.drillScriptIndex = 0;
  stubGame.drillForcedShot = null;
  const drillData = { script: [
    { hitter: 'P1', receiver: 'P3', shotType: 'lob', landing: { x: 1.8, z: -6.2 } }
  ] };
  armNextScriptedShot(stubGame, drillData);
  assert.equal(stubGame.drillForcedShot.hitter, stubGame.players[0]);
  assert.equal(stubGame.drillForcedShot.receiver, stubGame.players[2]);
});

/* ---------------------------- validateDrill: roster/script shape ---------------------------- */

test('validateDrill: a P1<->P3 back-and-forth validates cleanly at any x position (no zone constraint)', () => {
  // Both P1 and P3 authored at the SAME x (a real down-the-line lane) and
  // targeted in both directions — this used to be rejected by a since-
  // removed zone-sign check (P1 and P3's x-zones are opposite, so a shared
  // column could never satisfy both). Fixed at the source: game.js's
  // _checkContacts/_moveCPU now override the engine's x-zone contact
  // assignment whenever a drillForcedShot is armed, so a scripted target
  // always receives it regardless of position. P4 included so P3's team
  // has a real partner (2-player team) — exactly the case that used to fail.
  const drill = {
    startPositions: { P1: { x: 1.5, z: 7.5 }, P2: { x: -0.5, z: 2.0 }, P3: { x: 1.5, z: -7.5 }, P4: { x: -1.5, z: -6.7 } },
    script: [
      { hitter: 'P1', shotType: 'drive', target: 'P3' },
      { hitter: 'P3', shotType: 'drop', target: 'P1' }
    ]
  };
  assert.deepEqual(validateDrill(drill), []);
});

test('validateDrill: catches a shot aimed at your own partner (same team) instead of an opponent', () => {
  const brokenDrill = {
    // P3 included so the roster itself is otherwise valid (a far-side
    // player exists) — isolates this test to just the same-team check.
    startPositions: { P1: { x: 1.5, z: 7.5 }, P2: { x: -0.5, z: 2.0 }, P3: { x: -1.5, z: -7.5 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P2' }] // P1/P2 are both near-team partners
  };
  const errors = validateDrill(brokenDrill);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /partners/);
});

test('validateDrill: catches a shot targeting yourself with a distinct message from the partner case', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 7.5 }, P3: { x: -1.5, z: -7.5 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P1' }]
  };
  const errors = validateDrill(drill);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /cannot target themselves/);
});

test('validateDrill: catches a missing side (no near or no far player)', () => {
  const noFar = { startPositions: { P1: { x: 1.5, z: 7.5 } }, script: [] };
  const errorsNoFar = validateDrill(noFar);
  assert.ok(errorsNoFar.some(e => /no far-side player/.test(e)));

  const noNear = { startPositions: { P3: { x: -1.5, z: -7.5 } }, script: [] };
  const errorsNoNear = validateDrill(noNear);
  assert.ok(errorsNoNear.some(e => /no near-side player/.test(e)));
});

test('validateDrill: catches P2 without P1, and P4 without P3 (anchor rule)', () => {
  const p2NoP1 = { startPositions: { P2: { x: -0.5, z: 2.0 }, P3: { x: -1.5, z: -7.5 } }, script: [] };
  assert.ok(validateDrill(p2NoP1).some(e => /P2 is present without P1/.test(e)));

  const p4NoP3 = { startPositions: { P1: { x: 1.5, z: 7.5 }, P4: { x: 1.5, z: -6.7 } }, script: [] };
  assert.ok(validateDrill(p4NoP3).some(e => /P4 is present without P3/.test(e)));
});

test('validateDrill: catches a script entry referencing a slot absent from the roster', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 7.5 }, P3: { x: -1.5, z: -7.5 } }, // no P4
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P4' }]
  };
  const errors = validateDrill(drill);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not in this drill's roster/);
});

test('validateDrill: catches an empty script (would otherwise hang forever at Setup)', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 7.5 }, P3: { x: -1.5, z: -7.5 } },
    script: []
  };
  const errors = validateDrill(drill);
  assert.ok(errors.some(e => /has no shots/.test(e)));
});

test('validateDrill: catches a typo\'d/unrecognized shotType instead of silently falling back to \'drive\' at runtime', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 7.5 }, P3: { x: -1.5, z: -7.5 } },
    script: [{ hitter: 'P1', shotType: 'drivee', target: 'P3' }]
  };
  const errors = validateDrill(drill);
  assert.ok(errors.some(e => /not a recognized shot type/.test(e)));
});

test('validateDrill: catches an unrecognized startPositions key (typo\'d/mis-cased slot)', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 7.5 }, P3: { x: -1.5, z: -7.5 }, p2: { x: 0, z: 3 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3' }]
  };
  const errors = validateDrill(drill);
  assert.ok(errors.some(e => /"p2" is not a recognized slot/.test(e)));
});

test('validateDrill: catches a startPositions value that fails to resolve (malformed grid coord)', () => {
  const drill = {
    // 'f10' (lowercase) still resolves leniently, but 'Z99' does not.
    startPositions: { P1: 'Z99', P3: { x: -1.5, z: -7.5 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3' }]
  };
  const errors = validateDrill(drill);
  assert.ok(errors.some(e => /P1 has an invalid position/.test(e)));
});

test('validateDrill: two active players too close together are flagged', () => {
  const drill = {
    startPositions: { P1: { x: 0, z: 3 }, P2: { x: 0.2, z: 3.1 }, P3: { x: 0, z: -3 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3' }]
  };
  const errors = validateDrill(drill);
  assert.ok(errors.some(e => /too close together/.test(e)));
});

test('validateDrill: catches a start position on the wrong side of the net', () => {
  const drill = {
    startPositions: { P1: { x: 0, z: -3 }, P3: { x: 0, z: -3 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3' }]
  };
  const errors = validateDrill(drill);
  assert.ok(errors.some(e => /P1 is on the wrong side/.test(e)));
});

test('validateDrill: catches a players count that disagrees with startPositions', () => {
  const drill = {
    players: 4,
    startPositions: { P1: { x: 1.5, z: 7.5 }, P3: { x: -1.5, z: -7.5 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3' }]
  };
  const errors = validateDrill(drill);
  assert.ok(errors.some(e => /players: says 4/.test(e)));
});

test('validateDrill: catches a broken receiver chain where the next hitter is not the previous target', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 7.5 }, P2: { x: -1.5, z: 4 }, P3: { x: -1.5, z: -7.5 }, P4: { x: 1.5, z: -4 } },
    script: [
      { hitter: 'P1', shotType: 'drive', target: 'P3' },
      { hitter: 'P4', shotType: 'dink', target: 'P1' }
    ]
  };
  const errors = validateDrill(drill);
  assert.ok(errors.some(e => /does not match shot 1 hitter/.test(e)));
});

test('validateDrill: accepts v2 receiver plus explicit landing on receiver side', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 6.5 }, P3: { x: -1.5, z: -6.5 }, P4: { x: 1.5, z: -4 } },
    script: [
      { hitter: 'P1', receiver: 'P4', shotType: 'lob', landing: { x: 2.4, z: -6.2 } },
      { hitter: 'P4', receiver: 'P1', shotType: 'drop', landing: { x: 1.2, z: 2.4 } }
    ]
  };
  assert.deepEqual(validateDrill(drill), []);
});

test('validateDrill: catches v2 landing on the wrong side of the net', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 6.5 }, P3: { x: -1.5, z: -6.5 } },
    script: [
      { hitter: 'P1', receiver: 'P3', shotType: 'lob', landing: { x: 0, z: 4 } }
    ]
  };
  const errors = validateDrill(drill);
  assert.ok(errors.some(e => /landing is on the wrong side/.test(e)));
});

test('validateDrill: catches malformed v2 landing coords', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 6.5 }, P3: { x: -1.5, z: -6.5 } },
    script: [
      { hitter: 'P1', receiver: 'P3', shotType: 'lob', landing: 'Z99' }
    ]
  };
  const errors = validateDrill(drill);
  assert.ok(errors.some(e => /landing has an invalid position/.test(e)));
});

test('validateDrill: catches v2 landing outside the court', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 6.5 }, P3: { x: -1.5, z: -6.5 } },
    script: [
      { hitter: 'P1', receiver: 'P3', shotType: 'lob', landing: { x: 4, z: -6 } }
    ]
  };
  const errors = validateDrill(drill);
  assert.ok(errors.some(e => /must be inside the court/.test(e)));
});

test('validateDrill: catches v2 target/receiver disagreement', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 6.5 }, P3: { x: -1.5, z: -6.5 }, P4: { x: 1.5, z: -4 } },
    script: [
      { hitter: 'P1', target: 'P3', receiver: 'P4', shotType: 'lob', landing: { x: 2.4, z: -6.2 } }
    ]
  };
  const errors = validateDrill(drill);
  assert.ok(errors.some(e => /target and receiver disagree/.test(e)));
});

test('validateDrill: does not throw on a non-array script or non-array steps (defensive)', () => {
  assert.doesNotThrow(() => validateDrill({ startPositions: { P1: { x: 0, z: 3 }, P3: { x: 0, z: -3 } }, script: null }));
});

/* ---------------------------- gridToWorld: malformed input ---------------------------- */

test('gridToWorld: accepts a lowercase column letter leniently', () => {
  assert.deepEqual(gridToWorld('f10'), gridToWorld('F10'));
});

test('gridToWorld: returns null (not a fallback coordinate) for a malformed coord', () => {
  assert.equal(gridToWorld('I5'), null, 'column out of A-H range');
  assert.equal(gridToWorld('A11'), null, 'row out of 1-10 range');
  assert.equal(gridToWorld('A0'), null, 'row 0 is out of range');
  assert.equal(gridToWorld(' F5'), null, 'leading whitespace rejected');
  assert.equal(gridToWorld('F5 '), null, 'trailing whitespace rejected');
  assert.equal(gridToWorld('F5.5'), null, 'non-integer row rejected');
  assert.equal(gridToWorld('F'), null, 'missing row rejected');
  assert.equal(gridToWorld(''), null);
  assert.equal(gridToWorld(null), null);
});

test('normalizeDrill: a malformed grid string does NOT silently become the center of the net', () => {
  const drill = normalizeDrill({ startPositions: { P1: 'Z99', P3: 'F1' }, script: [] });
  assert.equal(drill.startPositions.P1, null, 'stays null, not {x:0,z:0}, so validateDrill can catch it');
});

test('normalizeDrill: guards against a malformed/null steps entry instead of throwing at module load', () => {
  assert.doesNotThrow(() => normalizeDrill({
    startPositions: { P1: 'F10', P3: 'F1' }, script: [], steps: [null, { title: 'ok', desc: '' }]
  }));
});

/* ------------------------- drill movement cues ------------------------- */

test('normalizeDrill: resolves a grid-coord moves[].to the same way startPositions does, leaves raw {x,z} untouched', () => {
  const drill = normalizeDrill({
    startPositions: { P1: 'F10', P3: 'F1' },
    script: [
      { hitter: 'P1', shotType: 'drive', target: 'P3', moves: [
        { player: 'P1', to: 'F8' },
        { player: 'P3', to: { x: -1.2, z: 3.0 } }
      ] }
    ]
  });
  const moves = drill.script[0].moves;
  assert.deepEqual(moves[0].to, { x: 1.524, z: 4.0 }, 'grid coord F8 resolves via gridToWorld');
  assert.deepEqual(moves[1].to, { x: -1.2, z: 3.0 }, 'raw {x,z} passes through unchanged');
});

test('normalizeDrill: resolves a grid-coord script landing', () => {
  const drill = normalizeDrill({
    startPositions: { P1: 'F10', P3: 'F1' },
    script: [
      { hitter: 'P1', receiver: 'P3', shotType: 'lob', landing: 'G2' }
    ]
  });
  assert.deepEqual(drill.script[0].landing, gridToWorld('G2'));
});

test('normalizeDrill: resolves v2 players directive targets', () => {
  const drill = normalizeDrill({
    startPositions: { P1: 'F10', P3: 'F1' },
    script: [
      { hitter: 'P1', target: 'P3', shotType: 'drive', players: {
        P1: { to: 'F8', behavior: 'recover', arriveBy: 'bounce' },
        P3: { behavior: 'hold' }
      } }
    ]
  });
  assert.deepEqual(drill.script[0].players.P1.to, gridToWorld('F8'));
  assert.equal(drill.script[0].players.P1.behavior, 'recover');
  assert.equal(drill.script[0].players.P3.behavior, 'hold');
});

test('normalizeDrill: a beat with no moves array is left untouched', () => {
  const drill = normalizeDrill({
    startPositions: { P1: 'F10', P3: 'F1' },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3' }]
  });
  assert.equal(drill.script[0].moves, undefined);
});

test('validateDrill: catches a moves[].player not in the roster', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 7.5 }, P3: { x: -1.5, z: -7.5 } }, // no P4
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3', moves: [{ player: 'P4', to: { x: 0, z: -5 } }] }]
  };
  const errors = validateDrill(drill);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /is not in this drill's roster/);
});

test('validateDrill: catches a moves[].to that is missing or non-numeric', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 7.5 }, P3: { x: -1.5, z: -7.5 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3', moves: [{ player: 'P1', to: null }] }]
  };
  const errors = validateDrill(drill);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /has no valid `to` position/);
});

test('validateDrill: catches a moves[].to wildly outside the court', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 7.5 }, P3: { x: -1.5, z: -7.5 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3', moves: [{ player: 'P1', to: { x: 40, z: 2 } }] }]
  };
  const errors = validateDrill(drill);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unreasonably far outside the court/);
});

test('validateDrill: catches duplicate moves for the same player on one shot', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 7.5 }, P3: { x: -1.5, z: -7.5 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3', moves: [
      { player: 'P1', to: { x: 0, z: 2.0 } },
      { player: 'P1', to: { x: 1, z: 2.0 } }
    ] }]
  };
  const errors = validateDrill(drill);
  assert.ok(errors.some(e => /already has a move cue/.test(e)));
});

test('validateDrill: catches a move target on the wrong side of the net', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 7.5 }, P3: { x: -1.5, z: -7.5 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3', moves: [{ player: 'P1', to: { x: 0, z: -2 } }] }]
  };
  const errors = validateDrill(drill);
  assert.ok(errors.some(e => /wrong side of the net/.test(e)));
});

test('validateDrill: accepts v2 players directives with behavior and arriveBy metadata', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 7.5 }, P2: { x: -0.5, z: 2.0 }, P3: { x: -1.5, z: -7.5 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3', players: {
      P1: { to: { x: 0, z: 2.0 }, behavior: 'recover', arriveBy: 'bounce' },
      P2: { to: { x: 1.0, z: 1.5 }, behavior: 'shadow', arriveBy: 'contact' },
      P3: { behavior: 'hold' }
    } }]
  };
  assert.deepEqual(validateDrill(drill), []);
});

test('validateDrill: catches v2 players directive problems', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 7.5 }, P3: { x: -1.5, z: -7.5 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3', players: {
      P2: { to: { x: 0, z: 2.0 } },
      P1: { to: { x: 0, z: -2.0 }, behavior: 'teleport', arriveBy: 'yesterday' },
      P3: { behavior: 'shadow' }
    } }]
  };
  const errors = validateDrill(drill);
  assert.ok(errors.some(e => /player P2: is not in this drill's roster/.test(e)));
  assert.ok(errors.some(e => /behavior "teleport"/.test(e)));
  assert.ok(errors.some(e => /arriveBy "yesterday"/.test(e)));
  assert.ok(errors.some(e => /target is on the wrong side/.test(e)));
  assert.ok(errors.some(e => /player P3: has no valid `to` position/.test(e)));
});

test('validateDrill: catches mixing legacy moves and v2 players for the same player', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 7.5 }, P3: { x: -1.5, z: -7.5 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3',
      players: { P1: { to: { x: 0, z: 2.0 } } },
      moves: [{ player: 'P1', to: { x: 1, z: 2.0 } }]
    }]
  };
  const errors = validateDrill(drill);
  assert.ok(errors.some(e => /also has a v2 players directive/.test(e)));
});

test('validateDrill: a well-formed moves cue on a non-hitter (partner poach) validates clean', () => {
  const drill = {
    startPositions: { P1: { x: 1.5, z: 7.5 }, P2: { x: -0.5, z: 2.0 }, P3: { x: -1.5, z: -7.5 } },
    script: [{ hitter: 'P1', shotType: 'drive', target: 'P3', moves: [
      { player: 'P1', to: { x: 0, z: 2.0 } },  // self-recovery
      { player: 'P2', to: { x: 1.0, z: 1.5 } } // partner poach cue
    ] }]
  };
  assert.deepEqual(validateDrill(drill), []);
});

test('armMovesForBeat: arms drillForcedMoves for each named player from the beat', () => {
  const stubGame = stubDrillGame();
  stubGame.drillForcedMoves = {};
  armMovesForBeat(stubGame, { hitter: 'P1', shotType: 'drive', target: 'P3', moves: [
    { player: 'P1', to: { x: 0, z: 2.0 } },
    { player: 'P2', to: { x: 1.0, z: 1.5 } }
  ] });
  assert.deepEqual(stubGame.drillForcedMoves.P1, { x: 0, z: 2.0, behavior: 'move', arriveBy: null });
  assert.deepEqual(stubGame.drillForcedMoves.P2, { x: 1.0, z: 1.5, behavior: 'move', arriveBy: null });
  assert.equal(stubGame.drillForcedMoves.P3, undefined, 'a beat that doesn\'t name P3 leaves it alone');
});

test('armMovesForBeat: v2 players directives arm movement metadata and hold directives', () => {
  const stubGame = stubDrillGame();
  stubGame.drillForcedMoves = {};
  armMovesForBeat(stubGame, { players: {
    P1: { to: { x: 0, z: 2.0 }, behavior: 'recover', arriveBy: 'bounce' },
    P3: { behavior: 'hold', arriveBy: 'contact' }
  } });
  assert.deepEqual(stubGame.drillForcedMoves.P1, { x: 0, z: 2.0, behavior: 'recover', arriveBy: 'bounce' });
  assert.deepEqual(stubGame.drillForcedMoves.P3, { x: -1.5, z: -4.0, behavior: 'hold', arriveBy: 'contact' });
});

function deadlineStub() {
  const game = stubDrillGame();
  game.players.forEach(p => {
    p.vel = { x: 0, z: 0 };
    p.ai = AI.makeAI('normal');
  });
  game.ball = { flight: { T: 1.5, elapsed: 0 } };
  game.drillWarnings = [];
  return game;
}

test('armMovesForBeat: bounce deadlines use solver flight time and plan a reachable Movement.seek speed', () => {
  const game = deadlineStub();
  armMovesForBeat(game, { players: {
    P2: { to: { x: 0.5, z: 2.0 }, behavior: 'shadow', arriveBy: 'bounce' }
  } }, 0);
  const deadline = game.drillForcedMoves.P2.deadline;
  assert.equal(deadline.seconds, 1.5, 'deadline is anchored to ball.flight.T');
  assert.equal(deadline.reachable, true);
  assert.ok(deadline.speed > 0 && deadline.speed < game.players[1].ai.cfg.speed,
    'planner selects the least seek speed needed, below real player top speed');
  assert.deepEqual(game.drillWarnings, []);
});

test('armMovesForBeat: contact aliases use the centralized post-bounce contact estimate', () => {
  for (const arriveBy of ['contact', 'ball-contact', 'next-contact']) {
    const game = deadlineStub();
    armMovesForBeat(game, { players: {
      P2: { to: { x: 0.5, z: 2.0 }, behavior: 'shadow', arriveBy }
    } }, 1);
    assert.equal(game.drillForcedMoves.P2.deadline.seconds, 1.85, arriveBy + ' includes the contact allowance');
  }
});

test('armMovesForBeat: contact deadlines prefer the first hittable solver sample near landing', () => {
  const game = deadlineStub();
  game.ball.flight.landing = { x: 1, z: -4 };
  game.ball.flight.samples = [
    { x: 0, y: 3, z: 0, t: 0.4 },
    { x: 0.5, y: 1.8, z: -3.0, t: 1.1 },
    { x: 1, y: 0.037, z: -4, t: 1.5 }
  ];
  armMovesForBeat(game, { players: {
    P2: { to: { x: 0.5, z: 2.0 }, behavior: 'shadow', arriveBy: 'contact' }
  } }, 1);
  assert.equal(game.drillForcedMoves.P2.deadline.seconds, 1.1);
});

test('armMovesForBeat: unreachable deadlines keep real max speed and emit one authoring warning', () => {
  const game = deadlineStub();
  game.ball.flight.T = 0.1;
  armMovesForBeat(game, { players: {
    P2: { to: { x: 4.0, z: 6.0 }, behavior: 'crash', arriveBy: 'bounce' }
  } }, 2);
  const deadline = game.drillForcedMoves.P2.deadline;
  assert.equal(deadline.reachable, false);
  assert.equal(deadline.speed, game.players[1].ai.cfg.speed, 'unreachable cue runs at real top speed, never teleports');
  assert.equal(game.drillWarnings.length, 1);
  assert.match(game.drillWarnings[0], /shot 2 player P2: arriveBy bounce is unreachable/);
});

test('armMovesForBeat: a later beat naming only P2 leaves an outstanding P1 entry untouched (the persistence rule)', () => {
  const stubGame = stubDrillGame();
  stubGame.drillForcedMoves = {};
  armMovesForBeat(stubGame, { hitter: 'P1', shotType: 'drive', target: 'P3', moves: [
    { player: 'P1', to: { x: 0, z: 2.0 } }
  ] });
  armMovesForBeat(stubGame, { hitter: 'P3', shotType: 'drop', target: 'P1', moves: [
    { player: 'P2', to: { x: 1.0, z: 1.5 } }
  ] });
  assert.deepEqual(stubGame.drillForcedMoves.P1, { x: 0, z: 2.0, behavior: 'move', arriveBy: null }, 'P1\'s cue from the earlier beat still stands');
  assert.deepEqual(stubGame.drillForcedMoves.P2, { x: 1.0, z: 1.5, behavior: 'move', arriveBy: null });
});

test('armMovesForBeat: a beat naming the same player again overwrites the earlier target', () => {
  const stubGame = stubDrillGame();
  stubGame.drillForcedMoves = {};
  armMovesForBeat(stubGame, { moves: [{ player: 'P1', to: { x: 0, z: 2.0 } }] });
  armMovesForBeat(stubGame, { moves: [{ player: 'P1', to: { x: -1, z: 3.5 } }] });
  assert.deepEqual(stubGame.drillForcedMoves.P1, { x: -1, z: 3.5, behavior: 'move', arriveBy: null });
});

test('armMovesForBeat: a beat with no moves array is a no-op', () => {
  const stubGame = stubDrillGame();
  stubGame.drillForcedMoves = { P1: { x: 0, z: 2.0, behavior: 'move', arriveBy: null } };
  armMovesForBeat(stubGame, { hitter: 'P1', shotType: 'drive', target: 'P3' });
  assert.deepEqual(stubGame.drillForcedMoves.P1, { x: 0, z: 2.0, behavior: 'move', arriveBy: null });
});

/* ===================================================================
 * Engine: Game.prototype stub tests.
 *
 * _moveCPU/_checkPoach/_clampToSide are Game.prototype METHODS shared by
 * every mode (singles/doubles/practice/drill) — not extracted into their
 * own pure module (see the code-organization review: the shared functions
 * genuinely serve every mode, only specific BRANCHES are drill-only), so
 * they can't be imported and called standalone the normal way. But since
 * game.js itself has no top-level side effects that need a real DOM/WebGL
 * context (importing it is safe — only *constructing* a Game via `new
 * Game(...)` touches three.js/canvas), these methods can be called directly
 * against a hand-built plain-object stub via `Object.create(Game.prototype)`
 * — bypassing the constructor entirely — as long as the stub carries every
 * plain-data field the method under test actually reads. This gives real
 * regression coverage for the exact engine bugs this session found and
 * fixed (movement hold-vs-chase, the responsibility-zone override, the
 * poach final-beat gate) without needing a live browser for every check.
 * =================================================================== */

function makeStubPlayer(team, slot, drillSlot, x, z) {
  return {
    team, slot, drillSlot, pos: { x, z }, vel: { x: 0, z: 0 },
    ai: AI.makeAI('normal'),
    move: { kind: 'ready', target: { x: 0, z: 0 }, split: 0, plant: 0, lunge: 0 },
    power: Power.makeMeter(), stun: Power.makeStun()
  };
}

// A drill-mode Game stub with a real (pure) Rules.makeMatch/rally object —
// enough state for _moveCPU/_checkPoach/_clampToSide to run exactly as they
// do in the real engine, without any mesh/scene/three.js involved.
function makeDrillStub(players, opts) {
  opts = opts || {};
  const stub = Object.create(Game.prototype);
  stub.mode = 'drill';
  stub.match = Rules.makeMatch({ mode: 'doubles', server: opts.server || 'far' });
  stub.match.rally = Object.assign({
    phase: 'open', lastHitter: 'near', shots: 4, bouncesSinceHit: 0,
    doubleBounceOpen: true, serverInfo: null, live: true, faulted: false
  }, opts.rally);
  stub.ball = Object.assign({ live: true, vel: { x: 0, y: 0, z: -5 }, pos: { x: 0, y: 1, z: 0 } }, opts.ball);
  stub.players = players;
  stub.drillForcedShot = opts.drillForcedShot || null;
  stub.drillForcedMoves = opts.drillForcedMoves || {};
  stub._drillMaxShots = () => 4;
  return stub;
}

test('engine _moveCPU: a solo-team drill player who just hit holds their exact spot (not singles.js\'s recovery formula)', () => {
  const p1 = makeStubPlayer('near', 0, 'P1', -2.8, 6.4);
  const p3 = makeStubPlayer('far', 0, 'P3', -2.54, -6.4);
  const stub = makeDrillStub([p1, p3], { drillForcedShot: { hitter: p3 } });
  stub._moveCPU(p1, 0.016);
  assert.deepEqual(p1.move.target, { x: -2.8, z: 6.4 });
  assert.equal(p1.move.kind, 'hold');
});

test('engine _moveCPU: the armed forced hitter is NOT held — real AI drives them to intercept', () => {
  const p1 = makeStubPlayer('near', 0, 'P1', -2.8, 6.4);
  const p3 = makeStubPlayer('far', 0, 'P3', -2.54, -6.4);
  const stub = makeDrillStub([p1, p3], { drillForcedShot: { hitter: p3 } });
  stub._moveCPU(p3, 0.016);
  assert.notEqual(p3.move.kind, 'hold', 'the forced hitter chases the ball, never holds');
});

test('engine _moveCPU: a doubles-shaped team\'s off-ball partner also holds (regression: used to default to the kitchen-advance formula)', () => {
  const p1 = makeStubPlayer('near', 0, 'P1', -2.8, 6.4);
  const p2 = makeStubPlayer('near', 1, 'P2', 2.8, 6.4);
  const p3 = makeStubPlayer('far', 0, 'P3', -2.8, -6.4);
  const p4 = makeStubPlayer('far', 1, 'P4', 2.8, -6.4);
  const stub = makeDrillStub([p1, p2, p3, p4], { drillForcedShot: { hitter: p3 } });
  stub._moveCPU(p2, 0.016);
  assert.deepEqual(p2.move.target, { x: 2.8, z: 6.4 }, 'P2 holds its own corner, not a lane-center/kitchen-advance target');
  assert.equal(p2.move.kind, 'hold');
});

test('engine _moveCPU: a corner-placed partner whose zone-guess would misfire still holds (regression: the "wrong player chases" bug)', () => {
  // The raw x-zone _responsibleSlot check has no idea P2 is authored at the
  // "wrong" corner relative to real-serve-rotation assumptions — this test
  // pins the fix that suppresses that guess entirely while a beat is armed.
  const p1 = makeStubPlayer('near', 0, 'P1', -2.8, 6.4);
  const p2 = makeStubPlayer('near', 1, 'P2', 2.8, 6.4);
  const p3 = makeStubPlayer('far', 0, 'P3', -2.8, -6.4);
  const stub = makeDrillStub([p1, p2, p3], { drillForcedShot: { hitter: p3 }, ball: { live: true, vel: { x: 0, y: 0, z: -5 }, pos: { x: -2.8, y: 1, z: 0 } } });
  stub._moveCPU(p2, 0.016);
  assert.equal(p2.move.kind, 'hold', 'P2 never chases, regardless of what the raw zone math would have guessed');
});

test('engine _moveCPU: once the script is exhausted (drillForcedShot null), players still hold instead of dropping into free-play recovery', () => {
  const p1 = makeStubPlayer('near', 0, 'P1', -2.8, 6.4);
  const p3 = makeStubPlayer('far', 0, 'P3', -2.54, -6.4);
  const stub = makeDrillStub([p1, p3], { drillForcedShot: null });
  stub._moveCPU(p1, 0.016);
  assert.deepEqual(p1.move.target, { x: -2.8, z: 6.4 });
  assert.equal(p1.move.kind, 'hold', 'the rep stays fully scripted through the final ball flight; no free-play recovery');
});

test('engine _moveCPU: once the final scripted shot has been hit, the receiver no longer chases an unreturnable ball', () => {
  const p1 = makeStubPlayer('near', 0, 'P1', -2.8, 6.4);
  const p3 = makeStubPlayer('far', 0, 'P3', 2.43, -6.33);
  const stub = makeDrillStub([p1, p3], {
    drillForcedShot: null,
    ball: { live: true, vel: { x: 0, y: 0, z: 5 }, pos: { x: -2.6, y: 1, z: 0.2 } }
  });
  stub.drillHitCount = 4; // capped: the rep is visually finishing, not still playable
  stub._moveCPU(p1, 0.016);
  assert.deepEqual(p1.move.target, { x: -2.8, z: 6.4 });
  assert.equal(p1.move.kind, 'hold', 'the last receiver holds position instead of sprinting after a dead-end final ball');
});

test('engine _moveCPU: a moves cue always takes priority over the hold default', () => {
  const p1 = makeStubPlayer('near', 0, 'P1', -2.8, 6.4);
  const p3 = makeStubPlayer('far', 0, 'P3', -2.54, -6.4);
  const stub = makeDrillStub([p1, p3], {
    drillForcedShot: { hitter: p3 },
    drillForcedMoves: { P1: { x: -1.0, z: 5.0 } }
  });
  stub._moveCPU(p1, 0.016);
  assert.deepEqual(p1.move.target, { x: -1.0, z: 5.0 }, 'the cue target wins over holding at the current spot');
});

test('engine _moveCPU: an operational deadline uses its planned speed through Movement.seek', () => {
  const p1 = makeStubPlayer('near', 0, 'P1', -2.8, 6.4);
  const p3 = makeStubPlayer('far', 0, 'P3', -2.54, -6.4);
  const stub = makeDrillStub([p1, p3], {
    drillForcedShot: { hitter: p3 },
    drillForcedMoves: {
      P1: {
        x: 0, z: 5.0, behavior: 'recover', arriveBy: 'contact',
        deadline: { seconds: 2, speed: 1.0, reachable: true, minTime: 1.8 }
      }
    }
  });
  stub._moveCPU(p1, 0.1);
  assert.ok(Math.hypot(p1.vel.x, p1.vel.z) <= 1.001,
    'deadline speed caps the same real seek path instead of setting/interpolating position');
  assert.ok(p1.pos.x > -2.8 && p1.pos.x < 0, 'player advances physically without teleporting to the target');
});

test('engine _moveCPU: a stale cue is dropped the instant its player becomes the forced hitter (regression: used to fire one beat late)', () => {
  const p1 = makeStubPlayer('near', 0, 'P1', -2.8, 6.4);
  const p3 = makeStubPlayer('far', 0, 'P3', -2.54, -6.4);
  // P1 is now the armed hitter, but still carries a leftover cue from an
  // earlier beat (e.g. authored for P1's own prior-beat recovery).
  const stub = makeDrillStub([p1, p3], {
    drillForcedShot: { hitter: p1 },
    drillForcedMoves: { P1: { x: -1.0, z: 5.0 } }
  });
  stub._moveCPU(p1, 0.016);
  assert.equal(stub.drillForcedMoves.P1, undefined, 'stale cue is deleted immediately, not left to reactivate later');
});

test('engine _clampToSide: a solo-team drill player placed off-center is NOT clamped toward a fake service lane', () => {
  const p1 = makeStubPlayer('near', 0, 'P1', -2.8, 6.4);
  const p3 = makeStubPlayer('far', 0, 'P3', -2.54, -6.4);
  const stub = makeDrillStub([p1, p3], { drillForcedShot: { hitter: p3 } });
  stub._moveCPU(p1, 0.016); // runs _clampToSide internally at the end
  assert.equal(p1.pos.x, -2.8, 'x is untouched — not hard-clamped to within 0.7m of center');
});

test('engine _clampToSide: a doubles-shaped team\'s corner-placed player is NOT clamped toward a fake service lane (the original 4-corner bug)', () => {
  const p1 = makeStubPlayer('near', 0, 'P1', -2.8, 6.4);
  const p2 = makeStubPlayer('near', 1, 'P2', 2.8, 6.4);
  const p3 = makeStubPlayer('far', 0, 'P3', -2.8, -6.4);
  const stub = makeDrillStub([p1, p2, p3], { drillForcedShot: { hitter: p3 } });
  stub._moveCPU(p1, 0.016);
  assert.equal(p1.pos.x, -2.8, 'P1 at the left corner is not snapped toward center — this exact case used to jump 3+ meters');
});

test('engine _checkPoach: suppressed for a scripted beat, including the script\'s FINAL beat (regression: gate used to read already-nulled drillForcedShot)', () => {
  const p3 = makeStubPlayer('far', 0, 'P3', -1.524, -6.706);
  const p4 = makeStubPlayer('far', 1, 'P4', 0.508, -6.706);
  const stub = makeDrillStub([p3, p4]);
  stub.ball.flight = { samples: [], landing: { x: -1.524, z: 6.5 } };
  // wasScriptedShot=true simulates the caller having captured "this shot
  // was scripted" BEFORE armNextScriptedShot nulled drillForcedShot for the
  // final beat — exactly the case the old `if (this.drillForcedShot)` gate
  // got wrong.
  stub._checkPoach('near', true);
  assert.equal(stub.pendingPoach, undefined, 'no poach armed for a scripted beat, final or otherwise');
});

test('engine _checkPoach: still works normally for genuine (non-scripted) free-play', () => {
  const p3 = makeStubPlayer('far', 0, 'P3', -1.524, -6.706);
  const p4 = makeStubPlayer('far', 1, 'P4', 0.508, -6.706);
  p4.ai.cfg.smart = 1; p4.ai.cfg.react = 0; // maximize the odds AI.checkPoach fires, for a deterministic-ish check
  const stub = makeDrillStub([p3, p4], { drillForcedShot: null });
  stub.ball.flight = { samples: [{ x: -1.524, z: 0, t: 0 }, { x: -1.2, z: -3, t: 0.2 }], landing: { x: -1.2, z: -6.7 } };
  // Not asserting pendingPoach gets set (AI.checkPoach's real geometry/
  // timing check is difficulty/RNG-shaped and out of scope here) — only
  // that passing wasScriptedShot=false does not hit the new early-return,
  // i.e. execution reaches the real partner-selection logic without
  // throwing.
  assert.doesNotThrow(() => stub._checkPoach('near', false));
});

test('engine _checkContacts: the human-poach override is excluded in drill mode, even if swingWindow is somehow armed (defensive — currently latent since main.js never calls setInput() for a drill Game)', () => {
  // players[0] (P1) is NOT the scripted hitter for this beat (P2 is), but is
  // deliberately placed within reach of the ball too — exactly the geometry
  // that would let the (mode-unaware) human-poach override in _checkContacts
  // steal the contact from P2 if this drill-mode guard were ever removed or
  // bypassed. swingWindow/swingUsed are set directly (not via a real
  // game.input, which drill mode never wires up) specifically to prove the
  // guard holds even if that separate invariant (in main.js) is ever broken.
  const p1 = makeStubPlayer('near', 0, 'P1', 0, 3.0);
  const p2 = makeStubPlayer('near', 1, 'P2', 0.3, 3.0);
  const p3 = makeStubPlayer('far', 0, 'P3', 0, -3.0);
  const stub = makeDrillStub([p1, p2, p3], {
    drillForcedShot: { hitter: p2 },
    rally: { lastHitter: 'far' }, // the ball is INCOMING to 'near' — must not equal the receiving team
    ball: { live: true, vel: { x: 0, y: -1, z: 5 }, pos: { x: 0.1, y: 0.5, z: 3.0 } }
  });
  stub.swingWindow = 1;
  stub.swingUsed = false;
  p2.aiSwingTimer = 0.001; p2.aiReactTarget = 0; // guarantee _cpuHit fires this call
  let dispatchedTo = null;
  stub._cpuHit = function (p) { dispatchedTo = p; };
  stub._hit = function (p) { dispatchedTo = p; };
  stub._checkContacts(0.016);
  assert.equal(dispatchedTo, p2, 'the scripted hitter (P2) receives the contact, not players[0] (P1) via the human-poach path');
});

test('DrillDirector.resetRep: zeroes power/stun for every active player (defensive — currently latent since drills hardcode superMode:\'off\')', () => {
  const p1 = makeStubPlayer('near', 0, 'P1', 0, 0);
  const p3 = makeStubPlayer('far', 0, 'P3', 0, 0);
  p1.power.charge = 0.9; p1.power.armed = true;
  p1.stun.phase = 'stunned';
  const stub = makeDrillStub([p1, p3]);
  resetRep(stub, { startPositions: { P1: { x: -2, z: 5 }, P3: { x: -2, z: -5 } } });
  assert.equal(p1.power.charge, 0, 'power charge reset');
  assert.equal(p1.power.armed, false, 'armed flag reset');
  assert.equal(p1.stun.phase, 'none', 'stun reset');
});

report();
