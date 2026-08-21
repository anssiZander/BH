import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const tableUrl = new URL(
  "../assets/schwarzschild-transfer-v1.bin",
  import.meta.url,
);

test("precomputed ray-transfer table has a finite validated payload", async () => {
  const bytes = await readFile(tableUrl);
  const header = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    64,
  );
  assert.equal(bytes.subarray(0, 7).toString("ascii"), "SLUTVR1");
  assert.equal(header.getUint32(8, true), 1);
  const width = header.getUint32(12, true);
  const height = header.getUint32(16, true);
  const channels = header.getUint32(20, true);
  const rhoMin = header.getFloat32(24, true);
  const rhoMax = header.getFloat32(28, true);
  const fixedArealRadius = header.getFloat32(36, true);
  const layers = header.getUint32(40, true);
  assert.equal(width, 4096);
  assert.equal(height, 35);
  assert.equal(channels, 4);
  assert.equal(layers, 2);
  assert.ok(rhoMin < 2.1328 && rhoMax > 2.1328);
  assert.ok(Math.abs(fixedArealRadius - 3.25) < 1e-6);
  assert.equal(bytes.byteLength, 64 + width * height * channels * layers * 4);

  const payload = new Float32Array(
    bytes.buffer,
    bytes.byteOffset + 64,
    width * height * channels * layers,
  );
  let escaped = 0;
  let captured = 0;
  for (let index = 0; index < payload.length; index += 1) {
    assert.ok(Number.isFinite(payload[index]), `non-finite float at ${index}`);
  }
  const centralRow = Math.round(
    ((2.132782218537319 - rhoMin) / (rhoMax - rhoMin)) * (height - 1),
  );
  for (let column = 0; column < width; column += 1) {
    const state = payload[(centralRow * width + column) * channels + 2];
    if (state > 0.5) escaped += 1;
    else captured += 1;
  }
  assert.ok(escaped > 0);
  assert.ok(captured > 0);

  const inwardOffset = centralRow * width * channels;
  const outwardOffset =
    (centralRow * width + width - 1) * channels;
  assert.equal(payload[inwardOffset + 2], 0);
  assert.equal(payload[outwardOffset + 2], 1);
  const crossingLayerOffset = width * height * channels;
  const crossingX = payload[crossingLayerOffset + inwardOffset];
  const crossingY = payload[crossingLayerOffset + inwardOffset + 1];
  assert.ok(Math.abs(Math.hypot(crossingX, crossingY) - 1) < 1e-4);

  const sampleEye = (eyeX) => {
    const eyeZ = 2.132782218537319;
    const rho = Math.hypot(eyeX, eyeZ);
    const radialX = eyeX / rho;
    const radialZ = eyeZ / rho;
    const radialCosine = radialX;
    const transverseX = 1 - radialCosine * radialX;
    const transverseZ = -radialCosine * radialZ;
    const transverseLength = Math.hypot(transverseX, transverseZ);
    const planeX = transverseX / transverseLength;
    const planeZ = transverseZ / transverseLength;
    const column = Math.round(
      (radialCosine * 0.5 + 0.5) * (width - 1),
    );
    const row = Math.round(
      ((rho - rhoMin) / (rhoMax - rhoMin)) * (height - 1),
    );
    const offset = (row * width + column) * channels;
    return {
      x: payload[offset] * radialX + payload[offset + 1] * planeX,
      z: payload[offset] * radialZ + payload[offset + 1] * planeZ,
      escaped: payload[offset + 2] > 0.5,
    };
  };
  const leftEye = sampleEye(-0.032 * 0.24);
  const rightEye = sampleEye(0.032 * 0.24);
  assert.ok(Number.isFinite(leftEye.x) && Number.isFinite(leftEye.z));
  assert.ok(Number.isFinite(rightEye.x) && Number.isFinite(rightEye.z));
  assert.ok(
    Math.hypot(leftEye.x - rightEye.x, leftEye.z - rightEye.z) > 1e-4,
    "left and right eye transfer directions unexpectedly collapsed",
  );
});
