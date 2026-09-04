import { analyseLiftSignal, reconcileDomainMass } from "../validation/metrics.js";
import type { WebGpuDeviceHandle } from "../validation/webgpu-api.js";
import {
  createWebGpuInteractiveCase,
  type WebGpuInteractiveCaseExecution,
} from "../validation/webgpu-runtime.js";
import type {
  FlowRegime,
  NumericalHealthThresholds,
  PhysicalScenario,
  ValidationCaseDefinition,
  ValidationSample,
} from "../validation/types.js";
import { WEBGPU_PRODUCTION_TIER } from "./quality-tiers.js";
import { canonicalCaseForReynolds } from "./cpu-production-contract.js";
import {
  applyPhysicalScenarioChange,
  reynoldsNumber,
  validatePhysicalScenario,
} from "./physical-scenario.js";
import type { WakeEncodingFocus } from "./protocol.js";

const ADAPTING_FLOW_THROUGH_TIME = 4;
const ADAPTATION_WAKE_PERTURBATION = 0.002;

export interface WebGpuWakeSimulationSummary {
  readonly availability: "available" | "unavailable";
  readonly unavailableReason?: string;
  readonly scenario: PhysicalScenario;
  readonly reynoldsNumber: number;
  readonly targetReynoldsNumber: number;
  readonly flowThroughTime: number;
  readonly regime: FlowRegime;
  readonly strouhalNumber?: number;
}

/** Owns the GPU-resident interactive field behind the shared fixed-step seam. */
export class WebGpuWakeSimulation {
  private execution!: WebGpuInteractiveCaseExecution;
  private scenario: PhysicalScenario;
  private stepCount = 0;
  private sampledStep = 0;
  private requestedStepTotal = 0;
  private currentReynoldsNumber: number;
  private regime: FlowRegime = "developing";
  private availability: "available" | "unavailable" = "available";
  private unavailableReason: string | undefined;
  private adaptation:
    | {
        readonly initialReynoldsNumber: number;
        readonly targetReynoldsNumber: number;
        readonly startFlowThroughTime: number;
        wakePerturbed: boolean;
      }
    | undefined;
  private samples: ValidationSample[] = [];
  private phaseStartFlowThroughTime = 0;
  private strouhalNumber: number | undefined;

  private constructor(
    private readonly device: WebGpuDeviceHandle,
    scenario: PhysicalScenario,
  ) {
    validatePhysicalScenario(scenario);
    this.scenario = Object.freeze({ ...scenario });
    this.currentReynoldsNumber = reynoldsNumber(scenario);
  }

  public static async create(
    device: WebGpuDeviceHandle,
    scenario: PhysicalScenario,
  ): Promise<WebGpuWakeSimulation> {
    const simulation = new WebGpuWakeSimulation(device, scenario);
    await simulation.recreateCase();
    return simulation;
  }

  public async advanceBy(flowThroughTime: number): Promise<WebGpuWakeSimulationSummary> {
    if (this.availability === "unavailable") return this.summary();
    if (!Number.isFinite(flowThroughTime) || flowThroughTime <= 0) {
      throw new RangeError("Wake advancement requires a positive flow-through increment.");
    }
    this.requestedStepTotal +=
      (flowThroughTime * this.execution.cylinderDiameter) / this.execution.latticeSpeed;
    const targetStep = Math.floor(this.requestedStepTotal + 1e-9);
    const stepCount = targetStep - this.stepCount;
    if (stepCount <= 0) return this.summary();
    await this.updateAdaptation();
    const sample = await this.execution.advanceAndSample({
      stepCount,
      reynoldsNumber: this.currentReynoldsNumber,
      step: targetStep,
      flowThroughTime:
        (targetStep * this.execution.latticeSpeed) / this.execution.cylinderDiameter,
      stepsSinceSample: targetStep - this.sampledStep,
    });
    this.stepCount = targetStep;
    this.sampledStep = this.stepCount;
    this.samples.push(sample);
    this.measureRegime(sample);
    return this.summary();
  }

  public async setScenario(requested: PhysicalScenario): Promise<WebGpuWakeSimulationSummary> {
    const change = applyPhysicalScenarioChange(this.scenario, requested);
    this.scenario = change.scenario;
    if (change.kind === "restart") {
      await this.restart();
      return this.summary();
    }
    this.adaptation = {
      initialReynoldsNumber: this.currentReynoldsNumber,
      targetReynoldsNumber: change.reynoldsNumber,
      startFlowThroughTime: this.flowThroughTime(),
      wakePerturbed: !(
        this.currentReynoldsNumber < 50 && change.reynoldsNumber >= 50
      ),
    };
    this.regime = "adapting";
    this.strouhalNumber = undefined;
    return this.summary();
  }

  public async restart(): Promise<WebGpuWakeSimulationSummary> {
    await this.execution.execute({ type: "dispose" });
    this.stepCount = 0;
    this.sampledStep = 0;
    this.requestedStepTotal = 0;
    this.currentReynoldsNumber = reynoldsNumber(this.scenario);
    this.regime = "developing";
    this.availability = "available";
    this.unavailableReason = undefined;
    this.adaptation = undefined;
    this.samples = [];
    this.phaseStartFlowThroughTime = 0;
    this.strouhalNumber = undefined;
    await this.recreateCase();
    return this.summary();
  }

  public renderFrame(
    flowThroughIncrement: number,
    tracersEnabled: boolean,
    encodingFocus: WakeEncodingFocus = "combined",
  ): ReturnType<WebGpuInteractiveCaseExecution["renderFrame"]> {
    return this.execution.renderFrame(flowThroughIncrement, tracersEnabled, encodingFocus);
  }

  public resetTracers(): void {
    this.execution.resetTracers();
  }

  public async dispose(): Promise<void> {
    await this.execution.execute({ type: "dispose" });
  }

  public summary(): WebGpuWakeSimulationSummary {
    return {
      availability: this.availability,
      ...(this.unavailableReason === undefined ? {} : { unavailableReason: this.unavailableReason }),
      scenario: this.scenario,
      reynoldsNumber: this.currentReynoldsNumber,
      targetReynoldsNumber: reynoldsNumber(this.scenario),
      flowThroughTime: this.flowThroughTime(),
      regime: this.regime,
      ...(this.strouhalNumber === undefined ? {} : { strouhalNumber: this.strouhalNumber }),
    };
  }

  private async recreateCase(): Promise<void> {
    this.execution = await createWebGpuInteractiveCase(this.device, this.definition());
  }

  private async updateAdaptation(): Promise<void> {
    if (this.adaptation === undefined) return;
    const elapsed = this.flowThroughTime() - this.adaptation.startFlowThroughTime;
    const progress = Math.min(1, Math.max(0, elapsed / ADAPTING_FLOW_THROUGH_TIME));
    this.currentReynoldsNumber =
      this.adaptation.initialReynoldsNumber +
      progress *
        (this.adaptation.targetReynoldsNumber - this.adaptation.initialReynoldsNumber);
    if (
      !this.adaptation.wakePerturbed &&
      this.currentReynoldsNumber >= 50
    ) {
      await this.execution.perturbWake(ADAPTATION_WAKE_PERTURBATION);
      this.adaptation.wakePerturbed = true;
    }
    if (progress >= 1) {
      this.adaptation = undefined;
      this.regime = "developing";
      this.samples = [];
      this.phaseStartFlowThroughTime = this.flowThroughTime();
    }
  }

  private measureRegime(sample: ValidationSample): void {
    const definition = canonicalCaseForReynolds(this.currentReynoldsNumber).definition;
    const healthWindow = this.samples.filter(
      (candidate) => candidate.flowThroughTime >= sample.flowThroughTime - 4,
    );
    const failure = numericalFailure(sample, definition);
    if (failure !== undefined) {
      this.availability = "unavailable";
      this.unavailableReason = failure;
      this.regime = "numerically-unstable";
      return;
    }
    if (this.adaptation !== undefined) return;
    const validationProblem = validationHealthProblem(healthWindow, definition);
    const phaseAge = sample.flowThroughTime - this.phaseStartFlowThroughTime;
    if (
      validationProblem !== undefined &&
      phaseAge >= definition.protocol.warmUpFlowThroughTime
    ) {
      this.availability = "unavailable";
      this.unavailableReason =
        `The WebGPU result became unavailable because ${validationProblem}.`;
      this.regime = "numerically-unstable";
      return;
    }
    const window = this.samples.filter(
      (candidate) => candidate.flowThroughTime >= sample.flowThroughTime - 32,
    );
    const thresholds = definition.classification;
    const periodic = analyseLiftSignal(window, {
      minimumCycles: thresholds.minimumPeriodicCycles,
      minimumAmplitude: thresholds.minimumPeriodicAmplitude ?? Number.EPSILON,
      maximumFrequencyVariation: thresholds.maximumPeriodicFrequencyVariation,
      maximumAmplitudeVariation: thresholds.maximumPeriodicAmplitudeVariation,
    });
    if (periodic.stable) {
      this.regime = "periodically-shedding";
      this.strouhalNumber = periodic.strouhalNumber;
      return;
    }
    const steadyWindow = window.filter(
      (candidate) => candidate.flowThroughTime >= sample.flowThroughTime - 4,
    );
    const averagedDrag = timeBlockAverages(steadyWindow, 2);
    if (
      averagedDrag.length >= 2 &&
      Math.max(...steadyWindow.map((candidate) => candidate.fieldResidual)) <=
        thresholds.maximumSteadyFieldResidual &&
      Math.max(...steadyWindow.map((candidate) => candidate.symmetryError)) <=
        thresholds.maximumSteadySymmetryError &&
      rootMeanSquare(steadyWindow.map((candidate) => candidate.liftCoefficient)) <=
        thresholds.maximumSteadyLiftRms &&
      relativeVariation(averagedDrag) <= thresholds.maximumSteadyDragRelativeVariation
    ) {
      this.regime = "steady";
    } else if (sample.flowThroughTime > 8) {
      this.regime = "unclassified";
    }
  }

  private definition(): ValidationCaseDefinition {
    const targetReynolds = reynoldsNumber(this.scenario);
    const reference = canonicalCaseForReynolds(targetReynolds);
    return {
      schemaVersion: reference.schemaVersion,
      id: "webgpu-wake-interactive",
      reynoldsNumber: targetReynolds,
      physicalScenario: this.scenario,
      expectedRegimes: ["steady", "periodically-shedding", "unclassified"],
      configuration: {
        ...reference.configuration,
        backendId: WEBGPU_PRODUCTION_TIER.backendId,
        qualityTier: WEBGPU_PRODUCTION_TIER.id,
        precision: "float32",
        initialTransversePerturbation: 0,
        cylinder: {
          cellsPerDiameter: WEBGPU_PRODUCTION_TIER.cellsPerDiameter,
          offsetX: 0,
          offsetY: 0,
        },
      },
      protocol: reference.definition.protocol,
      health: reference.definition.health,
      classification: reference.definition.classification,
      expectations: [],
    };
  }

  private flowThroughTime(): number {
    return (this.stepCount * this.execution.latticeSpeed) / this.execution.cylinderDiameter;
  }
}

function numericalFailure(
  sample: ValidationSample,
  definition: { readonly health: NumericalHealthThresholds },
): string | undefined {
  const values = [
    sample.density.minimum,
    sample.density.maximum,
    sample.density.mean,
    sample.fieldResidual,
    sample.symmetryError,
    sample.dragCoefficient,
    sample.liftCoefficient,
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    return "The WebGPU result became unavailable because a numerical diagnostic was non-finite.";
  }
  if (
    (sample.flowThroughTime >= 0.5 &&
      (sample.density.minimum < definition.health.densityRange.minimum ||
        sample.density.maximum > definition.health.densityRange.maximum)) ||
    (sample.density.nonFiniteValueCount ?? 0) > 0 ||
    (sample.density.nonPositiveValueCount ?? 0) > 0
  ) {
    return "The WebGPU result became unavailable because density left its validated bounds.";
  }
  return undefined;
}

function validationHealthProblem(
  samples: readonly ValidationSample[],
  definition: { readonly health: NumericalHealthThresholds },
): string | undefined {
  const sample = samples.at(-1);
  if (sample === undefined || sample.flowThroughTime < 4 || samples.length < 2) return undefined;
  const meanDensity =
    samples.reduce((sum, candidate) => sum + candidate.density.mean, 0) / samples.length;
  if (
    Math.abs(meanDensity - definition.health.targetDensity) >
    definition.health.maximumMeanDensityDrift
  ) return "mean density drift exceeded its validated bound";
  if (
    Math.max(...samples.map((candidate) => Math.abs(candidate.upstreamReflection))) >
    definition.health.maximumUpstreamReflection
  ) return "upstream reflection exceeded its validated bound";
  const first = samples[0]!;
  const last = samples.at(-1)!;
  const fluxResidual = reconcileDomainMass({
    initialMass: first.domainMass,
    finalMass: last.domainMass,
    samples,
  }).normalizedResidual;
  return Math.abs(fluxResidual) > definition.health.maximumFluxResidual
    ? "flux balance exceeded its validated bound"
    : undefined;
}

function rootMeanSquare(values: readonly number[]): number {
  return values.length === 0
    ? Number.POSITIVE_INFINITY
    : Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

function relativeVariation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return (Math.max(...values) - Math.min(...values)) /
    Math.max(Math.abs(mean), Number.EPSILON);
}

function timeBlockAverages(
  samples: readonly ValidationSample[],
  blockDuration: number,
): number[] {
  const end = samples.at(-1)?.flowThroughTime;
  if (end === undefined) return [];
  const start = end - 2 * blockDuration;
  const averages: number[] = [];
  for (let block = 0; block < 2; block += 1) {
    const blockStart = start + block * blockDuration;
    const blockEnd = blockStart + blockDuration;
    const values = samples
      .filter(({ flowThroughTime }) =>
        flowThroughTime > blockStart && flowThroughTime <= blockEnd + 1e-9,
      )
      .map(({ dragCoefficient }) => dragCoefficient);
    if (values.length === 0) return [];
    averages.push(values.reduce((sum, value) => sum + value, 0) / values.length);
  }
  return averages;
}
