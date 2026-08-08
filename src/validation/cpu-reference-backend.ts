import { measureRecirculationLength } from "./metrics.js";
import {
  VALIDATION_SCHEMA_VERSION,
  type BackendIdentity,
  type DensitySample,
  type SolverBackend,
  type ValidationCaseDefinition,
  type ValidationSample,
} from "./types.js";

const CX = [0, 1, 0, -1, 0, 1, -1, -1, 1] as const;
const CY = [0, 0, 1, 0, -1, 1, 1, -1, -1] as const;
const OPPOSITE = [0, 3, 4, 1, 2, 7, 8, 5, 6] as const;
const WEIGHTS = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36] as const;
const LATTICE_SPEED = 0.08;
const TARGET_DENSITY = 1;
const TRT_MAGIC_PARAMETER = 3 / 16;

export const CPU_REFERENCE_BOUNDARY_PRECEDENCE = Object.freeze([
  "free-slip-lateral",
  "regularized-velocity-inlet",
  "fixed-density-nee-outlet",
] as const);

export const CPU_REFERENCE_BACKEND_IDENTITY = Object.freeze({
  schemaVersion: VALIDATION_SCHEMA_VERSION,
  id: "cpu-reference",
  kind: "cpu-worker",
  solver: "D2Q9 TRT/BFL open-cylinder reference",
  solverVersion: "1.0.0",
  buildId: "ticket-02",
} satisfies BackendIdentity);

export function createCpuReferenceBackend(): SolverBackend {
  return {
    schemaVersion: VALIDATION_SCHEMA_VERSION,
    identity: CPU_REFERENCE_BACKEND_IDENTITY,
    async *runCase(definition) {
      validateReferenceConfiguration(definition);
      const solver = new D2Q9TrtOpenCylinder(definition);
      yield solver.diagnostic(0, 0, 0);

      const stepsPerSample = exactStepCount(
        (definition.protocol.sampleInterval * solver.cylinderDiameter) / LATTICE_SPEED,
        "sample interval",
      );
      const sampleCount = exactStepCount(
        (definition.protocol.warmUpFlowThroughTime +
          definition.protocol.sampleFlowThroughTime) /
          definition.protocol.sampleInterval,
        "case duration",
      );
      let step = 0;
      for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
        let forceX = 0;
        let forceY = 0;
        for (let localStep = 0; localStep < stepsPerSample; localStep += 1) {
          const force = solver.advance();
          forceX += force.x;
          forceY += force.y;
          step += 1;
        }
        yield solver.diagnostic(
          step,
          sampleIndex * definition.protocol.sampleInterval,
          forceX / stepsPerSample,
          forceY / stepsPerSample,
        );
      }
    },
  };
}

function validateReferenceConfiguration(definition: ValidationCaseDefinition): void {
  const { configuration } = definition;
  if (
    configuration.backendId !== CPU_REFERENCE_BACKEND_IDENTITY.id ||
    configuration.collision !== "D2Q9 TRT" ||
    configuration.precision !== "float64" ||
    configuration.boundaries.inlet !== "regularized-velocity" ||
    configuration.boundaries.lateral !== "free-slip" ||
    configuration.boundaries.outlet !== "fixed-density-nee" ||
    configuration.boundaries.cylinder !== "linear-bfl"
  ) {
    throw new Error(
      `Case ${definition.id} is incompatible with the CPU reference TRT/BFL open-boundary contract.`,
    );
  }
}

function exactStepCount(value: number, label: string): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(value) || rounded <= 0 || Math.abs(value - rounded) > 1e-9) {
    throw new Error(`CPU reference ${label} must resolve to a positive fixed step count; received ${value}.`);
  }
  return rounded;
}

class D2Q9TrtOpenCylinder {
  public readonly cylinderDiameter: number;
  private readonly width: number;
  private readonly height: number;
  private readonly cellCount: number;
  private readonly cylinderCenterX: number;
  private readonly cylinderCenterY: number;
  private readonly cylinderRadius: number;
  private readonly cylinderRearX: number;
  private readonly omegaEven: number;
  private readonly omegaOdd: number;
  private readonly solid: Uint8Array;
  private readonly cutFraction: Float64Array;
  private populations: Float64Array;
  private next: Float64Array;
  private readonly postCollision: Float64Array;
  private readonly density: Float64Array;
  private readonly velocityX: Float64Array;
  private readonly velocityY: Float64Array;
  private readonly previousStepVelocityX: Float64Array;
  private readonly previousStepVelocityY: Float64Array;
  private hasAdvanced = false;

  public constructor(definition: ValidationCaseDefinition) {
    this.cylinderDiameter = definition.configuration.cylinder.cellsPerDiameter;
    this.cylinderRadius = this.cylinderDiameter / 2;
    this.width =
      Math.round(
        (definition.configuration.domain.upstreamDiameters +
          1 +
          definition.configuration.domain.downstreamDiameters) *
          this.cylinderDiameter,
      ) + 1;
    this.height =
      Math.round(
        (2 * definition.configuration.domain.lateralDiameters + 1) *
          this.cylinderDiameter,
      ) + 1;
    this.cellCount = this.width * this.height;
    this.cylinderCenterX =
      definition.configuration.domain.upstreamDiameters * this.cylinderDiameter +
      this.cylinderRadius +
      definition.configuration.cylinder.offsetX;
    this.cylinderCenterY =
      (this.height - 1) / 2 + definition.configuration.cylinder.offsetY;
    this.cylinderRearX = this.cylinderCenterX + this.cylinderRadius;
    const viscosity = (LATTICE_SPEED * this.cylinderDiameter) / definition.reynoldsNumber;
    const tauEven = 0.5 + 3 * viscosity;
    const tauOdd = 0.5 + TRT_MAGIC_PARAMETER / (tauEven - 0.5);
    this.omegaEven = 1 / tauEven;
    this.omegaOdd = 1 / tauOdd;
    this.solid = new Uint8Array(this.cellCount);
    this.cutFraction = new Float64Array(this.cellCount * 9);
    this.populations = new Float64Array(this.cellCount * 9);
    this.next = new Float64Array(this.cellCount * 9);
    this.postCollision = new Float64Array(this.cellCount * 9);
    this.density = new Float64Array(this.cellCount);
    this.velocityX = new Float64Array(this.cellCount);
    this.velocityY = new Float64Array(this.cellCount);
    this.previousStepVelocityX = new Float64Array(this.cellCount);
    this.previousStepVelocityY = new Float64Array(this.cellCount);
    this.initializeGeometry();
    this.initializeUniformFlow();
  }

  public advance(): { readonly x: number; readonly y: number } {
    this.collide();
    const force = this.streamAndBounceBack();
    // Later applications own shared corner populations, matching the public precedence contract.
    this.applyFreeSlipLaterals();
    this.applyRegularizedInlet();
    this.applyFixedDensityOutlet();
    const previous = this.populations;
    this.populations = this.next;
    this.next = previous;
    this.hasAdvanced = true;
    return force;
  }

  public diagnostic(
    step: number,
    flowThroughTime: number,
    meanForceX: number,
    meanForceY = 0,
  ): ValidationSample {
    const density = this.updateMacroscopicFields();
    const fieldResidual = this.measureFieldResidual();
    const symmetryError = this.measureSymmetryError();
    const forceNormalizer =
      0.5 * TARGET_DENSITY * LATTICE_SPEED * LATTICE_SPEED * this.cylinderDiameter;
    const recirculationLength = this.measureWakeRecirculationLength();
    const sample: ValidationSample = {
      step,
      flowThroughTime,
      domainMass: this.measureDomainMass(),
      inletFlux: this.measureFlux(0),
      outletFlux: this.measureFlux(this.width - 1),
      density,
      upstreamReflection: this.measureUpstreamReflection(),
      fieldResidual,
      symmetryError,
      dragCoefficient: meanForceX / forceNormalizer,
      liftCoefficient: meanForceY / forceNormalizer,
      ...(recirculationLength === undefined ? {} : { recirculationLength }),
    };
    return sample;
  }

  private initializeGeometry(): void {
    const radiusSquared = this.cylinderRadius * this.cylinderRadius;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const cell = this.cell(x, y);
        const dx = x - this.cylinderCenterX;
        const dy = y - this.cylinderCenterY;
        this.solid[cell] = dx * dx + dy * dy <= radiusSquared ? 1 : 0;
      }
    }
    for (let y = 1; y < this.height - 1; y += 1) {
      for (let x = 1; x < this.width - 1; x += 1) {
        const cell = this.cell(x, y);
        if (this.solid[cell] === 1) {
          continue;
        }
        for (let direction = 1; direction < 9; direction += 1) {
          const neighbour = this.cell(x + CX[direction]!, y + CY[direction]!);
          if (this.solid[neighbour] === 1) {
            this.cutFraction[cell * 9 + direction] = this.wallIntersectionFraction(
              x,
              y,
              CX[direction]!,
              CY[direction]!,
            );
          }
        }
      }
    }
  }

  private wallIntersectionFraction(x: number, y: number, cx: number, cy: number): number {
    const dx = x - this.cylinderCenterX;
    const dy = y - this.cylinderCenterY;
    const a = cx * cx + cy * cy;
    const b = 2 * (dx * cx + dy * cy);
    const c = dx * dx + dy * dy - this.cylinderRadius * this.cylinderRadius;
    const discriminant = b * b - 4 * a * c;
    const root = (-b - Math.sqrt(Math.max(0, discriminant))) / (2 * a);
    return Math.min(1, Math.max(Number.EPSILON, root));
  }

  private initializeUniformFlow(): void {
    for (let cell = 0; cell < this.cellCount; cell += 1) {
      for (let direction = 0; direction < 9; direction += 1) {
        this.populations[cell * 9 + direction] = equilibrium(
          direction,
          TARGET_DENSITY,
          LATTICE_SPEED,
          0,
        );
      }
    }
  }

  private collide(): void {
    const equilibriumValues = new Float64Array(9);
    for (let cell = 0; cell < this.cellCount; cell += 1) {
      if (this.solid[cell] === 1) {
        continue;
      }
      const base = cell * 9;
      let rho = 0;
      let momentumX = 0;
      let momentumY = 0;
      for (let direction = 0; direction < 9; direction += 1) {
        const value = this.populations[base + direction]!;
        rho += value;
        momentumX += value * CX[direction]!;
        momentumY += value * CY[direction]!;
      }
      const ux = momentumX / rho;
      const uy = momentumY / rho;
      this.previousStepVelocityX[cell] = ux;
      this.previousStepVelocityY[cell] = uy;
      for (let direction = 0; direction < 9; direction += 1) {
        equilibriumValues[direction] = equilibrium(direction, rho, ux, uy);
      }
      for (let direction = 0; direction < 9; direction += 1) {
        const opposite = OPPOSITE[direction]!;
        const value = this.populations[base + direction]!;
        const oppositeValue = this.populations[base + opposite]!;
        const even = 0.5 * (value + oppositeValue);
        const odd = 0.5 * (value - oppositeValue);
        const equilibriumEven =
          0.5 * (equilibriumValues[direction]! + equilibriumValues[opposite]!);
        const equilibriumOdd =
          0.5 * (equilibriumValues[direction]! - equilibriumValues[opposite]!);
        this.postCollision[base + direction] =
          value -
          this.omegaEven * (even - equilibriumEven) -
          this.omegaOdd * (odd - equilibriumOdd);
      }
    }
  }

  private streamAndBounceBack(): { readonly x: number; readonly y: number } {
    this.next.fill(0);
    let forceX = 0;
    let forceY = 0;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const cell = this.cell(x, y);
        if (this.solid[cell] === 1) {
          continue;
        }
        const base = cell * 9;
        this.next[base] = this.postCollision[base]!;
        for (let direction = 1; direction < 9; direction += 1) {
          const neighbourX = x + CX[direction]!;
          const neighbourY = y + CY[direction]!;
          if (
            neighbourX < 0 ||
            neighbourX >= this.width ||
            neighbourY < 0 ||
            neighbourY >= this.height
          ) {
            continue;
          }
          const outgoing = this.postCollision[base + direction]!;
          const neighbour = this.cell(neighbourX, neighbourY);
          if (this.solid[neighbour] === 0) {
            this.next[neighbour * 9 + direction] = outgoing;
            continue;
          }
          const fraction = this.cutFraction[base + direction]!;
          const opposite = OPPOSITE[direction]!;
          let reflected: number;
          if (fraction < 0.5) {
            const awayX = x - CX[direction]!;
            const awayY = y - CY[direction]!;
            const away = this.cell(awayX, awayY);
            reflected =
              2 * fraction * outgoing +
              (1 - 2 * fraction) * this.postCollision[away * 9 + direction]!;
          } else {
            reflected =
              outgoing / (2 * fraction) +
              ((2 * fraction - 1) / (2 * fraction)) *
                this.postCollision[base + opposite]!;
          }
          this.next[base + opposite] = reflected;
          forceX += (outgoing + reflected) * CX[direction]!;
          forceY += (outgoing + reflected) * CY[direction]!;
        }
      }
    }
    return { x: forceX, y: forceY };
  }

  private applyFreeSlipLaterals(): void {
    for (let x = 0; x < this.width; x += 1) {
      const bottom = this.cell(x, 0) * 9;
      this.next[bottom + 2] = this.postCollision[bottom + 4]!;
      this.next[bottom + 5] = this.postCollision[bottom + 8]!;
      this.next[bottom + 6] = this.postCollision[bottom + 7]!;
      const top = this.cell(x, this.height - 1) * 9;
      this.next[top + 4] = this.postCollision[top + 2]!;
      this.next[top + 7] = this.postCollision[top + 6]!;
      this.next[top + 8] = this.postCollision[top + 5]!;
    }
  }

  private applyRegularizedInlet(): void {
    for (let y = 0; y < this.height; y += 1) {
      const boundaryBase = this.cell(0, y) * 9;
      const neighbourBase = this.cell(1, y) * 9;
      const rho =
        (this.next[boundaryBase]! +
          this.next[boundaryBase + 2]! +
          this.next[boundaryBase + 4]! +
          2 *
            (this.next[boundaryBase + 3]! +
              this.next[boundaryBase + 6]! +
              this.next[boundaryBase + 7]!)) /
        (1 - LATTICE_SPEED);
      const neighbour = macroscopic(this.next, neighbourBase);
      const stress = nonEquilibriumStress(
        this.next,
        neighbourBase,
        neighbour.rho,
        neighbour.ux,
        neighbour.uy,
      );
      for (let direction = 0; direction < 9; direction += 1) {
        const qxx = CX[direction]! * CX[direction]! - 1 / 3;
        const qxy = CX[direction]! * CY[direction]!;
        const qyy = CY[direction]! * CY[direction]! - 1 / 3;
        const regularizedNonEquilibrium =
          4.5 *
          WEIGHTS[direction]! *
          (qxx * stress.xx + 2 * qxy * stress.xy + qyy * stress.yy);
        this.next[boundaryBase + direction] =
          equilibrium(direction, rho, LATTICE_SPEED, 0) + regularizedNonEquilibrium;
      }
    }
  }

  private applyFixedDensityOutlet(): void {
    for (let y = 0; y < this.height; y += 1) {
      const boundaryBase = this.cell(this.width - 1, y) * 9;
      const neighbourBase = this.cell(this.width - 2, y) * 9;
      const neighbour = macroscopic(this.next, neighbourBase);
      for (let direction = 0; direction < 9; direction += 1) {
        const nonEquilibrium =
          this.next[neighbourBase + direction]! -
          equilibrium(direction, neighbour.rho, neighbour.ux, neighbour.uy);
        this.next[boundaryBase + direction] =
          equilibrium(direction, TARGET_DENSITY, neighbour.ux, neighbour.uy) + nonEquilibrium;
      }
    }
  }

  private updateMacroscopicFields(): DensitySample {
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    let total = 0;
    let fluidCells = 0;
    let nonFiniteValueCount = 0;
    let nonPositiveValueCount = 0;
    for (let cell = 0; cell < this.cellCount; cell += 1) {
      if (this.solid[cell] === 1) {
        this.density[cell] = 0;
        this.velocityX[cell] = 0;
        this.velocityY[cell] = 0;
        continue;
      }
      const values = macroscopic(this.populations, cell * 9);
      this.density[cell] = values.rho;
      this.velocityX[cell] = values.ux;
      this.velocityY[cell] = values.uy;
      if (![values.rho, values.ux, values.uy].every(Number.isFinite)) {
        nonFiniteValueCount += [values.rho, values.ux, values.uy].filter(
          (value) => !Number.isFinite(value),
        ).length;
      }
      if (values.rho <= 0) {
        nonPositiveValueCount += 1;
      }
      minimum = Math.min(minimum, values.rho);
      maximum = Math.max(maximum, values.rho);
      total += values.rho;
      fluidCells += 1;
    }
    return {
      minimum,
      maximum,
      mean: total / fluidCells,
      nonFiniteValueCount,
      nonPositiveValueCount,
    };
  }

  private measureFieldResidual(): number {
    if (!this.hasAdvanced) {
      return 0;
    }
    let squaredDifference = 0;
    let squaredReference = 0;
    for (let cell = 0; cell < this.cellCount; cell += 1) {
      if (this.solid[cell] === 1) {
        continue;
      }
      const dx = this.velocityX[cell]! - this.previousStepVelocityX[cell]!;
      const dy = this.velocityY[cell]! - this.previousStepVelocityY[cell]!;
      squaredDifference += dx * dx + dy * dy;
      squaredReference +=
        this.velocityX[cell]! * this.velocityX[cell]! +
        this.velocityY[cell]! * this.velocityY[cell]!;
    }
    return Math.sqrt(squaredDifference / Math.max(squaredReference, Number.EPSILON));
  }

  private measureSymmetryError(): number {
    const centreY = Math.round(this.cylinderCenterY);
    const startX = Math.ceil(this.cylinderRearX);
    const endX = Math.min(
      this.width - 2,
      Math.floor(this.cylinderRearX + 8 * this.cylinderDiameter),
    );
    let squaredDifference = 0;
    let squaredReference = 0;
    for (let yOffset = 1; centreY - yOffset >= 1 && centreY + yOffset < this.height - 1; yOffset += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const upper = this.cell(x, centreY + yOffset);
        const lower = this.cell(x, centreY - yOffset);
        if (this.solid[upper] === 1 || this.solid[lower] === 1) {
          continue;
        }
        const du = this.velocityX[upper]! - this.velocityX[lower]!;
        const dv = this.velocityY[upper]! + this.velocityY[lower]!;
        squaredDifference += du * du + dv * dv;
        squaredReference +=
          0.5 *
          (this.velocityX[upper]! * this.velocityX[upper]! +
            this.velocityY[upper]! * this.velocityY[upper]! +
            this.velocityX[lower]! * this.velocityX[lower]! +
            this.velocityY[lower]! * this.velocityY[lower]!);
      }
    }
    return Math.sqrt(squaredDifference / Math.max(squaredReference, Number.EPSILON));
  }

  private measureWakeRecirculationLength(): number | undefined {
    const y = Math.round(this.cylinderCenterY);
    const positions: number[] = [];
    const velocities: number[] = [];
    for (let x = Math.ceil(this.cylinderRearX); x < this.width; x += 1) {
      const cell = this.cell(x, y);
      if (this.solid[cell] === 0) {
        positions.push(x / this.cylinderDiameter);
        velocities.push(this.velocityX[cell]!);
      }
    }
    return measureRecirculationLength(
      positions,
      velocities,
      this.cylinderRearX / this.cylinderDiameter,
    );
  }

  private measureDomainMass(): number {
    let mass = 0;
    for (let cell = 0; cell < this.cellCount; cell += 1) {
      if (this.solid[cell] === 0) {
        mass += this.density[cell]!;
      }
    }
    return mass;
  }

  private measureFlux(x: number): number {
    let flux = 0;
    for (let y = 0; y < this.height; y += 1) {
      const cell = this.cell(x, y);
      flux += this.density[cell]! * this.velocityX[cell]!;
    }
    return flux * (this.cylinderDiameter / LATTICE_SPEED);
  }

  private measureUpstreamReflection(): number {
    const probeX = 1;
    let meanVelocityX = 0;
    let count = 0;
    for (let y = 1; y < this.height - 1; y += 1) {
      meanVelocityX += this.velocityX[this.cell(probeX, y)]!;
      count += 1;
    }
    meanVelocityX /= count;
    let squaredDisturbance = 0;
    for (let y = 1; y < this.height - 1; y += 1) {
      const cell = this.cell(probeX, y);
      const du = this.velocityX[cell]! - meanVelocityX;
      const dv = this.velocityY[cell]!;
      squaredDisturbance += du * du + dv * dv;
    }
    return Math.sqrt(squaredDisturbance / count) / LATTICE_SPEED;
  }

  private cell(x: number, y: number): number {
    return y * this.width + x;
  }
}

function equilibrium(
  direction: number,
  density: number,
  velocityX: number,
  velocityY: number,
): number {
  const projection = CX[direction]! * velocityX + CY[direction]! * velocityY;
  const velocitySquared = velocityX * velocityX + velocityY * velocityY;
  return (
    WEIGHTS[direction]! *
    density *
    (1 + 3 * projection + 4.5 * projection * projection - 1.5 * velocitySquared)
  );
}

function macroscopic(
  populations: Float64Array,
  base: number,
): { readonly rho: number; readonly ux: number; readonly uy: number } {
  let rho = 0;
  let momentumX = 0;
  let momentumY = 0;
  for (let direction = 0; direction < 9; direction += 1) {
    const value = populations[base + direction]!;
    rho += value;
    momentumX += value * CX[direction]!;
    momentumY += value * CY[direction]!;
  }
  return { rho, ux: momentumX / rho, uy: momentumY / rho };
}

function nonEquilibriumStress(
  populations: Float64Array,
  base: number,
  density: number,
  velocityX: number,
  velocityY: number,
): { readonly xx: number; readonly xy: number; readonly yy: number } {
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (let direction = 0; direction < 9; direction += 1) {
    const nonEquilibrium =
      populations[base + direction]! -
      equilibrium(direction, density, velocityX, velocityY);
    xx += nonEquilibrium * CX[direction]! * CX[direction]!;
    xy += nonEquilibrium * CX[direction]! * CY[direction]!;
    yy += nonEquilibrium * CY[direction]! * CY[direction]!;
  }
  return { xx, xy, yy };
}
