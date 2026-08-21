import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TABLE_WIDTH = 4096;
const TABLE_HEIGHT = 35;
const CHANNELS = 4;
const LAYERS = 2;
const HEADER_BYTES = 64;
const RHO_MIN = 1.96;
const RHO_MAX = 2.30;
const PHOTON_RHO = (2 + Math.sqrt(3)) / 2;
const CAPTURE_RHO = 0.505;
const ESCAPE_RHO = 42;
const FIXED_AREAL_RADIUS = 3.25;
const BASE_STEP = 0.06;
const PHOTON_STEP = 0.006;
const MAX_STEPS = 4096;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function normalize(x, y) {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
}

function opticalAcceleration(px, py, tx, ty) {
  const rho = Math.hypot(px, py);
  if (rho <= CAPTURE_RHO) return [0, 0];
  const a = 0.5 / rho;
  const denominator = Math.max(1 - a, 1e-7);
  const dLogNdr =
    -(a / rho) * (3 / (1 + a) + 1 / denominator);
  const gradientScale = dLogNdr / rho;
  const gx = px * gradientScale;
  const gy = py * gradientScale;
  const projection = tx * gx + ty * gy;
  return [gx - tx * projection, gy - ty * projection];
}

function adaptiveStep(rho) {
  const interpolation = smoothstep(1.2, 18, rho);
  let step = BASE_STEP * (0.30 + (5 - 0.30) * interpolation);
  const photonBlend = smoothstep(0, 0.30, Math.abs(rho - PHOTON_RHO));
  const photonLimited =
    PHOTON_STEP + (step - PHOTON_STEP) * photonBlend;
  step = Math.min(step, photonLimited);
  return step;
}

function segmentCircleRoots(ax, ay, bx, by, radius) {
  const dx = bx - ax;
  const dy = by - ay;
  const quadraticA = dx * dx + dy * dy;
  if (quadraticA <= 1e-16) return [];
  const quadraticB = 2 * (ax * dx + ay * dy);
  const quadraticC = ax * ax + ay * ay - radius * radius;
  const discriminant =
    quadraticB * quadraticB - 4 * quadraticA * quadraticC;
  if (discriminant < 0) return [];
  const root = Math.sqrt(Math.max(discriminant, 0));
  const denominator = 2 * quadraticA;
  return [
    (-quadraticB - root) / denominator,
    (-quadraticB + root) / denominator,
  ].filter((value) => value >= 0 && value <= 1)
    .sort((left, right) => left - right);
}

function recordCrossings(
  crossings,
  oldX,
  oldY,
  newX,
  newY,
  oldTx,
  oldTy,
  newTx,
  newTy,
) {
  if (crossings.length >= 2) return;
  for (const root of segmentCircleRoots(
    oldX,
    oldY,
    newX,
    newY,
    PHOTON_RHO,
  )) {
    const x = oldX + (newX - oldX) * root;
    const y = oldY + (newY - oldY) * root;
    const previous = crossings.at(-1);
    if (previous && Math.hypot(x - previous[0], y - previous[1]) < 1e-4) {
      continue;
    }
    const [tx, ty] = normalize(
      oldTx + (newTx - oldTx) * root,
      oldTy + (newTy - oldTy) * root,
    );
    crossings.push([x, y, tx, ty]);
    if (crossings.length >= 2) return;
  }
}

function integrateRay(startRho, radialCosine) {
  let px = startRho;
  let py = 0;
  let tx = clamp(radialCosine, -1, 1);
  let ty = Math.sqrt(Math.max(0, 1 - tx * tx));
  let escaped = false;
  let captured = false;
  let minimumRadius = startRho;
  const crossings = [];

  for (let stepIndex = 0; stepIndex < MAX_STEPS; stepIndex += 1) {
    const radius = Math.hypot(px, py);
    minimumRadius = Math.min(minimumRadius, radius);
    if (radius <= CAPTURE_RHO) {
      captured = true;
      break;
    }
    if (radius >= ESCAPE_RHO && px * tx + py * ty > 0) {
      escaped = true;
      break;
    }

    let step = adaptiveStep(radius);
    const inwardRate = -(px * tx + py * ty) / Math.max(radius, 1e-8);
    if (inwardRate > 0.02) {
      const safeInfallStep =
        0.72 * (radius - CAPTURE_RHO) / inwardRate;
      step = Math.min(step, Math.max(0.0008, safeInfallStep));
    }

    const oldX = px;
    const oldY = py;
    const oldTx = tx;
    const oldTy = ty;
    const [firstAx, firstAy] = opticalAcceleration(px, py, tx, ty);
    const [midTx, midTy] = normalize(
      tx + 0.5 * step * firstAx,
      ty + 0.5 * step * firstAy,
    );
    const midX = px + 0.5 * step * tx;
    const midY = py + 0.5 * step * ty;
    const [midAx, midAy] = opticalAcceleration(
      midX,
      midY,
      midTx,
      midTy,
    );
    px += step * midTx;
    py += step * midTy;
    [tx, ty] = normalize(
      tx + step * midAx,
      ty + step * midAy,
    );

    recordCrossings(
      crossings,
      oldX,
      oldY,
      px,
      py,
      oldTx,
      oldTy,
      tx,
      ty,
    );
    if (![px, py, tx, ty].every(Number.isFinite)) {
      captured = true;
      break;
    }
  }

  if (!escaped && !captured) captured = true;
  return {
    tx,
    ty,
    escaped,
    minimumRadius,
    crossings,
  };
}

function setCrossing(layer, offset, crossing) {
  if (!crossing) {
    layer.fill(0, offset, offset + CHANNELS);
    return;
  }
  layer[offset] = crossing[0] / PHOTON_RHO;
  layer[offset + 1] = crossing[1] / PHOTON_RHO;
  layer[offset + 2] = crossing[2];
  layer[offset + 3] = crossing[3];
}

async function main() {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const outputPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(repoRoot, "assets", "schwarzschild-transfer-v1.bin");
  const texelCount = TABLE_WIDTH * TABLE_HEIGHT;
  const layerFloatCount = texelCount * CHANNELS;
  const payloadBytes = layerFloatCount * LAYERS * Float32Array.BYTES_PER_ELEMENT;
  const buffer = Buffer.alloc(HEADER_BYTES + payloadBytes);
  buffer.write("SLUTVR1\0", 0, "ascii");
  buffer.writeUInt32LE(1, 8);
  buffer.writeUInt32LE(TABLE_WIDTH, 12);
  buffer.writeUInt32LE(TABLE_HEIGHT, 16);
  buffer.writeUInt32LE(CHANNELS, 20);
  buffer.writeFloatLE(RHO_MIN, 24);
  buffer.writeFloatLE(RHO_MAX, 28);
  buffer.writeFloatLE(PHOTON_RHO, 32);
  buffer.writeFloatLE(FIXED_AREAL_RADIUS, 36);
  buffer.writeUInt32LE(LAYERS, 40);
  buffer.writeUInt32LE(MAX_STEPS, 44);
  buffer.writeFloatLE(BASE_STEP, 48);
  buffer.writeFloatLE(PHOTON_STEP, 52);

  const payload = new Float32Array(
    buffer.buffer,
    buffer.byteOffset + HEADER_BYTES,
    layerFloatCount * LAYERS,
  );
  const transfer = payload.subarray(0, layerFloatCount);
  const crossing0 = payload.subarray(layerFloatCount, layerFloatCount * 2);
  const stats = {
    escaped: 0,
    captured: 0,
    firstCrossing: 0,
    minimumRadius: Number.POSITIVE_INFINITY,
  };

  for (let row = 0; row < TABLE_HEIGHT; row += 1) {
    const rowFraction = row / (TABLE_HEIGHT - 1);
    const startRho = RHO_MIN + (RHO_MAX - RHO_MIN) * rowFraction;
    for (let column = 0; column < TABLE_WIDTH; column += 1) {
      const columnFraction = column / (TABLE_WIDTH - 1);
      const radialCosine = -1 + 2 * columnFraction;
      const result = integrateRay(startRho, radialCosine);
      const offset = (row * TABLE_WIDTH + column) * CHANNELS;
      transfer[offset] = result.tx;
      transfer[offset + 1] = result.ty;
      transfer[offset + 2] = result.escaped ? 1 : 0;
      transfer[offset + 3] = result.minimumRadius;
      setCrossing(crossing0, offset, result.crossings[0]);
      stats[result.escaped ? "escaped" : "captured"] += 1;
      if (result.crossings[0]) stats.firstCrossing += 1;
      stats.minimumRadius = Math.min(stats.minimumRadius, result.minimumRadius);
    }
    process.stdout.write(
      `\rGenerated radius row ${row + 1}/${TABLE_HEIGHT}`,
    );
  }

  for (let index = 0; index < payload.length; index += 1) {
    if (!Number.isFinite(payload[index])) {
      throw new Error(
        `Generated transfer table contains a non-finite value at ${index}.`,
      );
    }
  }
  const centralRow = Math.round(
    ((2.132782218537319 - RHO_MIN) / (RHO_MAX - RHO_MIN))
      * (TABLE_HEIGHT - 1),
  );
  const outwardOffset =
    (centralRow * TABLE_WIDTH + TABLE_WIDTH - 1) * CHANNELS;
  const inwardOffset = centralRow * TABLE_WIDTH * CHANNELS;
  if (transfer[outwardOffset + 2] !== 1 || transfer[inwardOffset + 2] !== 0) {
    throw new Error("Radial transfer-table invariants failed.");
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buffer);
  process.stdout.write("\n");
  console.log(JSON.stringify({
    outputPath,
    bytes: buffer.byteLength,
    width: TABLE_WIDTH,
    height: TABLE_HEIGHT,
    rhoRange: [RHO_MIN, RHO_MAX],
    fixedArealRadius: FIXED_AREAL_RADIUS,
    ...stats,
  }, null, 2));
}

await main();
