import { measureRecirculationLength } from "./metrics.js";
import { runFixedStepValidationCase } from "./fixed-step-runner.js";
import {
  D2Q9_OPEN_CYLINDER_CONTRACT,
  buildOpenCylinderGeometry,
  equilibriumPopulation,
  trtRelaxationRates,
} from "./d2q9-open-cylinder-contract.js";
import {
  VALIDATION_SCHEMA_VERSION,
  type BackendIdentity,
  type BoundaryConfiguration,
  type DensitySample,
  type FixedStepCaseCommand,
  type FixedStepCaseExecution,
  type FixedStepSolverBackend,
  type ValidationCaseDefinition,
  type ValidationSample,
} from "./types.js";

const CX = D2Q9_OPEN_CYLINDER_CONTRACT.directions.map(([x]) => x);
const CY = D2Q9_OPEN_CYLINDER_CONTRACT.directions.map(([, y]) => y);
const OPPOSITE = D2Q9_OPEN_CYLINDER_CONTRACT.opposite;
const WEIGHTS = D2Q9_OPEN_CYLINDER_CONTRACT.weights;
const DEFAULT_LATTICE_SPEED = D2Q9_OPEN_CYLINDER_CONTRACT.defaultLatticeSpeed;
const TARGET_DENSITY = D2Q9_OPEN_CYLINDER_CONTRACT.targetDensity;

export const CPU_REFERENCE_BOUNDARY_PRECEDENCE =
  D2Q9_OPEN_CYLINDER_CONTRACT.boundaryPrecedence;

export const CPU_REFERENCE_BACKEND_IDENTITY = Object.freeze({
  schemaVersion: VALIDATION_SCHEMA_VERSION,
  id: "cpu-reference",
  kind: "cpu-worker",
  solver: "D2Q9 TRT/BFL open-cylinder reference",
  solverVersion: "1.2.0",
  buildId: "ticket-06",
} satisfies BackendIdentity);

export interface CpuReferenceRunCaseCommand {
  readonly type: "run-case";
  readonly definition: ValidationCaseDefinition;
}

export type CpuReferenceWorkerResponse =
  | { readonly type: "sample"; readonly sample: ValidationSample }
  | { readonly type: "complete" }
  | { readonly type: "error"; readonly message: string };

export interface CpuReferenceWorkerPort {
  onmessage: ((event: MessageEvent<CpuReferenceWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(command: CpuReferenceRunCaseCommand): void;
  terminate(): void;
}

export type CpuReferenceWorkerFactory = () => CpuReferenceWorkerPort;

export interface CpuFlowFieldView {
  readonly width: number;
  readonly height: number;
  readonly cylinderDiameter: number;
  readonly cylinderCenterX: number;
  readonly cylinderCenterY: number;
  readonly latticeSpeed: number;
  readonly solid: Uint8Array;
  readonly velocityX: Float64Array;
  readonly velocityY: Float64Array;
}

export function createCpuReferenceBackend(
  workerFactory: CpuReferenceWorkerFactory = createBrowserCpuReferenceWorker,
): FixedStepSolverBackend {
  return {
    schemaVersion: VALIDATION_SCHEMA_VERSION,
    identity: CPU_REFERENCE_BACKEND_IDENTITY,
    runCase(definition) {
      return runCaseInWorker(definition, workerFactory);
    },
    createCase(definition) {
      return Promise.resolve(createCpuFixedStepCase(definition));
    },
  };
}

export async function* runCpuReferenceCase(
  definition: ValidationCaseDefinition,
): AsyncIterable<ValidationSample> {
  yield* runFixedStepValidationCase(
    definition,
    () => Promise.resolve(createCpuFixedStepCase(definition)),
    "CPU reference",
  );
}

export function createCpuFixedStepCase(
  definition: ValidationCaseDefinition,
): FixedStepCaseExecution {
  validateReferenceConfiguration(definition);
  const solver = new D2Q9TrtOpenCylinder(definition);
  let forceX = 0;
  let forceY = 0;
  let stepsSinceDiagnostic = 0;
  let disposed = false;
  return {
    cylinderDiameter: solver.cylinderDiameter,
    latticeSpeed: solver.latticeSpeed,
    async execute(command: FixedStepCaseCommand) {
      if (disposed) throw new Error("The CPU fixed-step case has been disposed.");
      if (command.type === "dispose") {
        disposed = true;
        return undefined;
      }
      if (command.type === "advance-fixed-steps") {
        if (!Number.isInteger(command.stepCount) || command.stepCount <= 0) {
          throw new RangeError("CPU fixed-step advancement requires a positive integer step count.");
        }
        solver.setReynoldsNumber(command.reynoldsNumber);
        for (let step = 0; step < command.stepCount; step += 1) {
          const force = solver.advance();
          forceX += force.x;
          forceY += force.y;
          stepsSinceDiagnostic += 1;
        }
        return undefined;
      }
      const divisor = command.stepsSinceSample === 0 ? 1 : command.stepsSinceSample;
      if (command.stepsSinceSample !== stepsSinceDiagnostic) {
        throw new Error(
          `CPU diagnostic expected ${stepsSinceDiagnostic} fixed steps; received ${command.stepsSinceSample}.`,
        );
      }
      const sample = solver.diagnostic(
        command.step,
        command.flowThroughTime,
        forceX / divisor,
        forceY / divisor,
      );
      forceX = 0;
      forceY = 0;
      stepsSinceDiagnostic = 0;
      return sample;
    },
  };
}

async function* runCaseInWorker(
  definition: ValidationCaseDefinition,
  workerFactory: CpuReferenceWorkerFactory,
): AsyncIterable<ValidationSample> {
  const worker = workerFactory();
  const queued: CpuReferenceWorkerResponse[] = [];
  let resolveNext: ((response: CpuReferenceWorkerResponse) => void) | undefined;
  const receive = (response: CpuReferenceWorkerResponse) => {
    if (resolveNext !== undefined) {
      const resolve = resolveNext;
      resolveNext = undefined;
      resolve(response);
    } else {
      queued.push(response);
    }
  };
  const nextResponse = () => {
    const response = queued.shift();
    return response === undefined
      ? new Promise<CpuReferenceWorkerResponse>((resolve) => {
          resolveNext = resolve;
        })
      : Promise.resolve(response);
  };

  worker.onmessage = ({ data }) => receive(data);
  worker.onerror = (event) =>
    receive({ type: "error", message: event.message || "CPU reference Worker failed." });
  worker.postMessage({ type: "run-case", definition });
  try {
    while (true) {
      const response = await nextResponse();
      if (response.type === "sample") {
        yield response.sample;
      } else if (response.type === "complete") {
        return;
      } else {
        throw new Error(response.message);
      }
    }
  } finally {
    worker.terminate();
  }
}

function createBrowserCpuReferenceWorker(): CpuReferenceWorkerPort {
  return new Worker(new URL("./cpu-reference-worker.js", import.meta.url), {
    type: "module",
    name: "cfd-visualise-cpu-reference",
  });
}

function validateReferenceConfiguration(definition: ValidationCaseDefinition): void {
  const { configuration } = definition;
  if (
    configuration.backendId !== CPU_REFERENCE_BACKEND_IDENTITY.id ||
    configuration.collision !== "D2Q9 TRT" ||
    configuration.precision !== "float64" ||
    !["regularized-velocity", "equilibrium-velocity"].includes(
      configuration.boundaries.inlet,
    ) ||
    !["free-slip", "periodic"].includes(configuration.boundaries.lateral) ||
    !["fixed-density-nee", "convective", "extrapolated"].includes(
      configuration.boundaries.outlet,
    ) ||
    configuration.boundaries.cylinder !== "linear-bfl"
  ) {
    throw new Error(
      `Case ${definition.id} is incompatible with the CPU reference TRT/BFL open-boundary contract.`,
    );
  }
}

export class D2Q9TrtOpenCylinder {
  public readonly cylinderDiameter: number;
  public readonly latticeSpeed: number;
  private readonly initialTransversePerturbation: number;
  private readonly boundaries: BoundaryConfiguration;
  private readonly upstreamReflectionMode: NonNullable<
    ValidationCaseDefinition["configuration"]["upstreamReflectionMode"]
  >;
  private readonly width: number;
  private readonly height: number;
  private readonly cellCount: number;
  private readonly cylinderCenterX: number;
  private readonly cylinderCenterY: number;
  private readonly cylinderRearX: number;
  private omegaEven = 0;
  private omegaOdd = 0;
  private readonly solid: Uint8Array;
  private readonly cutFraction: Float64Array;
  private readonly streamTarget: Int32Array;
  private readonly bounceAway: Int32Array;
  private readonly bounceLinks: Int32Array;
  private readonly retainsPostCollision: Uint8Array;
  private populations: Float64Array;
  private next: Float64Array;
  private readonly postCollision: Float64Array;
  private readonly density: Float64Array;
  private readonly velocityX: Float64Array;
  private readonly velocityY: Float64Array;
  private readonly previousStepVelocityX: Float64Array;
  private readonly previousStepVelocityY: Float64Array;
  private hasAdvanced = false;
  private macroscopicFieldsCurrent = false;

  public constructor(definition: ValidationCaseDefinition) {
    const geometry = buildOpenCylinderGeometry(definition);
    this.cylinderDiameter = geometry.cylinderDiameter;
    this.latticeSpeed = definition.configuration.latticeSpeed ?? DEFAULT_LATTICE_SPEED;
    this.initialTransversePerturbation =
      definition.configuration.initialTransversePerturbation ?? 0;
    this.boundaries = definition.configuration.boundaries;
    this.upstreamReflectionMode =
      definition.configuration.upstreamReflectionMode ?? "velocity-vector-about-mean";
    this.width = geometry.width;
    this.height = geometry.height;
    this.cellCount = geometry.cellCount;
    this.cylinderCenterX = geometry.cylinderCenterX;
    this.cylinderCenterY = geometry.cylinderCenterY;
    this.cylinderRearX = geometry.cylinderRearX;
    this.setReynoldsNumber(
      definition.protocol.reynoldsChange?.initialReynoldsNumber ?? definition.reynoldsNumber,
    );
    this.solid = geometry.solid;
    this.cutFraction = geometry.cutFraction;
    this.streamTarget = geometry.streamTarget;
    this.bounceAway = geometry.bounceAway;
    this.bounceLinks = geometry.bounceLinks;
    this.retainsPostCollision = geometry.retainsPostCollision;
    this.populations = new Float64Array(this.cellCount * 9);
    this.next = new Float64Array(this.cellCount * 9);
    this.postCollision = new Float64Array(this.cellCount * 9);
    this.density = new Float64Array(this.cellCount);
    this.velocityX = new Float64Array(this.cellCount);
    this.velocityY = new Float64Array(this.cellCount);
    this.previousStepVelocityX = new Float64Array(this.cellCount);
    this.previousStepVelocityY = new Float64Array(this.cellCount);
    this.initializeUniformFlow();
  }

  public advance(): { readonly x: number; readonly y: number } {
    if (!this.hasAdvanced && this.initialTransversePerturbation > 0) {
      this.perturbWake(this.initialTransversePerturbation);
    }
    const force = this.collideAndStream();
    // Later applications own shared corner populations, matching the public precedence contract.
    this.applyLateralBoundary();
    this.applyInletBoundary();
    this.applyOutletBoundary();
    const previous = this.populations;
    this.populations = this.next;
    this.next = previous;
    this.hasAdvanced = true;
    this.macroscopicFieldsCurrent = false;
    return force;
  }

  public setReynoldsNumber(reynoldsNumber: number): void {
    const relaxation = trtRelaxationRates(
      reynoldsNumber,
      this.cylinderDiameter,
      this.latticeSpeed,
    );
    this.omegaEven = relaxation.omegaEven;
    this.omegaOdd = relaxation.omegaOdd;
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
      0.5 * TARGET_DENSITY * this.latticeSpeed * this.latticeSpeed * this.cylinderDiameter;
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

  public flowField(): CpuFlowFieldView {
    if (!this.macroscopicFieldsCurrent) this.updateMacroscopicFields();
    return {
      width: this.width,
      height: this.height,
      cylinderDiameter: this.cylinderDiameter,
      cylinderCenterX: this.cylinderCenterX,
      cylinderCenterY: this.cylinderCenterY,
      latticeSpeed: this.latticeSpeed,
      solid: this.solid,
      velocityX: this.velocityX,
      velocityY: this.velocityY,
    };
  }

  public perturbWake(amplitude: number): void {
    if (!Number.isFinite(amplitude) || amplitude <= 0) {
      throw new RangeError("Wake perturbation amplitude must be positive and finite.");
    }
    this.applyWakePerturbation(amplitude);
  }

  private initializeUniformFlow(): void {
    for (let cell = 0; cell < this.cellCount; cell += 1) {
      for (let direction = 0; direction < 9; direction += 1) {
        this.populations[cell * 9 + direction] = equilibrium(
          direction,
          TARGET_DENSITY,
          this.latticeSpeed,
          0,
        );
      }
    }
  }

  private applyWakePerturbation(amplitude: number): void {
    this.macroscopicFieldsCurrent = false;
    const centreX = this.cylinderRearX + 0.75 * this.cylinderDiameter;
    const centreY = this.cylinderCenterY + 0.25 * this.cylinderDiameter;
    const radius = 0.5 * this.cylinderDiameter;
    const radiusSquared = radius * radius;
    const reconstructed = { rho: 0, ux: 0, uy: 0 };
    for (let y = Math.floor(centreY - radius); y <= Math.ceil(centreY + radius); y += 1) {
      for (let x = Math.floor(centreX - radius); x <= Math.ceil(centreX + radius); x += 1) {
        const cell = this.cell(x, y);
        if (this.solid[cell] === 1) {
          continue;
        }
        const distanceSquared = (x - centreX) ** 2 + (y - centreY) ** 2;
        if (distanceSquared > radiusSquared) {
          continue;
        }
        const base = cell * 9;
        reconstructMacroscopic(this.populations, base, reconstructed);
        const transverseVelocity =
          reconstructed.uy +
          amplitude * Math.exp(-4 * distanceSquared / radiusSquared);
        for (let direction = 0; direction < 9; direction += 1) {
          this.populations[base + direction] = equilibrium(
            direction,
            reconstructed.rho,
            reconstructed.ux,
            transverseVelocity,
          );
        }
      }
    }
  }

  private collideAndStream(): { readonly x: number; readonly y: number } {
    const populations = this.populations;
    const postCollision = this.postCollision;
    const next = this.next;
    const streamTarget = this.streamTarget;
    const previousVelocityX = this.previousStepVelocityX;
    const previousVelocityY = this.previousStepVelocityY;
    const omegaEven = this.omegaEven;
    const omegaOdd = this.omegaOdd;
    const retainsPostCollision = this.retainsPostCollision;
    next.fill(0);
    for (let cell = 0; cell < this.cellCount; cell += 1) {
      if (this.solid[cell] === 1) {
        continue;
      }
      const base = cell * 9;
      const f0 = populations[base]!;
      const f1 = populations[base + 1]!;
      const f2 = populations[base + 2]!;
      const f3 = populations[base + 3]!;
      const f4 = populations[base + 4]!;
      const f5 = populations[base + 5]!;
      const f6 = populations[base + 6]!;
      const f7 = populations[base + 7]!;
      const f8 = populations[base + 8]!;
      const rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
      const ux = (f1 - f3 + f5 - f6 - f7 + f8) / rho;
      const uy = (f2 - f4 + f5 + f6 - f7 - f8) / rho;
      previousVelocityX[cell] = ux;
      previousVelocityY[cell] = uy;

      const velocitySquared = ux * ux + uy * uy;
      const common = 1 - 1.5 * velocitySquared;
      const rhoNinth = rho / 9;
      const rhoThirtySixth = rho / 36;
      const uxPlusUy = ux + uy;
      const minusUxPlusUy = -ux + uy;
      const e0 = (4 * rhoNinth) * common;
      const e1 = rhoNinth * (common + 3 * ux + 4.5 * ux * ux);
      const e2 = rhoNinth * (common + 3 * uy + 4.5 * uy * uy);
      const e3 = rhoNinth * (common - 3 * ux + 4.5 * ux * ux);
      const e4 = rhoNinth * (common - 3 * uy + 4.5 * uy * uy);
      const e5 = rhoThirtySixth *
        (common + 3 * uxPlusUy + 4.5 * uxPlusUy * uxPlusUy);
      const e6 = rhoThirtySixth *
        (common + 3 * minusUxPlusUy + 4.5 * minusUxPlusUy * minusUxPlusUy);
      const e7 = rhoThirtySixth *
        (common - 3 * uxPlusUy + 4.5 * uxPlusUy * uxPlusUy);
      const e8 = rhoThirtySixth *
        (common - 3 * minusUxPlusUy + 4.5 * minusUxPlusUy * minusUxPlusUy);

      const p0 = f0 - omegaEven * (f0 - e0);
      let evenRelaxation =
        omegaEven * (0.5 * (f1 + f3) - 0.5 * (e1 + e3));
      let oddRelaxation =
        omegaOdd * (0.5 * (f1 - f3) - 0.5 * (e1 - e3));
      const p1 = f1 - evenRelaxation - oddRelaxation;
      const p3 = f3 - evenRelaxation + oddRelaxation;

      evenRelaxation =
        omegaEven * (0.5 * (f2 + f4) - 0.5 * (e2 + e4));
      oddRelaxation =
        omegaOdd * (0.5 * (f2 - f4) - 0.5 * (e2 - e4));
      const p2 = f2 - evenRelaxation - oddRelaxation;
      const p4 = f4 - evenRelaxation + oddRelaxation;

      evenRelaxation =
        omegaEven * (0.5 * (f5 + f7) - 0.5 * (e5 + e7));
      oddRelaxation =
        omegaOdd * (0.5 * (f5 - f7) - 0.5 * (e5 - e7));
      const p5 = f5 - evenRelaxation - oddRelaxation;
      const p7 = f7 - evenRelaxation + oddRelaxation;

      evenRelaxation =
        omegaEven * (0.5 * (f6 + f8) - 0.5 * (e6 + e8));
      oddRelaxation =
        omegaOdd * (0.5 * (f6 - f8) - 0.5 * (e6 - e8));
      const p6 = f6 - evenRelaxation - oddRelaxation;
      const p8 = f8 - evenRelaxation + oddRelaxation;

      if (retainsPostCollision[cell] === 1) {
        postCollision[base] = p0;
        postCollision[base + 1] = p1;
        postCollision[base + 2] = p2;
        postCollision[base + 3] = p3;
        postCollision[base + 4] = p4;
        postCollision[base + 5] = p5;
        postCollision[base + 6] = p6;
        postCollision[base + 7] = p7;
        postCollision[base + 8] = p8;
      }

      next[base] = p0;
      let target = streamTarget[base + 1]!;
      if (target >= 0) next[target] = p1;
      target = streamTarget[base + 2]!;
      if (target >= 0) next[target] = p2;
      target = streamTarget[base + 3]!;
      if (target >= 0) next[target] = p3;
      target = streamTarget[base + 4]!;
      if (target >= 0) next[target] = p4;
      target = streamTarget[base + 5]!;
      if (target >= 0) next[target] = p5;
      target = streamTarget[base + 6]!;
      if (target >= 0) next[target] = p6;
      target = streamTarget[base + 7]!;
      if (target >= 0) next[target] = p7;
      target = streamTarget[base + 8]!;
      if (target >= 0) next[target] = p8;
    }

    const bounceAway = this.bounceAway;
    const cutFraction = this.cutFraction;
    let forceX = 0;
    let forceY = 0;
    for (const link of this.bounceLinks) {
      const base = link - (link % 9);
      const direction = link - base;
      const outgoing = postCollision[link]!;
      const fraction = cutFraction[link]!;
      const opposite = OPPOSITE[direction]!;
      const reflected =
        fraction < 0.5
          ? 2 * fraction * outgoing +
            (1 - 2 * fraction) * postCollision[bounceAway[link]!]!
          : outgoing / (2 * fraction) +
            ((2 * fraction - 1) / (2 * fraction)) *
              postCollision[base + opposite]!;
      next[base + opposite] = reflected;
      forceX += (outgoing + reflected) * CX[direction]!;
      forceY += (outgoing + reflected) * CY[direction]!;
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

  private applyLateralBoundary(): void {
    if (this.boundaries.lateral === "free-slip") {
      this.applyFreeSlipLaterals();
    }
  }

  private applyInletBoundary(): void {
    if (this.boundaries.inlet === "regularized-velocity") {
      this.applyRegularizedInlet();
      return;
    }
    this.applyEquilibriumInlet();
  }

  private applyOutletBoundary(): void {
    if (this.boundaries.outlet === "fixed-density-nee") {
      this.applyFixedDensityOutlet();
      return;
    }
    if (this.boundaries.outlet === "convective") {
      this.applyConvectiveOutlet();
      return;
    }
    this.applyExtrapolatedOutlet();
  }

  private applyEquilibriumInlet(): void {
    for (let y = 0; y < this.height; y += 1) {
      const boundaryBase = this.cell(0, y) * 9;
      const density = this.inletDensity(boundaryBase);
      for (let direction = 0; direction < 9; direction += 1) {
        this.next[boundaryBase + direction] = equilibrium(
          direction,
          density,
          this.latticeSpeed,
          0,
        );
      }
    }
  }

  private applyRegularizedInlet(): void {
    for (let y = 0; y < this.height; y += 1) {
      const boundaryBase = this.cell(0, y) * 9;
      const neighbourBase = this.cell(1, y) * 9;
      const rho = this.inletDensity(boundaryBase);
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
          equilibrium(direction, rho, this.latticeSpeed, 0) + regularizedNonEquilibrium;
      }
    }
  }

  private inletDensity(boundaryBase: number): number {
    return (
      (this.next[boundaryBase]! +
        this.next[boundaryBase + 2]! +
        this.next[boundaryBase + 4]! +
        2 *
          (this.next[boundaryBase + 3]! +
            this.next[boundaryBase + 6]! +
            this.next[boundaryBase + 7]!)) /
      (1 - this.latticeSpeed)
    );
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

  private applyExtrapolatedOutlet(): void {
    for (let y = 0; y < this.height; y += 1) {
      const boundaryBase = this.cell(this.width - 1, y) * 9;
      const neighbourBase = this.cell(this.width - 2, y) * 9;
      for (let direction = 0; direction < 9; direction += 1) {
        this.next[boundaryBase + direction] = this.next[neighbourBase + direction]!;
      }
    }
  }

  private applyConvectiveOutlet(): void {
    const denominator = 1 + this.latticeSpeed;
    for (let y = 0; y < this.height; y += 1) {
      const boundaryBase = this.cell(this.width - 1, y) * 9;
      const neighbourBase = this.cell(this.width - 2, y) * 9;
      for (let direction = 0; direction < 9; direction += 1) {
        this.next[boundaryBase + direction] =
          (this.populations[boundaryBase + direction]! +
            this.latticeSpeed * this.next[neighbourBase + direction]!) /
          denominator;
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
    this.macroscopicFieldsCurrent = true;
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
    return flux * (this.cylinderDiameter / this.latticeSpeed);
  }

  private measureUpstreamReflection(): number {
    const probeX = 1;
    if (this.upstreamReflectionMode === "velocity-vector-about-mean") {
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
        const streamwiseDisturbance = this.velocityX[cell]! - meanVelocityX;
        const transverseDisturbance = this.velocityY[cell]!;
        squaredDisturbance +=
          streamwiseDisturbance * streamwiseDisturbance +
          transverseDisturbance * transverseDisturbance;
      }
      return Math.sqrt(squaredDisturbance / count) / this.latticeSpeed;
    }
    let count = 0;
    let squaredStreamwiseDisturbance = 0;
    for (let y = 1; y < this.height - 1; y += 1) {
      const cell = this.cell(probeX, y);
      const streamwiseDisturbance = this.velocityX[cell]! - this.latticeSpeed;
      squaredStreamwiseDisturbance += streamwiseDisturbance * streamwiseDisturbance;
      count += 1;
    }
    return Math.sqrt(squaredStreamwiseDisturbance / count) / this.latticeSpeed;
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
  return equilibriumPopulation(direction, density, velocityX, velocityY);
}

function macroscopic(
  populations: Float64Array,
  base: number,
): { readonly rho: number; readonly ux: number; readonly uy: number } {
  const reconstructed = { rho: 0, ux: 0, uy: 0 };
  reconstructMacroscopic(populations, base, reconstructed);
  return reconstructed;
}

function reconstructMacroscopic(
  populations: Float64Array,
  base: number,
  result: { rho: number; ux: number; uy: number },
): void {
  let rho = 0;
  let momentumX = 0;
  let momentumY = 0;
  for (let direction = 0; direction < 9; direction += 1) {
    const value = populations[base + direction]!;
    rho += value;
    momentumX += value * CX[direction]!;
    momentumY += value * CY[direction]!;
  }
  result.rho = rho;
  result.ux = momentumX / rho;
  result.uy = momentumY / rho;
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
