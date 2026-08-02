export const CAMERA_TRACK_SCHEMA_VERSION = 1;
export const CAMERA_TRACK_GUARD_RADIUS = 0.535;
export const PRODUCTION_RENDER_PROFILE = Object.freeze({
  width: 2560,
  height: 1440,
  fps: 30,
  defaultSamples: 8,
  sampleOptions: Object.freeze([1, 4, 8, 16]),
});

const MAX_TRACK_SAMPLES = 1_000_000;
const MAX_TRACK_DURATION_SECONDS = 24 * 60 * 60;
const MAX_CAMERA_COMPONENT = 1_000_000;
const MAX_SCENE_TIME_MAGNITUDE = 10_000_000;
const DEFAULT_SAMPLE_INTERVAL_SECONDS = 1 / 60;
const SETTING_KEYS = Object.freeze([
  "quality",
  "maxSteps",
  "baseStep",
  "fov",
  "gridBrightness",
  "shellCount",
  "exposure",
  "saturation",
  "stationRotationSpeed",
  "photonLabelOpacity",
  "lensing",
  "gridVisible",
  "spheresVisible",
  "skyVisible",
  "ringsVisible",
]);
const BOOLEAN_SETTING_KEYS = new Set([
  "lensing",
  "gridVisible",
  "spheresVisible",
  "skyVisible",
  "ringsVisible",
]);
const NUMERIC_SETTING_RANGES = Object.freeze({
  maxSteps: [1, 896],
  baseStep: [0.0001, 10],
  fov: [1.000001, 178.999999],
  gridBrightness: [0, 10],
  shellCount: [0, 8],
  exposure: [0.0001, 32],
  saturation: [0, 16],
  stationRotationSpeed: [-10, 10],
  photonLabelOpacity: [0, 1],
});

function finiteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return Number(value);
}

function finiteVector(value, length, label) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    throw new Error(`${label} must be an array of ${length} finite numbers.`);
  }
  if (value.length !== length) {
    throw new Error(`${label} must contain exactly ${length} values.`);
  }
  return Array.from(value, (component, index) =>
    finiteNumber(component, `${label}[${index}]`)
  );
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function vectorLength(vector) {
  return Math.hypot(...vector);
}

function dot(first, second) {
  let result = 0;
  for (let index = 0; index < first.length; index += 1) {
    result += first[index] * second[index];
  }
  return result;
}

function mix(first, second, amount) {
  return first + (second - first) * amount;
}

function mixVector(first, second, amount) {
  return first.map((value, index) => mix(value, second[index], amount));
}

function normalizeVector(vector, fallback) {
  const length = vectorLength(vector);
  if (!Number.isFinite(length) || length < 1e-12) return [...fallback];
  return vector.map((value) => value / length);
}

function normalizeQuaternion(quaternion, label = "orientation") {
  const length = vectorLength(quaternion);
  if (!Number.isFinite(length) || length < 1e-8) {
    throw new Error(`${label} is not a valid quaternion.`);
  }
  return quaternion.map((value) => {
    const normalized = value / length;
    return normalized === 0 ? 0 : normalized;
  });
}

function canonicalizeQuaternion(quaternion, reference) {
  if (!reference || dot(quaternion, reference) >= 0) return quaternion;
  return quaternion.map((value) => -value);
}

function multiplyQuaternion(first, second) {
  const [ax, ay, az, aw] = first;
  const [bx, by, bz, bw] = second;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function inverseQuaternion(quaternion) {
  return [-quaternion[0], -quaternion[1], -quaternion[2], quaternion[3]];
}

function logarithmQuaternion(quaternion) {
  const normalized = normalizeQuaternion(quaternion);
  const scalar = clamp(normalized[3], -1, 1);
  const angle = Math.acos(scalar);
  const sine = Math.sin(angle);
  if (Math.abs(sine) < 1e-8) return [0, 0, 0, 0];
  const scale = angle / sine;
  return [
    normalized[0] * scale,
    normalized[1] * scale,
    normalized[2] * scale,
    0,
  ];
}

function exponentialQuaternion(quaternion) {
  const angle = Math.hypot(quaternion[0], quaternion[1], quaternion[2]);
  if (angle < 1e-8) return [0, 0, 0, 1];
  const scale = Math.sin(angle) / angle;
  return [
    quaternion[0] * scale,
    quaternion[1] * scale,
    quaternion[2] * scale,
    Math.cos(angle),
  ];
}

function quaternionControl(
  previous,
  current,
  next,
  previousTime,
  currentTime,
  nextTime,
  segmentDuration,
) {
  const inverse = inverseQuaternion(current);
  const previousLog = logarithmQuaternion(
    multiplyQuaternion(inverse, previous),
  );
  const nextLog = logarithmQuaternion(
    multiplyQuaternion(inverse, next),
  );
  const previousScale = segmentDuration / Math.max(currentTime - previousTime, 1e-9);
  const nextScale = segmentDuration / Math.max(nextTime - currentTime, 1e-9);
  const average = [
    -0.25 * (previousScale * previousLog[0] + nextScale * nextLog[0]),
    -0.25 * (previousScale * previousLog[1] + nextScale * nextLog[1]),
    -0.25 * (previousScale * previousLog[2] + nextScale * nextLog[2]),
    0,
  ];
  return normalizeQuaternion(
    multiplyQuaternion(current, exponentialQuaternion(average)),
  );
}

export function slerpQuaternion(first, second, amount) {
  const start = normalizeQuaternion(first);
  let end = normalizeQuaternion(second);
  let cosine = dot(start, end);
  if (cosine < 0) {
    end = end.map((value) => -value);
    cosine = -cosine;
  }
  if (cosine > 0.9995) {
    return normalizeQuaternion(mixVector(start, end, amount));
  }
  const angle = Math.acos(clamp(cosine, -1, 1));
  const sine = Math.sin(angle);
  const firstWeight = Math.sin((1 - amount) * angle) / sine;
  const secondWeight = Math.sin(amount * angle) / sine;
  return start.map(
    (value, index) => value * firstWeight + end[index] * secondWeight,
  );
}

function squadQuaternion(previous, first, second, next, amount) {
  const segmentDuration = Math.max(second.time - first.time, 1e-9);
  const firstControl = quaternionControl(
    previous.orientation,
    first.orientation,
    second.orientation,
    previous.time,
    first.time,
    second.time,
    segmentDuration,
  );
  const secondControl = quaternionControl(
    first.orientation,
    second.orientation,
    next.orientation,
    first.time,
    second.time,
    next.time,
    segmentDuration,
  );
  const direct = slerpQuaternion(first.orientation, second.orientation, amount);
  const controls = slerpQuaternion(firstControl, secondControl, amount);
  return slerpQuaternion(direct, controls, 2 * amount * (1 - amount));
}

function rotateByQuaternion(quaternion, vector) {
  const [qx, qy, qz, qw] = quaternion;
  const [vx, vy, vz] = vector;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

export function quaternionToCameraBasis(orientation) {
  const quaternion = normalizeQuaternion(orientation);
  return {
    right: normalizeVector(rotateByQuaternion(quaternion, [1, 0, 0]), [1, 0, 0]),
    up: normalizeVector(rotateByQuaternion(quaternion, [0, 1, 0]), [0, 1, 0]),
    forward: normalizeVector(
      rotateByQuaternion(quaternion, [0, 0, -1]),
      [0, 0, -1],
    ),
  };
}

export function cameraBasisToQuaternion(camera) {
  const right = finiteVector(camera.right, 3, "camera.right");
  const up = finiteVector(camera.up, 3, "camera.up");
  const forward = finiteVector(camera.forward, 3, "camera.forward");
  const m00 = right[0];
  const m10 = right[1];
  const m20 = right[2];
  const m01 = up[0];
  const m11 = up[1];
  const m21 = up[2];
  const m02 = -forward[0];
  const m12 = -forward[1];
  const m22 = -forward[2];
  const trace = m00 + m11 + m22;
  let quaternion;
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    quaternion = [
      (m21 - m12) / scale,
      (m02 - m20) / scale,
      (m10 - m01) / scale,
      0.25 * scale,
    ];
  } else if (m00 > m11 && m00 > m22) {
    const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
    quaternion = [
      0.25 * scale,
      (m01 + m10) / scale,
      (m02 + m20) / scale,
      (m21 - m12) / scale,
    ];
  } else if (m11 > m22) {
    const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
    quaternion = [
      (m01 + m10) / scale,
      0.25 * scale,
      (m12 + m21) / scale,
      (m02 - m20) / scale,
    ];
  } else {
    const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
    quaternion = [
      (m02 + m20) / scale,
      (m12 + m21) / scale,
      0.25 * scale,
      (m10 - m01) / scale,
    ];
  }
  return normalizeQuaternion(quaternion);
}

function sanitizeSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("Camera-track settings must be an object.");
  }
  const sanitized = {};
  for (const key of SETTING_KEYS) {
    if (!(key in settings)) {
      throw new Error(`Camera-track settings are missing ${key}.`);
    }
    const value = settings[key];
    if (key === "quality") {
      if (!["low", "medium", "high", "ultra"].includes(value)) {
        throw new Error("settings.quality must be low, medium, high, or ultra.");
      }
      sanitized[key] = value;
      continue;
    }
    if (BOOLEAN_SETTING_KEYS.has(key)) {
      if (typeof value !== "boolean") {
        throw new Error(`settings.${key} must be a boolean.`);
      }
      sanitized[key] = value;
      continue;
    }
    if (typeof value !== "number") {
      throw new Error(`settings.${key} must be a number.`);
    }
    const numeric = finiteNumber(value, `settings.${key}`);
    const [minimum, maximum] = NUMERIC_SETTING_RANGES[key];
    if (numeric < minimum || numeric > maximum) {
      throw new Error(`settings.${key} must be between ${minimum} and ${maximum}.`);
    }
    if ((key === "maxSteps" || key === "shellCount") && !Number.isInteger(numeric)) {
      throw new Error(`settings.${key} must be an integer.`);
    }
    sanitized[key] = numeric;
  }
  return sanitized;
}

export function snapshotVisualSettings(settings) {
  return sanitizeSettings(settings);
}

function createSample(camera, fov, sceneTime, time) {
  return {
    time,
    position: finiteVector(camera.position, 3, "camera.position"),
    orientation: cameraBasisToQuaternion(camera),
    fov: finiteNumber(fov, "fov"),
    sceneTime: finiteNumber(sceneTime, "sceneTime"),
  };
}

function createTrackId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `track-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class CameraTrackRecorder {
  constructor({ sampleIntervalSeconds = DEFAULT_SAMPLE_INTERVAL_SECONDS } = {}) {
    if (!Number.isFinite(sampleIntervalSeconds) || sampleIntervalSeconds < 0) {
      throw new Error("Camera-track sample interval must be a non-negative finite number.");
    }
    this.sampleIntervalSeconds = sampleIntervalSeconds;
    this.active = false;
    this.startedAt = 0;
    this.track = null;
  }

  start({ camera, fov, sceneTime, settings, now = performance.now() }) {
    if (this.active) throw new Error("Camera-path recording is already active.");
    const startedAt = finiteNumber(now, "recording start time");
    const track = {
      schemaVersion: CAMERA_TRACK_SCHEMA_VERSION,
      id: createTrackId(),
      createdAt: new Date().toISOString(),
      durationSeconds: 0,
      sceneTimeAtStart: finiteNumber(sceneTime, "sceneTimeAtStart"),
      settings: snapshotVisualSettings(settings),
      samples: [createSample(camera, fov, sceneTime, 0)],
    };
    this.startedAt = startedAt;
    this.track = track;
    this.active = true;
    return track;
  }

  sample({ camera, fov, sceneTime, now = performance.now(), force = false }) {
    if (!this.active || !this.track) return false;
    const elapsed = Math.max(
      0,
      (finiteNumber(now, "sample time") - this.startedAt) / 1000,
    );
    const samples = this.track.samples;
    if (elapsed > MAX_TRACK_DURATION_SECONDS) {
      throw new Error("Camera-path recording reached the 24-hour safety limit.");
    }
    if (samples.length >= MAX_TRACK_SAMPLES && elapsed > samples[samples.length - 1].time) {
      throw new Error(`Camera-path recording reached the ${MAX_TRACK_SAMPLES} sample safety limit.`);
    }
    const previous = samples[samples.length - 1];
    if (!force && elapsed - previous.time < this.sampleIntervalSeconds) {
      return false;
    }
    const sample = createSample(camera, fov, sceneTime, elapsed);
    sample.orientation = canonicalizeQuaternion(
      sample.orientation,
      previous.orientation,
    );
    if (elapsed <= previous.time + 1e-9) {
      samples[samples.length - 1] = { ...sample, time: previous.time };
    } else {
      samples.push(sample);
    }
    this.track.durationSeconds = samples[samples.length - 1].time;
    return true;
  }

  stop({ camera, fov, sceneTime, now = performance.now() }) {
    if (!this.active || !this.track) {
      throw new Error("No camera-path recording is active.");
    }
    try {
      this.sample({ camera, fov, sceneTime, now, force: true });
    } finally {
      this.active = false;
    }
    if (this.track.samples.length < 2) {
      throw new Error("Record the camera path for more than one instant before stopping.");
    }
    const completed = validateCameraTrack(this.track);
    this.track = completed;
    return completed;
  }

  cancel() {
    this.active = false;
    this.track = null;
  }
}

export function validateCameraTrack(candidate, {
  guardRadius = CAMERA_TRACK_GUARD_RADIUS,
} = {}) {
  if (!Number.isFinite(guardRadius) || guardRadius <= 0) {
    throw new Error("Camera-track guard radius must be a positive finite number.");
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("The selected JSON file does not contain a camera track.");
  }
  if (candidate.schemaVersion !== CAMERA_TRACK_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported camera-track schema ${String(candidate.schemaVersion)}; expected ${CAMERA_TRACK_SCHEMA_VERSION}.`,
    );
  }
  if (!Array.isArray(candidate.samples) || candidate.samples.length < 2) {
    throw new Error("A camera track must contain at least two samples.");
  }
  if (candidate.samples.length > MAX_TRACK_SAMPLES) {
    throw new Error(`The camera track exceeds the ${MAX_TRACK_SAMPLES} sample safety limit.`);
  }
  const duration = finiteNumber(candidate.durationSeconds, "durationSeconds");
  if (duration <= 0 || duration > MAX_TRACK_DURATION_SECONDS) {
    throw new Error("Camera-track duration must be greater than zero and shorter than 24 hours.");
  }
  const sceneTimeAtStart = finiteNumber(
    candidate.sceneTimeAtStart,
    "sceneTimeAtStart",
  );
  const createdAt = typeof candidate.createdAt === "string"
    ? candidate.createdAt
    : "";
  if (!createdAt || !Number.isFinite(Date.parse(createdAt))) {
    throw new Error("createdAt must be a valid date string.");
  }
  const samples = [];
  let previousTime = -Infinity;
  let previousOrientation = null;
  let previousSceneTime = -Infinity;
  for (let index = 0; index < candidate.samples.length; index += 1) {
    const source = candidate.samples[index];
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error(`samples[${index}] must be an object.`);
    }
    const time = finiteNumber(source.time, `samples[${index}].time`);
    if (index === 0 && Math.abs(time) > 1e-6) {
      throw new Error("The first camera-track sample must start at time zero.");
    }
    if (time <= previousTime) {
      throw new Error("Camera-track sample times must increase strictly.");
    }
    const position = finiteVector(
      source.position,
      3,
      `samples[${index}].position`,
    );
    if (position.some((component) => Math.abs(component) > MAX_CAMERA_COMPONENT)) {
      throw new Error(
        `samples[${index}].position exceeds the supported camera-coordinate range.`,
      );
    }
    if (vectorLength(position) < guardRadius) {
      throw new Error(
        `samples[${index}] is inside the camera horizon guard (${guardRadius}).`,
      );
    }
    let orientation = normalizeQuaternion(
      finiteVector(
        source.orientation,
        4,
        `samples[${index}].orientation`,
      ),
      `samples[${index}].orientation`,
    );
    orientation = canonicalizeQuaternion(orientation, previousOrientation);
    const fov = finiteNumber(source.fov, `samples[${index}].fov`);
    if (fov <= 1 || fov >= 179) {
      throw new Error(`samples[${index}].fov must be between 1 and 179 degrees.`);
    }
    const sceneTime = finiteNumber(
      source.sceneTime,
      `samples[${index}].sceneTime`,
    );
    if (Math.abs(sceneTime) > MAX_SCENE_TIME_MAGNITUDE) {
      throw new Error(`samples[${index}].sceneTime exceeds the supported GPU time range.`);
    }
    if (sceneTime < previousSceneTime - 1e-9) {
      throw new Error("Camera-track sceneTime values must not run backward.");
    }
    if (index === 0 && Math.abs(sceneTime - sceneTimeAtStart) > 1e-5) {
      throw new Error("The first sample sceneTime must match sceneTimeAtStart.");
    }
    samples.push({ time, position, orientation, fov, sceneTime });
    previousTime = time;
    previousOrientation = orientation;
    previousSceneTime = sceneTime;
  }
  const lastTime = samples[samples.length - 1].time;
  const durationTolerance = Math.max(0.005, duration * 1e-5);
  if (Math.abs(lastTime - duration) > durationTolerance) {
    throw new Error(
      `durationSeconds (${duration}) does not match the final sample time (${lastTime}).`,
    );
  }
  return {
    schemaVersion: CAMERA_TRACK_SCHEMA_VERSION,
    id: typeof candidate.id === "string" && candidate.id.trim()
      ? candidate.id.trim()
      : createTrackId(),
    createdAt,
    durationSeconds: lastTime,
    sceneTimeAtStart,
    settings: sanitizeSettings(candidate.settings ?? {}),
    samples,
  };
}

function findSampleSegment(samples, time) {
  if (time <= samples[0].time) return 0;
  const finalIndex = samples.length - 1;
  if (time >= samples[finalIndex].time) return finalIndex - 1;
  let low = 0;
  let high = finalIndex;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].time <= time) low = middle;
    else high = middle;
  }
  return low;
}

function timeAwareHermite(previous, first, second, next, amount) {
  const segmentDuration = Math.max(second.time - first.time, 1e-9);
  const velocity = (before, after, fallbackBefore, fallbackAfter) => {
    const duration = after.time - before.time;
    if (duration > 1e-9) {
      return after.position.map((value, index) =>
        (value - before.position[index]) / duration
      );
    }
    return fallbackAfter.position.map((value, index) =>
      (value - fallbackBefore.position[index]) / segmentDuration
    );
  };
  const firstVelocity = velocity(previous, second, first, second);
  const secondVelocity = velocity(first, next, first, second);
  const amount2 = amount * amount;
  const amount3 = amount2 * amount;
  const h00 = 2 * amount3 - 3 * amount2 + 1;
  const h10 = amount3 - 2 * amount2 + amount;
  const h01 = -2 * amount3 + 3 * amount2;
  const h11 = amount3 - amount2;
  return first.position.map((value, index) => {
    const candidate =
      h00 * value
      + h10 * segmentDuration * firstVelocity[index]
      + h01 * second.position[index]
      + h11 * segmentDuration * secondVelocity[index];
    return clamp(
      candidate,
      Math.min(value, second.position[index]),
      Math.max(value, second.position[index]),
    );
  });
}

function filteredSample(samples, index) {
  const sample = samples[index];
  if (index <= 0 || index >= samples.length - 1) return sample;
  const previous = samples[index - 1];
  const next = samples[index + 1];
  const amount = clamp(
    (sample.time - previous.time) / Math.max(next.time - previous.time, 1e-9),
    0,
    1,
  );
  const filterStrength = 0.35;
  const neighborPosition = mixVector(previous.position, next.position, amount);
  const neighborOrientation = slerpQuaternion(
    previous.orientation,
    next.orientation,
    amount,
  );
  return {
    ...sample,
    position: mixVector(sample.position, neighborPosition, filterStrength),
    orientation: slerpQuaternion(
      sample.orientation,
      neighborOrientation,
      filterStrength * 0.65,
    ),
    fov: mix(sample.fov, mix(previous.fov, next.fov, amount), filterStrength),
  };
}

function sphericalSafePosition(first, second, amount, guardRadius) {
  const firstRadius = vectorLength(first);
  const secondRadius = vectorLength(second);
  const firstDirection = normalizeVector(first, [0, 0, 1]);
  let secondDirection = normalizeVector(second, firstDirection);
  let cosine = clamp(dot(firstDirection, secondDirection), -1, 1);
  let direction;
  if (cosine > 0.9995) {
    direction = normalizeVector(
      mixVector(firstDirection, secondDirection, amount),
      firstDirection,
    );
  } else {
    if (cosine < -0.9995) {
      const auxiliary = Math.abs(firstDirection[1]) < 0.9
        ? [0, 1, 0]
        : [1, 0, 0];
      let axis = [
        firstDirection[1] * secondDirection[2] - firstDirection[2] * secondDirection[1],
        firstDirection[2] * secondDirection[0] - firstDirection[0] * secondDirection[2],
        firstDirection[0] * secondDirection[1] - firstDirection[1] * secondDirection[0],
      ];
      if (vectorLength(axis) < 1e-8) {
        axis = [
          firstDirection[1] * auxiliary[2] - firstDirection[2] * auxiliary[1],
          firstDirection[2] * auxiliary[0] - firstDirection[0] * auxiliary[2],
          firstDirection[0] * auxiliary[1] - firstDirection[1] * auxiliary[0],
        ];
      }
      axis = normalizeVector(axis, [0, 0, 1]);
      const angle = Math.acos(cosine) * amount;
      const cosineAngle = Math.cos(angle);
      const sineAngle = Math.sin(angle);
      const axisCrossDirection = [
        axis[1] * firstDirection[2] - axis[2] * firstDirection[1],
        axis[2] * firstDirection[0] - axis[0] * firstDirection[2],
        axis[0] * firstDirection[1] - axis[1] * firstDirection[0],
      ];
      direction = normalizeVector(
        firstDirection.map((value, index) =>
          value * cosineAngle + axisCrossDirection[index] * sineAngle
        ),
        firstDirection,
      );
    } else {
      const angle = Math.acos(cosine);
      const sine = Math.sin(angle);
      const firstWeight = Math.sin((1 - amount) * angle) / sine;
      const secondWeight = Math.sin(amount * angle) / sine;
      direction = normalizeVector(
        firstDirection.map(
          (value, index) => value * firstWeight + secondDirection[index] * secondWeight,
        ),
        firstDirection,
      );
    }
  }
  const radius = Math.max(guardRadius, mix(firstRadius, secondRadius, amount));
  return direction.map((value) => value * radius);
}

function horizonSafePosition(candidate, raw, first, second, amount, guardRadius) {
  if (vectorLength(candidate) >= guardRadius) return candidate;
  if (vectorLength(raw) >= guardRadius) {
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const middle = 0.5 * (low + high);
      const test = mixVector(raw, candidate, middle);
      if (vectorLength(test) >= guardRadius) low = middle;
      else high = middle;
    }
    return mixVector(raw, candidate, low);
  }
  return sphericalSafePosition(first, second, amount, guardRadius);
}

function smoothScalar(previous, first, second, next, amount) {
  const segmentDuration = Math.max(second.time - first.time, 1e-9);
  const firstDuration = Math.max(second.time - previous.time, 1e-9);
  const secondDuration = Math.max(next.time - first.time, 1e-9);
  const tangentFirst = segmentDuration * (second.fov - previous.fov) / firstDuration;
  const tangentSecond = segmentDuration * (next.fov - first.fov) / secondDuration;
  const amount2 = amount * amount;
  const amount3 = amount2 * amount;
  const value =
    (2 * amount3 - 3 * amount2 + 1) * first.fov
    + (amount3 - 2 * amount2 + amount) * tangentFirst
    + (-2 * amount3 + 3 * amount2) * second.fov
    + (amount3 - amount2) * tangentSecond;
  return clamp(
    value,
    Math.min(previous.fov, first.fov, second.fov, next.fov),
    Math.max(previous.fov, first.fov, second.fov, next.fov),
  );
}

export function evaluateCameraTrack(track, time, {
  smoothing = 0,
  guardRadius = CAMERA_TRACK_GUARD_RADIUS,
  isPositionSafe = null,
} = {}) {
  if (!Number.isFinite(time)) throw new Error("Camera-track evaluation time must be finite.");
  if (!Number.isFinite(smoothing)) throw new Error("Camera smoothing must be finite.");
  if (!Number.isFinite(guardRadius) || guardRadius <= 0) {
    throw new Error("Camera guard radius must be a positive finite number.");
  }
  if (isPositionSafe !== null && typeof isPositionSafe !== "function") {
    throw new Error("isPositionSafe must be a function when provided.");
  }
  const strength = clamp(smoothing, 0, 1);
  const clampedTime = clamp(time, 0, track.durationSeconds);
  const samples = track.samples;
  if (clampedTime <= 0) {
    const sample = samples[0];
    return {
      time: 0,
      position: [...sample.position],
      orientation: [...sample.orientation],
      ...quaternionToCameraBasis(sample.orientation),
      fov: sample.fov,
      sceneTime: sample.sceneTime,
    };
  }
  if (clampedTime >= track.durationSeconds) {
    const sample = samples[samples.length - 1];
    return {
      time: track.durationSeconds,
      position: [...sample.position],
      orientation: [...sample.orientation],
      ...quaternionToCameraBasis(sample.orientation),
      fov: sample.fov,
      sceneTime: sample.sceneTime,
    };
  }
  const index = findSampleSegment(samples, clampedTime);
  const first = samples[index];
  const second = samples[index + 1];
  const previous = samples[Math.max(0, index - 1)];
  const next = samples[Math.min(samples.length - 1, index + 2)];
  const smoothPrevious = filteredSample(samples, Math.max(0, index - 1));
  const smoothFirst = filteredSample(samples, index);
  const smoothSecond = filteredSample(samples, index + 1);
  const smoothNext = filteredSample(samples, Math.min(samples.length - 1, index + 2));
  const amount = clamp(
    (clampedTime - first.time) / Math.max(second.time - first.time, 1e-9),
    0,
    1,
  );
  const rawPosition = mixVector(first.position, second.position, amount);
  const smoothPosition = timeAwareHermite(
    smoothPrevious,
    smoothFirst,
    smoothSecond,
    smoothNext,
    amount,
  );
  const candidatePosition = mixVector(rawPosition, smoothPosition, strength);
  let position = horizonSafePosition(
    candidatePosition,
    rawPosition,
    first.position,
    second.position,
    amount,
    guardRadius,
  );
  if (isPositionSafe && !isPositionSafe(position)) {
    if (!isPositionSafe(rawPosition)) {
      position = rawPosition;
    } else {
      let safe = rawPosition;
      let unsafe = position;
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const middle = mixVector(safe, unsafe, 0.5);
        if (isPositionSafe(middle)) safe = middle;
        else unsafe = middle;
      }
      position = safe;
    }
  }
  const rawOrientation = slerpQuaternion(
    first.orientation,
    second.orientation,
    amount,
  );
  const smoothOrientation = squadQuaternion(
    smoothPrevious,
    smoothFirst,
    smoothSecond,
    smoothNext,
    amount,
  );
  const orientation = slerpQuaternion(
    rawOrientation,
    smoothOrientation,
    strength,
  );
  const rawFov = mix(first.fov, second.fov, amount);
  const smoothedFov = smoothScalar(
    smoothPrevious,
    smoothFirst,
    smoothSecond,
    smoothNext,
    amount,
  );
  const fov = mix(rawFov, smoothedFov, strength);
  const sceneTime = mix(first.sceneTime, second.sceneTime, amount);
  return {
    time: clampedTime,
    position,
    orientation,
    ...quaternionToCameraBasis(orientation),
    fov,
    sceneTime,
  };
}

export function normalizeTrimRange(track, startTime, endTime) {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    throw new Error("Trim start and end must be finite numbers.");
  }
  const start = clamp(startTime, 0, track.durationSeconds);
  const requestedEnd = Number(endTime);
  const end = clamp(
    Number.isFinite(requestedEnd) ? requestedEnd : track.durationSeconds,
    start,
    track.durationSeconds,
  );
  if (end - start <= 1e-6) {
    throw new Error("Trim end must be later than trim start.");
  }
  return { start, end, duration: end - start };
}

export function productionFrameCount(durationSeconds, fps = PRODUCTION_RENDER_PROFILE.fps) {
  const duration = finiteNumber(durationSeconds, "trimmed duration");
  const frameRate = finiteNumber(fps, "frame rate");
  if (duration <= 0 || frameRate <= 0) return 0;
  return Math.max(1, Math.ceil(duration * frameRate - 1e-9));
}

export function productionFrameTime(frameIndex, fps = PRODUCTION_RENDER_PROFILE.fps) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    throw new Error("Frame index must be a non-negative integer.");
  }
  const frameRate = finiteNumber(fps, "frame rate");
  if (frameRate <= 0) throw new Error("Frame rate must be greater than zero.");
  return frameIndex / frameRate;
}
