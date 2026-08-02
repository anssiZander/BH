import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMERA_TRACK_GUARD_RADIUS,
  CameraTrackRecorder,
  cameraBasisToQuaternion,
  evaluateCameraTrack,
  productionFrameCount,
  productionFrameTime,
  quaternionToCameraBasis,
  slerpQuaternion,
  validateCameraTrack,
} from "../js/camera-track.js";
import { productionJitterPattern } from "../js/production-renderer.js";

const settings = Object.freeze({
  quality: "high",
  maxSteps: 416,
  baseStep: 0.09,
  fov: 68,
  gridBrightness: 0.8,
  shellCount: 8,
  exposure: 1.1,
  saturation: 1.18,
  stationRotationSpeed: 0.015,
  photonLabelOpacity: 1,
  lensing: true,
  gridVisible: true,
  spheresVisible: false,
  skyVisible: true,
  ringsVisible: true,
});

function cameraAt(position = [0, 0, 10], forward = [0, 0, -1]) {
  const up = [0, 1, 0];
  const right = [
    forward[1] * up[2] - forward[2] * up[1],
    forward[2] * up[0] - forward[0] * up[2],
    forward[0] * up[1] - forward[1] * up[0],
  ];
  return { position, forward, right, up };
}

function sample(time, x, orientation = [0, 0, 0, 1], fov = 68) {
  return {
    time,
    position: [x, 0, 10],
    orientation,
    fov,
    sceneTime: 100 + time,
  };
}

function trackFromSamples(samples) {
  return validateCameraTrack({
    schemaVersion: 1,
    id: "unit-track",
    createdAt: "2026-08-02T00:00:00.000Z",
    durationSeconds: samples.at(-1).time,
    sceneTimeAtStart: 100,
    settings,
    samples,
  });
}

test("camera basis and quaternion round-trip without axis inversion", () => {
  const invSqrt2 = Math.SQRT1_2;
  const camera = {
    right: [invSqrt2, 0, -invSqrt2],
    up: [0, 1, 0],
    forward: [-invSqrt2, 0, -invSqrt2],
  };
  const restored = quaternionToCameraBasis(cameraBasisToQuaternion(camera));
  for (const key of ["right", "up", "forward"]) {
    restored[key].forEach((value, index) =>
      assert.ok(Math.abs(value - camera[key][index]) < 1e-12)
    );
  }
});

test("SLERP takes the short path across the yaw wrap", () => {
  const quaternionForYaw = (degrees) => {
    const radians = degrees * Math.PI / 180;
    return [0, Math.sin(radians / 2), 0, Math.cos(radians / 2)];
  };
  const midpoint = quaternionToCameraBasis(
    slerpQuaternion(quaternionForYaw(179), quaternionForYaw(-179), 0.5),
  );
  assert.ok(midpoint.forward[2] > 0.9999);
  assert.ok(Math.abs(midpoint.forward[0]) < 1e-10);
});

test("time-aware smoothing preserves constant velocity with uneven samples", () => {
  const track = trackFromSamples([
    sample(0, 0),
    sample(0.01, 0.01),
    sample(1.01, 1.01),
    sample(1.02, 1.02),
  ]);
  for (const time of [0.02, 0.25, 0.5, 0.9, 1]) {
    const pose = evaluateCameraTrack(track, time, { smoothing: 1 });
    assert.ok(Math.abs(pose.position[0] - time) < 1e-10);
  }
});

test("smoothing preserves endpoints and never crosses the horizon guard", () => {
  const track = trackFromSamples([
    { ...sample(0, 0.536), position: [0.536, 0, 0] },
    { ...sample(1, -0.536), position: [-0.536, 0, 0] },
  ]);
  assert.deepEqual(evaluateCameraTrack(track, 0, { smoothing: 1 }).position, [0.536, 0, 0]);
  assert.deepEqual(evaluateCameraTrack(track, 1, { smoothing: 1 }).position, [-0.536, 0, 0]);
  for (let index = 0; index <= 1000; index += 1) {
    const pose = evaluateCameraTrack(track, index / 1000, { smoothing: 1 });
    assert.ok(Math.hypot(...pose.position) >= CAMERA_TRACK_GUARD_RADIUS - 1e-9);
  }
});

test("station-safety callback backs smoothing down toward the raw path", () => {
  const track = trackFromSamples([
    sample(0, 0),
    sample(1, 1),
    sample(2, 2),
    sample(3, -20),
  ]);
  const raw = evaluateCameraTrack(track, 1.5, { smoothing: 0 });
  const safe = evaluateCameraTrack(track, 1.5, {
    smoothing: 1,
    isPositionSafe: (position) => Math.abs(position[0] - raw.position[0]) < 0.05,
  });
  assert.ok(Math.abs(safe.position[0] - raw.position[0]) <= 0.051);
});

test("recorder uses real timestamps and validates a save/load round trip", () => {
  const recorder = new CameraTrackRecorder({ sampleIntervalSeconds: 0 });
  recorder.start({ camera: cameraAt(), fov: 68, sceneTime: 10, settings, now: 500 });
  recorder.sample({ camera: cameraAt([1, 0, 10]), fov: 69, sceneTime: 10.137, now: 637 });
  const track = recorder.stop({ camera: cameraAt([2, 0, 10]), fov: 70, sceneTime: 10.411, now: 911 });
  assert.equal(track.durationSeconds, 0.411);
  assert.equal(track.samples.at(-1).time, 0.411);
  const loaded = validateCameraTrack(JSON.parse(JSON.stringify(track)));
  assert.deepEqual(loaded.samples[0], track.samples[0]);
  assert.deepEqual(loaded.samples.at(-1), track.samples.at(-1));
});

test("validator rejects non-finite and wrongly typed settings", () => {
  const candidate = {
    schemaVersion: 1,
    id: "bad",
    createdAt: "2026-08-02T00:00:00.000Z",
    durationSeconds: 1,
    sceneTimeAtStart: 100,
    settings: { ...settings, baseStep: "bad" },
    samples: [sample(0, 0), sample(1, 1)],
  };
  assert.throws(() => validateCameraTrack(candidate), /baseStep must be a number/);
  assert.throws(
    () => validateCameraTrack({ ...candidate, settings, durationSeconds: Infinity }),
    /finite/,
  );
});

test("30 fps frame policy has no duplicated final endpoint", () => {
  assert.equal(productionFrameCount(1 / 60), 1);
  assert.equal(productionFrameCount(1 / 30), 1);
  assert.equal(productionFrameCount(1 / 30 + 1e-8), 2);
  assert.equal(productionFrameCount(1), 30);
  assert.equal(productionFrameCount(1.0001), 31);
  assert.equal(productionFrameTime(29), 29 / 30);
  assert.throws(() => productionFrameTime(0, 0), /greater than zero/);
});

test("Hammersley production jitter is deterministic and zero-centred", () => {
  for (const count of [1, 4, 8, 16]) {
    const first = productionJitterPattern(count);
    const second = productionJitterPattern(count);
    assert.deepEqual(first, second);
    const sum = first.reduce(
      (total, point) => [total[0] + point[0], total[1] + point[1]],
      [0, 0],
    );
    assert.ok(Math.abs(sum[0]) < 1e-12);
    assert.ok(Math.abs(sum[1]) < 1e-12);
  }
});
