import assert from "node:assert/strict";
import test from "node:test";

import {
  FixedBlackHoleXRRig,
  XR_FIXED_AREAL_RADIUS,
  XR_FIXED_ISOTROPIC_RADIUS,
  XR_FRAMEBUFFER_SCALE,
  XR_METERS_TO_M,
  chooseXRTargetFrameRate,
  createXRViewState,
  invertMat4,
  isotropicToAreal,
} from "../js/xr.js";

const EPSILON = 1e-5;
const IDENTITY = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

function close(actual, expected, tolerance = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function viewAt(x, y = 0, z = 0) {
  return {
    transform: {
      position: { x, y, z },
      matrix: IDENTITY,
    },
    projectionMatrix: IDENTITY,
  };
}

test("fixed XR profile starts just outside the photon sphere at 72 Hz", () => {
  assert.equal(XR_FRAMEBUFFER_SCALE, 0.42);
  close(isotropicToAreal(XR_FIXED_ISOTROPIC_RADIUS), XR_FIXED_AREAL_RADIUS);
  assert.equal(XR_FIXED_AREAL_RADIUS, 3.25);
  assert.equal(chooseXRTargetFrameRate([60, 72, 80, 90, 120]), 72);
  assert.equal(chooseXRTargetFrameRate(new Float32Array([60, 80, 90])), 80);
  assert.equal(chooseXRTargetFrameRate([60]), null);
});

test("fixed XR rig cannot drift away from its lookup-table position", () => {
  const rig = new FixedBlackHoleXRRig();
  assert.deepEqual([...rig.position.slice(0, 2)], [0, 0]);
  close(rig.position[2], XR_FIXED_ISOTROPIC_RADIUS);
  close(rig.arealRadius, XR_FIXED_AREAL_RADIUS);
  rig.position.set([1, 2, 3]);
  rig.reset();
  close(rig.position[0], 0);
  close(rig.position[1], 0);
  close(rig.position[2], XR_FIXED_ISOTROPIC_RADIUS);
});

test("each WebXR eye keeps an independent physical stereo position", () => {
  assert.deepEqual([...invertMat4(IDENTITY)], [...IDENTITY]);
  const rig = new FixedBlackHoleXRRig();
  const initialViewerPosition = { x: 0, y: 0, z: 0 };
  const left = createXRViewState(
    viewAt(-0.032),
    initialViewerPosition,
    rig,
  );
  const right = createXRViewState(
    viewAt(0.032),
    initialViewerPosition,
    rig,
  );

  close(left.position[0], -0.032 * XR_METERS_TO_M);
  close(right.position[0], 0.032 * XR_METERS_TO_M);
  close(
    right.position[0] - left.position[0],
    0.064 * XR_METERS_TO_M,
  );
  close(left.position[2], XR_FIXED_ISOTROPIC_RADIUS);
  close(right.position[2], XR_FIXED_ISOTROPIC_RADIUS);
  assert.notEqual(left.position, right.position);
  assert.deepEqual([...right.right], [1, 0, 0]);
  assert.deepEqual([...right.up], [0, 1, 0]);
  close(right.forward[0], 0);
  close(right.forward[1], 0);
  close(right.forward[2], -1);
  close(right.fovY, Math.PI / 2);
});

test("small tracked head translations remain live around the fixed center", () => {
  const rig = new FixedBlackHoleXRRig();
  const state = createXRViewState(
    viewAt(0.05, 0.12, -0.08),
    { x: 0, y: 0, z: 0 },
    rig,
  );
  close(state.position[0], 0.05 * XR_METERS_TO_M);
  close(state.position[1], 0.12 * XR_METERS_TO_M);
  close(
    state.position[2],
    XR_FIXED_ISOTROPIC_RADIUS - 0.08 * XR_METERS_TO_M,
  );
});
