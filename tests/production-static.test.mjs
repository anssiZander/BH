import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function balanced(source, open, close) {
  let depth = 0;
  for (const character of source) {
    if (character === open) depth += 1;
    if (character === close) depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

test("runtime shader assembly retains one station injection marker", () => {
  const scene = read("shaders/schwarzschild.frag");
  const station = read("shaders/orbital_station.glsl");
  assert.equal(scene.split("/*__ORBITAL_STATION_GLSL__*/").length - 1, 1);
  const assembled = scene.replace("/*__ORBITAL_STATION_GLSL__*/", station);
  assert.ok(balanced(assembled, "{", "}"));
  assert.ok(balanced(assembled, "(", ")"));
  assert.match(assembled, /uniform bool uProductionLinear;/);
  assert.match(assembled, /if \(uProductionLinear\)/);
});

test("Dyson geometry is two continuous hemispheres with one equatorial gap", () => {
  const scene = read("shaders/schwarzschild.frag");
  const station = read("shaders/orbital_station.glsl");
  const html = read("index.html");
  assert.match(scene, /STATION_EQUATORIAL_GAP_HALF_ANGLE = 0\.125/);
  assert.match(scene, /stationHemisphereEnvelope/);
  assert.match(station, /STATION_HEMISPHERE_PHASES\[2\]/);
  assert.match(station, /continuous opaque hull/);
  assert.match(station, /STATION_DETAIL_LATITUDE_LIMIT/);
  assert.doesNotMatch(station, /STATION_BAND_PHASES|stationBandTransform/);
  assert.match(html, /Dyson hemispheres/);

  const photonRadius = (2 + Math.sqrt(3)) / 2;
  const resetTrajectoryLatitude = Math.atan2(1.35, 13.5);
  const boundaryClearance = photonRadius * Math.sin(
    0.125 - resetTrajectoryLatitude,
  );
  const rimRadius = 0.075 * photonRadius / 8;
  assert.ok(boundaryClearance - rimRadius > 0.018);
});

test("retired spherical grids have no shader or interface surface", () => {
  const scene = read("shaders/schwarzschild.frag");
  const html = read("index.html");
  const main = read("js/main.js");
  const webgl = read("js/webgl.js");
  for (const source of [scene, html, main, webgl]) {
    assert.doesNotMatch(source, /uGridVisible|uGridBrightness|gridVisibleInput|gridInput/);
  }
  assert.doesNotMatch(scene, /gridPipe|accumulateGridHit/);
});

test("live hemispheres use a bounded GPU path while production stays full fidelity", () => {
  const scene = read("shaders/schwarzschild.frag");
  const station = read("shaders/orbital_station.glsl");
  const main = read("js/main.js");
  const html = read("index.html");
  assert.match(scene, /if \(!uProductionLinear\) return 0\.88/);
  assert.match(scene, /if \(!uProductionLinear\) return 1\.0/);
  assert.match(scene, /stationRealtimeSurfaceMaterial/);
  assert.match(station, /uProductionLinear \|\| liveRimDetail/);
  assert.match(main, /const PRODUCTION_MAX_STEPS = 896/);
  assert.match(main, /medium: \{ maxSteps: 288, scale: 0\.64, maxPixels: 900_000 \}/);
  assert.match(main, /GPU_SAFE_MODE_STORAGE_KEY/);
  assert.match(html, /<option value="medium" selected>Medium<\/option>/);
});

test("production shaders are high precision WebGL2 linear passes", () => {
  const accumulate = read("shaders/production_accumulate.frag");
  const resolve = read("shaders/production_resolve.frag");
  assert.match(accumulate, /^#version 300 es/);
  assert.match(accumulate, /previous \+ \(current - previous\) \/ count/);
  assert.match(resolve, /^#version 300 es/);
  assert.match(resolve, /linearToSrgb/);
  assert.match(resolve, /uSharpness/);
  assert.match(resolve, /signedDither/);
  for (const source of [accumulate, resolve]) {
    assert.ok(balanced(source, "{", "}"));
    assert.ok(balanced(source, "(", ")"));
  }
});

test("all declared production uniforms have JavaScript bindings", () => {
  const scene = read("shaders/schwarzschild.frag");
  const accumulate = read("shaders/production_accumulate.frag");
  const resolve = read("shaders/production_resolve.frag");
  const webgl = read("js/webgl.js");
  const production = read("js/production-renderer.js");
  const names = (source) => [
    ...source.matchAll(/\buniform\s+\w+\s+(u\w+)\s*;/g),
  ].map((match) => match[1]);
  for (const name of names(scene)) assert.match(webgl, new RegExp(`"${name}"`));
  for (const name of [...names(accumulate), ...names(resolve)]) {
    assert.match(production, new RegExp(`"${name}"`));
  }
});

test("production renderer is independent from live recording and viewport timing", () => {
  const source = read("js/production-renderer.js");
  assert.doesNotMatch(source, /MediaRecorder|captureStream|requestAnimationFrame/);
  assert.match(source, /EXT_color_buffer_float/);
  assert.match(source, /MAX_TEXTURE_SIZE/);
  assert.match(source, /MAX_RENDERBUFFER_SIZE/);
  assert.match(source, /gl\.RGBA16F/);
  assert.match(source, /gl\.readPixels/);
  assert.match(source, /flipRowsInPlace/);
});

test("production UI advertises the fixed profile and non-production quick capture", () => {
  const html = read("index.html");
  assert.match(html, /Production render/);
  assert.match(html, /2560×1440 · 30 fps/);
  assert.match(html, /not production quality/);
  assert.match(html, /Test first 30/);
  assert.match(html, /Cancel after current frame/);
});
