import assert from "node:assert/strict";
import test from "node:test";

import {
  BlackHoleXRRig,
  QuestControllerInput,
  XR_METERS_TO_M,
  applyOrbitalDisplacement,
  createXRViewState,
  invertMat4,
} from "../js/xr.js";

const EPSILON = 1e-5;

function close(actual, expected, tolerance = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("orbital displacement follows a black-hole-centered constant-radius arc", () => {
  const position = new Float32Array([0, 1.35, 13.5]);
  const tangent = new Float32Array([-1, 0, 0]);
  const displacement = new Float32Array([-1, 0, 0]);
  const before = Math.hypot(position[0], position[2]);

  const angle = applyOrbitalDisplacement(
    position,
    position,
    displacement,
    tangent,
  );

  close(angle, 1 / 13.5);
  close(Math.hypot(position[0], position[2]), before);
  close(position[1], 1.35);
  assert.ok(position[0] < 0);
});

test("Quest Touch xr-standard mappings expose locomotion, boost, and edge reset", () => {
  const input = new QuestControllerInput();
  const left = {
    handedness: "left",
    gamepad: {
      axes: [0, 0, 0.55, -1],
      buttons: [{}, { pressed: true }, {}, {}, { pressed: true }],
    },
  };
  const right = {
    handedness: "right",
    gamepad: {
      axes: [0, 0, 0, -0.55],
      buttons: [],
    },
  };

  const first = input.read([left, right]);
  assert.equal(first.controllers, 2);
  assert.ok(first.radial > 0.99);
  assert.ok(first.angular > 0);
  assert.ok(first.polar > 0);
  assert.equal(first.boost, true);
  assert.equal(first.reset, true);
  assert.equal(input.read([left, right]).reset, false);
  assert.equal(input.read([]).reset, false);
  assert.equal(input.read([left]).reset, true);
});

test("XR rig preserves radius while orbiting and moves radially toward the hole", () => {
  const rig = new BlackHoleXRRig();
  const initialRadius = Math.hypot(...rig.position);
  const initialHorizontalRadius = Math.hypot(rig.position[0], rig.position[2]);

  for (let frame = 0; frame < 30; frame += 1) {
    rig.update(1 / 72, {
      angular: 1,
      polar: 0,
      radial: 0,
      boost: false,
      reset: false,
    });
  }

  close(
    Math.hypot(rig.position[0], rig.position[2]),
    initialHorizontalRadius,
    2e-4,
  );
  close(rig.position[1], 1.35, 2e-4);
  assert.ok(rig.orientation > 0);

  rig.reset();
  for (let frame = 0; frame < 30; frame += 1) {
    rig.update(1 / 72, {
      angular: 0,
      polar: 0,
      radial: 1,
      boost: false,
      reset: false,
    });
  }
  assert.ok(Math.hypot(...rig.position) < initialRadius);
});

test("XR view conversion keeps stereo offset and headset basis", () => {
  const identity = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
  assert.deepEqual([...invertMat4(identity)], [...identity]);

  const rig = new BlackHoleXRRig();
  const view = {
    transform: {
      position: { x: 0.032, y: 0, z: 0 },
      matrix: identity,
    },
    projectionMatrix: identity,
  };
  const state = createXRViewState(
    view,
    { x: 0, y: 0, z: 0 },
    rig,
  );

  close(state.position[0], 0.032 * XR_METERS_TO_M);
  close(state.position[1], rig.position[1]);
  close(state.position[2], rig.position[2]);
  assert.deepEqual([...state.right], [1, 0, 0]);
  assert.deepEqual([...state.up], [0, 1, 0]);
  close(state.forward[0], 0);
  close(state.forward[1], 0);
  close(state.forward[2], -1);
  close(state.fovY, Math.PI / 2);
});
