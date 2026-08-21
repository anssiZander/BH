export const XR_METERS_TO_M = 0.24;
export const XR_FRAMEBUFFER_SCALE = 0.42;
export const XR_FIXED_AREAL_RADIUS = 3.25;
export const XR_FIXED_ISOTROPIC_RADIUS = (
  XR_FIXED_AREAL_RADIUS
  - 1
  + Math.sqrt(XR_FIXED_AREAL_RADIUS * (XR_FIXED_AREAL_RADIUS - 2))
) / 2;

export function chooseXRTargetFrameRate(supportedFrameRates) {
  const rates = Array.from(supportedFrameRates || [])
    .map(Number)
    .filter((rate) => Number.isFinite(rate) && rate >= 72)
    .sort((left, right) => left - right);
  return rates[0] ?? null;
}

export function isotropicToAreal(rho) {
  if (rho <= 0) return 2;
  const factor = 1 + 0.5 / rho;
  return rho * factor * factor;
}

export class FixedBlackHoleXRRig {
  constructor() {
    this.position = new Float32Array([
      0,
      0,
      XR_FIXED_ISOTROPIC_RADIUS,
    ]);
  }

  reset() {
    this.position[0] = 0;
    this.position[1] = 0;
    this.position[2] = XR_FIXED_ISOTROPIC_RADIUS;
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

export function createXRViewState(view, initialViewerPosition, rig) {
  const transform = view.transform;
  const position = new Float32Array([
    rig.position[0]
      + (transform.position.x - initialViewerPosition.x) * XR_METERS_TO_M,
    rig.position[1]
      + (transform.position.y - initialViewerPosition.y) * XR_METERS_TO_M,
    rig.position[2]
      + (transform.position.z - initialViewerPosition.z) * XR_METERS_TO_M,
  ]);
  const eyeRotation = new Float32Array([
    transform.matrix[0],
    transform.matrix[1],
    transform.matrix[2],
    transform.matrix[4],
    transform.matrix[5],
    transform.matrix[6],
    transform.matrix[8],
    transform.matrix[9],
    transform.matrix[10],
  ]);
  const right = new Float32Array(eyeRotation.subarray(0, 3));
  const up = new Float32Array(eyeRotation.subarray(3, 6));
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
