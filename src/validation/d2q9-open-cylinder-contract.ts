import type { ValidationCaseDefinition } from "./types.js";

const DIRECTIONS = Object.freeze([
  Object.freeze([0, 0] as const),
  Object.freeze([1, 0] as const),
  Object.freeze([0, 1] as const),
  Object.freeze([-1, 0] as const),
  Object.freeze([0, -1] as const),
  Object.freeze([1, 1] as const),
  Object.freeze([-1, 1] as const),
  Object.freeze([-1, -1] as const),
  Object.freeze([1, -1] as const),
]);

export const D2Q9_OPEN_CYLINDER_CONTRACT = Object.freeze({
  directions: DIRECTIONS,
  opposite: Object.freeze([0, 3, 4, 1, 2, 7, 8, 5, 6] as const),
  weights: Object.freeze([
    4 / 9,
    1 / 9,
    1 / 9,
    1 / 9,
    1 / 9,
    1 / 36,
    1 / 36,
    1 / 36,
    1 / 36,
  ] as const),
  defaultLatticeSpeed: 0.08,
  targetDensity: 1,
  trtMagicParameter: 3 / 16,
  boundaryPrecedence: Object.freeze([
    "free-slip-lateral",
    "regularized-velocity-inlet",
    "fixed-density-nee-outlet",
  ] as const),
});

export interface OpenCylinderGeometry {
  readonly width: number;
  readonly height: number;
  readonly cellCount: number;
  readonly cylinderDiameter: number;
  readonly cylinderCenterX: number;
  readonly cylinderCenterY: number;
  readonly cylinderRadius: number;
  readonly cylinderRearX: number;
  readonly solid: Uint8Array;
  readonly cutFraction: Float64Array;
  readonly streamTarget: Int32Array;
  readonly bounceAway: Int32Array;
  readonly bounceLinks: Int32Array;
  readonly retainsPostCollision: Uint8Array;
}

export function equilibriumPopulation(
  direction: number,
  density: number,
  velocityX: number,
  velocityY: number,
): number {
  const latticeDirection = D2Q9_OPEN_CYLINDER_CONTRACT.directions[direction];
  const weight = D2Q9_OPEN_CYLINDER_CONTRACT.weights[direction];
  if (latticeDirection === undefined || weight === undefined) {
    throw new RangeError(`D2Q9 direction ${direction} is outside 0 through 8.`);
  }
  const projection =
    latticeDirection[0] * velocityX + latticeDirection[1] * velocityY;
  const velocitySquared = velocityX * velocityX + velocityY * velocityY;
  return (
    weight *
    density *
    (1 + 3 * projection + 4.5 * projection * projection - 1.5 * velocitySquared)
  );
}

export function trtRelaxationRates(
  reynoldsNumber: number,
  cylinderDiameter: number,
  latticeSpeed: number,
): { readonly omegaEven: number; readonly omegaOdd: number } {
  const viscosity = (latticeSpeed * cylinderDiameter) / reynoldsNumber;
  const tauEven = 0.5 + 3 * viscosity;
  const tauOdd =
    0.5 + D2Q9_OPEN_CYLINDER_CONTRACT.trtMagicParameter / (tauEven - 0.5);
  return { omegaEven: 1 / tauEven, omegaOdd: 1 / tauOdd };
}

export function buildOpenCylinderGeometry(
  definition: ValidationCaseDefinition,
): OpenCylinderGeometry {
  const cylinderDiameter = definition.configuration.cylinder.cellsPerDiameter;
  const cylinderRadius = cylinderDiameter / 2;
  const width =
    Math.round(
      (definition.configuration.domain.upstreamDiameters +
        1 +
        definition.configuration.domain.downstreamDiameters) *
        cylinderDiameter,
    ) + 1;
  const height =
    Math.round(
      (2 * definition.configuration.domain.lateralDiameters + 1) *
        cylinderDiameter,
    ) + 1;
  const cellCount = width * height;
  const cylinderCenterX =
    definition.configuration.domain.upstreamDiameters * cylinderDiameter +
    cylinderRadius +
    definition.configuration.cylinder.offsetX;
  const cylinderCenterY =
    (height - 1) / 2 + definition.configuration.cylinder.offsetY;
  const cylinderRearX = cylinderCenterX + cylinderRadius;
  const solid = new Uint8Array(cellCount);
  const cutFraction = new Float64Array(cellCount * 9);
  const streamTarget = new Int32Array(cellCount * 9);
  const bounceAway = new Int32Array(cellCount * 9);
  const radiusSquared = cylinderRadius * cylinderRadius;
  const cell = (x: number, y: number) => y * width + x;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cylinderCenterX;
      const dy = y - cylinderCenterY;
      solid[cell(x, y)] = dx * dx + dy * dy <= radiusSquared ? 1 : 0;
    }
  }
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const fluidCell = cell(x, y);
      if (solid[fluidCell] === 1) continue;
      for (let direction = 1; direction < 9; direction += 1) {
        const [cx, cy] = DIRECTIONS[direction]!;
        if (solid[cell(x + cx, y + cy)] !== 1) continue;
        const dx = x - cylinderCenterX;
        const dy = y - cylinderCenterY;
        const a = cx * cx + cy * cy;
        const b = 2 * (dx * cx + dy * cy);
        const c = dx * dx + dy * dy - radiusSquared;
        const discriminant = b * b - 4 * a * c;
        const root = (-b - Math.sqrt(Math.max(0, discriminant))) / (2 * a);
        cutFraction[fluidCell * 9 + direction] = Math.min(
          1,
          Math.max(Number.EPSILON, root),
        );
      }
    }
  }

  const bounceLinks: number[] = [];
  streamTarget.fill(-1);
  bounceAway.fill(-1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const fluidCell = cell(x, y);
      if (solid[fluidCell] === 1) continue;
      const base = fluidCell * 9;
      for (let direction = 1; direction < 9; direction += 1) {
        const [cx, cy] = DIRECTIONS[direction]!;
        const neighbourX = x + cx;
        let neighbourY = y + cy;
        if (
          (neighbourY < 0 || neighbourY >= height) &&
          definition.configuration.boundaries.lateral === "periodic"
        ) {
          neighbourY = (neighbourY + height) % height;
        }
        if (
          neighbourX < 0 ||
          neighbourX >= width ||
          neighbourY < 0 ||
          neighbourY >= height
        ) {
          continue;
        }
        const link = base + direction;
        const neighbour = cell(neighbourX, neighbourY);
        if (solid[neighbour] === 0) {
          streamTarget[link] = neighbour * 9 + direction;
          continue;
        }
        streamTarget[link] = -2;
        bounceLinks.push(link);
        if (cutFraction[link]! < 0.5) {
          bounceAway[link] = cell(x - cx, y - cy) * 9 + direction;
        }
      }
    }
  }

  const retainsPostCollision = new Uint8Array(cellCount);
  if (definition.configuration.boundaries.lateral === "free-slip") {
    for (let x = 0; x < width; x += 1) {
      retainsPostCollision[cell(x, 0)] = 1;
      retainsPostCollision[cell(x, height - 1)] = 1;
    }
  }
  for (const link of bounceLinks) {
    retainsPostCollision[Math.floor(link / 9)] = 1;
    const away = bounceAway[link]!;
    if (away >= 0) retainsPostCollision[Math.floor(away / 9)] = 1;
  }

  return {
    width,
    height,
    cellCount,
    cylinderDiameter,
    cylinderCenterX,
    cylinderCenterY,
    cylinderRadius,
    cylinderRearX,
    solid,
    cutFraction,
    streamTarget,
    bounceAway,
    bounceLinks: Int32Array.from(bounceLinks),
    retainsPostCollision,
  };
}
