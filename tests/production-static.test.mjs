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
