const SHADER_PATHS = {
  vertex: "shaders/fullscreen.vert",
  fragment: "shaders/schwarzschild.frag",
};

const SKY_TEXTURE_PATH = "assets/galaxy_4k.jpg";

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
    const [vertexSource, fragmentSource] = await Promise.all([
      fetchText(SHADER_PATHS.vertex),
      fetchText(SHADER_PATHS.fragment),
    ]);

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = linkProgram(gl, vertexShader, fragmentShader);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    onProgress("Decoding the 4K spherical sky field…");
    const skyImage = await loadImage(SKY_TEXTURE_PATH);
    const skyTexture = createSkyTexture(gl, skyImage);

    return new SchwarzschildRenderer(canvas, gl, program, skyTexture, {
      width: skyImage.naturalWidth,
      height: skyImage.naturalHeight,
    });
  }

  constructor(canvas, gl, program, skyTexture, textureSize) {
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this.skyTexture = skyTexture;
    this.textureSize = textureSize;
    this.renderScale = 0.68;
    this.maxPixels = 1_450_000;
    this.lastCssWidth = 0;
    this.lastCssHeight = 0;
    this.lastDpr = 0;
    this.uniforms = {};

    const uniformNames = [
      "uResolution",
      "uCameraPosition",
      "uCameraForward",
      "uCameraRight",
      "uCameraUp",
      "uFovY",
      "uMaxSteps",
      "uBaseStep",
      "uLensing",
      "uGridVisible",
      "uSpheresVisible",
      "uSkyVisible",
      "uTracksVisible",
      "uGridBrightness",
      "uShellCount",
      "uExposure",
      "uSaturation",
      "uSky",
    ];

    for (const name of uniformNames) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.useProgram(program);
    gl.uniform1i(this.uniforms.uSky, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  setQuality(profile) {
    this.renderScale = profile.scale;
    this.maxPixels = profile.maxPixels;
    this.lastCssWidth = 0;
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
    this.gl.viewport(0, 0, width, height);
    return true;
  }

  render(camera, settings) {
    this.resizeIfNeeded();

    const gl = this.gl;
    const u = this.uniforms;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.skyTexture);

    gl.uniform2f(u.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform3fv(u.uCameraPosition, camera.position);
    gl.uniform3fv(u.uCameraForward, camera.forward);
    gl.uniform3fv(u.uCameraRight, camera.right);
    gl.uniform3fv(u.uCameraUp, camera.up);
    gl.uniform1f(u.uFovY, (settings.fov * Math.PI) / 180);
    gl.uniform1i(u.uMaxSteps, settings.maxSteps);
    gl.uniform1f(u.uBaseStep, settings.baseStep);
    gl.uniform1i(u.uLensing, settings.lensing ? 1 : 0);
    gl.uniform1i(u.uGridVisible, settings.gridVisible ? 1 : 0);
    gl.uniform1i(u.uSpheresVisible, settings.spheresVisible ? 1 : 0);
    gl.uniform1i(u.uSkyVisible, settings.skyVisible ? 1 : 0);
    gl.uniform1i(u.uTracksVisible, settings.tracksVisible ? 1 : 0);
    gl.uniform1f(u.uGridBrightness, settings.gridBrightness);
    gl.uniform1i(u.uShellCount, settings.shellCount);
    gl.uniform1f(u.uExposure, settings.exposure);
    gl.uniform1f(u.uSaturation, settings.saturation);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
