import { analyseLiftSignal, reconcileDomainMass } from "../validation/metrics.js";
import {
  D2Q9TrtOpenCylinder,
  type CpuFlowFieldView,
} from "../validation/cpu-reference-backend.js";
import type {
  DomainConfiguration,
  FlowRegime,
  NumericalHealthThresholds,
  PhysicalScenario,
  ValidationCaseDefinition,
  ValidationSample,
} from "../validation/types.js";
import {
  applyPhysicalScenarioChange,
  reynoldsNumber,
  validatePhysicalScenario,
} from "./physical-scenario.js";
import {
  CPU_PRODUCTION_STEADY_CASE,
  canonicalCaseForReynolds,
} from "./cpu-production-contract.js";

const ADAPTING_FLOW_THROUGH_TIME = 4;
const ADAPTATION_WAKE_PERTURBATION = 0.001;
const DEFAULT_CONFIGURATION = Object.freeze({
  cellsPerDiameter:
    CPU_PRODUCTION_STEADY_CASE.configuration.cylinder.cellsPerDiameter,
  domain: CPU_PRODUCTION_STEADY_CASE.configuration.domain,
});

export interface CpuWakeConfiguration {
  readonly cellsPerDiameter: number;
  readonly domain: DomainConfiguration;
}

export interface CpuWakeSimulationSummary {
  readonly availability: "available" | "unavailable";
  readonly unavailableReason?: string;
  readonly scenario: PhysicalScenario;
  readonly reynoldsNumber: number;
  readonly targetReynoldsNumber: number;
  readonly flowThroughTime: number;
  readonly regime: FlowRegime;
  readonly strouhalNumber?: number;
}

export class CpuWakeSimulation {
  private readonly configuration: CpuWakeConfiguration;
  private scenario: PhysicalScenario;
  private solver: D2Q9TrtOpenCylinder;
  private stepCount = 0;
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

  public constructor(
    scenario: PhysicalScenario,
    configuration: CpuWakeConfiguration = DEFAULT_CONFIGURATION,
  ) {
    validatePhysicalScenario(scenario);
    this.scenario = Object.freeze({ ...scenario });
    this.configuration = configuration;
    this.currentReynoldsNumber = reynoldsNumber(scenario);
    this.solver = new D2Q9TrtOpenCylinder(this.definition());
    this.samples.push(this.solver.diagnostic(0, 0, 0));
  }

  public advanceBy(flowThroughTime: number): CpuWakeSimulationSummary {
    if (this.availability === "unavailable") {
      return this.summary();
    }
    if (!Number.isFinite(flowThroughTime) || flowThroughTime <= 0) {
      throw new RangeError("Wake advancement requires a positive flow-through increment.");
    }
    this.requestedStepTotal +=
      (flowThroughTime * this.solver.cylinderDiameter) / this.solver.latticeSpeed;
    const targetStep = Math.floor(this.requestedStepTotal + 1e-9);
    let forceX = 0;
    let forceY = 0;
    const firstStep = this.stepCount;
    while (this.stepCount < targetStep) {
      this.updateAdaptation();
      const force = this.solver.advance();
      forceX += force.x;
      forceY += force.y;
      this.stepCount += 1;
    }
    if (this.stepCount === firstStep) {
      return this.summary();
    }
    const sample = this.solver.diagnostic(
      this.stepCount,
      this.flowThroughTime(),
      forceX / (this.stepCount - firstStep),
      forceY / (this.stepCount - firstStep),
    );
    this.samples.push(sample);
    this.measureRegime(sample);
    return this.summary();
  }

  public setScenario(requested: PhysicalScenario): CpuWakeSimulationSummary {
    const change = applyPhysicalScenarioChange(this.scenario, requested);
    if (change.kind === "restart") {
      this.scenario = change.scenario;
      this.restart();
      return this.summary();
    }
    this.scenario = change.scenario;
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

  public restart(): CpuWakeSimulationSummary {
    this.stepCount = 0;
    this.requestedStepTotal = 0;
    this.currentReynoldsNumber = reynoldsNumber(this.scenario);
    this.regime = "developing";
    this.availability = "available";
    this.unavailableReason = undefined;
    this.adaptation = undefined;
    this.strouhalNumber = undefined;
    this.solver = new D2Q9TrtOpenCylinder(this.definition());
    this.samples = [this.solver.diagnostic(0, 0, 0)];
    this.phaseStartFlowThroughTime = 0;
    return this.summary();
  }

  public summary(): CpuWakeSimulationSummary {
    return {
      availability: this.availability,
      ...(this.unavailableReason === undefined
        ? {}
        : { unavailableReason: this.unavailableReason }),
      scenario: this.scenario,
      reynoldsNumber: this.currentReynoldsNumber,
      targetReynoldsNumber: reynoldsNumber(this.scenario),
      flowThroughTime: this.flowThroughTime(),
      regime: this.regime,
      ...(this.strouhalNumber === undefined
        ? {}
        : { strouhalNumber: this.strouhalNumber }),
    };
  }

  public flowField(): CpuFlowFieldView {
    return this.solver.flowField();
  }

  private updateAdaptation(): void {
    if (this.adaptation === undefined) return;
    const elapsed = this.flowThroughTime() - this.adaptation.startFlowThroughTime;
    const progress = Math.min(1, Math.max(0, elapsed / ADAPTING_FLOW_THROUGH_TIME));
    const previousReynoldsNumber = this.currentReynoldsNumber;
    this.currentReynoldsNumber =
      this.adaptation.initialReynoldsNumber +
      progress *
        (this.adaptation.targetReynoldsNumber - this.adaptation.initialReynoldsNumber);
    this.solver.setReynoldsNumber(this.currentReynoldsNumber);
    if (
      !this.adaptation.wakePerturbed &&
      previousReynoldsNumber < 50 &&
      this.currentReynoldsNumber >= 50
    ) {
      this.solver.perturbWake(ADAPTATION_WAKE_PERTURBATION);
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
        `The CPU result became unavailable because ${validationProblem}.`;
      this.regime = "numerically-unstable";
      return;
    }

    const window = this.samples.filter(
      (candidate) => candidate.flowThroughTime >= sample.flowThroughTime - 32,
    );
    const periodicThresholds = definition.classification;
    const periodic = analyseLiftSignal(window, {
      minimumCycles: periodicThresholds.minimumPeriodicCycles,
      minimumAmplitude: periodicThresholds.minimumPeriodicAmplitude ?? Number.EPSILON,
      maximumFrequencyVariation: periodicThresholds.maximumPeriodicFrequencyVariation,
      maximumAmplitudeVariation: periodicThresholds.maximumPeriodicAmplitudeVariation,
    });
    if (periodic.stable) {
      this.regime = "periodically-shedding";
      this.strouhalNumber = periodic.strouhalNumber;
      return;
    }

    const steadyThresholds = definition.classification;
    const steadyWindow = window.filter(
      (candidate) => candidate.flowThroughTime >= sample.flowThroughTime - 4,
    );
    const averagedDrag = timeBlockAverages(steadyWindow, 2);
    if (
      averagedDrag.length >= 2 &&
      Math.max(...steadyWindow.map((candidate) => candidate.fieldResidual)) <=
        steadyThresholds.maximumSteadyFieldResidual &&
      Math.max(...steadyWindow.map((candidate) => candidate.symmetryError)) <=
        steadyThresholds.maximumSteadySymmetryError &&
      rootMeanSquare(steadyWindow.map((candidate) => candidate.liftCoefficient)) <=
        steadyThresholds.maximumSteadyLiftRms &&
      relativeVariation(averagedDrag) <=
        steadyThresholds.maximumSteadyDragRelativeVariation
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
      id: "cpu-wake-interactive",
      reynoldsNumber: targetReynolds,
      physicalScenario: this.scenario,
      expectedRegimes: ["steady", "periodically-shedding", "unclassified"],
      configuration: {
        ...reference.configuration,
        qualityTier: `cpu-balanced-d${this.configuration.cellsPerDiameter}`,
        initialTransversePerturbation: 0,
        domain: this.configuration.domain,
        cylinder: {
          cellsPerDiameter: this.configuration.cellsPerDiameter,
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
    return (this.stepCount * this.solver.latticeSpeed) / this.solver.cylinderDiameter;
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
    return "The CPU result became unavailable because a numerical diagnostic was non-finite.";
  }
  if (
    (sample.flowThroughTime >= 0.5 &&
      (sample.density.minimum < definition.health.densityRange.minimum ||
        sample.density.maximum > definition.health.densityRange.maximum)) ||
    (sample.density.nonFiniteValueCount ?? 0) > 0 ||
    (sample.density.nonPositiveValueCount ?? 0) > 0
  ) {
    return "The CPU result became unavailable because density left its validated bounds.";
  }
  return undefined;
}

function validationHealthProblem(
  samples: readonly ValidationSample[],
  definition: { readonly health: NumericalHealthThresholds },
): string | undefined {
  const sample = samples.at(-1);
  if (sample === undefined || sample.flowThroughTime < 4 || samples.length < 2) {
    return undefined;
  }
  const meanDensity =
    samples.reduce((sum, candidate) => sum + candidate.density.mean, 0) / samples.length;
  if (
    Math.abs(meanDensity - definition.health.targetDensity) >
    definition.health.maximumMeanDensityDrift
  ) {
    return "mean density drift exceeded its validated bound";
  }
  if (
    Math.max(...samples.map((candidate) => Math.abs(candidate.upstreamReflection))) >
    definition.health.maximumUpstreamReflection
  ) {
    return "upstream reflection exceeded its validated bound";
  }
  const first = samples[0]!;
  const last = samples.at(-1)!;
  const fluxResidual = reconcileDomainMass({
    initialMass: first.domainMass,
    finalMass: last.domainMass,
    samples,
  }).normalizedResidual;
  if (Math.abs(fluxResidual) > definition.health.maximumFluxResidual) {
    return "flux balance exceeded its validated bound";
  }
  return undefined;
}

function rootMeanSquare(values: readonly number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

function relativeVariation(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return (
    (Math.max(...values) - Math.min(...values)) /
    Math.max(Math.abs(mean), Number.EPSILON)
  );
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
      .filter(
        ({ flowThroughTime }) =>
          flowThroughTime > blockStart && flowThroughTime <= blockEnd + 1e-9,
      )
      .map(({ dragCoefficient }) => dragCoefficient);
    if (values.length === 0) return [];
    averages.push(values.reduce((sum, value) => sum + value, 0) / values.length);
  }
  return averages;
}
