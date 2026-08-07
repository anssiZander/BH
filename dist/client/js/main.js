import {
  FirstPersonCamera,
  arealToIsotropic,
  isotropicToAreal,
} from "./camera.js?v=20260805-orbit-v1";
import { SchwarzschildRenderer } from "./webgl.js?v=20260804-hemispheres-v2";
import {
  CameraTrackRecorder,
  PRODUCTION_RENDER_PROFILE,
  evaluateCameraTrack,
  normalizeTrimRange,
  productionFrameCount,
  productionFrameTime,
  validateCameraTrack,
} from "./camera-track.js?v=20260804-hemispheres-v2";
import {
  ProductionRenderSession,
  inspectProductionSupport,
} from "./production-renderer.js?v=20260804-hemispheres-v2";

const APPLICATION_VERSION = "2026.08.05-orbit-v1";
const MAX_PRODUCTION_FRAMES = 1_000_000;
const GPU_SAFE_MODE_STORAGE_KEY = "schwarzschild-gpu-safe-mode";

function readGpuSafeModeRequest() {
  try {
    return sessionStorage.getItem(GPU_SAFE_MODE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function requestGpuSafeMode() {
  try {
    sessionStorage.setItem(GPU_SAFE_MODE_STORAGE_KEY, "1");
  } catch {
    // The conservative live defaults still apply when storage is unavailable.
  }
}

function clearGpuSafeModeRequest() {
  try {
    sessionStorage.removeItem(GPU_SAFE_MODE_STORAGE_KEY);
  } catch {
    // Storage is optional; no recovery behavior depends on clearing it.
  }
}

const gpuSafeModeRequested = readGpuSafeModeRequest();

const QUALITY_PROFILES = {
  low: { maxSteps: 192, scale: 0.45, maxPixels: 450_000 },
  medium: { maxSteps: 288, scale: 0.64, maxPixels: 900_000 },
  high: { maxSteps: 384, scale: 0.88, maxPixels: 1_800_000 },
  ultra: { maxSteps: 640, scale: 1.0, maxPixels: 2_600_000 },
};
const PRODUCTION_MAX_STEPS = 896;
const PHYSICS_SELF_CHECK_STEPS = 416;

const CAPTURE_RHO = 0.515;
const PHOTON_RHO = (2 + Math.sqrt(3)) / 2;
const RADIAL_TRACK_MIN_AREAL = 2;
const RADIAL_TRACK_MAX_AREAL = 22;
const STATION_EQUATORIAL_GAP_HALF_ANGLE = 0.125;
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
const recordButton = document.querySelector("#recordButton");
const recordButtonText = document.querySelector("#recordButtonText");
const recordStatus = document.querySelector("#recordStatus");
const controlsPanel = document.querySelector(".controls-panel");
const radialLandmarks = document.querySelectorAll("[data-areal-radius]");
const pathRecordButton = document.querySelector("#pathRecordButton");
const pathStopButton = document.querySelector("#pathStopButton");
const trackSaveButton = document.querySelector("#trackSaveButton");
const trackLoadButton = document.querySelector("#trackLoadButton");
const trackFileInput = document.querySelector("#trackFileInput");
const trackResetButton = document.querySelector("#trackResetButton");
const trackPreviewButton = document.querySelector("#trackPreviewButton");
const trackPreviewStopButton = document.querySelector("#trackPreviewStopButton");
const smoothingInput = document.querySelector("#smoothingInput");
const smoothingOutput = document.querySelector("#smoothingOutput");
const trimStartInput = document.querySelector("#trimStartInput");
const trimEndInput = document.querySelector("#trimEndInput");
const sampleCountInput = document.querySelector("#sampleCountInput");
const renderStartInput = document.querySelector("#renderStartInput");
const testRenderButton = document.querySelector("#testRenderButton");
const productionRenderButton = document.querySelector("#productionRenderButton");
const productionCancelButton = document.querySelector("#productionCancelButton");
const trackStatus = document.querySelector("#trackStatus");
const productionStatus = document.querySelector("#productionStatus");
const productionProgress = document.querySelector("#productionProgress");
const productionProgressText = document.querySelector("#productionProgressText");

const settings = {
  quality: gpuSafeModeRequested ? "low" : "medium",
  maxSteps: gpuSafeModeRequested
    ? QUALITY_PROFILES.low.maxSteps
    : QUALITY_PROFILES.medium.maxSteps,
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
let simulationTimeSeconds = lastFrameTime / 1000;
let smoothedFps = 60;
let lastTelemetryTime = 0;
let stepCapDetected = false;
let lastProbeTime = 0;
let uiHidden = false;
let photonLabelTarget = 1;
let contextLost = false;
let suppressUnloadWarning = false;
let stableLiveFrameCount = 0;

const cameraTrackRecorder = new CameraTrackRecorder();
const trackState = {
  track: null,
  filename: "",
  unsaved: false,
};
const trackLoadState = {
  active: false,
  token: 0,
};
const previewState = {
  active: false,
  startedAt: 0,
  trim: null,
  restore: null,
  finishAfterFrame: false,
};
const productionState = {
  preparing: false,
  active: false,
  cancelRequested: false,
  session: null,
};

const RECORDING_FPS = 60;
const RECORDING_TIME_STEP_SECONDS = 1 / RECORDING_FPS;
const RECORDING_VIDEO_BITS_PER_SECOND = 16_000_000;
const recordingState = {
  isRecording: false,
  isFinalizing: false,
  recorder: null,
  stream: null,
  captureTrack: null,
  manualFrameCapture: false,
  chunks: [],
  mimeType: "",
  extension: "mp4",
  formatLabel: "MP4",
  frameCount: 0,
  lastStatusSecond: -1,
};

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
  if (gpuSafeModeRequested) qualitySelect.value = "low";
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
  bindRange(
    "rotationSpeedInput",
    "rotationSpeedOutput",
    "stationRotationSpeed",
    (value) => `${Math.round((value / 0.015) * 100)}%`,
  );
  bindRange("fovInput", "fovOutput", "fov", (value) => `${Math.round(value)}°`);
  bindRange("shellInput", "shellOutput", "shellCount", (value) => `${Math.round(value)}`);
  bindRange("exposureInput", "exposureOutput", "exposure", (value) => value.toFixed(2));
  bindRange("saturationInput", "saturationOutput", "saturation", (value) => value.toFixed(2));

  const lensingInput = document.querySelector("#lensingInput");
  const updateLensing = () => {
    settings.lensing = lensingInput.checked;
  };
  lensingInput.addEventListener("change", updateLensing);
  updateLensing();

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

  const photonIndicatorInput = document.querySelector("#photonIndicatorInput");
  const updatePhotonIndicatorVisibility = () => {
    photonLabelTarget = photonIndicatorInput.checked ? 1 : 0;
    renderer?.invalidateHistory();
  };
  photonIndicatorInput.addEventListener(
    "change",
    updatePhotonIndicatorVisibility,
  );
  updatePhotonIndicatorVisibility();

  document.querySelector("#resetButton").addEventListener("click", resetCamera);
  document.querySelector("#hideUiButton").addEventListener("click", toggleUi);
  recordButton.addEventListener("click", () => {
    if (recordingState.isRecording) stopRecording();
    else startRecording();
  });
  updateRecordingIdleUi();
  bindProductionControls();

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
    if (
      event.code === "KeyR"
      && !cameraTrackRecorder.active
      && !previewState.active
      && !productionState.active
    ) resetCamera();
    if (event.code === "KeyH") toggleUi();
  });

  document.addEventListener("visibilitychange", () => {
    renderer?.invalidateHistory();
  });
  window.addEventListener("pagehide", releaseRecordingStream);
  window.addEventListener("beforeunload", (event) => {
    if (suppressUnloadWarning) return;
    if (
      productionState.active
      || productionState.preparing
      || cameraTrackRecorder.active
      || previewState.active
      || trackLoadState.active
      || trackState.unsaved
    ) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

const STANDARD_CONTROL_IDS = Object.freeze([
  "qualitySelect",
  "rayStepInput",
  "speedInput",
  "rotationSpeedInput",
  "fovInput",
  "shellInput",
  "exposureInput",
  "saturationInput",
  "lensingInput",
  "spheresVisibleInput",
  "skyVisibleInput",
  "ringsVisibleInput",
  "photonIndicatorInput",
  "resetButton",
]);

const PATH_LOCKED_CONTROL_IDS = STANDARD_CONTROL_IDS.filter(
  (id) => id !== "speedInput" && id !== "fovInput",
);

function setControlIdsDisabled(ids, disabled) {
  for (const id of ids) {
    const element = document.querySelector(`#${id}`);
    if (element) element.disabled = disabled;
  }
}

function isWorkflowBusy() {
  return (
    cameraTrackRecorder.active
    || previewState.active
    || trackLoadState.active
    || productionState.active
    || productionState.preparing
    || recordingState.isRecording
    || recordingState.isFinalizing
  );
}

function updateWorkflowUi() {
  const pathRecording = cameraTrackRecorder.active;
  const previewing = previewState.active;
  const loadingTrack = trackLoadState.active;
  const rendering = productionState.active || productionState.preparing;
  const quickBusy = recordingState.isRecording || recordingState.isFinalizing;
  const hasTrack = Boolean(trackState.track);
  const otherBusy = pathRecording || previewing || loadingTrack || rendering || quickBusy;

  setControlIdsDisabled(STANDARD_CONTROL_IDS, previewing || rendering);
  if (pathRecording) setControlIdsDisabled(PATH_LOCKED_CONTROL_IDS, true);

  pathRecordButton.disabled = otherBusy;
  pathStopButton.disabled = !pathRecording;
  trackSaveButton.disabled = !hasTrack || otherBusy;
  trackLoadButton.disabled = otherBusy;
  trackResetButton.disabled = !hasTrack || otherBusy;
  trackPreviewButton.disabled = !hasTrack || otherBusy;
  trackPreviewStopButton.disabled = !previewing;
  smoothingInput.disabled = previewing || rendering;
  trimStartInput.disabled = previewing || rendering;
  trimEndInput.disabled = previewing || rendering;
  sampleCountInput.disabled = rendering;
  renderStartInput.disabled = rendering;
  testRenderButton.disabled = !hasTrack || otherBusy;
  productionRenderButton.disabled = !hasTrack || otherBusy;
  productionCancelButton.disabled = !productionState.active || productionState.cancelRequested;
  if (!recordingState.isRecording && !recordingState.isFinalizing) {
    recordButton.disabled = otherBusy || !getPreferredRecordingFormat();
  }
}

function cameraPoseSnapshot() {
  return {
    position: Array.from(camera.position),
    forward: Array.from(camera.forward),
    right: Array.from(camera.right),
    up: Array.from(camera.up),
  };
}

function restoreInteractiveState(snapshot) {
  if (!snapshot || !camera) return;
  Object.assign(settings, snapshot.settings);
  photonLabelTarget = snapshot.photonLabelTarget ?? settings.photonLabelOpacity;
  simulationTimeSeconds = snapshot.sceneTime;
  camera.setPlaybackPose(
    snapshot.camera.position,
    snapshot.camera.forward,
    snapshot.camera.right,
    snapshot.camera.up,
  );
  camera.setInputEnabled(true);
  renderer.setQuality(QUALITY_PROFILES[settings.quality]);
  renderer.invalidateHistory();
  lastFrameTime = performance.now();
}

function getTrackTrim() {
  if (!trackState.track) throw new Error("Record or load a camera track first.");
  return normalizeTrimRange(
    trackState.track,
    Number(trimStartInput.value),
    Number(trimEndInput.value),
  );
}

function setTrack(track, { filename = "", unsaved = false } = {}) {
  trackState.track = validateCameraTrack(track);
  trackState.filename = filename;
  trackState.unsaved = unsaved;
  trimStartInput.value = "0.00";
  trimEndInput.value = String(trackState.track.durationSeconds);
  renderStartInput.value = "";
  const saveState = unsaved ? " · unsaved (a recovery copy will be written with the render)" : "";
  trackStatus.textContent = `${filename || "Current track"} · ${trackState.track.durationSeconds.toFixed(2)} s · ${trackState.track.samples.length} samples${saveState}`;
  productionStatus.textContent = "Track ready for preview or production rendering";
  updateWorkflowUi();
}

function startCameraPathRecording() {
  if (!camera || !renderer || isWorkflowBusy()) return;
  if (trackState.unsaved && !window.confirm("Replace the current unsaved camera track?")) return;
  try {
    settings.photonLabelOpacity = photonLabelTarget;
    cameraTrackRecorder.start({
      camera,
      fov: settings.fov,
      sceneTime: simulationTimeSeconds,
      settings,
      now: performance.now(),
    });
    trackStatus.textContent = "Recording camera path · navigate normally";
    productionStatus.textContent = "Camera states only; no image frames are stored";
    updateWorkflowUi();
  } catch (error) {
    trackStatus.textContent = error.message;
  }
}

function stopCameraPathRecording() {
  if (!cameraTrackRecorder.active) return;
  try {
    const track = cameraTrackRecorder.stop({
      camera,
      fov: settings.fov,
      sceneTime: simulationTimeSeconds,
      now: performance.now(),
    });
    setTrack(track, { unsaved: true });
  } catch (error) {
    cameraTrackRecorder.cancel();
    trackStatus.textContent = error.message;
    updateWorkflowUi();
  }
}

function saveTrackJson() {
  if (!trackState.track) return;
  const blob = new Blob(
    [`${JSON.stringify(trackState.track, null, 2)}\n`],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const filename = trackState.filename || `schwarzschild-camera-track-${Date.now()}.json`;
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  trackState.filename = filename;
  trackState.unsaved = false;
  trackStatus.textContent = `Saved ${filename} · ${trackState.track.durationSeconds.toFixed(2)} s`;
}

async function loadTrackFile(file) {
  if (trackLoadState.active) return;
  if (trackState.unsaved && !window.confirm("Replace the current unsaved camera track?")) {
    trackFileInput.value = "";
    return;
  }
  const token = ++trackLoadState.token;
  trackLoadState.active = true;
  trackStatus.textContent = "Reading and validating camera-track JSON\u2026";
  updateWorkflowUi();
  try {
    if (!file || file.size > 32 * 1024 * 1024) {
      throw new Error("Choose a camera-track JSON file smaller than 32 MB.");
    }
    const candidate = JSON.parse(await file.text());
    if (token !== trackLoadState.token) return;
    setTrack(candidate, { filename: file.name, unsaved: false });
  } catch (error) {
    if (token === trackLoadState.token) {
      trackStatus.textContent = `Track rejected: ${error.message}`;
    }
  } finally {
    if (token === trackLoadState.token) {
      trackLoadState.active = false;
      trackFileInput.value = "";
      updateWorkflowUi();
    }
  }
}

function isTrackPositionSafeFor(track, position) {
  if (!track?.settings.ringsVisible) return true;
  return stationHemisphereEnvelope(position) > 0.018;
}

function evaluateCurrentTrack(time) {
  return evaluateCameraTrack(trackState.track, time, {
    smoothing: Number(smoothingInput.value),
    isPositionSafe: (position) => isTrackPositionSafeFor(trackState.track, position),
  });
}

function startTrackPreview() {
  if (!trackState.track || isWorkflowBusy()) return;
  let restore = null;
  try {
    const trim = getTrackTrim();
    evaluateCurrentTrack(trim.start);
    restore = {
      camera: cameraPoseSnapshot(),
      settings: { ...settings },
      sceneTime: simulationTimeSeconds,
      photonLabelTarget,
    };
    Object.assign(settings, trackState.track.settings);
    renderer.setQuality(QUALITY_PROFILES[settings.quality]);
    camera.setInputEnabled(false);
    previewState.restore = restore;
    previewState.active = true;
    previewState.startedAt = performance.now();
    previewState.trim = trim;
    previewState.finishAfterFrame = false;
    renderer.invalidateHistory();
    trackStatus.textContent = `Preview 0.00 / ${trim.duration.toFixed(2)} s`;
    updateWorkflowUi();
  } catch (error) {
    previewState.active = false;
    previewState.startedAt = 0;
    previewState.trim = null;
    previewState.restore = null;
    previewState.finishAfterFrame = false;
    if (restore) restoreInteractiveState(restore);
    trackStatus.textContent = `Preview unavailable: ${error.message}`;
    updateWorkflowUi();
  }
}

function stopTrackPreview({ completed = false } = {}) {
  if (!previewState.active) return;
  const restore = previewState.restore;
  previewState.active = false;
  previewState.startedAt = 0;
  previewState.trim = null;
  previewState.restore = null;
  previewState.finishAfterFrame = false;
  restoreInteractiveState(restore);
  trackStatus.textContent = completed
    ? `Preview complete · ${trackState.track.durationSeconds.toFixed(2)} s track`
    : "Preview stopped · interactive camera restored";
  updateWorkflowUi();
}

function updateTrackPreview(now) {
  const elapsed = Math.max(0, (now - previewState.startedAt) / 1000);
  const localTime = Math.min(elapsed, previewState.trim.duration);
  const trackTime = previewState.trim.start + localTime;
  const pose = evaluateCurrentTrack(trackTime);
  camera.setPlaybackPose(pose.position, pose.forward, pose.right, pose.up);
  settings.fov = pose.fov;
  simulationTimeSeconds = pose.sceneTime;
  trackStatus.textContent = `Preview ${localTime.toFixed(2)} / ${previewState.trim.duration.toFixed(2)} s`;
  previewState.finishAfterFrame = elapsed >= previewState.trim.duration;
}

function resetTrack() {
  if (trackState.unsaved && !window.confirm("Discard the unsaved camera track?")) return;
  trackState.track = null;
  trackState.filename = "";
  trackState.unsaved = false;
  trimStartInput.value = "0";
  trimEndInput.value = "0";
  renderStartInput.value = "";
  trackStatus.textContent = "No camera track loaded";
  productionStatus.textContent = "Choose or record a track to begin";
  productionProgress.value = 0;
  productionProgressText.textContent = "0 / 0 frames";
  updateWorkflowUi();
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = String(rounded % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`
    : `${minutes}:${remainder}`;
}

async function readManifest(directory) {
  try {
    const handle = await directory.getFileHandle("render_manifest.json");
    const file = await handle.getFile();
    if (file.size > 4 * 1024 * 1024) {
      throw new Error("render_manifest.json exceeds the 4 MiB safety limit");
    }
    return { manifest: JSON.parse(await file.text()), error: null };
  } catch (error) {
    if (error?.name === "NotFoundError") return { manifest: null, error: null };
    return {
      manifest: null,
      error: new Error(`Could not read the existing render manifest: ${error.message}`),
    };
  }
}

async function removeEntryIfPresent(directory, filename) {
  try {
    await directory.removeEntry(filename);
  } catch (error) {
    if (error?.name !== "NotFoundError") throw error;
  }
}

async function writeTextFile(directory, filename, text) {
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (error) {
    await writable.abort?.();
    throw error;
  }
}

async function writeBlobFile(directory, filename, blob) {
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort?.();
    throw error;
  }
}

async function listFrameFiles(directory) {
  const frames = new Map();
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== "file") continue;
    const match = /^frame_(\d{6})\.png$/.exec(name);
    if (!match) continue;
    const index = Number(match[1]);
    if (index >= 0) frames.set(index, { name, handle });
  }
  return frames;
}

async function validateFrameFiles(frameFiles, width, height) {
  const validated = new Set();
  const sortedFrames = [...frameFiles.entries()].sort(([first], [second]) => first - second);
  for (const [index, entry] of sortedFrames) {
    try {
      const file = await entry.handle.getFile();
      await assertPngDimensions(file, width, height);
      validated.add(index);
    } catch (error) {
      throw new Error(`${entry.name} is not a resumable production frame: ${error.message}`);
    }
  }
  return validated;
}

async function removeFrameFiles(directory, frameFiles, predicate = () => true) {
  for (const [index, entry] of [...frameFiles]) {
    if (!predicate(index)) continue;
    await directory.removeEntry(entry.name);
    frameFiles.delete(index);
  }
}

function firstMissingFrame(indices, frameCount) {
  for (let index = 0; index < frameCount; index += 1) {
    if (!indices.has(index)) return index;
  }
  return frameCount;
}

async function assertPngDimensions(blob, width, height) {
  const header = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (header.length < 24 || !signature.every((value, index) => header[index] === value)) {
    throw new Error("The encoded production frame is not a valid PNG.");
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(16) !== width || view.getUint32(20) !== height) {
    throw new Error("The encoded PNG does not have the required 2560×1440 dimensions.");
  }
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot fully decode-check production PNG files.");
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
    if (bitmap.width !== width || bitmap.height !== height) {
      throw new Error("The decoded PNG dimensions do not match its IHDR header.");
    }
  } catch (error) {
    throw new Error(`The PNG could not be decoded completely: ${error.message}`);
  } finally {
    bitmap?.close();
  }
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("The render contract contains an unsupported value.");
  return encoded;
}

async function createRenderFingerprint(contract) {
  const hash = await sha256Hex(new TextEncoder().encode(canonicalJson(contract)));
  if (!hash) {
    throw new Error("SHA-256 is required to create a resumable production render.");
  }
  return hash;
}

function manifestCompatible(manifest, profile) {
  if (!manifest) return true;
  return (
    manifest.width === profile.width
    && manifest.height === profile.height
    && manifest.fps === profile.fps
    && manifest.frameCount === profile.frameCount
    && manifest.samplesPerFrame === profile.samplesPerFrame
    && manifest.applicationVersion === profile.applicationVersion
    && manifest.renderFingerprint === profile.renderFingerprint
  );
}

async function beginProductionRender({ testOnly = false } = {}) {
  if (!trackState.track || isWorkflowBusy()) return;
  if (typeof window.showDirectoryPicker !== "function") {
    productionStatus.textContent = "Production export requires Chrome or Edge with the File System Access API";
    return;
  }

  productionState.preparing = true;
  updateWorkflowUi();
  const finishPreparation = () => {
    productionState.preparing = false;
    updateWorkflowUi();
  };

  let renderRequest;
  try {
    const track = validateCameraTrack(trackState.track);
    const trim = normalizeTrimRange(
      track,
      Number(trimStartInput.value),
      Number(trimEndInput.value),
    );
    const smoothing = Number(smoothingInput.value);
    if (!Number.isFinite(smoothing) || smoothing < 0 || smoothing > 1) {
      throw new Error("Smoothing must be between zero and one.");
    }
    const sourceFrameCount = productionFrameCount(trim.duration);
    if (sourceFrameCount > MAX_PRODUCTION_FRAMES) {
      throw new Error("The trimmed track exceeds the one-million-frame sequence limit.");
    }
    const samplesPerFrame = Number(sampleCountInput.value);
    if (!PRODUCTION_RENDER_PROFILE.sampleOptions.includes(samplesPerFrame)) {
      throw new Error("Choose 1, 4, 8, or 16 samples per frame.");
    }
    const support = inspectProductionSupport(renderer);
    if (!support.supported) throw new Error(support.reason);
    const frameCount = testOnly ? Math.min(30, sourceFrameCount) : sourceFrameCount;
    const productionSettings = {
      ...track.settings,
      quality: "ultra",
      maxSteps: PRODUCTION_MAX_STEPS,
    };
    renderRequest = {
      track,
      trackFilename: trackState.filename || "",
      trim,
      smoothing,
      sourceFrameCount,
      frameCount,
      samplesPerFrame,
      productionSettings,
    };
  } catch (error) {
    productionStatus.textContent = `Production render unavailable: ${error.message}`;
    finishPreparation();
    return;
  }

  let directory;
  try {
    directory = await window.showDirectoryPicker({ mode: "readwrite" });
  } catch (error) {
    if (error?.name !== "AbortError") {
      productionStatus.textContent = `Could not open the output directory: ${error.message}`;
    }
    finishPreparation();
    return;
  }

  const {
    track,
    trackFilename,
    trim,
    smoothing,
    sourceFrameCount,
    frameCount,
    samplesPerFrame,
    productionSettings,
  } = renderRequest;
  const profile = {
    width: PRODUCTION_RENDER_PROFILE.width,
    height: PRODUCTION_RENDER_PROFILE.height,
    fps: PRODUCTION_RENDER_PROFILE.fps,
    frameCount,
    sourceFrameCount,
    samplesPerFrame,
    applicationVersion: APPLICATION_VERSION,
    trimStart: trim.start,
    trimEnd: testOnly
      ? Math.min(trim.end, trim.start + frameCount / PRODUCTION_RENDER_PROFILE.fps)
      : trim.end,
  };
  try {
    profile.renderFingerprint = await createRenderFingerprint({
      contractVersion: 1,
      applicationVersion: APPLICATION_VERSION,
      pipeline: "linear-rgba16f-hammersley-srgb-v1",
      width: profile.width,
      height: profile.height,
      fps: profile.fps,
      frameCount: profile.frameCount,
      sourceFrameCount: profile.sourceFrameCount,
      samplesPerFrame: profile.samplesPerFrame,
      trimStart: profile.trimStart,
      trimEnd: profile.trimEnd,
      smoothing,
      settings: productionSettings,
      track,
    });
  } catch (error) {
    productionStatus.textContent = `Could not fingerprint the render settings: ${error.message}`;
    finishPreparation();
    return;
  }

  let frameFiles = new Map();
  let completedFrames = new Set();
  let priorManifest;
  let startFrame;
  let forcedRestart = false;
  try {
    const [listedFrames, manifestResult] = await Promise.all([
      listFrameFiles(directory),
      readManifest(directory),
    ]);
    frameFiles = listedFrames;
    priorManifest = manifestResult.manifest;
    const hasPriorOutput = Boolean(priorManifest) || Boolean(manifestResult.error) || frameFiles.size > 0;
    const compatibleOutput = !manifestResult.error
      && Boolean(priorManifest)
      && manifestCompatible(priorManifest, profile);
    if (hasPriorOutput && !compatibleOutput) {
      const reason = manifestResult.error ? ` (${manifestResult.error.message})` : "";
      if (!window.confirm(`This directory contains a different or unverifiable render${reason}. Delete its numbered frames and manifest, then start this render from frame 0?`)) {
        productionStatus.textContent = "Production render cancelled; existing files were left untouched";
        finishPreparation();
        return;
      }
      await removeFrameFiles(directory, frameFiles);
      await removeEntryIfPresent(directory, "render_manifest.json");
      priorManifest = null;
      forcedRestart = true;
    } else if (compatibleOutput) {
      completedFrames = await validateFrameFiles(
        frameFiles,
        profile.width,
        profile.height,
      );
      const extraIndices = [...completedFrames.keys()].filter((index) => index >= frameCount);
      if (extraIndices.length > 0) {
        if (!window.confirm(`This matching directory has ${extraIndices.length} numbered frame file(s) outside 0–${frameCount - 1}. Delete only those extra files?`)) {
          productionStatus.textContent = "Production render cancelled; existing files were left untouched";
          finishPreparation();
          return;
        }
        const extras = new Set(extraIndices);
        await removeFrameFiles(directory, frameFiles, (index) => extras.has(index));
        for (const index of extraIndices) completedFrames.delete(index);
      }
    }

    const explicitStart = renderStartInput.value.trim();
    if (forcedRestart) {
      startFrame = 0;
      renderStartInput.value = "";
    } else if (testOnly) {
      startFrame = 0;
      const collisions = [...completedFrames.keys()].filter((index) => index < frameCount);
      if (collisions.length > 0) {
        if (!window.confirm(`The test directory already has ${collisions.length} target frame(s). Delete and re-render them?`)) {
          finishPreparation();
          return;
        }
        const targets = new Set(collisions);
        await removeFrameFiles(directory, frameFiles, (index) => targets.has(index));
        for (const index of collisions) completedFrames.delete(index);
      }
    } else if (explicitStart === "") {
      startFrame = firstMissingFrame(completedFrames, frameCount);
    } else {
      startFrame = Number(explicitStart);
      if (!Number.isInteger(startFrame) || startFrame < 0 || startFrame >= frameCount) {
        throw new Error(`Start frame must be an integer from 0 to ${Math.max(0, frameCount - 1)}.`);
      }
      const missingEarlier = [];
      for (let index = 0; index < startFrame; index += 1) {
        if (!completedFrames.has(index)) missingEarlier.push(index);
      }
      if (missingEarlier.length > 0) {
        throw new Error(`Cannot start at frame ${startFrame}: ${missingEarlier.length} earlier frame(s) are missing. Leave Start frame empty to resume safely.`);
      }
      const collisions = [...completedFrames.keys()].filter(
        (index) => index >= startFrame && index < frameCount,
      );
      if (collisions.length > 0) {
        if (!window.confirm(`Starting at frame ${startFrame} will delete and re-render ${collisions.length} existing frame(s). Continue?`)) {
          finishPreparation();
          return;
        }
        const targets = new Set(collisions);
        await removeFrameFiles(directory, frameFiles, (index) => targets.has(index));
        for (const index of collisions) completedFrames.delete(index);
      }
    }
    if (startFrame >= frameCount) {
      if (priorManifest) {
        priorManifest.completedFrameCount = completedFrames.size;
        priorManifest.nextFrame = frameCount;
        priorManifest.status = "complete";
        priorManifest.updatedAt = new Date().toISOString();
        await writeTextFile(directory, "render_manifest.json", `${JSON.stringify(priorManifest, null, 2)}\n`);
      }
      productionStatus.textContent = `All ${frameCount} production frames already exist in this directory`;
      productionProgress.max = frameCount;
      productionProgress.value = frameCount;
      productionProgressText.textContent = `${frameCount} / ${frameCount} frames`;
      finishPreparation();
      return;
    }
  } catch (error) {
    productionStatus.textContent = `Could not inspect the output directory: ${error.message}`;
    finishPreparation();
    return;
  }

  const restore = {
    camera: cameraPoseSnapshot(),
    settings: { ...settings },
    sceneTime: simulationTimeSeconds,
    photonLabelTarget,
  };
  const trackSnapshotFilename = `camera_track_${profile.renderFingerprint.slice(0, 12)}.json`;
  const manifest = {
    manifestVersion: 1,
    status: "rendering",
    application: "Schwarzschild Optical Field",
    applicationVersion: profile.applicationVersion,
    createdAt: priorManifest?.createdAt || new Date().toISOString(),
    width: profile.width,
    height: profile.height,
    fps: profile.fps,
    frameCount,
    sourceFrameCount,
    trackDuration: profile.trimEnd - profile.trimStart,
    trimmedSourceDuration: trim.duration,
    sourceTrackDuration: track.durationSeconds,
    trimStart: profile.trimStart,
    trimEnd: profile.trimEnd,
    samplesPerFrame,
    smoothing,
    geodesicMaxSteps: productionSettings.maxSteps,
    baseStep: productionSettings.baseStep,
    exposure: productionSettings.exposure,
    saturation: productionSettings.saturation,
    trackId: track.id,
    trackFilename: trackFilename || null,
    trackSnapshotFilename,
    renderFingerprint: profile.renderFingerprint,
    settings: productionSettings,
    nextFrame: startFrame,
    completedFrameCount: completedFrames.size,
    testRender: testOnly,
  };

  productionState.active = true;
  finishPreparation();
  productionState.cancelRequested = false;
  camera.setInputEnabled(false);
  productionProgress.max = frameCount;
  productionProgress.value = completedFrames.size;
  productionProgressText.textContent = `${completedFrames.size} / ${frameCount} frames`;
  productionStatus.textContent = "Allocating fixed 2560×1440 linear render targets…";
  updateWorkflowUi();

  const renderStartedAt = performance.now();
  let renderedThisRun = 0;
  try {
    await writeTextFile(directory, trackSnapshotFilename, `${JSON.stringify(track, null, 2)}\n`);
    await writeTextFile(directory, "render_manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
    productionState.session = await ProductionRenderSession.create(renderer);
    for (let frameIndex = startFrame; frameIndex < frameCount; frameIndex += 1) {
      if (productionState.cancelRequested) break;
      if (completedFrames.has(frameIndex)) continue;
      const outputTime = productionFrameTime(frameIndex);
      const trackTime = trim.start + outputTime;
      const pose = evaluateCameraTrack(track, trackTime, {
        smoothing,
        isPositionSafe: (position) => isTrackPositionSafeFor(track, position),
      });
      camera.setPlaybackPose(pose.position, pose.forward, pose.right, pose.up);
      const frameSettings = { ...productionSettings, fov: pose.fov };
      productionState.session.renderFrame({
        camera,
        settings: frameSettings,
        timeSeconds: pose.sceneTime,
        frameIndex,
        samplesPerFrame,
      });
      if (testOnly && frameIndex === 0) {
        const firstHash = await sha256Hex(productionState.session.copyLastPixels());
        productionState.session.renderFrame({
          camera,
          settings: frameSettings,
          timeSeconds: pose.sceneTime,
          frameIndex,
          samplesPerFrame,
        });
        const secondHash = await sha256Hex(productionState.session.copyLastPixels());
        if (firstHash && secondHash && firstHash !== secondHash) {
          throw new Error("The deterministic frame-zero raw-pixel check did not match.");
        }
        manifest.determinismCheck = firstHash
          ? { frameIndex: 0, rawRgbaSha256: firstHash, exactMatch: true }
          : { frameIndex: 0, exactMatch: null, reason: "Web Crypto unavailable" };
      }
      productionState.session.presentLastFrame();
      const png = await productionState.session.encodeLastFramePng();
      await assertPngDimensions(png, profile.width, profile.height);
      const filename = `frame_${String(frameIndex).padStart(6, "0")}.png`;
      await writeBlobFile(directory, filename, png);
      completedFrames.add(frameIndex);
      renderedThisRun += 1;
      manifest.completedFrameCount = completedFrames.size;
      manifest.nextFrame = firstMissingFrame(completedFrames, frameCount);
      manifest.lastCompletedFrame = frameIndex;
      manifest.updatedAt = new Date().toISOString();
      await writeTextFile(directory, "render_manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

      const elapsedSeconds = (performance.now() - renderStartedAt) / 1000;
      const averageFrameSeconds = elapsedSeconds / renderedThisRun;
      const remainingFrames = frameCount - completedFrames.size;
      const etaSeconds = averageFrameSeconds * remainingFrames;
      productionProgress.value = completedFrames.size;
      productionProgressText.textContent = `${completedFrames.size} / ${frameCount} · ${(100 * completedFrames.size / frameCount).toFixed(1)}%`;
      productionStatus.textContent = `Frame ${frameIndex + 1}/${frameCount} · elapsed ${formatClock(elapsedSeconds)} · ETA ${formatClock(etaSeconds)}`;

      if (productionState.cancelRequested) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const complete = completedFrames.size >= frameCount;
    manifest.status = complete ? "complete" : "cancelled";
    manifest.completedFrameCount = completedFrames.size;
    manifest.nextFrame = firstMissingFrame(completedFrames, frameCount);
    manifest.finishedAt = new Date().toISOString();
    await writeTextFile(directory, "render_manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
    productionStatus.textContent = complete
      ? `Complete · ${frameCount} lossless PNG frames written at 2560×1440`
      : `Cancelled safely · ${completedFrames.size}/${frameCount} completed files remain resumable`;
  } catch (error) {
    console.error(error);
    manifest.status = "error";
    manifest.error = error.message;
    manifest.updatedAt = new Date().toISOString();
    try {
      await writeTextFile(directory, "render_manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
    } catch (manifestError) {
      console.error("Could not update render manifest:", manifestError);
    }
    productionStatus.textContent = `Production render stopped: ${error.message}`;
  } finally {
    try {
      productionState.session?.dispose();
    } catch (cleanupError) {
      console.error("Production renderer cleanup failed:", cleanupError);
    }
    productionState.session = null;
    productionState.active = false;
    productionState.cancelRequested = false;
    try {
      if (!contextLost) restoreInteractiveState(restore);
    } catch (restoreError) {
      console.error("Interactive renderer restoration failed:", restoreError);
      productionStatus.textContent += ` · interactive restoration failed: ${restoreError.message}`;
    }
    updateWorkflowUi();
  }
}

function bindProductionControls() {
  smoothingInput.addEventListener("input", () => {
    smoothingOutput.value = `${Math.round(Number(smoothingInput.value) * 100)}%`;
  });
  pathRecordButton.addEventListener("click", startCameraPathRecording);
  pathStopButton.addEventListener("click", stopCameraPathRecording);
  trackSaveButton.addEventListener("click", saveTrackJson);
  trackLoadButton.addEventListener("click", () => {
    trackFileInput.click();
  });
  trackFileInput.addEventListener("change", () => loadTrackFile(trackFileInput.files?.[0]));
  trackResetButton.addEventListener("click", resetTrack);
  trackPreviewButton.addEventListener("click", startTrackPreview);
  trackPreviewStopButton.addEventListener("click", () => stopTrackPreview());
  testRenderButton.addEventListener("click", () => beginProductionRender({ testOnly: true }));
  productionRenderButton.addEventListener("click", () => beginProductionRender({ testOnly: false }));
  productionCancelButton.addEventListener("click", () => {
    productionState.cancelRequested = true;
    productionStatus.textContent = "Cancel requested · finishing and saving the current frame…";
    updateWorkflowUi();
  });
  smoothingInput.dispatchEvent(new Event("input"));
  if (typeof window.showDirectoryPicker !== "function") {
    productionStatus.textContent = "Production PNG export requires Chrome or Edge";
  }
  updateWorkflowUi();
}

function resetCamera() {
  camera?.reset();
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

function setRecordingStatus(message) {
  recordStatus.textContent = message;
}

function getPreferredRecordingFormat() {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    { mimeType: 'video/mp4;codecs="avc1.424028"', extension: "mp4", label: "H.264 MP4" },
    { mimeType: 'video/mp4;codecs="avc1.42E02A"', extension: "mp4", label: "H.264 MP4" },
    { mimeType: 'video/mp4;codecs="avc1.4D402A"', extension: "mp4", label: "H.264 MP4" },
    { mimeType: "video/mp4", extension: "mp4", label: "MP4" },
    { mimeType: 'video/webm;codecs="vp9"', extension: "webm", label: "VP9 WebM" },
    { mimeType: 'video/webm;codecs="vp8"', extension: "webm", label: "VP8 WebM" },
    { mimeType: "video/webm", extension: "webm", label: "WebM" },
  ];
  return candidates.find(({ mimeType }) =>
    MediaRecorder.isTypeSupported(mimeType)
  ) || null;
}

function releaseRecordingStream() {
  recordingState.stream?.getTracks().forEach((track) => track.stop());
  recordingState.stream = null;
  recordingState.captureTrack = null;
  recordingState.manualFrameCapture = false;
}

function resetRecordingUi() {
  recordButton.classList.remove("recording");
  updateRecordingIdleUi();
}

function updateRecordingIdleUi() {
  const format = getPreferredRecordingFormat();
  recordButton.disabled = !format;
  recordButtonText.textContent =
    format?.extension === "webm" ? "Quick WebM" : "Quick MP4";
  if (format) {
    setRecordingStatus(`Real-time preview recording · not production quality · ${format.label}`);
  } else {
    setRecordingStatus("Recording is unavailable in this browser");
  }
}

function startRecording() {
  if (recordingState.isRecording || recordingState.isFinalizing) return;
  if (
    cameraTrackRecorder.active
    || previewState.active
    || productionState.active
    || productionState.preparing
  ) {
    setRecordingStatus("Stop the camera-track workflow before quick recording");
    return;
  }
  if (
    typeof MediaRecorder === "undefined"
    || typeof canvas.captureStream !== "function"
  ) {
    setRecordingStatus("Recording is unavailable in this browser");
    return;
  }

  const format = getPreferredRecordingFormat();
  if (!format) {
    setRecordingStatus("No supported video encoder was found");
    return;
  }

  let stream = canvas.captureStream(0);
  let captureTrack = stream.getVideoTracks()[0];
  const manualFrameCapture =
    typeof captureTrack?.requestFrame === "function";
  if (!manualFrameCapture) {
    stream.getTracks().forEach((track) => track.stop());
    stream = canvas.captureStream(RECORDING_FPS);
    captureTrack = stream.getVideoTracks()[0];
  }
  if (!captureTrack) {
    stream.getTracks().forEach((track) => track.stop());
    setRecordingStatus("The renderer did not provide a video track");
    return;
  }

  let recorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: format.mimeType,
      videoBitsPerSecond: RECORDING_VIDEO_BITS_PER_SECOND,
    });
  } catch (error) {
    console.error(error);
    stream.getTracks().forEach((track) => track.stop());
    setRecordingStatus("The browser could not start its video encoder");
    return;
  }

  recordingState.recorder = recorder;
  recordingState.stream = stream;
  recordingState.captureTrack = captureTrack;
  recordingState.manualFrameCapture = manualFrameCapture;
  recordingState.chunks = [];
  recordingState.mimeType = recorder.mimeType || format.mimeType;
  recordingState.extension = format.extension;
  recordingState.formatLabel = format.label;
  recorder.ondataavailable = (event) => {
    if (event.data?.size) recordingState.chunks.push(event.data);
  };
  recorder.onerror = (event) => {
    console.error("MediaRecorder error:", event.error || event);
    setRecordingStatus("Recording failed; stop to finalize available frames");
  };
  recorder.onstop = () => {
    const chunks = recordingState.chunks.slice();
    const mimeType = recordingState.mimeType;
    const extension = recordingState.extension;
    const formatLabel = recordingState.formatLabel;
    releaseRecordingStream();
    recordingState.recorder = null;
    recordingState.chunks = [];
    recordingState.isFinalizing = false;
    resetRecordingUi();
    updateWorkflowUi();

    if (!chunks.length) {
      setRecordingStatus("No recording data was produced");
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `schwarzschild-field-${Date.now()}.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setRecordingStatus(
      `Saved ${formatLabel} · ${(blob.size / 1_048_576).toFixed(1)} MB`,
    );
  };

  try {
    recorder.start();
  } catch (error) {
    console.error(error);
    releaseRecordingStream();
    recordingState.recorder = null;
    recordingState.chunks = [];
    setRecordingStatus("The video encoder could not begin recording");
    return;
  }

  recordingState.isRecording = true;
  recordingState.frameCount = 0;
  recordingState.lastStatusSecond = -1;
  recordButton.classList.add("recording");
  recordButtonText.textContent = "Stop recording";
  setRecordingStatus(`Recording ${format.label} · ${RECORDING_FPS} fps`);
  updateWorkflowUi();
}

function stopRecording() {
  if (!recordingState.isRecording || !recordingState.recorder) return;
  recordingState.isRecording = false;
  recordingState.isFinalizing = true;
  recordButton.disabled = true;
  recordButtonText.textContent = "Finalizing…";
  setRecordingStatus(`Finalizing ${recordingState.formatLabel}…`);
  updateWorkflowUi();
  recordingState.recorder.stop();
}

function captureRecordingFrame() {
  if (!recordingState.isRecording) return;
  recordingState.frameCount += 1;
  if (recordingState.manualFrameCapture) {
    recordingState.captureTrack.requestFrame();
  }
}

function updateRecordingStatus() {
  if (!recordingState.isRecording) return;
  const elapsedSeconds = Math.floor(
    recordingState.frameCount * RECORDING_TIME_STEP_SECONDS,
  );
  if (elapsedSeconds === recordingState.lastStatusSecond) return;
  recordingState.lastStatusSecond = elapsedSeconds;
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = String(elapsedSeconds % 60).padStart(2, "0");
  setRecordingStatus(
    `Recording ${recordingState.formatLabel} · ${minutes}:${seconds} · ${recordingState.frameCount} frames · ${RECORDING_FPS} fps`,
  );
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

function stationHemisphereEnvelope(position) {
  const stationRadius = Math.hypot(...position);
  const foldedLatitude = Math.asin(
    Math.max(
      0,
      Math.min(1, Math.abs(position[1]) / Math.max(stationRadius, 1e-8)),
    ),
  );
  const gapEnvelope = stationRadius * Math.sin(
    STATION_EQUATORIAL_GAP_HALF_ANGLE - foldedLatitude,
  );
  const radialEnvelope = Math.abs(stationRadius - PHOTON_RHO) - 0.11;
  return Math.max(radialEnvelope, gapEnvelope);
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
    const stationEnvelope = stationHemisphereEnvelope(position);
    const stationBlend = smoothstep(
      0.025,
      0.2,
      Math.max(stationEnvelope, 0),
    );
    const foldedLatitude = Math.asin(
      Math.max(0, Math.min(1, Math.abs(position[1]) / Math.max(rho, 1e-8))),
    );
    const rimCoverage = 1 - smoothstep(
      STATION_EQUATORIAL_GAP_HALF_ANGLE,
      0.48,
      foldedLatitude,
    );
    const structureStep = 0.014 + (0.007 - 0.014) * rimCoverage;
    rayStep = Math.min(
      rayStep,
      structureStep + (rayStep - structureStep) * stationBlend,
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
    maxSteps: PHYSICS_SELF_CHECK_STEPS,
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
    maxSteps: PRODUCTION_MAX_STEPS,
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
  const renderingDeltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;
  if (productionState.active || contextLost) {
    requestAnimationFrame(animate);
    return;
  }
  const simulationDeltaSeconds = recordingState.isRecording
    ? RECORDING_TIME_STEP_SECONDS
    : renderingDeltaSeconds;
  if (previewState.active) {
    try {
      updateTrackPreview(now);
    } catch (error) {
      stopTrackPreview();
      trackStatus.textContent = `Preview stopped: ${error.message}`;
    }
  } else {
    simulationTimeSeconds += simulationDeltaSeconds;
    camera.update(simulationDeltaSeconds);
    const labelBlend = 1 - Math.exp(-4.5 * simulationDeltaSeconds);
    settings.photonLabelOpacity +=
      (photonLabelTarget - settings.photonLabelOpacity) * labelBlend;
    if (Math.abs(photonLabelTarget - settings.photonLabelOpacity) < 0.001) {
      settings.photonLabelOpacity = photonLabelTarget;
    }
  }
  renderer.render(camera, settings, simulationTimeSeconds);
  if (gpuSafeModeRequested && stableLiveFrameCount < 180) {
    stableLiveFrameCount += 1;
    if (stableLiveFrameCount === 180) {
      clearGpuSafeModeRequest();
      statusText.textContent = "GPU SAFE MODE · STABLE";
    }
  }
  if (cameraTrackRecorder.active) {
    try {
      cameraTrackRecorder.sample({
        camera,
        fov: settings.fov,
        sceneTime: simulationTimeSeconds,
        now,
      });
      const elapsed = (now - cameraTrackRecorder.startedAt) / 1000;
      trackStatus.textContent = `Recording camera path · ${elapsed.toFixed(2)} s · ${cameraTrackRecorder.track.samples.length} samples`;
    } catch (error) {
      cameraTrackRecorder.cancel();
      trackStatus.textContent = `Camera-path recording stopped: ${error.message}`;
      updateWorkflowUi();
    }
  }
  captureRecordingFrame();

  const instantaneousFps = 1 / Math.max(renderingDeltaSeconds, 1 / 240);
  smoothedFps += (instantaneousFps - smoothedFps) * 0.035;
  probeCriticalRays(now);
  updateTelemetry(now);
  updateRecordingStatus();
  if (previewState.finishAfterFrame) stopTrackPreview({ completed: true });
  requestAnimationFrame(animate);
}

async function start() {
  bindControls();

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    requestGpuSafeMode();
    productionState.cancelRequested = true;
    if (cameraTrackRecorder.active) cameraTrackRecorder.cancel();
    camera?.setInputEnabled(false);
    statusPill.classList.add("danger");
    loadingScreen.classList.add("loaded");
    fatalError.hidden = false;
    fatalMessage.textContent =
      "The GPU stopped the live frame. Restarting once with the conservative real-time profile…";
    statusText.textContent = "WEBGL CONTEXT LOST · RESTARTING SAFE MODE";
    productionStatus.textContent = "GPU context lost; completed PNG files remain safe to resume";
    updateWorkflowUi();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    suppressUnloadWarning = true;
    productionState.active = false;
    productionState.preparing = false;
    previewState.active = false;
    trackLoadState.active = false;
    window.location.reload();
  });

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
    statusText.textContent = gpuSafeModeRequested
      ? "GPU SAFE MODE · WARMING UP"
      : "SCHWARZSCHILD FIELD · STABLE";
    lastFrameTime = performance.now();
    requestAnimationFrame(animate);
  } catch (error) {
    loadingScreen.classList.add("loaded");
    fatalMessage.textContent = error instanceof Error ? error.message : String(error);
    fatalError.hidden = false;
  }
}

start();
