import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

async function bytes(path) {
  return readFile(new URL(path, root));
}

test("page exposes the reduced Quest VR surface", async () => {
  const html = await source("index.html");
  assert.match(html, /id="enterVrButton"/);
  assert.match(html, /Photon double band/);
  assert.match(html, /Position · r = 3\.25M/);
  assert.match(html, /Both eyes · independent ray transfer/);
  assert.doesNotMatch(html, /Left stick · radial \/ orbit/);
  assert.doesNotMatch(html, /recordButton|production rendering|cinematic/i);
});

test("WebXR renderer uses a loop-free stereo transfer-table shader", async () => {
  const renderer = await source("js/webgl.js");
  const shader = await source("shaders/schwarzschild-lut-xr.frag");
  assert.match(renderer, /makeXRCompatible/);
  assert.match(renderer, /new window\.XRWebGLLayer/);
  assert.match(renderer, /renderXR\(viewStates/);
  assert.match(renderer, /this\.xrProgram/);
  assert.match(renderer, /schwarzschild-transfer-v1\.bin/);
  assert.match(renderer, /RGBA32F/);
  assert.match(renderer, /fixedFoveation\s*=\s*0\.65/);
  assert.match(shader, /uInverseProjection/);
  assert.match(shader, /uEyeRotation/);
  assert.match(shader, /uRayTransfer/);
  assert.match(shader, /uPhotonCrossing/);
  assert.match(shader, /texelFetch/);
  assert.match(shader, /PHOTON_RHO/);
  assert.match(shader, /SKY_BRIGHTNESS\s*=\s*0\.5/);
  assert.doesNotMatch(shader, /opticalAcceleration|HARD_MAX_STEPS|for\s*\(/);
});

test("deployable client is synchronized with every active source asset", async () => {
  const paths = [
    "index.html",
    "styles.css",
    "js/camera.js",
    "js/main.js",
    "js/webgl.js",
    "js/xr.js",
    "shaders/fullscreen.vert",
    "shaders/fxaa.frag",
    "shaders/rcas.frag",
    "shaders/schwarzschild-lut-xr.frag",
    "shaders/schwarzschild-vr.frag",
  ];
  for (const path of paths) {
    assert.equal(
      await source(path),
      await source(`dist/client/${path}`),
      `${path} differs from its deployable copy`,
    );
  }
  assert.deepEqual(
    await bytes("assets/schwarzschild-transfer-v1.bin"),
    await bytes("dist/client/assets/schwarzschild-transfer-v1.bin"),
    "transfer-table binary differs from its deployable copy",
  );
});
