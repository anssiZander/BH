const RESET_POSITION = new Float32Array([0, 1.35, 13.5]);
const HORIZON_GUARD = 0.78;
const MAX_DELTA_SECONDS = 0.05;
const MOVE_ACCELERATION_RESPONSE = 4.2;
const MOVE_DECELERATION_RESPONSE = 6.5;
const CONTROLLER_DEADZONE = 0.14;

export const XR_METERS_TO_M = 0.24;
export const XR_FRAMEBUFFER_SCALE = 0.65;
export const XR_QUALITY_PROFILE = Object.freeze({
  maxSteps: 224,
  baseStep: 0.1,
});

function normalize(out, x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  out[0] = x / length;
  out[1] = y / length;
  out[2] = z / length;
  return out;
}

function cross(out, ax, ay, az, bx, by, bz) {
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
}

export function isotropicToAreal(rho) {
  if (rho <= 0) return 2;
  const factor = 1 + 0.5 / rho;
  return rho * factor * factor;
}

export function rotateAroundWorldY(out, vector, angle) {
  const x = vector[0];
  const y = vector[1];
  const z = vector[2];
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  out[0] = cosine * x - sine * z;
  out[1] = y;
  out[2] = sine * x + cosine * z;
  return out;
}

export function applyOrbitalDisplacement(
  out,
  position,
  displacement,
  orbitTangent,
) {
  const orbitDistance =
    displacement[0] * orbitTangent[0]
    + displacement[1] * orbitTangent[1]
    + displacement[2] * orbitTangent[2];
  const translatedX =
    position[0] + displacement[0] - orbitTangent[0] * orbitDistance;
  const translatedY =
    position[1] + displacement[1] - orbitTangent[1] * orbitDistance;
  const translatedZ =
    position[2] + displacement[2] - orbitTangent[2] * orbitDistance;
  const horizontalRadius = Math.hypot(translatedX, translatedZ);
  const orbitAngle = horizontalRadius > 1e-8
    ? orbitDistance / horizontalRadius
    : 0;
  const cosine = Math.cos(orbitAngle);
  const sine = Math.sin(orbitAngle);
  out[0] = cosine * translatedX - sine * translatedZ;
  out[1] = translatedY;
  out[2] = sine * translatedX + cosine * translatedZ;
  return orbitAngle;
}

function applyDeadzone(value) {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  if (magnitude <= CONTROLLER_DEADZONE) return 0;
  return Math.sign(value)
    * Math.min(
      1,
      (magnitude - CONTROLLER_DEADZONE) / (1 - CONTROLLER_DEADZONE),
    );
}

function thumbstickAxes(gamepad) {
  const axes = gamepad?.axes || [];
  if (axes.length >= 4) {
    return [applyDeadzone(axes[2]), applyDeadzone(axes[3])];
  }
  return [applyDeadzone(axes[0]), applyDeadzone(axes[1])];
}

function buttonDown(gamepad, index) {
  const button = gamepad?.buttons?.[index];
  return Boolean(button?.pressed || button?.value > 0.55);
}

export class QuestControllerInput {
  constructor() {
    this.resetHeld = false;
  }

  read(inputSources) {
    const state = {
      radial: 0,
      angular: 0,
      polar: 0,
      boost: false,
      reset: false,
      controllers: 0,
    };
    let resetPressed = false;

    for (const source of inputSources) {
      const gamepad = source.gamepad;
      if (!gamepad) continue;
      state.controllers += 1;
      const [stickX, stickY] = thumbstickAxes(gamepad);
      if (source.handedness === "left") {
        state.angular = stickX;
        state.radial = -stickY;
      } else if (source.handedness === "right") {
        state.polar = -stickY;
      }

      state.boost ||= buttonDown(gamepad, 1);
      // Oculus Touch A/X is the first face button in the xr-standard mapping.
      resetPressed ||= buttonDown(gamepad, 4);
    }

    state.reset = resetPressed && !this.resetHeld;
    this.resetHeld = resetPressed;
    return state;
  }
}

export class BlackHoleXRRig {
  constructor() {
    this.position = new Float32Array(RESET_POSITION);
    this.orientation = 0;
    this.velocity = new Float32Array(3);
    this.targetVelocity = new Float32Array(3);
    this.displacement = new Float32Array(3);
    this.travelInward = new Float32Array(3);
    this.travelRight = new Float32Array(3);
    this.travelUp = new Float32Array(3);
    this.speed = 1.4;
  }

  setSpeed(speed) {
    if (Number.isFinite(speed) && speed > 0) this.speed = speed;
  }

  reset() {
    this.position.set(RESET_POSITION);
    this.orientation = 0;
    this.velocity.fill(0);
    this.targetVelocity.fill(0);
    this.displacement.fill(0);
  }

  _updateTravelBasis() {
    normalize(
      this.travelInward,
      -this.position[0],
      -this.position[1],
      -this.position[2],
    );
    const horizontalRadius = Math.hypot(
      this.position[0],
      this.position[2],
    );
    if (horizontalRadius > 1e-8) {
      this.travelRight[0] = -this.position[2] / horizontalRadius;
      this.travelRight[1] = 0;
      this.travelRight[2] = this.position[0] / horizontalRadius;
    } else {
      this.travelRight[0] = 1;
      this.travelRight[1] = 0;
      this.travelRight[2] = 0;
    }
    cross(
      this.travelUp,
      this.travelRight[0],
      this.travelRight[1],
      this.travelRight[2],
      this.travelInward[0],
      this.travelInward[1],
      this.travelInward[2],
    );
    normalize(
      this.travelUp,
      this.travelUp[0],
      this.travelUp[1],
      this.travelUp[2],
    );
  }

  update(deltaSeconds, input) {
    const dt = Math.max(
      0,
      Math.min(
        Number.isFinite(deltaSeconds) ? deltaSeconds : 0,
        MAX_DELTA_SECONDS,
      ),
    );
    if (dt <= 0) return;
    if (input.reset) {
      this.reset();
      return;
    }

    let angular = Number.isFinite(input.angular) ? input.angular : 0;
    let polar = Number.isFinite(input.polar) ? input.polar : 0;
    let radial = Number.isFinite(input.radial) ? input.radial : 0;
    const movementLength = Math.hypot(angular, polar, radial);
    if (movementLength > 1) {
      angular /= movementLength;
      polar /= movementLength;
      radial /= movementLength;
    }

    const localRadius = Math.hypot(...this.position);
    const horizonSlowdown = Math.max(
      0.10,
      Math.min(1, (localRadius - HORIZON_GUARD) * 1.55),
    );
    const boost = input.boost ? 2.5 : 1;
    const targetSpeed = movementLength > 0
      ? this.speed * boost * horizonSlowdown
      : 0;

    this._updateTravelBasis();
    this.targetVelocity[0] =
      (
        this.travelRight[0] * angular
        + this.travelUp[0] * polar
        + this.travelInward[0] * radial
      ) * targetSpeed;
    this.targetVelocity[1] =
      (
        this.travelRight[1] * angular
        + this.travelUp[1] * polar
        + this.travelInward[1] * radial
      ) * targetSpeed;
    this.targetVelocity[2] =
      (
        this.travelRight[2] * angular
        + this.travelUp[2] * polar
        + this.travelInward[2] * radial
      ) * targetSpeed;

    const response = movementLength > 0
      ? MOVE_ACCELERATION_RESPONSE
      : MOVE_DECELERATION_RESPONSE;
    const decay = Math.exp(-response * dt);
    const integrationScale = (1 - decay) / response;
    for (let component = 0; component < 3; component += 1) {
      const oldVelocity = this.velocity[component];
      const desiredVelocity = this.targetVelocity[component];
      this.displacement[component] =
        desiredVelocity * dt
        + (oldVelocity - desiredVelocity) * integrationScale;
      this.velocity[component] =
        desiredVelocity + (oldVelocity - desiredVelocity) * decay;
    }

    const orbitAngle = applyOrbitalDisplacement(
      this.position,
      this.position,
      this.displacement,
      this.travelRight,
    );
    if (Math.abs(orbitAngle) > 1e-12) {
      this.orientation += orbitAngle;
      rotateAroundWorldY(this.velocity, this.velocity, orbitAngle);
      rotateAroundWorldY(
        this.targetVelocity,
        this.targetVelocity,
        orbitAngle,
      );
    }

    const radius = Math.hypot(...this.position);
    if (radius < HORIZON_GUARD) {
      const scale = HORIZON_GUARD / Math.max(radius, 1e-6);
      this.position[0] *= scale;
      this.position[1] *= scale;
      this.position[2] *= scale;
      const normalX = this.position[0] / HORIZON_GUARD;
      const normalY = this.position[1] / HORIZON_GUARD;
      const normalZ = this.position[2] / HORIZON_GUARD;
      const radialVelocity =
        this.velocity[0] * normalX
        + this.velocity[1] * normalY
        + this.velocity[2] * normalZ;
      if (radialVelocity < 0) {
        this.velocity[0] -= normalX * radialVelocity;
        this.velocity[1] -= normalY * radialVelocity;
        this.velocity[2] -= normalZ * radialVelocity;
      }
    }
  }

  get arealRadius() {
    return isotropicToAreal(Math.hypot(...this.position));
  }
}

export function invertMat4(matrix) {
  const out = new Float32Array(16);
  const a00 = matrix[0];
  const a01 = matrix[1];
  const a02 = matrix[2];
  const a03 = matrix[3];
  const a10 = matrix[4];
  const a11 = matrix[5];
  const a12 = matrix[6];
  const a13 = matrix[7];
  const a20 = matrix[8];
  const a21 = matrix[9];
  const a22 = matrix[10];
  const a23 = matrix[11];
  const a30 = matrix[12];
  const a31 = matrix[13];
  const a32 = matrix[14];
  const a33 = matrix[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let determinant =
    b00 * b11 - b01 * b10 + b02 * b09
    + b03 * b08 - b04 * b07 + b05 * b06;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new Error("The XR projection matrix was not invertible.");
  }
  determinant = 1 / determinant;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * determinant;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * determinant;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * determinant;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * determinant;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * determinant;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * determinant;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * determinant;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * determinant;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * determinant;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * determinant;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * determinant;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * determinant;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * determinant;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * determinant;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * determinant;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * determinant;
  return out;
}

function projectionFovY(projection) {
  const scale = projection[5];
  const offset = projection[9];
  if (!Number.isFinite(scale) || Math.abs(scale) < 1e-8) {
    return Math.PI * 0.5;
  }
  const topTangent = (1 + offset) / scale;
  const bottomTangent = (offset - 1) / scale;
  const fov = Math.atan(topTangent) - Math.atan(bottomTangent);
  return Number.isFinite(fov) && fov > 0 ? fov : Math.PI * 0.5;
}

function rotateMatrixColumn(out, offset, matrix, column, angle) {
  const source = column * 4;
  const x = matrix[source];
  const y = matrix[source + 1];
  const z = matrix[source + 2];
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  out[offset] = cosine * x - sine * z;
  out[offset + 1] = y;
  out[offset + 2] = sine * x + cosine * z;
}

export function createXRViewState(
  view,
  initialViewerPosition,
  rig,
) {
  const transform = view.transform;
  const offset = new Float32Array([
    (transform.position.x - initialViewerPosition.x) * XR_METERS_TO_M,
    (transform.position.y - initialViewerPosition.y) * XR_METERS_TO_M,
    (transform.position.z - initialViewerPosition.z) * XR_METERS_TO_M,
  ]);
  const rotatedOffset = new Float32Array(3);
  rotateAroundWorldY(rotatedOffset, offset, rig.orientation);
  const position = new Float32Array([
    rig.position[0] + rotatedOffset[0],
    rig.position[1] + rotatedOffset[1],
    rig.position[2] + rotatedOffset[2],
  ]);

  const eyeRotation = new Float32Array(9);
  rotateMatrixColumn(
    eyeRotation,
    0,
    transform.matrix,
    0,
    rig.orientation,
  );
  rotateMatrixColumn(
    eyeRotation,
    3,
    transform.matrix,
    1,
    rig.orientation,
  );
  rotateMatrixColumn(
    eyeRotation,
    6,
    transform.matrix,
    2,
    rig.orientation,
  );

  const right = new Float32Array([
    eyeRotation[0],
    eyeRotation[1],
    eyeRotation[2],
  ]);
  const up = new Float32Array([
    eyeRotation[3],
    eyeRotation[4],
    eyeRotation[5],
  ]);
  const forward = new Float32Array([
    -eyeRotation[6],
    -eyeRotation[7],
    -eyeRotation[8],
  ]);

  return {
    view,
    position,
    right,
    up,
    forward,
    eyeRotation,
    inverseProjection: invertMat4(view.projectionMatrix),
    fovY: projectionFovY(view.projectionMatrix),
  };
}
