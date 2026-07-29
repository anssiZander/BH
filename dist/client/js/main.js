import {
  FirstPersonCamera,
  arealToIsotropic,
  isotropicToAreal,
} from "./camera.js";
import { SchwarzschildRenderer } from "./webgl.js";

const QUALITY_PROFILES = {
  low: { maxSteps: 256, scale: 0.46, maxPixels: 600_000 },
  medium: { maxSteps: 320, scale: 0.58, maxPixels: 950_000 },
  high: { maxSteps: 416, scale: 0.68, maxPixels: 1_450_000 },
  ultra: { maxSteps: 896, scale: 0.9, maxPixels: 3_200_000 },
};

const CAPTURE_RHO = 0.515;
const PHOTON_RHO = (2 + Math.sqrt(3)) / 2;
const RADIAL_TRACK_MIN_AREAL = 2;
const RADIAL_TRACK_MAX_AREAL = 22;
const STATION_INNER_BAND_LATITUDE = 0.1875;
const STATION_OUTER_BAND_LATITUDE = 0.5625;
const STATION_ENVELOPE_HALF_ANGLE = 0.15;
const ESCAPE_RHO = 36;
const SHELL_RADII = [
  0.93166248, 1.30901699, 1.8660254, 2.39564392,
  2.91421356, 3.93649167, 5.45416346, 6.96410162,
];

const canvas = document.querySelector("#glCanvas");
const loadingScreen = document.querySelector("#loadingScreen");
const loadingDetail = document.querySelector("#loadingDetail");
const fatalError = document.querySelector("#fatalError");
const fatalMessage = document.querySelector("#fatalMessage");
const radiusValue = document.querySelector("#radiusValue");
const fpsValue = document.querySelector("#fpsValue");
const stepValue = document.querySelector("#stepValue");
const radiusMarker = document.querySelector("#radiusMarker");
const pointerHint = document.querySelector("#pointerHint");
const statusPill = document.querySelector("#statusPill");
const statusText = document.querySelector("#statusText");
const controlsPanel = document.querySelector(".controls-panel");
const radialLandmarks = document.querySelectorAll("[data-areal-radius]");

const settings = {
  quality: "high",
  maxSteps: QUALITY_PROFILES.high.maxSteps,
  baseStep: 0.09,
  fov: 68,
  gridBrightness: 0.8,
  shellCount: 8,
  exposure: 1.1,
  saturation: 1.18,
  lensing: true,
  gridVisible: true,
  spheresVisible: false,
  skyVisible: true,
  ringsVisible: true,
};

let renderer;
let camera;
let lastFrameTime = performance.now();
let smoothedFps = 60;
let lastTelemetryTime = 0;
let stepCapDetected = false;
let lastProbeTime = 0;
let uiHidden = false;

function bindRange(inputId, outputId, settingKey, format, onInput) {
  const input = document.querySelector(`#${inputId}`);
  const output = document.querySelector(`#${outputId}`);
  const update = () => {
    const value = Number(input.value);
    if (settingKey) settings[settingKey] = value;
    output.value = format(value);
    onInput?.(value);
  };
  input.addEventListener("input", update);
  update();
}

function bindControls() {
  for (const landmark of radialLandmarks) {
    const radius = Number(landmark.dataset.arealRadius);
    landmark.style.left = `${arealRadiusToTrackPercent(radius)}%`;
  }

  const qualitySelect = document.querySelector("#qualitySelect");
  const updateQuality = () => {
    settings.quality = qualitySelect.value;
    const profile = QUALITY_PROFILES[settings.quality];
    settings.maxSteps = profile.maxSteps;
    renderer?.setQuality(profile);
    stepValue.textContent = `${settings.maxSteps} RK2`;
  };
  qualitySelect.addEventListener("change", updateQuality);
  updateQuality();

  bindRange("rayStepInput", "rayStepOutput", "baseStep", (value) => value.toFixed(3));
  bindRange("speedInput", "speedOutput", null, (value) => value.toFixed(2), (value) => {
    if (camera) camera.speed = value;
  });
  bindRange("fovInput", "fovOutput", "fov", (value) => `${Math.round(value)}°`);
  bindRange("gridInput", "gridOutput", "gridBrightness", (value) => value.toFixed(2));
  bindRange("shellInput", "shellOutput", "shellCount", (value) => `${Math.round(value)}`);
  bindRange("exposureInput", "exposureOutput", "exposure", (value) => value.toFixed(2));
  bindRange("saturationInput", "saturationOutput", "saturation", (value) => value.toFixed(2));

  const lensingInput = document.querySelector("#lensingInput");
  const updateLensing = () => {
    settings.lensing = lensingInput.checked;
  };
  lensingInput.addEventListener("change", updateLensing);
  updateLensing();

  const gridVisibleInput = document.querySelector("#gridVisibleInput");
  const updateGridVisibility = () => {
    settings.gridVisible = gridVisibleInput.checked;
  };
  gridVisibleInput.addEventListener("change", updateGridVisibility);
  updateGridVisibility();

  const spheresVisibleInput = document.querySelector("#spheresVisibleInput");
  const updateSphereVisibility = () => {
    settings.spheresVisible = spheresVisibleInput.checked;
  };
  spheresVisibleInput.addEventListener("change", updateSphereVisibility);
  updateSphereVisibility();

  const skyVisibleInput = document.querySelector("#skyVisibleInput");
  const updateSkyVisibility = () => {
    settings.skyVisible = skyVisibleInput.checked;
  };
  skyVisibleInput.addEventListener("change", updateSkyVisibility);
  updateSkyVisibility();

  const ringsVisibleInput = document.querySelector("#ringsVisibleInput");
  const updateRingVisibility = () => {
    settings.ringsVisible = ringsVisibleInput.checked;
  };
  ringsVisibleInput.addEventListener("change", updateRingVisibility);
  updateRingVisibility();

  document.querySelector("#resetButton").addEventListener("click", () => camera?.reset());
  document.querySelector("#hideUiButton").addEventListener("click", toggleUi);

  document.querySelector("#collapseControls").addEventListener("click", (event) => {
    const collapsed = controlsPanel.classList.toggle("collapsed");
    event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
    event.currentTarget.setAttribute(
      "aria-label",
      collapsed ? "Expand controls" : "Collapse controls",
    );
    event.currentTarget.querySelector("span").textContent = collapsed ? "+" : "−";
  });

  document.addEventListener("camera:pointerlock", (event) => {
    pointerHint.textContent = event.detail.locked
      ? "Pointer captured · Esc releases"
      : "Click the field to capture the pointer";
  });

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.code === "KeyR") camera?.reset();
    if (event.code === "KeyH") toggleUi();
  });
}

function arealRadiusToTrackPercent(radius) {
  const clampedRadius = Math.max(
    RADIAL_TRACK_MIN_AREAL,
    Math.min(RADIAL_TRACK_MAX_AREAL, radius),
  );
  return (
    Math.log(clampedRadius / RADIAL_TRACK_MIN_AREAL)
    / Math.log(RADIAL_TRACK_MAX_AREAL / RADIAL_TRACK_MIN_AREAL)
  ) * 100;
}

function toggleUi() {
  uiHidden = !uiHidden;
  document.body.classList.toggle("ui-hidden", uiHidden);
}

function updateTelemetry(now) {
  if (now - lastTelemetryTime < 150) return;
  lastTelemetryTime = now;
  const radius = camera.arealRadius;
  radiusValue.textContent = `${radius.toFixed(radius < 10 ? 3 : 2)} M`;
  fpsValue.textContent = `${Math.round(smoothedFps)} FPS`;
  stepValue.textContent = `${settings.maxSteps} RK2`;

  radiusMarker.style.left = `${arealRadiusToTrackPercent(radius)}%`;

  statusPill.classList.remove("warning", "danger");
  if (radius < 2.12) {
    statusPill.classList.add("danger");
    statusText.textContent = "HORIZON PROXIMITY · CAMERA GUARD ACTIVE";
  } else if (Math.abs(radius - 3) < 0.22) {
    statusPill.classList.add("warning");
    statusText.textContent = "PHOTON SPHERE · r = 3M";
  } else if (stepCapDetected) {
    statusPill.classList.add("warning");
    statusText.textContent = "STEP CAP · CRITICAL RAYS APPROXIMATED";
  } else if (!settings.lensing) {
    statusText.textContent = "FLAT-RAY COMPARISON MODE";
  } else {
    statusText.textContent = "SCHWARZSCHILD FIELD · STABLE";
  }
}

function opticalAcceleration(position, direction) {
  const rho = Math.hypot(position[0], position[1], position[2]);
  if (rho <= CAPTURE_RHO) return [0, 0, 0];
  const a = 0.5 / rho;
  const derivative = (-a / rho) * (3 / (1 + a) + 1 / (1 - a));
  const radialScale = derivative / rho;
  const gx = position[0] * radialScale;
  const gy = position[1] * radialScale;
  const gz = position[2] * radialScale;
  const projection = direction[0] * gx + direction[1] * gy + direction[2] * gz;
  return [
    gx - direction[0] * projection,
    gy - direction[1] * projection,
    gz - direction[2] * projection,
  ];
}

function opticalIndex(rho) {
  const a = 0.5 / rho;
  return ((1 + a) ** 3) / (1 - a);
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function stationBandEnvelope(position) {
  const stationRadius = Math.hypot(...position);
  const stationLatitude = Math.asin(
    Math.max(
      0,
      Math.min(1, Math.abs(position[1]) / Math.max(stationRadius, 1e-8)),
    ),
  );
  const innerAngularEnvelope = stationRadius * Math.sin(
    Math.abs(stationLatitude - STATION_INNER_BAND_LATITUDE)
      - STATION_ENVELOPE_HALF_ANGLE,
  );
  const outerAngularEnvelope = stationRadius * Math.sin(
    Math.abs(stationLatitude - STATION_OUTER_BAND_LATITUDE)
      - STATION_ENVELOPE_HALF_ANGLE,
  );
  const radialEnvelope = Math.abs(stationRadius - PHOTON_RHO) - 0.11;
  return Math.max(
    radialEnvelope,
    Math.min(innerAngularEnvelope, outerAngularEnvelope),
  );
}

function probeStepSize(
  position,
  baseStep,
  gridVisible,
  spheresVisible,
  ringsVisible,
  shellCount,
) {
  const rho = Math.hypot(...position);
  let rayStep = baseStep * (0.35 + 5.65 * smoothstep(1.2, 18, rho));
  const photonBlend = smoothstep(0, 0.28, Math.abs(rho - PHOTON_RHO));
  rayStep = Math.min(rayStep, 0.016 + (rayStep - 0.016) * photonBlend);

  if ((gridVisible || spheresVisible) && rho > 0.64 && rho < 7.3) {
    for (let shell = 0; shell < Math.min(shellCount, SHELL_RADII.length); shell += 1) {
      const shellBlend = smoothstep(0, 0.28, Math.abs(rho - SHELL_RADII[shell]));
      rayStep = Math.min(rayStep, 0.075 + (rayStep - 0.075) * shellBlend);
    }
  }

  if (ringsVisible) {
    const stationEnvelope = stationBandEnvelope(position);
    const stationBlend = smoothstep(
      0.025,
      0.2,
      Math.max(stationEnvelope, 0),
    );
    rayStep = Math.min(
      rayStep,
      0.01 + (rayStep - 0.01) * stationBlend,
    );
  }
  return rayStep;
}

function finishProbe(state, steps, position, direction, invalid, metrics) {
  return {
    state,
    steps,
    position: [...position],
    direction: [...direction],
    invalid,
    minRadius: metrics.minRadius,
    maxRadius: metrics.maxRadius,
    angularTravel: Math.abs(metrics.angularTravel),
    finalRadius: Math.hypot(...position),
    directionNorm: Math.hypot(...direction),
  };
}

function traceProbe(
  origin,
  initialDirection,
  {
    maxSteps,
    baseStep,
    lensing = true,
    gridVisible = true,
    spheresVisible = false,
    ringsVisible = false,
    shellCount = SHELL_RADII.length,
  },
) {
  const position = [...origin];
  let direction = [...initialDirection];
  const directionLength = Math.hypot(...direction);
  direction = direction.map((component) => component / directionLength);
  const metrics = {
    minRadius: Math.hypot(...position),
    maxRadius: Math.hypot(...position),
    angularTravel: 0,
    lastAngle: Math.atan2(position[2], position[0]),
  };

  if (!lensing) {
    const projection =
      position[0] * direction[0] +
      position[1] * direction[1] +
      position[2] * direction[2];
    const discriminant =
      projection * projection -
      (position[0] ** 2 + position[1] ** 2 + position[2] ** 2 - CAPTURE_RHO ** 2);
    const captured =
      discriminant >= 0 && -projection - Math.sqrt(discriminant) > 0;
    return finishProbe(captured ? "captured" : "escaped", 0, position, direction, false, metrics);
  }

  for (let i = 0; i < maxSteps; i += 1) {
    const rho = Math.hypot(...position);
    if (!Number.isFinite(rho) || direction.some((value) => !Number.isFinite(value))) {
      return finishProbe("invalid", i, position, direction, true, metrics);
    }
    metrics.minRadius = Math.min(metrics.minRadius, rho);
    metrics.maxRadius = Math.max(metrics.maxRadius, rho);
    if (rho <= CAPTURE_RHO) {
      return finishProbe("captured", i, position, direction, false, metrics);
    }
    const outward =
      position[0] * direction[0] +
      position[1] * direction[1] +
      position[2] * direction[2];
    if (rho > ESCAPE_RHO && outward > 0) {
      return finishProbe("escaped", i, position, direction, false, metrics);
    }

    let step = probeStepSize(
      position,
      baseStep,
      gridVisible,
      spheresVisible,
      ringsVisible,
      shellCount,
    );
    const inwardRate =
      -(position[0] * direction[0] +
        position[1] * direction[1] +
        position[2] * direction[2]) / rho;
    if (inwardRate > 0.02) {
      step = Math.min(step, Math.max(0.0015, (0.72 * (rho - CAPTURE_RHO)) / inwardRate));
    }

    const k1 = opticalAcceleration(position, direction);
    let mx = direction[0] + 0.5 * step * k1[0];
    let my = direction[1] + 0.5 * step * k1[1];
    let mz = direction[2] + 0.5 * step * k1[2];
    const midLength = Math.hypot(mx, my, mz) || 1;
    mx /= midLength;
    my /= midLength;
    mz /= midLength;

    const midPosition = [
      position[0] + 0.5 * step * direction[0],
      position[1] + 0.5 * step * direction[1],
      position[2] + 0.5 * step * direction[2],
    ];
    if (Math.hypot(...midPosition) <= CAPTURE_RHO) {
      return finishProbe("captured", i + 1, midPosition, direction, false, metrics);
    }

    const k2 = opticalAcceleration(midPosition, [mx, my, mz]);
    position[0] += step * mx;
    position[1] += step * my;
    position[2] += step * mz;
    direction[0] += step * k2[0];
    direction[1] += step * k2[1];
    direction[2] += step * k2[2];
    const newDirectionLength = Math.hypot(...direction);
    if (!Number.isFinite(newDirectionLength) || newDirectionLength < 1e-12) {
      return finishProbe("invalid", i + 1, position, direction, true, metrics);
    }
    direction = direction.map((component) => component / newDirectionLength);

    const angle = Math.atan2(position[2], position[0]);
    let angleDelta = angle - metrics.lastAngle;
    if (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
    if (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
    metrics.angularTravel += angleDelta;
    metrics.lastAngle = angle;
  }

  const finalRadius = Math.hypot(...position);
  const finalRadialMotion =
    position[0] * direction[0] +
    position[1] * direction[1] +
    position[2] * direction[2];
  if (finalRadius > ESCAPE_RHO && finalRadialMotion > 0) {
    return finishProbe("escaped", maxSteps, position, direction, false, metrics);
  }

  const impactParameter =
    opticalIndex(finalRadius) *
    Math.hypot(
      position[1] * direction[2] - position[2] * direction[1],
      position[2] * direction[0] - position[0] * direction[2],
      position[0] * direction[1] - position[1] * direction[0],
    );
  const insidePhotonSphere = finalRadius < PHOTON_RHO;
  const outsideCapture =
    !insidePhotonSphere &&
    finalRadialMotion < 0 &&
    impactParameter < 3 * Math.sqrt(3) * 0.999;
  const insideCapture =
    insidePhotonSphere &&
    (finalRadialMotion < 0 || impactParameter > 3 * Math.sqrt(3) * 1.001);
  if (outsideCapture || insideCapture) {
    return finishProbe("captured", maxSteps, position, direction, false, metrics);
  }

  return finishProbe("capped", maxSteps, position, direction, false, metrics);
}

function probeCriticalRays(now) {
  if (now - lastProbeTime < 900) return;
  lastProbeTime = now;
  if (!settings.lensing) {
    stepCapDetected = false;
    return;
  }

  const aspect = canvas.width / Math.max(canvas.height, 1);
  const tangent = Math.tan((settings.fov * Math.PI) / 360);
  const samples = [
    [0, 0],
    [-0.36, 0],
    [0.36, 0],
    [-0.46, 0],
    [0.46, 0],
    [-0.18, 0],
    [0.18, 0],
    [-0.27, 0],
    [0.27, 0],
    [-0.29, 0],
    [0.29, 0],
    [-0.3, 0],
    [0.3, 0],
    [-0.31, 0],
    [0.31, 0],
    [-0.33, 0],
    [0.33, 0],
    [0, -0.28],
    [0, 0.28],
    [0, -0.43],
    [0, 0.43],
    [-0.22, 0.17],
    [0.22, -0.17],
    [-0.34, -0.2],
    [0.34, 0.2],
  ];

  stepCapDetected = samples.some(([sx, sy]) => {
    let dx =
      camera.forward[0] +
      camera.right[0] * sx * aspect * tangent +
      camera.up[0] * sy * tangent;
    let dy =
      camera.forward[1] +
      camera.right[1] * sx * aspect * tangent +
      camera.up[1] * sy * tangent;
    let dz =
      camera.forward[2] +
      camera.right[2] * sx * aspect * tangent +
      camera.up[2] * sy * tangent;
    const length = Math.hypot(dx, dy, dz) || 1;
    dx /= length;
    dy /= length;
    dz /= length;
    return (
      traceProbe(camera.position, [dx, dy, dz], {
        maxSteps: settings.maxSteps,
        baseStep: settings.baseStep,
        lensing: true,
        gridVisible: settings.gridVisible,
        spheresVisible: settings.spheresVisible,
        ringsVisible: settings.ringsVisible,
        shellCount: settings.shellCount,
      }).state === "capped"
    );
  });
}

function runPhysicsSelfCheck() {
  const far = [0, 0, 14];
  const probeOptions = {
    maxSteps: QUALITY_PROFILES.high.maxSteps,
    baseStep: 0.09,
    lensing: true,
    gridVisible: true,
    spheresVisible: false,
    ringsVisible: false,
    shellCount: SHELL_RADII.length,
  };
  const outward = traceProbe(far, [0, 0, 1], probeOptions);
  const inward = traceProbe(far, [0, 0, -1], probeOptions);
  const photonRho = arealToIsotropic(3);
  const photonOrbit = traceProbe([photonRho, 0, 0], [0, 0, 1], probeOptions);
  const flat = traceProbe(far, [0.2, 0, Math.sqrt(0.96)], {
    ...probeOptions,
    lensing: false,
  });
  const longProbeOptions = {
    ...probeOptions,
    maxSteps: QUALITY_PROFILES.ultra.maxSteps,
    gridVisible: false,
  };
  const localOpticalRadius = opticalIndex(14) * 14;
  const directionForImpact = (impact) => {
    const sine = impact / localOpticalRadius;
    return [sine, 0, -Math.sqrt(1 - sine * sine)];
  };
  const capturedCriticalSide = traceProbe(far, directionForImpact(4.7), longProbeOptions);
  const scatteredCriticalSide = traceProbe(far, directionForImpact(6.2), longProbeOptions);
  const scatterDirection = directionForImpact(6.2);
  const rotatedScatter = traceProbe(
    [14, 0, 0],
    [scatterDirection[2], 0, -scatterDirection[0]],
    longProbeOptions,
  );

  const outwardDirectionError = Math.hypot(
    outward.direction[0],
    outward.direction[1],
    outward.direction[2] - 1,
  );
  const photonDrift = Math.abs(photonOrbit.finalRadius - photonRho);
  const radiiCorrect =
    Math.abs(isotropicToAreal(0.5) - 2) < 1e-12 &&
    Math.abs(isotropicToAreal(photonRho) - 3) < 1e-12 &&
    SHELL_RADII.every(
      (rho, index) =>
        Math.abs(isotropicToAreal(rho) - [2.2, 2.5, 3, 3.5, 4, 5, 6.5, 8][index]) <
        1e-6,
    );
  const finite = [
    outward,
    inward,
    photonOrbit,
    flat,
    capturedCriticalSide,
    scatteredCriticalSide,
    rotatedScatter,
  ].every(
    (probe) =>
      !probe.invalid &&
      Number.isFinite(probe.finalRadius) &&
      Number.isFinite(probe.directionNorm) &&
      Math.abs(probe.directionNorm - 1) < 1e-8,
  );

  return {
    outwardStraight: outward.state === "escaped" && outwardDirectionError < 1e-10,
    inwardCaptured: inward.state === "captured",
    photonOrbitStable:
      photonOrbit.state === "capped" &&
      photonOrbit.angularTravel > 3.2 &&
      photonDrift < 0.005,
    flatUndistorted:
      flat.state === "escaped" &&
      Math.hypot(
        flat.direction[0] - 0.2,
        flat.direction[1],
        flat.direction[2] - Math.sqrt(0.96),
      ) < 1e-12,
    criticalSplit:
      capturedCriticalSide.state === "captured" &&
      scatteredCriticalSide.state === "escaped",
    sphericalSymmetry:
      scatteredCriticalSide.state === rotatedScatter.state &&
      Math.abs(scatteredCriticalSide.minRadius - rotatedScatter.minRadius) < 1e-9,
    radiiCorrect,
    finite,
  };
}

function animate(now) {
  const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;
  camera.update(deltaSeconds);
  renderer.render(camera, settings, now / 1000);

  const instantaneousFps = 1 / Math.max(deltaSeconds, 1 / 240);
  smoothedFps += (instantaneousFps - smoothedFps) * 0.035;
  probeCriticalRays(now);
  updateTelemetry(now);
  requestAnimationFrame(animate);
}

async function start() {
  bindControls();

  try {
    renderer = await SchwarzschildRenderer.create(canvas, (message) => {
      loadingDetail.textContent = message;
    });
    camera = new FirstPersonCamera(canvas);
    camera.speed = Number(document.querySelector("#speedInput").value);
    renderer.setQuality(QUALITY_PROFILES[settings.quality]);

    const physics = runPhysicsSelfCheck();
    if (!Object.values(physics).every(Boolean)) {
      throw new Error("The startup physics self-check did not converge. Try reloading the page.");
    }

    loadingDetail.textContent = `${renderer.textureSize.width}×${renderer.textureSize.height} sky loaded · optics stable`;
    setTimeout(() => loadingScreen.classList.add("loaded"), 260);
    statusText.textContent = "SCHWARZSCHILD FIELD · STABLE";
    lastFrameTime = performance.now();
    requestAnimationFrame(animate);
  } catch (error) {
    loadingScreen.classList.add("loaded");
    fatalMessage.textContent = error instanceof Error ? error.message : String(error);
    fatalError.hidden = false;
  }
}

start();
