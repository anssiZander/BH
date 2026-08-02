import { PRODUCTION_RENDER_PROFILE } from "./camera-track.js?v=20260802-production-v1";

const SHADER_PATHS = Object.freeze({
  vertex: "shaders/fullscreen.vert?v=20260802-production-v1",
  accumulate: "shaders/production_accumulate.frag?v=20260802-production-v1",
  resolve: "shaders/production_resolve.frag?v=20260802-production-v1",
});

const SAMPLE_OPTIONS = new Set(PRODUCTION_RENDER_PROFILE.sampleOptions);

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
  return response.text();
}

function compileShader(gl, type, source, label) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`WebGL could not create the ${label}.`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const details = gl.getShaderInfoLog(shader) || "Unknown compiler error.";
    gl.deleteShader(shader);
    throw new Error(`${label} failed to compile:\n${details}`);
  }
  return shader;
}

function linkProgram(gl, vertexShader, fragmentShader, label) {
  const program = gl.createProgram();
  if (!program) throw new Error(`WebGL could not create the ${label}.`);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const details = gl.getProgramInfoLog(program) || "Unknown linker error.";
    gl.deleteProgram(program);
    throw new Error(`${label} failed to link:\n${details}`);
  }
  return program;
}

function drainErrors(gl) {
  while (gl.getError() !== gl.NO_ERROR) {
    // Clear stale live-render errors before validating an export allocation.
  }
}

function errorName(gl, error) {
  const names = new Map([
    [gl.INVALID_ENUM, "INVALID_ENUM"],
    [gl.INVALID_VALUE, "INVALID_VALUE"],
    [gl.INVALID_OPERATION, "INVALID_OPERATION"],
    [gl.INVALID_FRAMEBUFFER_OPERATION, "INVALID_FRAMEBUFFER_OPERATION"],
    [gl.OUT_OF_MEMORY, "OUT_OF_MEMORY"],
    [gl.CONTEXT_LOST_WEBGL, "CONTEXT_LOST_WEBGL"],
  ]);
  return names.get(error) ?? `0x${error.toString(16)}`;
}

function assertNoGlError(gl, operation) {
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    throw new Error(`${operation} failed with WebGL ${errorName(gl, error)}.`);
  }
}

function createTarget(gl, width, height, internalFormat, label) {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) {
    if (texture) gl.deleteTexture(texture);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    throw new Error(`WebGL could not create the ${label} render target.`);
  }
  try {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, width, height);
    assertNoGlError(gl, `${label} texture storage`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    assertNoGlError(gl, `${label} framebuffer attachment`);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(
        `${label} framebuffer is incomplete (0x${status.toString(16)}).`,
      );
    }
    assertNoGlError(gl, `${label} allocation`);
    return { texture, framebuffer, label };
  } catch (error) {
    gl.deleteTexture(texture);
    gl.deleteFramebuffer(framebuffer);
    throw error;
  } finally {
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

function deleteTarget(gl, target) {
  if (!target) return;
  if (target.texture) gl.deleteTexture(target.texture);
  if (target.framebuffer) gl.deleteFramebuffer(target.framebuffer);
}

function radicalInverseBaseTwo(index) {
  let bits = index >>> 0;
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
  return bits * 2.3283064365386963e-10;
}

export function productionJitterPattern(sampleCount) {
  if (!SAMPLE_OPTIONS.has(sampleCount)) {
    throw new Error("Production samples must be 1, 4, 8, or 16 per frame.");
  }
  return Array.from({ length: sampleCount }, (_, index) => [
    (index + 0.5) / sampleCount - 0.5,
    radicalInverseBaseTwo(index) + 0.5 / sampleCount - 0.5,
  ]);
}

export function inspectProductionSupport(renderer, {
  width = PRODUCTION_RENDER_PROFILE.width,
  height = PRODUCTION_RENDER_PROFILE.height,
} = {}) {
  const gl = renderer?.gl;
  if (!gl || gl.isContextLost()) {
    return { supported: false, reason: "The WebGL2 context is unavailable or lost." };
  }
  if (!gl.getExtension("EXT_color_buffer_float")) {
    return {
      supported: false,
      reason: "This GPU does not expose EXT_color_buffer_float, required for linear RGBA16F accumulation.",
    };
  }
  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const maxRenderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
  const maxViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  if (
    width > maxTexture
    || height > maxTexture
    || width > maxRenderbuffer
    || height > maxRenderbuffer
    || width > maxViewport[0]
    || height > maxViewport[1]
  ) {
    return {
      supported: false,
      reason: `The GPU limit is too small for an exact ${width}×${height} render target.`,
      limits: { maxTexture, maxRenderbuffer, maxViewport: Array.from(maxViewport) },
    };
  }
  return {
    supported: true,
    limits: { maxTexture, maxRenderbuffer, maxViewport: Array.from(maxViewport) },
  };
}

function uniformLocations(gl, program, names) {
  return Object.fromEntries(names.map((name) => {
    const location = gl.getUniformLocation(program, name);
    if (location === null) {
      throw new Error(`The linked production shader is missing uniform ${name}.`);
    }
    return [name, location];
  }));
}

function flipRowsInPlace(pixels, width, height, scratch) {
  const rowBytes = width * 4;
  for (let top = 0, bottom = height - 1; top < bottom; top += 1, bottom -= 1) {
    const topOffset = top * rowBytes;
    const bottomOffset = bottom * rowBytes;
    scratch.set(pixels.subarray(topOffset, topOffset + rowBytes));
    pixels.copyWithin(topOffset, bottomOffset, bottomOffset + rowBytes);
    pixels.set(scratch, bottomOffset);
  }
}

function imageDataFromPixels(pixels, width, height) {
  const view = new Uint8ClampedArray(
    pixels.buffer,
    pixels.byteOffset,
    pixels.byteLength,
  );
  try {
    return new ImageData(view, width, height, { colorSpace: "srgb" });
  } catch {
    return new ImageData(view, width, height);
  }
}

function canvasToBlob(canvas) {
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type: "image/png" });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not encode the rendered frame as PNG."));
    }, "image/png");
  });
}

export class ProductionRenderSession {
  static async create(renderer, {
    width = PRODUCTION_RENDER_PROFILE.width,
    height = PRODUCTION_RENDER_PROFILE.height,
  } = {}) {
    if (
      width !== PRODUCTION_RENDER_PROFILE.width
      || height !== PRODUCTION_RENDER_PROFILE.height
    ) {
      throw new Error("Production output is fixed at exactly 2560×1440.");
    }
    const support = inspectProductionSupport(renderer, { width, height });
    if (!support.supported) throw new Error(support.reason);
    if (renderer.uniforms?.uProductionLinear == null) {
      throw new Error("The scene shader does not expose its production-linear output path.");
    }
    const gl = renderer.gl;
    const [vertexSource, accumulateSource, resolveSource] = await Promise.all([
      fetchText(SHADER_PATHS.vertex),
      fetchText(SHADER_PATHS.accumulate),
      fetchText(SHADER_PATHS.resolve),
    ]);
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource, "Production vertex shader");
    let accumulateShader;
    let resolveShader;
    let accumulateProgram;
    let resolveProgram;
    try {
      accumulateShader = compileShader(
        gl,
        gl.FRAGMENT_SHADER,
        accumulateSource,
        "Production accumulation shader",
      );
      resolveShader = compileShader(
        gl,
        gl.FRAGMENT_SHADER,
        resolveSource,
        "Production resolve shader",
      );
      accumulateProgram = linkProgram(
        gl,
        vertexShader,
        accumulateShader,
        "Production accumulation program",
      );
      resolveProgram = linkProgram(
        gl,
        vertexShader,
        resolveShader,
        "Production resolve program",
      );
    } catch (error) {
      if (accumulateProgram) gl.deleteProgram(accumulateProgram);
      if (resolveProgram) gl.deleteProgram(resolveProgram);
      throw error;
    } finally {
      gl.deleteShader(vertexShader);
      if (accumulateShader) gl.deleteShader(accumulateShader);
      if (resolveShader) gl.deleteShader(resolveShader);
    }
    let session;
    try {
      session = new ProductionRenderSession(
        renderer,
        accumulateProgram,
        resolveProgram,
        width,
        height,
        support,
      );
      renderer.beginProductionMode();
      session.liveTargetsSuspended = true;
      session.allocate();
      return session;
    } catch (error) {
      if (session) session.dispose();
      else {
        gl.deleteProgram(accumulateProgram);
        gl.deleteProgram(resolveProgram);
      }
      throw error;
    }
  }

  constructor(renderer, accumulateProgram, resolveProgram, width, height, support) {
    this.renderer = renderer;
    this.gl = renderer.gl;
    this.accumulateProgram = accumulateProgram;
    this.resolveProgram = resolveProgram;
    this.width = width;
    this.height = height;
    this.support = support;
    this.sampleTarget = null;
    this.averageTargets = [];
    this.finalTarget = null;
    this.disposed = false;
    this.liveTargetsSuspended = false;
    this.lastFrameIndex = -1;
    this.readback = new Uint8Array(width * height * 4);
    this.rowScratch = new Uint8Array(width * 4);
    this.accumulateUniforms = uniformLocations(this.gl, accumulateProgram, [
      "uCurrentSample",
      "uPreviousAverage",
      "uSampleIndex",
    ]);
    this.resolveUniforms = uniformLocations(this.gl, resolveProgram, [
      "uLinearAverage",
      "uResolution",
      "uExposure",
      "uSaturation",
      "uSharpness",
    ]);
    this.pngCanvas = typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });
    try {
      this.pngContext = this.pngCanvas.getContext("2d", {
        alpha: false,
        colorSpace: "srgb",
      });
    } catch {
      this.pngContext = null;
    }
    this.pngContext ||= this.pngCanvas.getContext("2d", { alpha: false });
    if (!this.pngContext) throw new Error("A 2D canvas is required to encode PNG frames.");
  }

  allocate() {
    const gl = this.gl;
    drainErrors(gl);
    try {
      this.sampleTarget = createTarget(
        gl,
        this.width,
        this.height,
        gl.RGBA16F,
        "linear sample",
      );
      this.averageTargets = [0, 1].map((index) => createTarget(
        gl,
        this.width,
        this.height,
        gl.RGBA16F,
        `linear accumulation ${index + 1}`,
      ));
      this.finalTarget = createTarget(
        gl,
        this.width,
        this.height,
        gl.RGBA8,
        "8-bit PNG resolve",
      );
    } catch (error) {
      deleteTarget(gl, this.sampleTarget);
      for (const target of this.averageTargets) deleteTarget(gl, target);
      deleteTarget(gl, this.finalTarget);
      this.sampleTarget = null;
      this.averageTargets = [];
      this.finalTarget = null;
      throw new Error(`Could not allocate the production render targets: ${error.message}`);
    }
  }

  assertUsable() {
    if (this.disposed) throw new Error("The production render session has ended.");
    if (this.gl.isContextLost()) {
      throw new Error("The WebGL context was lost during production rendering. Completed PNG files are still safe to resume.");
    }
  }

  bindScene(camera, settings, timeSeconds, jitter) {
    const gl = this.gl;
    const u = this.renderer.uniforms;
    const fovY = (settings.fov * Math.PI) / 180;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sampleTarget.framebuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.renderer.program);
    gl.bindVertexArray(this.renderer.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.renderer.skyTexture);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.renderer.photonLabelTexture);
    gl.uniform2f(u.uResolution, this.width, this.height);
    gl.uniform3fv(u.uCameraPosition, camera.position);
    gl.uniform3fv(u.uCameraForward, camera.forward);
    gl.uniform3fv(u.uCameraRight, camera.right);
    gl.uniform3fv(u.uCameraUp, camera.up);
    gl.uniform3fv(u.uPreviousCameraPosition, camera.position);
    gl.uniform3fv(u.uPreviousCameraForward, camera.forward);
    gl.uniform3fv(u.uPreviousCameraRight, camera.right);
    gl.uniform3fv(u.uPreviousCameraUp, camera.up);
    gl.uniform1f(u.uPreviousTime, timeSeconds);
    gl.uniform1f(u.uPreviousFovY, fovY);
    gl.uniform1i(u.uMotionValid, 0);
    gl.uniform1f(u.uTime, timeSeconds);
    gl.uniform1f(u.uStationRotationSpeed, settings.stationRotationSpeed);
    gl.uniform2f(u.uJitter, jitter[0], jitter[1]);
    gl.uniform1f(u.uFovY, fovY);
    gl.uniform1i(u.uMaxSteps, settings.maxSteps);
    gl.uniform1f(u.uBaseStep, settings.baseStep);
    gl.uniform1i(u.uLensing, settings.lensing ? 1 : 0);
    gl.uniform1i(u.uGridVisible, settings.gridVisible ? 1 : 0);
    gl.uniform1i(u.uSpheresVisible, settings.spheresVisible ? 1 : 0);
    gl.uniform1i(u.uSkyVisible, settings.skyVisible ? 1 : 0);
    gl.uniform1i(u.uRingsVisible, settings.ringsVisible ? 1 : 0);
    gl.uniform1f(u.uGridBrightness, settings.gridBrightness);
    gl.uniform1i(u.uShellCount, settings.shellCount);
    gl.uniform1f(u.uExposure, 1);
    gl.uniform1f(u.uSaturation, 1);
    gl.uniform1f(u.uPhotonLabelOpacity, settings.photonLabelOpacity);
    gl.uniform1i(u.uProductionLinear, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  accumulate(sampleIndex) {
    const gl = this.gl;
    const write = this.averageTargets[sampleIndex & 1];
    const read = this.averageTargets[1 - (sampleIndex & 1)];
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.framebuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.accumulateProgram);
    gl.bindVertexArray(this.renderer.vao);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.sampleTarget.texture);
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, read.texture);
    gl.uniform1i(this.accumulateUniforms.uCurrentSample, 6);
    gl.uniform1i(this.accumulateUniforms.uPreviousAverage, 7);
    gl.uniform1i(this.accumulateUniforms.uSampleIndex, sampleIndex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  resolve(sampleCount, settings) {
    const gl = this.gl;
    const average = this.averageTargets[(sampleCount - 1) & 1];
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.finalTarget.framebuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.resolveProgram);
    gl.bindVertexArray(this.renderer.vao);
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, average.texture);
    gl.uniform1i(this.resolveUniforms.uLinearAverage, 8);
    gl.uniform2f(this.resolveUniforms.uResolution, this.width, this.height);
    gl.uniform1f(this.resolveUniforms.uExposure, settings.exposure);
    gl.uniform1f(this.resolveUniforms.uSaturation, settings.saturation);
    gl.uniform1f(this.resolveUniforms.uSharpness, 0.09);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  renderFrame({ camera, settings, timeSeconds, frameIndex, samplesPerFrame }) {
    this.assertUsable();
    if (!Number.isInteger(frameIndex) || frameIndex < 0) {
      throw new Error("Production frame index must be a non-negative integer.");
    }
    if (!Number.isFinite(timeSeconds)) throw new Error("Production scene time must be finite.");
    const jitterPattern = productionJitterPattern(samplesPerFrame);
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DITHER);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.colorMask(true, true, true, true);
    for (let sampleIndex = 0; sampleIndex < samplesPerFrame; sampleIndex += 1) {
      this.bindScene(camera, settings, timeSeconds, jitterPattern[sampleIndex]);
      this.accumulate(sampleIndex);
    }
    this.resolve(samplesPerFrame, settings);
    assertNoGlError(gl, `production frame ${frameIndex}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.finalTarget.framebuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.readPixels(
      0,
      0,
      this.width,
      this.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.readback,
    );
    assertNoGlError(gl, `production frame ${frameIndex} readback`);
    flipRowsInPlace(this.readback, this.width, this.height, this.rowScratch);
    this.lastFrameIndex = frameIndex;
    return this.readback;
  }

  async encodeLastFramePng() {
    this.assertUsable();
    if (this.lastFrameIndex < 0) throw new Error("No production frame is ready to encode.");
    this.pngContext.putImageData(
      imageDataFromPixels(this.readback, this.width, this.height),
      0,
      0,
    );
    const blob = await canvasToBlob(this.pngCanvas);
    if (!blob || blob.type !== "image/png" || blob.size < 100) {
      throw new Error("The browser returned an invalid PNG frame.");
    }
    return blob;
  }

  presentLastFrame() {
    this.assertUsable();
    if (this.lastFrameIndex < 0) throw new Error("No production frame is ready to present.");
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.finalTarget.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(
      0,
      0,
      this.width,
      this.height,
      0,
      0,
      this.renderer.canvas.width,
      this.renderer.canvas.height,
      gl.COLOR_BUFFER_BIT,
      gl.LINEAR,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    assertNoGlError(gl, `production frame ${this.lastFrameIndex} preview`);
  }

  copyLastPixels() {
    return new Uint8Array(this.readback);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    const contextHealthy = !gl.isContextLost();
    if (contextHealthy) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.useProgram(null);
      gl.bindVertexArray(null);
    }
    deleteTarget(gl, this.sampleTarget);
    for (const target of this.averageTargets) deleteTarget(gl, target);
    deleteTarget(gl, this.finalTarget);
    this.sampleTarget = null;
    this.averageTargets = [];
    this.finalTarget = null;
    if (this.accumulateProgram) gl.deleteProgram(this.accumulateProgram);
    if (this.resolveProgram) gl.deleteProgram(this.resolveProgram);
    this.accumulateProgram = null;
    this.resolveProgram = null;
    if (this.liveTargetsSuspended && !gl.isContextLost()) {
      this.renderer.endProductionMode();
      this.liveTargetsSuspended = false;
    }
    if (contextHealthy) assertNoGlError(gl, "production renderer cleanup");
    this.readback = new Uint8Array(0);
    this.rowScratch = new Uint8Array(0);
    if (this.pngCanvas) {
      this.pngCanvas.width = 1;
      this.pngCanvas.height = 1;
    }
    this.pngContext = null;
    this.pngCanvas = null;
  }
}
