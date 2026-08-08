import {
  VALIDATION_SCHEMA_VERSION,
  type MetricExpectation,
  type ScientificSource,
  type ValidationCaseDefinition,
  type ValidationSuite,
} from "./types.js";

const VALIDATION_CONTRACT_SOURCE = Object.freeze({
  id: "cfd-visualise-ticket-02",
  url: "https://github.com/barnabyg/cfdVisualise/issues/4",
  convention:
    "Committed Ticket 02 numerical-health and steady-classification release thresholds.",
} satisfies ScientificSource);

const DENNIS_CHANG_SOURCE = Object.freeze({
  id: "dennis-chang-1970",
  url: "https://doi.org/10.1017/S0022112070001428",
  convention:
    "Unconfined two-dimensional cylinder; drag uses 0.5 rho U^2 D and wake length is measured downstream from the cylinder rear surface.",
} satisfies ScientificSource);

const BOUZIDI_FORCE_SOURCE = Object.freeze({
  id: "bouzidi-firdaouss-lallemand-2001",
  url: "https://doi.org/10.1063/1.1399290",
  convention:
    "Linear interpolated curved-wall bounce-back with link-wise momentum transfer.",
} satisfies ScientificSource);

const expectations = Object.freeze([
  expectation("densityMinimum", 0.95, 1.05, [VALIDATION_CONTRACT_SOURCE]),
  expectation("densityMaximum", 0.95, 1.05, [VALIDATION_CONTRACT_SOURCE]),
  expectation("meanDensity", 0.995, 1.005, [VALIDATION_CONTRACT_SOURCE]),
  expectation("meanDensityDrift", 0, 0.005, [VALIDATION_CONTRACT_SOURCE]),
  expectation("nonFiniteValueCount", 0, 0, [VALIDATION_CONTRACT_SOURCE]),
  expectation("nonPositiveDensityCount", 0, 0, [VALIDATION_CONTRACT_SOURCE]),
  expectation("fluxResidual", -0.005, 0.005, [VALIDATION_CONTRACT_SOURCE]),
  expectation("upstreamReflection", 0, 0.01, [VALIDATION_CONTRACT_SOURCE]),
  expectation("fieldResidual", 0, 0.001, [VALIDATION_CONTRACT_SOURCE]),
  expectation("symmetryError", 0, 0.001, [VALIDATION_CONTRACT_SOURCE]),
  expectation("meanDragCoefficient", 2, 2.2, [
    DENNIS_CHANG_SOURCE,
    BOUZIDI_FORCE_SOURCE,
  ], 0.1),
  expectation("dragRelativeVariation", 0, 0.02, [VALIDATION_CONTRACT_SOURCE]),
  expectation("liftRms", 0, 0.005, [VALIDATION_CONTRACT_SOURCE]),
  expectation("recirculationLength", 0.85, 1.05, [DENNIS_CHANG_SOURCE]),
] satisfies readonly MetricExpectation[]);

const steadyRe20Case = Object.freeze({
  schemaVersion: VALIDATION_SCHEMA_VERSION,
  id: "open-cylinder-re020",
  reynoldsNumber: 20,
  physicalScenario: Object.freeze({
    flowSpeedMetersPerSecond: 0.002,
    cylinderDiameterMeters: 0.01,
    kinematicViscositySquareMetersPerSecond: 0.000001,
  }),
  expectedRegimes: Object.freeze(["steady"] as const),
  configuration: Object.freeze({
    backendId: "cpu-reference",
    qualityTier: "reference-re20-d12",
    precision: "float64" as const,
    collision: "D2Q9 TRT" as const,
    boundaries: Object.freeze({
      inlet: "regularized-velocity" as const,
      lateral: "free-slip" as const,
      outlet: "fixed-density-nee" as const,
      cylinder: "linear-bfl" as const,
    }),
    domain: Object.freeze({
      upstreamDiameters: 6,
      downstreamDiameters: 14,
      lateralDiameters: 8,
    }),
    cylinder: Object.freeze({ cellsPerDiameter: 12, offsetX: 0, offsetY: 0 }),
  }),
  protocol: Object.freeze({
    warmUpFlowThroughTime: 60,
    sampleFlowThroughTime: 4,
    sampleInterval: 2,
  }),
  health: Object.freeze({
    targetDensity: 1,
    densityRange: Object.freeze({ minimum: 0.95, maximum: 1.05 }),
    maximumMeanDensityDrift: 0.005,
    maximumFluxResidual: 0.005,
    maximumUpstreamReflection: 0.01,
  }),
  classification: Object.freeze({
    maximumSteadyFieldResidual: 0.001,
    maximumSteadySymmetryError: 0.001,
    maximumSteadyLiftRms: 0.005,
    maximumSteadyDragRelativeVariation: 0.02,
    minimumPeriodicCycles: 4,
    maximumPeriodicFrequencyVariation: 0.02,
    maximumPeriodicAmplitudeVariation: 0.05,
  }),
  expectations,
} satisfies ValidationCaseDefinition);

export const STEADY_RE20_VALIDATION_SUITE = Object.freeze({
  schemaVersion: VALIDATION_SCHEMA_VERSION,
  id: "steady-re20-cpu-reference-v1",
  metricVersions: Object.freeze({
    densityHealth: "1",
    drag: "1",
    fieldResidual: "1",
    fluxBalance: "1",
    recirculationLength: "1",
    symmetry: "1",
  }),
  cases: Object.freeze([steadyRe20Case]),
  reconciliations: Object.freeze([]),
} satisfies ValidationSuite);

function expectation(
  metric: MetricExpectation["metric"],
  minimum: number,
  maximum: number,
  sources: readonly ScientificSource[],
  tolerance = 0,
): MetricExpectation {
  return Object.freeze({
    metric,
    range: Object.freeze({ minimum, maximum }),
    tolerance,
    sources: Object.freeze(sources),
  });
}
