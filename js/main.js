import {
  FirstPersonCamera,
  arealToIsotropic,
  isotropicToAreal,
} from "./camera.js?v=20260821-vr-lut-v3";
import { SchwarzschildRenderer } from "./webgl.js?v=20260821-vr-lut-v3";
import {
  FixedBlackHoleXRRig,
  XR_FRAMEBUFFER_SCALE,
  XR_FIXED_AREAL_RADIUS,
  chooseXRTargetFrameRate,
  createXRViewState,
} from "./xr.js?v=20260821-vr-lut-v3";

const QUALITY_PROFILES = {
  low: { maxSteps: 256, scale: 0.52, maxPixels: 750_000 },
  medium: { maxSteps: 320, scale: 0.78, maxPixels: 1_500_000 },
  high: { maxSteps: 416, scale: 1.0, maxPixels: 2_000_000 },
  ultra: { maxSteps: 896, scale: 1.15, maxPixels: 3_000_000 },
};

const CAPTURE_RHO = 0.515;
const PHOTON_RHO = (2 + Math.sqrt(3)) / 2;
const RADIAL_TRACK_MIN_AREAL = 2;
const RADIAL_TRACK_MAX_AREAL = 22;
const STATION_DOUBLE_BAND_LATITUDE = 0.1875;
const STATION_ENVELOPE_HALF_ANGLE = 0.1125;
const STATION_RADIAL_ENVELOPE = 0.01;
const STATION_ASSEMBLY_RADII = [PHOTON_RHO];
const CONTEXT_RECOVERY_KEY = "schwarzschild-context-recovery";
const STABLE_FRAMES_BEFORE_RECOVERY_CLEAR = 120;
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
const retryStartupButton = document.querySelector("#retryStartupButton");
const radiusValue = document.querySelector("#radiusValue");
const fpsValue = document.querySelector("#fpsValue");
const stepValue = document.querySelector("#stepValue");
const radiusMarker = document.querySelector("#radiusMarker");
const pointerHint = document.querySelector("#pointerHint");
const statusPill = document.querySelector("#statusPill");
const statusText = document.querySelector("#statusText");
const enterVrButton = document.querySelector("#enterVrButton");
const vrStatus = document.querySelector("#vrStatus");
const controlsPanel = document.querySelector(".controls-panel");
const radialLandmarks = document.querySelectorAll("[data-areal-radius]");

function readContextRecoveryCount() {
  try {
    return Math.max(0, Number(sessionStorage.getItem(CONTEXT_RECOVERY_KEY)) || 0);
  } catch {
    return 0;
  }
}

function writeContextRecoveryCount(count) {
  try {
    sessionStorage.setItem(CONTEXT_RECOVERY_KEY, String(count));
  } catch {
    // Recovery remains available for this page even without session storage.
  }
}

function clearContextRecoveryCount() {
  try {
    sessionStorage.removeItem(CONTEXT_RECOVERY_KEY);
  } catch {
    // Storage may be unavailable in hardened private browsing modes.
  }
}

const initialQuality = readContextRecoveryCount() > 0 ? "low" : "medium";
const settings = {
  quality: initialQuality,
  maxSteps: QUALITY_PROFILES[initialQuality].maxSteps,
  baseStep: 0.09,
  fov: 68,
  shellCount: 8,
  exposure: 1.1,
  saturation: 1.18,
  stationRotationSpeed: 0.015,
  photonLabelOpacity: 1,
  lensing: true,
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
let animationFrameId = 0;
let rendererGeneration = 0;
let applicationState = "starting";
let stableFrameCount = 0;
let xrSession = null;
let xrReferenceSpace = null;
let xrInitialViewerPosition = null;
let xrLastFrameTime = Number.NaN;
let xrFrameRequestId = 0;
let xrImmersiveSupported = null;
let xrTargetFrameRate = 72;
let xrPerformanceWindowStart = Number.NaN;
let xrPerformanceFrameCount = 0;
let xrSlowFrameCount = 0;
let xrLastPerformanceSummary = "";
const xrRig = new FixedBlackHoleXRRig();

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

function applyQualityProfile(quality) {
  settings.quality = quality;
  const profile = QUALITY_PROFILES[quality];
  settings.maxSteps = profile.maxSteps;
  renderer?.setQuality(profile);
  stepValue.textContent = `${settings.maxSteps} RK2`;
}

function bindControls() {
  for (const landmark of radialLandmarks) {
    const radius = Number(landmark.dataset.arealRadius);
    landmark.style.left = `${arealRadiusToTrackPercent(radius)}%`;
  }

  const qualitySelect = document.querySelector("#qualitySelect");
  qualitySelect.value = settings.quality;
  const updateQuality = () => {
    applyQualityProfile(qualitySelect.value);
  };
  qualitySelect.addEventListener("change", updateQuality);
  updateQuality();

  bindRange("rayStepInput", "rayStepOutput", "baseStep", (value) => value.toFixed(3));
  bindRange("speedInput", "speedOutput", null, (value) => value.toFixed(2), (value) => {
    if (camera) camera.speed = value;
  });
  bindRange(
    "rotationSpeedInput",
    "rotationSpeedOutput",
    "stationRotationSpeed",
    (value) => `${Math.round((value / 0.015) * 100)}%`,
  );
  bindRange("fovInput", "fovOutput", "fov", (value) => `${Math.round(value)}°`);
  bindRange("exposureInput", "exposureOutput", "exposure", (value) => value.toFixed(2));
  bindRange("saturationInput", "saturationOutput", "saturation", (value) => value.toFixed(2));

  const lensingInput = document.querySelector("#lensingInput");
  const updateLensing = () => {
    settings.lensing = lensingInput.checked;
  };
  lensingInput.addEventListener("change", updateLensing);
  updateLensing();

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

  document.querySelector("#resetButton").addEventListener("click", resetCamera);
  document.querySelector("#hideUiButton").addEventListener("click", toggleUi);
  enterVrButton.addEventListener("click", () => void toggleXRSession());

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
    if (event.code === "KeyR") resetCamera();
    if (event.code === "KeyH") toggleUi();
  });

  document.addEventListener("visibilitychange", () => {
    renderer?.invalidateHistory();
  });
}

function resetCamera() {
  camera?.reset();
  xrRig.reset();
  renderer?.invalidateHistory();
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
  const radius = xrSession ? xrRig.arealRadius : camera.arealRadius;
  radiusValue.textContent = `${radius.toFixed(radius < 10 ? 3 : 2)} M`;
  fpsValue.textContent = `${Math.round(smoothedFps)} FPS`;
  stepValue.textContent = xrSession
    ? "PRECOMPUTED"
    : `${settings.maxSteps} RK2`;

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
    statusText.textContent = xrSession
      ? "QUEST 3 PC VR · SCHWARZSCHILD FIELD"
      : "SCHWARZSCHILD FIELD · STABLE";
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

function stationAssemblyBandEnvelope(position, assemblyIndex) {
  const stationRadius = Math.hypot(...position);
  const stationLatitude = Math.asin(
    Math.max(
      0,
      Math.min(1, Math.abs(position[1]) / Math.max(stationRadius, 1e-8)),
    ),
  );
  const angularEnvelope = stationRadius * Math.sin(
    Math.abs(stationLatitude - STATION_DOUBLE_BAND_LATITUDE)
      - STATION_ENVELOPE_HALF_ANGLE,
  );
  const radialEnvelope =
    Math.abs(stationRadius - STATION_ASSEMBLY_RADII[assemblyIndex])
    - STATION_RADIAL_ENVELOPE;
  return Math.max(radialEnvelope, angularEnvelope);
}

function stationBandEnvelope(position) {
  return Math.min(
    ...STATION_ASSEMBLY_RADII.map((_, assemblyIndex) =>
      stationAssemblyBandEnvelope(position, assemblyIndex),
    ),
  );
}

function probeStepSize(
  position,
  baseStep,
  spheresVisible,
  ringsVisible,
  shellCount,
) {
  const rho = Math.hypot(...position);
  let rayStep = baseStep * (0.35 + 5.65 * smoothstep(1.2, 18, rho));
  const photonBlend = smoothstep(0, 0.28, Math.abs(rho - PHOTON_RHO));
  rayStep = Math.min(rayStep, 0.016 + (rayStep - 0.016) * photonBlend);

  if (spheresVisible && rho > 0.64 && rho < 7.3) {
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

function setVrStatus(message) {
  vrStatus.textContent = message;
}

function resetXRPerformanceTelemetry() {
  xrPerformanceWindowStart = Number.NaN;
  xrPerformanceFrameCount = 0;
  xrSlowFrameCount = 0;
}

async function preferComfortableXRFrameRate(session) {
  const target = chooseXRTargetFrameRate(session.supportedFrameRates);
  if (target && typeof session.updateTargetFrameRate === "function") {
    try {
      await session.updateTargetFrameRate(target);
      return target;
    } catch (error) {
      console.warn(`Quest refresh-rate request was declined: ${error}`);
    }
  }
  return Number(session.frameRate) || 72;
}

function updateXRPerformanceTelemetry(time, deltaSeconds) {
  if (!Number.isFinite(xrPerformanceWindowStart)) {
    xrPerformanceWindowStart = time;
    return;
  }

  xrPerformanceFrameCount += 1;
  if (deltaSeconds >= 1.18 / Math.max(xrTargetFrameRate, 1)) {
    xrSlowFrameCount += 1;
  }

  const elapsed = time - xrPerformanceWindowStart;
  if (elapsed < 1000) return;
  const appFps = xrPerformanceFrameCount * 1000 / Math.max(elapsed, 1);
  const slowPercent = xrPerformanceFrameCount > 0
    ? 100 * xrSlowFrameCount / xrPerformanceFrameCount
    : 0;
  const stats = renderer?.xrFrameStats;
  const eyeSize = stats?.viewCount
    ? ` · ${stats.maxWidth}×${stats.maxHeight}/eye`
    : "";
  xrLastPerformanceSummary =
    `${Math.round(xrTargetFrameRate)} Hz target · ${Math.round(appFps)} app fps${eyeSize}`
    + ` · ${Math.round(slowPercent)}% slow · stereo LUT`;
  setVrStatus(xrLastPerformanceSummary);
  xrPerformanceWindowStart = time;
  xrPerformanceFrameCount = 0;
  xrSlowFrameCount = 0;
}

async function checkXRSupport() {
  if (!window.isSecureContext) {
    xrImmersiveSupported = false;
    enterVrButton.disabled = true;
    setVrStatus("VR requires HTTPS or localhost");
    return false;
  }
  if (!navigator.xr) {
    xrImmersiveSupported = false;
    enterVrButton.disabled = true;
    setVrStatus("WebXR is unavailable in this browser");
    return false;
  }

  enterVrButton.disabled = true;
  setVrStatus("Checking Meta Quest Link…");
  try {
    const supported = await navigator.xr.isSessionSupported("immersive-vr");
    xrImmersiveSupported = supported;
    enterVrButton.disabled = false;
    enterVrButton.textContent = supported ? "Enter Quest 3 VR" : "Check Quest Link";
    setVrStatus(
      supported
        ? `Quest Link detected · fixed stereo view at r = ${XR_FIXED_AREAL_RADIUS}M`
        : "Start Quest Link, connect the headset, then check again",
    );
    return supported;
  } catch (error) {
    console.error(error);
    xrImmersiveSupported = false;
    enterVrButton.disabled = false;
    enterVrButton.textContent = "Check Quest Link";
    setVrStatus("The browser could not query the VR runtime");
    return false;
  }
}

function xrRenderSettings() {
  return {
    ...settings,
    spheresVisible: false,
    shellCount: 0,
    photonLabelOpacity: 0,
  };
}

function handleXRSessionEnded(endedSession) {
  if (xrSession && xrSession !== endedSession) return;
  const performanceSummary = xrLastPerformanceSummary;
  xrSession = null;
  xrReferenceSpace = null;
  xrInitialViewerPosition = null;
  xrLastFrameTime = Number.NaN;
  xrFrameRequestId = 0;
  xrTargetFrameRate = 72;
  resetXRPerformanceTelemetry();
  renderer?.finishXRSession();
  document.body.classList.remove("xr-active");
  enterVrButton.disabled = false;
  enterVrButton.textContent = "Enter Quest 3 VR";
  setVrStatus(
    performanceSummary
      ? `VR ended · last sample: ${performanceSummary}`
      : "VR session ended · desktop view resumed",
  );
  lastFrameTime = performance.now();
  if (applicationState === "running" && renderer && !animationFrameId) {
    animationFrameId = requestAnimationFrame(animate);
  }
}

async function startXRSession() {
  if (xrSession || applicationState !== "running" || !renderer) return;
  if (xrImmersiveSupported !== true) {
    await checkXRSupport();
    if (xrImmersiveSupported) {
      setVrStatus("Quest Link is ready · click Enter Quest 3 VR again");
    }
    return;
  }

  enterVrButton.disabled = true;
  setVrStatus("Opening Quest 3 immersive session…");
  let session;
  try {
    session = await navigator.xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor"],
    });
    const sessionRenderer = renderer;
    xrSession = session;
    session.addEventListener(
      "end",
      () => handleXRSessionEnded(session),
      { once: true },
    );
    await sessionRenderer.prepareXRSession(
      session,
      XR_FRAMEBUFFER_SCALE,
    );
    if (renderer !== sessionRenderer || applicationState !== "running") {
      throw new Error("The renderer changed while Quest Link was starting.");
    }

    xrReferenceSpace = await session.requestReferenceSpace("local");
    xrTargetFrameRate = await preferComfortableXRFrameRate(session);
    xrLastPerformanceSummary = "";
    xrRig.reset();
    xrInitialViewerPosition = null;
    xrLastFrameTime = Number.NaN;
    resetXRPerformanceTelemetry();
    smoothedFps = xrTargetFrameRate;
    stopAnimation();
    document.body.classList.add("xr-active");
    enterVrButton.disabled = false;
    enterVrButton.textContent = "Exit VR";
    const refresh = xrTargetFrameRate;
    setVrStatus(
      refresh > 0
        ? `Quest 3 active at ${Math.round(refresh)} Hz · fixed r = ${XR_FIXED_AREAL_RADIUS}M · stereo LUT`
        : `Quest 3 active · fixed r = ${XR_FIXED_AREAL_RADIUS}M · stereo LUT`,
    );
    xrFrameRequestId = session.requestAnimationFrame(onXRFrame);
  } catch (error) {
    console.error(error);
    setVrStatus(error instanceof Error ? error.message : String(error));
    enterVrButton.disabled = false;
    enterVrButton.textContent = "Check Quest Link";
    if (session) {
      try {
        await session.end();
      } catch {
        handleXRSessionEnded(session);
      }
    } else {
      xrSession = null;
    }
  }
}

async function toggleXRSession() {
  if (xrSession) {
    enterVrButton.disabled = true;
    setVrStatus("Closing VR session…");
    await xrSession.end();
    return;
  }
  await startXRSession();
}

function onXRFrame(time, frame) {
  const session = frame.session;
  if (!xrSession || session !== xrSession || !renderer || !xrReferenceSpace) {
    return;
  }
  xrFrameRequestId = session.requestAnimationFrame(onXRFrame);

  try {
    const pose = frame.getViewerPose(xrReferenceSpace);
    if (!pose) return;
    if (!xrInitialViewerPosition) {
      xrInitialViewerPosition = {
        x: pose.transform.position.x,
        y: pose.transform.position.y,
        z: pose.transform.position.z,
      };
    }

    const deltaSeconds = Number.isFinite(xrLastFrameTime)
      ? Math.min((time - xrLastFrameTime) / 1000, 0.05)
      : 0;
    xrLastFrameTime = time;
    const viewStates = pose.views.map((view) =>
      createXRViewState(view, xrInitialViewerPosition, xrRig)
    );
    const sceneTime = Number.isFinite(frame.predictedDisplayTime)
      ? frame.predictedDisplayTime / 1000
      : time / 1000;
    if (!renderer.renderXR(viewStates, xrRenderSettings(), sceneTime)) return;

    if (deltaSeconds > 0) {
      const instantaneousFps = 1 / Math.max(deltaSeconds, 1 / 240);
      smoothedFps += (instantaneousFps - smoothedFps) * 0.055;
    }
    updateXRPerformanceTelemetry(time, deltaSeconds);
    updateTelemetry(time);
    stableFrameCount += 1;
    if (stableFrameCount === STABLE_FRAMES_BEFORE_RECOVERY_CLEAR) {
      clearContextRecoveryCount();
    }
  } catch (error) {
    console.error(error);
    setVrStatus("VR rendering stopped after an unexpected error");
    void session.end();
  }
}

function stopAnimation() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }
}

function showLoadingState(message) {
  fatalError.hidden = true;
  loadingDetail.textContent = message;
  loadingScreen.classList.remove("loaded");
}

function failRuntime(error) {
  applicationState = "failed";
  stopAnimation();
  loadingScreen.classList.add("loaded");
  fatalMessage.textContent = error instanceof Error
    ? error.message
    : String(error);
  fatalError.hidden = false;
  statusText.textContent = "RENDERER OFFLINE";
}

function handleContextLost(event) {
  event.preventDefault();
  if (xrSession) void xrSession.end();
  rendererGeneration += 1;
  applicationState = "context-lost";
  stopAnimation();
  renderer?.invalidateHistory();
  renderer = undefined;
  writeContextRecoveryCount(
    Math.min(2, readContextRecoveryCount() + 1),
  );
  showLoadingState("Graphics context lost · restoring at safe quality…");
  statusText.textContent = "GRAPHICS RESET · RECOVERING";
}

async function handleContextRestored() {
  if (applicationState !== "context-lost") return;
  const qualitySelect = document.querySelector("#qualitySelect");
  qualitySelect.value = "low";
  applyQualityProfile("low");
  await initializeRenderer(true);
}

function animate(now) {
  animationFrameId = 0;
  if (applicationState !== "running" || !renderer || !camera || xrSession) return;

  try {
    const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05);
    lastFrameTime = now;
    camera.update(deltaSeconds);

    if (!renderer.render(camera, settings, now / 1000)) return;

    const instantaneousFps = 1 / Math.max(deltaSeconds, 1 / 240);
    smoothedFps += (instantaneousFps - smoothedFps) * 0.035;
    probeCriticalRays(now);
    updateTelemetry(now);
    stableFrameCount += 1;
    if (stableFrameCount === STABLE_FRAMES_BEFORE_RECOVERY_CLEAR) {
      clearContextRecoveryCount();
    }
    animationFrameId = requestAnimationFrame(animate);
  } catch (error) {
    if (renderer?.isContextLost()) return;
    if (/allocate the temporal render targets/i.test(String(error))) {
      writeContextRecoveryCount(1);
    }
    failRuntime(error);
  }
}

async function initializeRenderer(recovering = false) {
  const generation = ++rendererGeneration;
  applicationState = "starting";
  showLoadingState(
    recovering
      ? "Rebuilding graphics resources at safe quality…"
      : "Preparing the WebGL2 renderer…",
  );

  try {
    const nextRenderer = await SchwarzschildRenderer.create(
      canvas,
      (message) => {
        if (generation === rendererGeneration) {
          loadingDetail.textContent = message;
        }
      },
    );
    if (
      generation !== rendererGeneration
      || applicationState === "context-lost"
      || nextRenderer.isContextLost()
    ) {
      return;
    }

    renderer = nextRenderer;
    renderer.setQuality(QUALITY_PROFILES[settings.quality]);

    const physics = runPhysicsSelfCheck();
    if (!Object.values(physics).every(Boolean)) {
      throw new Error(
        "The startup physics self-check did not converge. Try reloading the page.",
      );
    }

    loadingDetail.textContent =
      `${renderer.textureSize.width}×${renderer.textureSize.height} sky · `
      + `${renderer.transferTable.width}×${renderer.transferTable.height} stereo ray table loaded`;
    applicationState = "running";
    stableFrameCount = 0;
    statusText.textContent = recovering
      ? "SCHWARZSCHILD FIELD · RECOVERED"
      : "SCHWARZSCHILD FIELD · STABLE";
    lastFrameTime = performance.now();
    window.setTimeout(() => {
      if (applicationState === "running") {
        loadingScreen.classList.add("loaded");
      }
    }, 260);
    animationFrameId = requestAnimationFrame(animate);
  } catch (error) {
    if (
      generation !== rendererGeneration
      || applicationState === "context-lost"
    ) {
      return;
    }
    failRuntime(error);
  }
}

async function start() {
  camera = new FirstPersonCamera(canvas);
  bindControls();
  camera.speed = Number(document.querySelector("#speedInput").value);
  retryStartupButton.addEventListener("click", () => window.location.reload());
  canvas.addEventListener("webglcontextlost", handleContextLost, false);
  canvas.addEventListener(
    "webglcontextrestored",
    () => void handleContextRestored(),
    false,
  );
  await initializeRenderer(false);
  await checkXRSupport();
}

start();
