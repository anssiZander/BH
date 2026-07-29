const WORLD_UP = new Float32Array([0, 1, 0]);
const RESET_POSITION = new Float32Array([0, 1.35, 13.5]);
const RESET_YAW = Math.PI;
const RESET_PITCH = -0.0996687;
const HORIZON_GUARD = 0.535;
const MAX_DELTA_SECONDS = 0.05;
const LOOK_RESPONSE = 24;
const MOVE_ACCELERATION_RESPONSE = 12;
const MOVE_DECELERATION_RESPONSE = 30;

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

export function arealToIsotropic(radius) {
  if (radius <= 2) return 0.5;
  return 0.5 * (radius - 1 + Math.sqrt(radius * (radius - 2)));
}

export class FirstPersonCamera {
  constructor(canvas) {
    this.canvas = canvas;
    this.position = new Float32Array(RESET_POSITION);
    this.forward = new Float32Array(3);
    this.right = new Float32Array(3);
    this.up = new Float32Array(3);
    this.yaw = RESET_YAW;
    this.pitch = RESET_PITCH;
    this.targetYaw = RESET_YAW;
    this.targetPitch = RESET_PITCH;
    this.velocity = new Float32Array(3);
    this.targetVelocity = new Float32Array(3);
    this.displacement = new Float32Array(3);
    this.speed = 1.4;
    this.sensitivity = 0.00175;
    this.keys = new Set();
    this.pointerLocked = false;
    this._bindEvents();
    this._updateBasis();
  }

  _bindEvents() {
    this.canvas.addEventListener("click", () => {
      if (document.pointerLockElement !== this.canvas) {
        const request = this.canvas.requestPointerLock?.();
        request?.catch?.(() => {});
      }
    });

    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (this.pointerLocked) {
        this.targetYaw = this.yaw;
        this.targetPitch = this.pitch;
      } else {
        this._cancelMotion();
      }
      document.body.classList.toggle("pointer-locked", this.pointerLocked);
      document.dispatchEvent(
        new CustomEvent("camera:pointerlock", { detail: { locked: this.pointerLocked } }),
      );
    });

    document.addEventListener("mousemove", (event) => {
      if (!this.pointerLocked) return;
      if (!Number.isFinite(event.movementX) || !Number.isFinite(event.movementY)) return;
      this.targetYaw -= event.movementX * this.sensitivity;
      this.targetPitch -= event.movementY * this.sensitivity;
      const pitchLimit = Math.PI * 0.495;
      this.targetPitch = Math.max(
        -pitchLimit,
        Math.min(pitchLimit, this.targetPitch),
      );
    });

    window.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        return;
      }
      this.keys.add(event.code);
      if (["Space", "KeyW", "KeyA", "KeyS", "KeyD", "KeyC"].includes(event.code)) {
        event.preventDefault();
      }
    });

    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.code);
    });

    window.addEventListener("blur", () => this._cancelMotion());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this._cancelMotion();
    });
  }

  _cancelMotion() {
    this.keys.clear();
    this.velocity.fill(0);
    this.targetVelocity.fill(0);
    this.displacement.fill(0);
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
  }

  _updateBasis() {
    const cp = Math.cos(this.pitch);
    normalize(
      this.forward,
      Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cp,
    );
    cross(
      this.right,
      this.forward[0],
      this.forward[1],
      this.forward[2],
      WORLD_UP[0],
      WORLD_UP[1],
      WORLD_UP[2],
    );
    normalize(this.right, this.right[0], this.right[1], this.right[2]);
    cross(
      this.up,
      this.right[0],
      this.right[1],
      this.right[2],
      this.forward[0],
      this.forward[1],
      this.forward[2],
    );
    normalize(this.up, this.up[0], this.up[1], this.up[2]);
  }

  update(deltaSeconds) {
    const dt = Math.max(
      0,
      Math.min(
        Number.isFinite(deltaSeconds) ? deltaSeconds : 0,
        MAX_DELTA_SECONDS,
      ),
    );
    if (dt <= 0) return;

    const lookBlend = 1 - Math.exp(-LOOK_RESPONSE * dt);
    this.yaw += (this.targetYaw - this.yaw) * lookBlend;
    this.pitch += (this.targetPitch - this.pitch) * lookBlend;
    this._updateBasis();

    let mx = 0;
    let my = 0;
    let mz = 0;

    if (this.keys.has("KeyW")) mz += 1;
    if (this.keys.has("KeyS")) mz -= 1;
    if (this.keys.has("KeyD")) mx += 1;
    if (this.keys.has("KeyA")) mx -= 1;
    if (this.keys.has("Space") || this.keys.has("KeyE")) my += 1;
    if (this.keys.has("KeyC") || this.keys.has("KeyQ")) my -= 1;

    const movementLength = Math.hypot(mx, my, mz);
    if (movementLength > 0) {
      mx /= movementLength;
      my /= movementLength;
      mz /= movementLength;
    }

    const boost = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 3.5 : 1;
    const localRadius = Math.hypot(...this.position);
    const horizonSlowdown = Math.max(0.12, Math.min(1, (localRadius - HORIZON_GUARD) * 1.7));
    const targetSpeed =
      movementLength > 0
        ? this.speed * boost * horizonSlowdown
        : 0;
    this.targetVelocity[0] =
      (this.right[0] * mx + WORLD_UP[0] * my + this.forward[0] * mz) * targetSpeed;
    this.targetVelocity[1] =
      (this.right[1] * mx + WORLD_UP[1] * my + this.forward[1] * mz) * targetSpeed;
    this.targetVelocity[2] =
      (this.right[2] * mx + WORLD_UP[2] * my + this.forward[2] * mz) * targetSpeed;
    const response =
      movementLength > 0
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
        desiredVelocity
        + (oldVelocity - desiredVelocity) * decay;
    }

    let nx = this.position[0] + this.displacement[0];
    let ny = this.position[1] + this.displacement[1];
    let nz = this.position[2] + this.displacement[2];
    const newRadius = Math.hypot(nx, ny, nz);

    if (newRadius < HORIZON_GUARD) {
      const invRadius = HORIZON_GUARD / Math.max(newRadius, 1e-6);
      nx *= invRadius;
      ny *= invRadius;
      nz *= invRadius;
      const normalX = nx / HORIZON_GUARD;
      const normalY = ny / HORIZON_GUARD;
      const normalZ = nz / HORIZON_GUARD;
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

    this.position[0] = nx;
    this.position[1] = ny;
    this.position[2] = nz;
  }

  reset() {
    this.position.set(RESET_POSITION);
    this.yaw = RESET_YAW;
    this.pitch = RESET_PITCH;
    this.targetYaw = RESET_YAW;
    this.targetPitch = RESET_PITCH;
    this.velocity.fill(0);
    this.targetVelocity.fill(0);
    this.displacement.fill(0);
    this.keys.clear();
    this._updateBasis();
  }

  get arealRadius() {
    return isotropicToAreal(Math.hypot(...this.position));
  }
}
