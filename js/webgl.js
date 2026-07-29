const SHADER_PATHS = {
  vertex: "shaders/fullscreen.vert",
  fragment: "shaders/schwarzschild.frag",
  orbitalStation: "shaders/orbital_station.glsl",
  fxaa: "shaders/fxaa.frag",
};

const SKY_TEXTURE_PATH = "assets/galaxy_4k.jpg";
const ORBITAL_STATION_MARKER = "/*__ORBITAL_STATION_GLSL__*/";
const ZERO_JITTER = [0, 0];
const TEMPORAL_JITTER = [
  [7 / 128, -1 / 6],
  [-25 / 128, 1 / 6],
  [39 / 128, -7 / 18],
  [-41 / 128, -1 / 18],
  [23 / 128, 5 / 18],
  [-9 / 128, -5 / 18],
  [55 / 128, 1 / 18],
  [-49 / 128, 7 / 18],
];
const MAX_HISTORY_FRAME_GAP = 0.12;
const CAMERA_MOTION_RATE_LIMIT = 0.36;
const ROTATING_SCENE_HISTORY_CAP = 0.2;

function shaderTypeName(gl, type) {
  return type === gl.VERTEX_SHADER ? "vertex" : "fragment";
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url} (${response.status}).`);
  }
  return response.text();
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

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load the local sky texture at ${url}.`));
    image.src = url;
  });
}

function createSkyTexture(gl, image) {
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
    image,
  );
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
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

function resizeColorTarget(gl, target, width, height) {
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
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    target.texture,
    0,
  );
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("The anti-aliasing render target is incomplete.");
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function settingsSignature(settings) {
  return [
    settings.maxSteps,
    settings.baseStep,
    settings.fov,
    settings.gridBrightness,
    settings.shellCount,
    settings.exposure,
    settings.saturation,
    settings.lensing,
    settings.gridVisible,
    settings.spheresVisible,
    settings.skyVisible,
    settings.ringsVisible,
  ].join("|");
}

export class SchwarzschildRenderer {
  static async create(canvas, onProgress = () => {}) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      throw new Error("This browser or graphics driver does not provide a WebGL2 context.");
    }

    onProgress("Loading standalone GLSL shaders…");
    const [
      vertexSource,
      fragmentTemplate,
      orbitalStationSource,
      fxaaSource,
    ] = await Promise.all([
      fetchText(SHADER_PATHS.vertex),
      fetchText(SHADER_PATHS.fragment),
      fetchText(SHADER_PATHS.orbitalStation),
      fetchText(SHADER_PATHS.fxaa),
    ]);
    const markerCount = fragmentTemplate.split(ORBITAL_STATION_MARKER).length - 1;
    if (markerCount !== 1) {
      throw new Error(
        `Expected exactly one ${ORBITAL_STATION_MARKER} marker in the fragment shader; found ${markerCount}.`,
      );
    }
    const fragmentSource = fragmentTemplate.replace(
      ORBITAL_STATION_MARKER,
      orbitalStationSource,
    );

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const fxaaShader = compileShader(gl, gl.FRAGMENT_SHADER, fxaaSource);
    const program = linkProgram(gl, vertexShader, fragmentShader);
    const fxaaProgram = linkProgram(gl, vertexShader, fxaaShader);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    gl.deleteShader(fxaaShader);

    onProgress("Decoding the 4K spherical sky field…");
    const skyImage = await loadImage(SKY_TEXTURE_PATH);
    const skyTexture = createSkyTexture(gl, skyImage);

    return new SchwarzschildRenderer(canvas, gl, program, fxaaProgram, skyTexture, {
      width: skyImage.naturalWidth,
      height: skyImage.naturalHeight,
    });
  }

  constructor(canvas, gl, program, fxaaProgram, skyTexture, textureSize) {
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this.fxaaProgram = fxaaProgram;
    this.skyTexture = skyTexture;
    this.textureSize = textureSize;
    this.renderScale = 0.86;
    this.maxPixels = 2_000_000;
    this.lastCssWidth = 0;
    this.lastCssHeight = 0;
    this.lastDpr = 0;
    this.uniforms = {};
    this.fxaaUniforms = {};
    this.sceneTarget = createColorTarget(gl);
    this.historyTargets = [
      createColorTarget(gl),
      createColorTarget(gl),
    ];
    this.historyIndex = 0;
    this.historyValid = false;
    this.frameIndex = 0;
    this.previousCameraPosition = new Float32Array(3);
    this.previousCameraForward = new Float32Array(3);
    this.hasPreviousCamera = false;
    this.previousRenderTime = Number.NaN;
    this.previousSettingsSignature = "";

    const uniformNames = [
      "uResolution",
      "uCameraPosition",
      "uCameraForward",
      "uCameraRight",
      "uCameraUp",
      "uTime",
      "uJitter",
      "uFovY",
      "uMaxSteps",
      "uBaseStep",
      "uLensing",
      "uGridVisible",
      "uSpheresVisible",
      "uSkyVisible",
      "uRingsVisible",
      "uGridBrightness",
      "uShellCount",
      "uExposure",
      "uSaturation",
      "uSky",
    ];

    for (const name of uniformNames) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    for (const name of [
      "uScene",
      "uHistory",
      "uResolution",
      "uHistoryValid",
      "uHistoryBlend",
    ]) {
      this.fxaaUniforms[name] =
        gl.getUniformLocation(fxaaProgram, name);
    }

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.useProgram(program);
    gl.uniform1i(this.uniforms.uSky, 0);
    gl.useProgram(fxaaProgram);
    gl.uniform1i(this.fxaaUniforms.uScene, 1);
    gl.uniform1i(this.fxaaUniforms.uHistory, 2);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
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

  resizeIfNeeded() {
    const cssWidth = Math.max(1, this.canvas.clientWidth);
    const cssHeight = Math.max(1, this.canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    if (
      cssWidth === this.lastCssWidth &&
      cssHeight === this.lastCssHeight &&
      dpr === this.lastDpr
    ) {
      return false;
    }

    let width = Math.max(1, Math.round(cssWidth * dpr * this.renderScale));
    let height = Math.max(1, Math.round(cssHeight * dpr * this.renderScale));
    const pixels = width * height;
    if (pixels > this.maxPixels) {
      const correction = Math.sqrt(this.maxPixels / pixels);
      width = Math.max(1, Math.round(width * correction));
      height = Math.max(1, Math.round(height * correction));
    }

    this.canvas.width = width;
    this.canvas.height = height;
    this.lastCssWidth = cssWidth;
    this.lastCssHeight = cssHeight;
    this.lastDpr = dpr;
    resizeColorTarget(this.gl, this.sceneTarget, width, height);
    for (const target of this.historyTargets) {
      resizeColorTarget(this.gl, target, width, height);
    }
    this.invalidateHistory();
    this.gl.viewport(0, 0, width, height);
    return true;
  }

  render(camera, settings, timeSeconds) {
    this.resizeIfNeeded();

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

    let cameraMotion = Number.POSITIVE_INFINITY;
    if (this.hasPreviousCamera) {
      const positionMotion = Math.hypot(
        camera.position[0] - this.previousCameraPosition[0],
        camera.position[1] - this.previousCameraPosition[1],
        camera.position[2] - this.previousCameraPosition[2],
      );
      const directionMotion = Math.hypot(
        camera.forward[0] - this.previousCameraForward[0],
        camera.forward[1] - this.previousCameraForward[1],
        camera.forward[2] - this.previousCameraForward[2],
      );
      cameraMotion =
        positionMotion + directionMotion * 1.5;
    }
    this.previousCameraPosition.set(camera.position);
    this.previousCameraForward.set(camera.forward);
    this.hasPreviousCamera = true;

    const cameraMotionRate =
      Number.isFinite(cameraMotion)
      && Number.isFinite(frameDeltaSeconds)
      && frameDeltaSeconds > 1e-4
        ? cameraMotion / frameDeltaSeconds
        : Number.POSITIVE_INFINITY;
    const stability = Number.isFinite(cameraMotionRate)
      ? Math.max(
        0,
        Math.min(
          1,
          1 - cameraMotionRate / CAMERA_MOTION_RATE_LIMIT,
        ),
      )
      : 0;
    const historyCap = settings.ringsVisible
      ? ROTATING_SCENE_HISTORY_CAP
      : 0.68;
    const historyBlend = this.historyValid
      ? Math.min(
        historyCap,
        0.08 + 0.6 * stability * stability,
      )
      : 0;
    const jitter =
      this.historyValid && stability > 0.8
        ? TEMPORAL_JITTER[this.frameIndex % TEMPORAL_JITTER.length]
        : ZERO_JITTER;

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget.framebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.skyTexture);

    gl.uniform2f(u.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform3fv(u.uCameraPosition, camera.position);
    gl.uniform3fv(u.uCameraForward, camera.forward);
    gl.uniform3fv(u.uCameraRight, camera.right);
    gl.uniform3fv(u.uCameraUp, camera.up);
    gl.uniform1f(u.uTime, timeSeconds);
    gl.uniform2f(u.uJitter, jitter[0], jitter[1]);
    gl.uniform1f(u.uFovY, (settings.fov * Math.PI) / 180);
    gl.uniform1i(u.uMaxSteps, settings.maxSteps);
    gl.uniform1f(u.uBaseStep, settings.baseStep);
    gl.uniform1i(u.uLensing, settings.lensing ? 1 : 0);
    gl.uniform1i(u.uGridVisible, settings.gridVisible ? 1 : 0);
    gl.uniform1i(u.uSpheresVisible, settings.spheresVisible ? 1 : 0);
    gl.uniform1i(u.uSkyVisible, settings.skyVisible ? 1 : 0);
    gl.uniform1i(u.uRingsVisible, settings.ringsVisible ? 1 : 0);
    gl.uniform1f(u.uGridBrightness, settings.gridBrightness);
    gl.uniform1i(u.uShellCount, settings.shellCount);
    gl.uniform1f(u.uExposure, settings.exposure);
    gl.uniform1f(u.uSaturation, settings.saturation);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const historyRead = this.historyTargets[this.historyIndex];
    const historyWriteIndex = 1 - this.historyIndex;
    const historyWrite = this.historyTargets[historyWriteIndex];
    gl.bindFramebuffer(gl.FRAMEBUFFER, historyWrite.framebuffer);
    gl.useProgram(this.fxaaProgram);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, historyRead.texture);
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

    gl.bindFramebuffer(
      gl.READ_FRAMEBUFFER,
      historyWrite.framebuffer,
    );
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);

    this.historyIndex = historyWriteIndex;
    this.historyValid = true;
    this.frameIndex += 1;
  }
}
