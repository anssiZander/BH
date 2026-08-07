import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOrbitalDisplacement,
  rotateAroundWorldY,
} from "../js/camera.js";

const RESET_POSITION = [0, 1.35, 13.5];

function normalized(vector) {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

function orbitTangent(position) {
  const horizontalRadius = Math.hypot(position[0], position[2]);
  return [
    -position[2] / horizontalRadius,
    0,
    position[0] / horizontalRadius,
  ];
}

test("A/D orbital displacement preserves radius exactly", () => {
  const tangent = orbitTangent(RESET_POSITION);
  const displacement = tangent.map((value) => value * 0.4);
  const result = new Float64Array(3);
  const angle = applyOrbitalDisplacement(
    result,
    RESET_POSITION,
    displacement,
    tangent,
  );

  assert.ok(angle > 0);
  assert.ok(Math.abs(Math.hypot(...result) - Math.hypot(...RESET_POSITION)) < 1e-12);
  assert.equal(result[1], RESET_POSITION[1]);
  assert.ok(result[0] < 0, "D should orbit toward negative world X at reset");
});

test("orbital movement rotates the camera with its radial frame", () => {
  const tangent = orbitTangent(RESET_POSITION);
  const displacement = tangent.map((value) => value * 0.55);
  const result = new Float64Array(3);
  const angle = applyOrbitalDisplacement(
    result,
    RESET_POSITION,
    displacement,
    tangent,
  );
  const initialForward = normalized(RESET_POSITION.map((value) => -value));
  const rotatedForward = new Float64Array(3);
  rotateAroundWorldY(rotatedForward, initialForward, angle);
  const expectedForward = normalized(Array.from(result, (value) => -value));

  for (let index = 0; index < 3; index += 1) {
    assert.ok(Math.abs(rotatedForward[index] - expectedForward[index]) < 1e-12);
  }
});

test("radial velocity combines with orbit without orbital radius drift", () => {
  const radius = Math.hypot(...RESET_POSITION);
  const inward = normalized(RESET_POSITION.map((value) => -value));
  const tangent = orbitTangent(RESET_POSITION);
  const radialDistance = 0.3;
  const orbitDistance = 0.45;
  const displacement = [0, 1, 2].map(
    (index) =>
      inward[index] * radialDistance
      + tangent[index] * orbitDistance,
  );
  const result = new Float64Array(3);
  applyOrbitalDisplacement(
    result,
    RESET_POSITION,
    displacement,
    tangent,
  );

  assert.ok(Math.abs(Math.hypot(...result) - (radius - radialDistance)) < 1e-12);
});
