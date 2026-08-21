import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("page exposes the reduced Quest VR surface", async () => {
  const html = await source("index.html");
  assert.match(html, /id="enterVrButton"/);
  assert.match(html, /Photon double band/);
  assert.match(html, /Left stick · radial \/ orbit/);
  assert.doesNotMatch(html, /recordButton|production rendering|cinematic/i);
});

test("WebXR renderer uses direct per-eye projection and the reduced shader", async () => {
  const renderer = await source("js/webgl.js");
  const shader = await source("shaders/schwarzschild-vr.frag");
  assert.match(renderer, /makeXRCompatible/);
  assert.match(renderer, /new window\.XRWebGLLayer/);
  assert.match(renderer, /renderXR\(viewStates/);
  assert.match(renderer, /fixedFoveation\s*=\s*0\.65/);
  assert.match(shader, /uInverseProjection/);
  assert.match(shader, /uEyeRotation/);
  assert.match(shader, /PHOTON_RHO/);
  assert.match(shader, /SKY_BRIGHTNESS\s*=\s*0\.5/);
  assert.match(shader, /if \(uXRView\) \{[\s\S]*one field evaluation/);
  assert.doesNotMatch(shader, /orbital_station\.glsl/);
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
    "shaders/schwarzschild-vr.frag",
  ];
  for (const path of paths) {
    assert.equal(
      await source(path),
      await source(`dist/client/${path}`),
      `${path} differs from its deployable copy`,
    );
  }
});
