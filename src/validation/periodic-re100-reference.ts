import {
  VALIDATION_SCHEMA_VERSION,
  type MetricExpectation,
  type ScientificSource,
  type ValidationCaseDefinition,
  type ValidationSuite,
} from "./types.js";

const VALIDATION_CONTRACT_SOURCE = Object.freeze({
  id: "cfd-visualise-ticket-03",
  url: "https://github.com/barnabyg/cfdVisualise/issues/5",
  convention:
    "Committed Ticket 03 thresholds; warm-up spans at least nine cycles at the lower published Strouhal bound and sampling spans at least four.",
} satisfies ScientificSource);

const PUBLISHED_STROUHAL_RANGE = Object.freeze({ minimum: 0.15, maximum: 0.18 });
const MINIMUM_WARM_UP_SHEDDING_CYCLES = 9;
const WARM_UP_FLOW_THROUGH_TIME = 64;
const SAMPLE_FLOW_THROUGH_TIME = 32;

const LINNICK_FASEL_SOURCE = Object.freeze({
  id: "linnick-fasel-2005",
  url: "https://doi.org/10.1016/j.jcp.2004.09.017",
  convention:
    "Unconfined two-dimensional cylinder at Re=100; force coefficients use 0.5 rho U^2 D and Strouhal uses fD/U.",
} satisfies ScientificSource);

const TAIRA_COLONIUS_SOURCE = Object.freeze({
  id: "taira-colonius-2007",
  url: "https://doi.org/10.1016/j.jcp.2007.03.005",
  convention:
    "Unconfined two-dimensional Re=100 cylinder benchmark for mean drag, periodic lift, and shedding frequency.",
} satisfies ScientificSource);

const BOUZIDI_FORCE_SOURCE = Object.freeze({
  id: "bouzidi-firdaouss-lallemand-2001",
  url: "https://doi.org/10.1063/1.1399290",
  convention:
    "Linear interpolated curved-wall bounce-back with link-wise momentum transfer.",
} satisfies ScientificSource);

const publishedSources = Object.freeze([
  LINNICK_FASEL_SOURCE,
  TAIRA_COLONIUS_SOURCE,
]);

const expectations = Object.freeze([
  expectation("densityMinimum", 0.9, 1.1, [VALIDATION_CONTRACT_SOURCE]),
  expectation("densityMaximum", 0.9, 1.1, [VALIDATION_CONTRACT_SOURCE]),
  expectation("meanDensity", 0.99, 1.01, [VALIDATION_CONTRACT_SOURCE]),
  expectation("meanDensityDrift", 0, 0.01, [VALIDATION_CONTRACT_SOURCE]),
  expectation("nonFiniteValueCount", 0, 0, [VALIDATION_CONTRACT_SOURCE]),
  expectation("nonPositiveDensityCount", 0, 0, [VALIDATION_CONTRACT_SOURCE]),
  expectation("fluxResidual", -0.01, 0.01, [VALIDATION_CONTRACT_SOURCE]),
  expectation("upstreamReflection", 0, 0.02, [VALIDATION_CONTRACT_SOURCE]),
  expectation("meanDragCoefficient", 1.25, 1.45, [
    ...publishedSources,
    BOUZIDI_FORCE_SOURCE,
  ], 0.1),
  expectation("liftRms", 0.15, 0.3, publishedSources, 0.05),
  expectation("periodicCycleCount", 4, 10, [VALIDATION_CONTRACT_SOURCE]),
  expectation(
    "dominantFrequency",
    PUBLISHED_STROUHAL_RANGE.minimum,
    PUBLISHED_STROUHAL_RANGE.maximum,
    publishedSources,
    0.02,
  ),
  expectation("frequencyVariation", 0, 0.05, [VALIDATION_CONTRACT_SOURCE]),
  expectation("amplitudeVariation", 0, 0.1, [VALIDATION_CONTRACT_SOURCE]),
  expectation("frequencyUncertainty", 0, 0.02, [VALIDATION_CONTRACT_SOURCE]),
  expectation(
    "strouhalNumber",
    PUBLISHED_STROUHAL_RANGE.minimum,
    PUBLISHED_STROUHAL_RANGE.maximum,
    publishedSources,
    0.02,
  ),
] satisfies readonly MetricExpectation[]);

const periodicRe100Case = Object.freeze({
  schemaVersion: VALIDATION_SCHEMA_VERSION,
  id: "open-cylinder-re100",
  reynoldsNumber: 100,
  physicalScenario: Object.freeze({
    flowSpeedMetersPerSecond: 0.01,
    cylinderDiameterMeters: 0.01,
    kinematicViscositySquareMetersPerSecond: 0.000001,
  }),
  expectedRegimes: Object.freeze(["periodically-shedding"] as const),
  configuration: Object.freeze({
    backendId: "cpu-reference",
    qualityTier: "reference-re100-d16",
    precision: "float64" as const,
    latticeSpeed: 0.08,
    initialTransversePerturbation: 0.001,
    upstreamReflectionMode: "streamwise-from-inlet" as const,
    collision: "D2Q9 TRT" as const,
    boundaries: Object.freeze({
      inlet: "regularized-velocity" as const,
      lateral: "free-slip" as const,
      outlet: "fixed-density-nee" as const,
      cylinder: "linear-bfl" as const,
    }),
    domain: Object.freeze({
      upstreamDiameters: 5,
      downstreamDiameters: 14,
      lateralDiameters: 7,
    }),
    cylinder: Object.freeze({ cellsPerDiameter: 16, offsetX: 0, offsetY: 0 }),
  }),
  protocol: Object.freeze({
    warmUpFlowThroughTime: WARM_UP_FLOW_THROUGH_TIME,
    sampleFlowThroughTime: SAMPLE_FLOW_THROUGH_TIME,
    sampleInterval: 0.5,
    minimumStableCycles: 4,
  }),
  health: Object.freeze({
    targetDensity: 1,
    densityRange: Object.freeze({ minimum: 0.9, maximum: 1.1 }),
    maximumMeanDensityDrift: 0.01,
    maximumFluxResidual: 0.01,
    maximumUpstreamReflection: 0.02,
  }),
  classification: Object.freeze({
    maximumSteadyFieldResidual: 0.001,
    maximumSteadySymmetryError: 0.001,
    maximumSteadyLiftRms: 0.01,
    maximumSteadyDragRelativeVariation: 0.02,
    minimumPeriodicCycles: 4,
    minimumPeriodicAmplitude: 0.1,
    maximumPeriodicFrequencyVariation: 0.05,
    maximumPeriodicAmplitudeVariation: 0.1,
  }),
  expectations,
} satisfies ValidationCaseDefinition);

if (
  WARM_UP_FLOW_THROUGH_TIME * PUBLISHED_STROUHAL_RANGE.minimum <
  MINIMUM_WARM_UP_SHEDDING_CYCLES
) {
  throw new Error("Re=100 warm-up does not span its evidence-based minimum cycle count.");
}

export const PERIODIC_RE100_VALIDATION_SUITE = Object.freeze({
  schemaVersion: VALIDATION_SCHEMA_VERSION,
  id: "periodic-re100-cpu-reference-v1",
  metricVersions: Object.freeze({
    densityHealth: "1",
    drag: "1",
    fluxBalance: "1",
    liftPeriodicity: "2",
    strouhal: "2",
    upstreamReflection: "2",
  }),
  cases: Object.freeze([periodicRe100Case]),
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
