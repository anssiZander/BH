const RUNTIME_ASSET_VERSION = "20260818-webxr-v1";
const runtimeAsset = (path) => `${path}?v=${RUNTIME_ASSET_VERSION}`;

const SHADER_PATHS = {
  vertex: runtimeAsset("shaders/fullscreen.vert"),
  fragment: runtimeAsset("shaders/schwarzschild-vr.frag"),
  fxaa: runtimeAsset("shaders/fxaa.frag"),
  rcas: runtimeAsset("shaders/rcas.frag"),
};

const SKY_TEXTURE_PATH = runtimeAsset("assets/galaxy_4k.jpg");
const MAX_HISTORY_FRAME_GAP = 0.12;
const TEMPORAL_HISTORY_WEIGHT = 0.9;
const RCAS_SHARPNESS = 0.18;
const ZERO_JITTER = [0, 0];
const ASSET_RETRY_DELAYS = [0, 350, 800, 1600, 3200, 5000];
// PC-VR keeps the complete ESO panorama when the desktop GPU supports it.
const MAX_SKY_TEXTURE_WIDTH = 6000;
const TARGET_SIZE_RETRY_FACTORS = [1, 0.75, 0.5];

function radicalInverse(index, base) {
  let value = 0;
  let fraction = 1 / base;
  let remaining = index;
  while (remaining > 0) {
    value += (remaining % base) * fraction;
    remaining = Math.floor(remaining / base);
    fraction /= base;
  }
  return value;
}

const TEMPORAL_JITTER = Array.from({ length: 360 }, (_, index) => [
  radicalInverse(index + 1, 2) - 0.5,
  radicalInverse(index + 1, 3) - 0.5,
]);

function shaderTypeName(gl, type) {
  return type === gl.VERTEX_SHADER ? "vertex" : "fragment";
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function assetName(url) {
  return url.split("?")[0].split("/").pop() || url;
}

async function retryAsset(url, operation, onRetry = () => {}) {
  let lastError = null;
  for (let attempt = 0; attempt < ASSET_RETRY_DELAYS.length; attempt += 1) {
    const delay = ASSET_RETRY_DELAYS[attempt];
    if (delay > 0) {
      onRetry(
        `Reconnecting to ${assetName(url)} · attempt ${attempt + 1}/${ASSET_RETRY_DELAYS.length}`,
      );
      await wait(delay);
    }
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
    }
  }

  const reason = lastError instanceof Error ? ` ${lastError.message}` : "";
  throw new Error(
    `Could not reach ${assetName(url)} after ${ASSET_RETRY_DELAYS.length} attempts.${reason} `
      + "If this is a local preview, restart Live Server and press Retry startup.",
  );
}

async function fetchText(url, onRetry) {
  return retryAsset(url, async () => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`The server returned HTTP ${response.status}.`);
    }
    return response.text();
  }, onRetry);
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Unknown shader compiler error.";
    gl.deleteShader(shader);
    throw new Error(`${shaderTypeName(gl, type)} shader failed to compile:\n${message}`);
  }
  return shader;
}

function linkProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Unknown program linker error.";
    gl.deleteProgram(program);
    throw new Error(`Shader program failed to link:\n${message}`);
  }
  return program;
}

async function loadImage(url, onRetry) {
  return retryAsset(url, (attempt) => new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image request failed."));
    const separator = url.includes("?") ? "&" : "?";
    image.src = `${url}${separator}attempt=${attempt}`;
  }), onRetry);
}

function createSkyTexture(gl, image) {
  const maximumTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const scale = Math.min(
    1,
    Math.min(MAX_SKY_TEXTURE_WIDTH, maximumTextureSize) / image.naturalWidth,
    maximumTextureSize / image.naturalHeight,
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  let source = image;

  if (width !== image.naturalWidth || height !== image.naturalHeight) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("Could not create the sky downsampling surface.");
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);
    source = canvas;
  }

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.SRGB8_ALPHA8,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    source,
  );
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { texture, width, height };
}

function createColorTarget(gl) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const framebuffer = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { texture, framebuffer };
}

function createSceneTarget(gl) {
  const colorTexture = gl.createTexture();
  const motionTexture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  for (const texture of [colorTexture, motionTexture]) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }
  gl.bindTexture(gl.TEXTURE_2D, motionTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { colorTexture, motionTexture, framebuffer };
}

function resizeSceneTarget(gl, target, width, height) {
  if (gl.isContextLost()) return false;
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  let complete = false;
  try {
    const attachments = [
      [target.colorTexture, gl.COLOR_ATTACHMENT0],
      [target.motionTexture, gl.COLOR_ATTACHMENT1],
    ];
    for (const [texture, attachment] of attachments) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        attachment,
        gl.TEXTURE_2D,
        texture,
        0,
      );
    }
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    const error = gl.getError();
    complete =
      status === gl.FRAMEBUFFER_COMPLETE
      && error === gl.NO_ERROR
      && !gl.isContextLost();
  } finally {
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  return complete;
}

function resizeColorTarget(gl, target, width, height) {
  if (gl.isContextLost()) return false;
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  let complete = false;
  try {
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      target.texture,
      0,
    );
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    const error = gl.getError();
    complete =
      status === gl.FRAMEBUFFER_COMPLETE
      && error === gl.NO_ERROR
      && !gl.isContextLost();
  } finally {
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  return complete;
}

function resizeTargetSet(gl, sceneTarget, historyTargets, width, height) {
  if (!resizeSceneTarget(gl, sceneTarget, width, height)) return false;
  for (const target of historyTargets) {
    if (!resizeColorTarget(gl, target, width, height)) return false;
  }
  return !gl.isContextLost();
}

function settingsSignature(settings) {
  return [
    settings.maxSteps,
    settings.baseStep,
    settings.fov,
    settings.shellCount,
    settings.exposure,
    settings.saturation,
    settings.stationRotationSpeed,
    settings.lensing,
    settings.spheresVisible,
    settings.skyVisible,
    settings.ringsVisible,
  ].join("|");
}

export class SchwarzschildRenderer {
  static async create(canvas, onProgress = () => {}) {
    const contextAttributes = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
      xrCompatible: true,
    };
    let gl = canvas.getContext("webgl2", contextAttributes);

    if (!gl) {
      onProgress("Retrying WebGL2 with compatibility settings…");
      gl = canvas.getContext("webgl2", {
        ...contextAttributes,
        powerPreference: "default",
      });
    }

    if (!gl) {
      throw new Error(
        "This browser or graphics driver did not provide a WebGL2 context, even with compatibility settings.",
      );
    }

    onProgress("Loading standalone GLSL shaders…");
    const [
      vertexSource,
      fragmentSource,
      fxaaSource,
      rcasSource,
    ] = await Promise.all([
      fetchText(SHADER_PATHS.vertex, onProgress),
      fetchText(SHADER_PATHS.fragment, onProgress),
      fetchText(SHADER_PATHS.fxaa, onProgress),
      fetchText(SHADER_PATHS.rcas, onProgress),
    ]);

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const fxaaShader = compileShader(gl, gl.FRAGMENT_SHADER, fxaaSource);
    const rcasShader = compileShader(gl, gl.FRAGMENT_SHADER, rcasSource);
    const program = linkProgram(gl, vertexShader, fragmentShader);
    const fxaaProgram = linkProgram(gl, vertexShader, fxaaShader);
    const rcasProgram = linkProgram(gl, vertexShader, rcasShader);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    gl.deleteShader(fxaaShader);
    gl.deleteShader(rcasShader);

    onProgress("Decoding and fitting the spherical sky field…");
    const skyImage = await loadImage(SKY_TEXTURE_PATH, onProgress);
    const skyTexture = createSkyTexture(gl, skyImage);

    return new SchwarzschildRenderer(
      canvas,
      gl,
      program,
      fxaaProgram,
      rcasProgram,
      skyTexture.texture,
      {
        width: skyTexture.width,
        height: skyTexture.height,
      },
    );
  }

  constructor(
    canvas,
    gl,
    program,
    fxaaProgram,
    rcasProgram,
    skyTexture,
    textureSize,
  ) {
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this.fxaaProgram = fxaaProgram;
    this.rcasProgram = rcasProgram;
    this.skyTexture = skyTexture;
    this.textureSize = textureSize;
    this.renderScale = 0.86;
    this.maxPixels = 2_000_000;
    this.lastCssWidth = 0;
    this.lastCssHeight = 0;
    this.lastDpr = 0;
    this.uniforms = {};
    this.fxaaUniforms = {};
    this.rcasUniforms = {};
    this.sceneTarget = createSceneTarget(gl);
    this.historyTargets = [
      createColorTarget(gl),
      createColorTarget(gl),
    ];
    this.historyIndex = 0;
    this.historyValid = false;
    this.frameIndex = 0;
    this.previousCameraPosition = new Float32Array(3);
    this.previousCameraForward = new Float32Array(3);
    this.previousCameraRight = new Float32Array(3);
    this.previousCameraUp = new Float32Array(3);
    this.previousFovY = 0;
    this.previousSceneTime = 0;
    this.hasPreviousCamera = false;
    this.previousRenderTime = Number.NaN;
    this.previousSettingsSignature = "";
    this.xrLayer = null;

    const uniformNames = [
      "uResolution",
      "uCameraPosition",
      "uCameraForward",
      "uCameraRight",
      "uCameraUp",
      "uPreviousCameraPosition",
      "uPreviousCameraForward",
      "uPreviousCameraRight",
      "uPreviousCameraUp",
      "uPreviousTime",
      "uPreviousFovY",
      "uMotionValid",
      "uTime",
      "uStationRotationSpeed",
      "uJitter",
      "uFovY",
      "uMaxSteps",
      "uBaseStep",
      "uLensing",
      "uSpheresVisible",
      "uSkyVisible",
      "uRingsVisible",
      "uShellCount",
      "uExposure",
      "uSaturation",
      "uSky",
      "uXRView",
      "uInverseProjection",
      "uEyeRotation",
    ];

    for (const name of uniformNames) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    for (const name of [
      "uCurrentFrame",
      "uHistoryFrame",
      "uMotionFrame",
      "uResolution",
      "uHistoryValid",
      "uHistoryBlend",
    ]) {
      this.fxaaUniforms[name] =
        gl.getUniformLocation(fxaaProgram, name);
    }
    for (const name of [
      "uSource",
      "uResolution",
      "uSharpness",
    ]) {
      this.rcasUniforms[name] =
        gl.getUniformLocation(rcasProgram, name);
    }

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.useProgram(program);
    gl.uniform1i(this.uniforms.uSky, 0);
    gl.useProgram(fxaaProgram);
    gl.uniform1i(this.fxaaUniforms.uCurrentFrame, 1);
    gl.uniform1i(this.fxaaUniforms.uHistoryFrame, 2);
    gl.uniform1i(this.fxaaUniforms.uMotionFrame, 3);
    gl.useProgram(rcasProgram);
    gl.uniform1i(this.rcasUniforms.uSource, 4);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    // RGBA8 motion vectors store exact bytes; framebuffer dithering would
    // randomly alter the packed previous-UV coordinates.
    gl.disable(gl.DITHER);
  }

  setQuality(profile) {
    this.renderScale = profile.scale;
    this.maxPixels = profile.maxPixels;
    this.lastCssWidth = 0;
    this.invalidateHistory();
  }

  invalidateHistory() {
    this.historyValid = false;
    this.frameIndex = 0;
  }

  isContextLost() {
    return this.gl.isContextLost();
  }

  resizeIfNeeded() {
    if (this.gl.isContextLost()) return false;
    const cssWidth = Math.max(1, this.canvas.clientWidth);
    const cssHeight = Math.max(1, this.canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    if (
      cssWidth === this.lastCssWidth &&
      cssHeight === this.lastCssHeight &&
      dpr === this.lastDpr
    ) {
      return true;
    }

    let width = Math.max(1, Math.round(cssWidth * dpr * this.renderScale));
    let height = Math.max(1, Math.round(cssHeight * dpr * this.renderScale));
    const pixels = width * height;
    if (pixels > this.maxPixels) {
      const correction = Math.sqrt(this.maxPixels / pixels);
      width = Math.max(1, Math.round(width * correction));
      height = Math.max(1, Math.round(height * correction));
    }

    const maximumTextureSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
    const maximumViewport = this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS);
    width = Math.min(width, maximumTextureSize, maximumViewport[0]);
    height = Math.min(height, maximumTextureSize, maximumViewport[1]);

    let allocatedWidth = 0;
    let allocatedHeight = 0;
    for (const factor of TARGET_SIZE_RETRY_FACTORS) {
      if (this.gl.isContextLost()) return false;
      const candidateWidth = Math.max(1, Math.round(width * factor));
      const candidateHeight = Math.max(1, Math.round(height * factor));
      if (
        resizeTargetSet(
          this.gl,
          this.sceneTarget,
          this.historyTargets,
          candidateWidth,
          candidateHeight,
        )
      ) {
        allocatedWidth = candidateWidth;
        allocatedHeight = candidateHeight;
        break;
      }
    }

    if (this.gl.isContextLost()) return false;
    if (allocatedWidth === 0 || allocatedHeight === 0) {
      throw new Error(
        `Could not allocate the temporal render targets at or below ${width}×${height}. `
          + "Choose a lower quality profile and press Retry startup.",
      );
    }

    this.canvas.width = allocatedWidth;
    this.canvas.height = allocatedHeight;
    this.lastCssWidth = cssWidth;
    this.lastCssHeight = cssHeight;
    this.lastDpr = dpr;
    this.invalidateHistory();
    this.gl.viewport(0, 0, allocatedWidth, allocatedHeight);
    return true;
  }

  async prepareXRSession(session, framebufferScaleFactor = 0.65) {
    if (this.gl.isContextLost()) {
      throw new Error("The WebGL context was lost before the VR session started.");
    }
    if (typeof this.gl.makeXRCompatible !== "function") {
      throw new Error("This browser did not provide WebXR-compatible WebGL2.");
    }
    if (typeof window.XRWebGLLayer !== "function") {
      throw new Error("This browser did not provide XRWebGLLayer.");
    }

    await this.gl.makeXRCompatible();
    if (this.gl.isContextLost()) {
      throw new Error("WebGL changed graphics adapters while VR was starting. Retry after recovery.");
    }

    const layer = new window.XRWebGLLayer(session, this.gl, {
      antialias: false,
      depth: false,
      stencil: false,
      alpha: false,
      ignoreDepthValues: true,
      framebufferScaleFactor,
    });
    try {
      if (typeof layer.fixedFoveation === "number") {
        layer.fixedFoveation = 0.35;
      }
    } catch {
      // Foveation is optional and some runtimes expose a read-only shim.
    }
    session.updateRenderState({
      baseLayer: layer,
      depthNear: 0.05,
      depthFar: 1000,
    });
    this.xrLayer = layer;
    this.invalidateHistory();
    return layer;
  }

  finishXRSession() {
    this.xrLayer = null;
    this.invalidateHistory();
    this.previousRenderTime = Number.NaN;
  }

  renderXR(viewStates, settings, timeSeconds) {
    if (this.gl.isContextLost() || !this.xrLayer) return false;

    const gl = this.gl;
    const u = this.uniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.xrLayer.framebuffer);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DITHER);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.skyTexture);

    gl.uniform1i(u.uXRView, 1);
    gl.uniform1f(u.uTime, timeSeconds);
    gl.uniform1f(u.uStationRotationSpeed, settings.stationRotationSpeed);
    gl.uniform1i(u.uMaxSteps, settings.maxSteps);
    gl.uniform1f(u.uBaseStep, settings.baseStep);
    gl.uniform1i(u.uLensing, settings.lensing ? 1 : 0);
    gl.uniform1i(u.uSpheresVisible, 0);
    gl.uniform1i(u.uSkyVisible, settings.skyVisible ? 1 : 0);
    gl.uniform1i(u.uRingsVisible, settings.ringsVisible ? 1 : 0);
    gl.uniform1i(u.uShellCount, 0);
    gl.uniform1f(u.uExposure, settings.exposure);
    gl.uniform1f(u.uSaturation, settings.saturation);

    for (const state of viewStates) {
      const viewport = this.xrLayer.getViewport(state.view);
      if (!viewport) continue;
      gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
      gl.uniform2f(u.uResolution, viewport.width, viewport.height);
      gl.uniform3fv(u.uCameraPosition, state.position);
      gl.uniform3fv(u.uCameraForward, state.forward);
      gl.uniform3fv(u.uCameraRight, state.right);
      gl.uniform3fv(u.uCameraUp, state.up);
      gl.uniform1f(u.uFovY, state.fovY);
      gl.uniformMatrix4fv(
        u.uInverseProjection,
        false,
        state.inverseProjection,
      );
      gl.uniformMatrix3fv(u.uEyeRotation, false, state.eyeRotation);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (gl.isContextLost()) return false;
    }

    gl.uniform1i(u.uXRView, 0);
    gl.disable(gl.DITHER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  render(camera, settings, timeSeconds) {
    if (this.gl.isContextLost()) return false;
    if (!this.resizeIfNeeded()) return false;

    const gl = this.gl;
    const u = this.uniforms;
    const frameDeltaSeconds =
      Number.isFinite(this.previousRenderTime)
      && Number.isFinite(timeSeconds)
        ? timeSeconds - this.previousRenderTime
        : Number.NaN;
    this.previousRenderTime = timeSeconds;
    if (
      Number.isFinite(frameDeltaSeconds)
      && (
        frameDeltaSeconds < 0
        || frameDeltaSeconds > MAX_HISTORY_FRAME_GAP
      )
    ) {
      this.invalidateHistory();
    }
    const currentSettingsSignature = settingsSignature(settings);
    if (
      this.previousSettingsSignature
      && currentSettingsSignature !== this.previousSettingsSignature
    ) {
      this.invalidateHistory();
    }
    this.previousSettingsSignature = currentSettingsSignature;

    const fovY = (settings.fov * Math.PI) / 180;
    const motionValid = this.historyValid && this.hasPreviousCamera;
    const historyBlend = motionValid ? TEMPORAL_HISTORY_WEIGHT : 0;
    // Lensed images do not have a pinhole inverse motion map. Keep them
    // spatially stable instead of injecting temporal jitter that cannot be
    // reprojected correctly.
    const jitterSafe = motionValid && !settings.lensing;
    const jitter = !jitterSafe
      ? ZERO_JITTER
      : TEMPORAL_JITTER[
        (this.frameIndex - 1) % TEMPORAL_JITTER.length
      ];

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget.framebuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.skyTexture);

    gl.uniform1i(u.uXRView, 0);
    gl.uniform2f(u.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform3fv(u.uCameraPosition, camera.position);
    gl.uniform3fv(u.uCameraForward, camera.forward);
    gl.uniform3fv(u.uCameraRight, camera.right);
    gl.uniform3fv(u.uCameraUp, camera.up);
    gl.uniform3fv(
      u.uPreviousCameraPosition,
      motionValid ? this.previousCameraPosition : camera.position,
    );
    gl.uniform3fv(
      u.uPreviousCameraForward,
      motionValid ? this.previousCameraForward : camera.forward,
    );
    gl.uniform3fv(
      u.uPreviousCameraRight,
      motionValid ? this.previousCameraRight : camera.right,
    );
    gl.uniform3fv(
      u.uPreviousCameraUp,
      motionValid ? this.previousCameraUp : camera.up,
    );
    gl.uniform1f(
      u.uPreviousTime,
      motionValid ? this.previousSceneTime : timeSeconds,
    );
    gl.uniform1f(
      u.uPreviousFovY,
      motionValid ? this.previousFovY : fovY,
    );
    gl.uniform1i(u.uMotionValid, motionValid ? 1 : 0);
    gl.uniform1f(u.uTime, timeSeconds);
    gl.uniform1f(u.uStationRotationSpeed, settings.stationRotationSpeed);
    gl.uniform2f(u.uJitter, jitter[0], jitter[1]);
    gl.uniform1f(u.uFovY, fovY);
    gl.uniform1i(u.uMaxSteps, settings.maxSteps);
    gl.uniform1f(u.uBaseStep, settings.baseStep);
    gl.uniform1i(u.uLensing, settings.lensing ? 1 : 0);
    gl.uniform1i(u.uSpheresVisible, settings.spheresVisible ? 1 : 0);
    gl.uniform1i(u.uSkyVisible, settings.skyVisible ? 1 : 0);
    gl.uniform1i(u.uRingsVisible, settings.ringsVisible ? 1 : 0);
    gl.uniform1i(u.uShellCount, settings.shellCount);
    gl.uniform1f(u.uExposure, settings.exposure);
    gl.uniform1f(u.uSaturation, settings.saturation);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (gl.isContextLost()) return false;

    const historyRead = this.historyTargets[this.historyIndex];
    const historyWriteIndex = 1 - this.historyIndex;
    const historyWrite = this.historyTargets[historyWriteIndex];
    gl.bindFramebuffer(gl.FRAMEBUFFER, historyWrite.framebuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.useProgram(this.fxaaProgram);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.colorTexture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, historyRead.texture);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.motionTexture);
    gl.uniform2f(
      this.fxaaUniforms.uResolution,
      this.canvas.width,
      this.canvas.height,
    );
    gl.uniform1i(
      this.fxaaUniforms.uHistoryValid,
      this.historyValid ? 1 : 0,
    );
    gl.uniform1f(
      this.fxaaUniforms.uHistoryBlend,
      historyBlend,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (gl.isContextLost()) return false;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.rcasProgram);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, historyWrite.texture);
    gl.uniform2f(
      this.rcasUniforms.uResolution,
      this.canvas.width,
      this.canvas.height,
    );
    gl.uniform1f(this.rcasUniforms.uSharpness, RCAS_SHARPNESS);
    gl.enable(gl.DITHER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (gl.isContextLost()) return false;
    gl.disable(gl.DITHER);
    gl.activeTexture(gl.TEXTURE0);

    this.previousCameraPosition.set(camera.position);
    this.previousCameraForward.set(camera.forward);
    this.previousCameraRight.set(camera.right);
    this.previousCameraUp.set(camera.up);
    this.previousFovY = fovY;
    this.previousSceneTime = timeSeconds;
    this.hasPreviousCamera = true;
    this.historyIndex = historyWriteIndex;
    this.historyValid = true;
    this.frameIndex += 1;
    return true;
  }
}
