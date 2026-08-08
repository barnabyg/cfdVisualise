import {
  createReferenceValidationSuite,
  type ReferenceCaseEvidence,
  type ReferenceCaseId,
} from "./reference-catalogue.js";
import { PERIODIC_RE100_VALIDATION_SUITE } from "./periodic-re100-reference.js";
import { STEADY_RE20_VALIDATION_SUITE } from "./steady-re20-reference.js";
import {
  type MetricExpectation,
  type NumericalHealthThresholds,
  type ScientificSource,
  type ValidationCaseDefinition,
} from "./types.js";

const VALIDATION_CONTRACT_SOURCE = Object.freeze({
  id: "cfd-visualise-ticket-04",
  url: "https://github.com/barnabyg/cfdVisualise/issues/6",
  convention:
    "Committed Ticket 04 numerical-health, classification, sampling, and inclusive reconciliation thresholds.",
} satisfies ScientificSource);

const DENNIS_CHANG_SOURCE = Object.freeze({
  id: "dennis-chang-1970",
  url: "https://doi.org/10.1017/S0022112070001428",
  convention:
    "Unconfined two-dimensional steady cylinder flow; drag uses 0.5 rho U^2 D and recirculation length is measured from the cylinder rear surface.",
} satisfies ScientificSource);

const PROVANSAL_MATHIS_BOYER_SOURCE = Object.freeze({
  id: "provansal-mathis-boyer-1987",
  url: "https://doi.org/10.1017/S0022112087002222",
  convention:
    "Unconfined circular-cylinder wake near the first Hopf bifurcation, with onset determined from the growth and decay of the wake oscillation.",
} satisfies ScientificSource);

const KUMAR_MITTAL_SOURCE = Object.freeze({
  id: "kumar-mittal-2006",
  url: "https://doi.org/10.1016/j.cma.2005.10.009",
  convention:
    "Two-dimensional unconfined-cylinder critical-Reynolds prediction used to bracket shedding onset while avoiding a regime lookup by Reynolds number.",
} satisfies ScientificSource);

const QU_NORBERG_DAVIDSON_SOURCE = Object.freeze({
  id: "qu-norberg-davidson-peng-wang-2013",
  url: "https://doi.org/10.1016/j.jfluidstructs.2013.02.007",
  convention:
    "Unconfined two-dimensional cylinder at Re=50 through 200; time-mean force coefficients follow 0.5 rho U^2 D and Strouhal follows fD/U after developed shedding.",
} satisfies ScientificSource);

function healthExpectations(
  health: NumericalHealthThresholds,
): readonly MetricExpectation[] {
  return Object.freeze([
    expectation(
      "densityMinimum",
      health.densityRange.minimum,
      health.densityRange.maximum,
      [VALIDATION_CONTRACT_SOURCE],
    ),
    expectation(
      "densityMaximum",
      health.densityRange.minimum,
      health.densityRange.maximum,
      [VALIDATION_CONTRACT_SOURCE],
    ),
    expectation(
      "meanDensity",
      health.targetDensity - health.maximumMeanDensityDrift,
      health.targetDensity + health.maximumMeanDensityDrift,
      [VALIDATION_CONTRACT_SOURCE],
    ),
    expectation(
      "meanDensityDrift",
      0,
      health.maximumMeanDensityDrift,
      [VALIDATION_CONTRACT_SOURCE],
    ),
    expectation("nonFiniteValueCount", 0, 0, [VALIDATION_CONTRACT_SOURCE]),
    expectation("nonPositiveDensityCount", 0, 0, [VALIDATION_CONTRACT_SOURCE]),
    expectation(
      "fluxResidual",
      -health.maximumFluxResidual,
      health.maximumFluxResidual,
      [VALIDATION_CONTRACT_SOURCE],
    ),
    expectation(
      "upstreamReflection",
      0,
      health.maximumUpstreamReflection,
      [VALIDATION_CONTRACT_SOURCE],
    ),
  ] satisfies readonly MetricExpectation[]);
}

const BASE_CONFIGURATION = Object.freeze({
  backendId: "cpu-reference",
  precision: "float64" as const,
  latticeSpeed: 0.08,
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
});

const HEALTH_THRESHOLDS = Object.freeze({
  targetDensity: 1,
  densityRange: Object.freeze({ minimum: 0.9, maximum: 1.1 }),
  maximumMeanDensityDrift: 0.01,
  maximumFluxResidual: 0.01,
  maximumUpstreamReflection: 0.02,
});

const CLASSIFICATION_THRESHOLDS = Object.freeze({
  maximumSteadyFieldResidual: 0.001,
  maximumSteadySymmetryError: 0.001,
  maximumSteadyLiftRms: 0.01,
  maximumSteadyDragRelativeVariation: 0.02,
  minimumPeriodicCycles: 4,
  minimumPeriodicAmplitude: 0.01,
  maximumPeriodicFrequencyVariation: 0.05,
  maximumPeriodicAmplitudeVariation: 0.1,
});

const evidence: Record<ReferenceCaseId, ReferenceCaseEvidence> = {
  "open-cylinder-re005": steadyEvidence({
    reynoldsNumber: 5,
    warmUpFlowThroughTime: 60,
    sampleFlowThroughTime: 4,
    dragRange: [3.8, 4.5],
    dragTolerance: 0.2,
  }),
  "open-cylinder-re020": evidenceFrom(
    requiredCase(STEADY_RE20_VALIDATION_SUITE.cases[0], 20),
  ),
  "open-cylinder-re040": steadyEvidence({
    reynoldsNumber: 40,
    warmUpFlowThroughTime: 96,
    sampleFlowThroughTime: 8,
    dragRange: [1.45, 1.6],
    maximumDragRelativeVariation: 0.05,
    recirculationRange: [1.9, 2.5],
  }),
  "open-cylinder-re045": onsetEvidence(45, [1.35, 1.6], "steady-side"),
  "open-cylinder-re050": onsetEvidence(50, [1.3, 1.6], "periodic-side"),
  "open-cylinder-re100": evidenceFrom(
    requiredCase(PERIODIC_RE100_VALIDATION_SUITE.cases[0], 100),
  ),
  "open-cylinder-re150": periodicEvidence({
    reynoldsNumber: 150,
    cellsPerDiameter: 20,
    densityRange: [0.85, 1.15],
    maximumUpstreamReflection: 0.06,
    dragRange: [1.2, 1.5],
    liftRmsRange: [0.2, 0.55],
    strouhalRange: [0.17, 0.2],
  }),
};

export const FULL_REYNOLDS_ENVELOPE_VALIDATION_SUITE = Object.freeze(
  createReferenceValidationSuite({
    id: "full-reynolds-envelope-cpu-reference-v1",
    metricVersions: Object.freeze({
      densityHealth: "1",
      drag: "1",
      fieldResidual: "1",
      fluxBalance: "1",
      liftPeriodicity: "2",
      recirculationLength: "1",
      strouhal: "2",
      symmetry: "1",
      upstreamReflection: "2",
    }),
    evidence,
    sensitivityCases: Object.freeze([]),
    reconciliations: Object.freeze([]),
  }),
);

function steadyEvidence(input: {
  readonly reynoldsNumber: number;
  readonly warmUpFlowThroughTime: number;
  readonly sampleFlowThroughTime: number;
  readonly dragRange: readonly [number, number];
  readonly dragTolerance?: number;
  readonly maximumDragRelativeVariation?: number;
  readonly recirculationRange?: readonly [number, number];
}): ReferenceCaseEvidence {
  return Object.freeze({
    configuration: Object.freeze({
      ...BASE_CONFIGURATION,
      qualityTier: `reference-re${input.reynoldsNumber}-d12`,
    }),
    protocol: Object.freeze({
      warmUpFlowThroughTime: input.warmUpFlowThroughTime,
      sampleFlowThroughTime: input.sampleFlowThroughTime,
      sampleInterval: 2,
    }),
    health: HEALTH_THRESHOLDS,
    classification: Object.freeze({
      ...CLASSIFICATION_THRESHOLDS,
      maximumSteadyDragRelativeVariation:
        input.maximumDragRelativeVariation ??
        CLASSIFICATION_THRESHOLDS.maximumSteadyDragRelativeVariation,
    }),
    expectations: Object.freeze([
      ...healthExpectations(HEALTH_THRESHOLDS),
      expectation("fieldResidual", 0, 0.001, [VALIDATION_CONTRACT_SOURCE]),
      expectation("symmetryError", 0, 0.001, [VALIDATION_CONTRACT_SOURCE]),
      expectation(
        "meanDragCoefficient",
        ...input.dragRange,
        [DENNIS_CHANG_SOURCE],
        input.dragTolerance ?? 0.1,
      ),
      expectation(
        "dragRelativeVariation",
        0,
        input.maximumDragRelativeVariation ?? 0.02,
        [VALIDATION_CONTRACT_SOURCE],
      ),
      expectation("liftRms", 0, 0.01, [VALIDATION_CONTRACT_SOURCE]),
      ...(input.recirculationRange === undefined
        ? []
        : [
            expectation(
              "recirculationLength",
              ...input.recirculationRange,
              [DENNIS_CHANG_SOURCE],
              0.15,
            ),
          ]),
    ]),
  });
}

function onsetEvidence(
  reynoldsNumber: number,
  dragRange: readonly [number, number],
  onsetSide: "steady-side" | "periodic-side",
): ReferenceCaseEvidence {
  const onsetSources = [PROVANSAL_MATHIS_BOYER_SOURCE, KUMAR_MITTAL_SOURCE];
  const regimeExpectations =
    onsetSide === "steady-side"
      ? [
          expectation("fieldResidual", 0, 0.001, onsetSources, 0, ["steady"]),
          expectation("symmetryError", 0, 0.001, onsetSources, 0, ["steady"]),
          expectation("dragRelativeVariation", 0, 0.02, onsetSources, 0, ["steady"]),
          expectation("liftRms", 0, 0.01, onsetSources, 0, ["steady"]),
          expectation(
            "recirculationLength",
            2.2,
            3.2,
            [DENNIS_CHANG_SOURCE],
            0.2,
            ["steady"],
          ),
        ]
      : [
          expectation("liftRms", 0.01, 0.12, [QU_NORBERG_DAVIDSON_SOURCE], 0.05, [
            "periodically-shedding",
          ]),
          expectation("periodicCycleCount", 4, 10, onsetSources, 0, [
            "periodically-shedding",
          ]),
          expectation("dominantFrequency", 0.11, 0.14, [QU_NORBERG_DAVIDSON_SOURCE], 0.02, [
            "periodically-shedding",
          ]),
          expectation("frequencyVariation", 0, 0.05, onsetSources, 0, [
            "periodically-shedding",
          ]),
          expectation("amplitudeVariation", 0, 0.1, onsetSources, 0, [
            "periodically-shedding",
          ]),
          expectation("frequencyUncertainty", 0, 0.02, onsetSources, 0, [
            "periodically-shedding",
          ]),
          expectation("strouhalNumber", 0.11, 0.14, [QU_NORBERG_DAVIDSON_SOURCE], 0.02, [
            "periodically-shedding",
          ]),
        ];
  return Object.freeze({
    configuration: Object.freeze({
      ...BASE_CONFIGURATION,
      qualityTier: `reference-re${reynoldsNumber}-onset-d12`,
      initialTransversePerturbation: 0.001,
    }),
    protocol: Object.freeze({
      warmUpFlowThroughTime: 64,
      sampleFlowThroughTime: 32,
      sampleInterval: 1,
      minimumStableCycles: 4,
    }),
    health: HEALTH_THRESHOLDS,
    classification: CLASSIFICATION_THRESHOLDS,
    expectations: Object.freeze([
      ...healthExpectations(HEALTH_THRESHOLDS),
      expectation(
        "meanDragCoefficient",
        ...dragRange,
        [
          onsetSide === "steady-side"
            ? DENNIS_CHANG_SOURCE
            : QU_NORBERG_DAVIDSON_SOURCE,
        ],
        0.1,
      ),
      ...regimeExpectations,
    ]),
  });
}

function periodicEvidence(input: {
  readonly reynoldsNumber: number;
  readonly cellsPerDiameter: number;
  readonly densityRange: readonly [number, number];
  readonly maximumUpstreamReflection: number;
  readonly dragRange: readonly [number, number];
  readonly liftRmsRange: readonly [number, number];
  readonly strouhalRange: readonly [number, number];
}): ReferenceCaseEvidence {
  const periodicSources = [QU_NORBERG_DAVIDSON_SOURCE];
  const health = Object.freeze({
    ...HEALTH_THRESHOLDS,
    densityRange: Object.freeze({
      minimum: input.densityRange[0],
      maximum: input.densityRange[1],
    }),
    maximumUpstreamReflection: input.maximumUpstreamReflection,
  });
  return Object.freeze({
    configuration: Object.freeze({
      ...BASE_CONFIGURATION,
      qualityTier: `reference-re${input.reynoldsNumber}-d${input.cellsPerDiameter}`,
      initialTransversePerturbation: 0.001,
      upstreamReflectionMode: "streamwise-from-inlet" as const,
      domain: Object.freeze({
        upstreamDiameters: 5,
        downstreamDiameters: 14,
        lateralDiameters: 7,
      }),
      cylinder: Object.freeze({
        cellsPerDiameter: input.cellsPerDiameter,
        offsetX: 0,
        offsetY: 0,
      }),
    }),
    protocol: Object.freeze({
      warmUpFlowThroughTime: 64,
      sampleFlowThroughTime: 32,
      sampleInterval: 0.5,
      minimumStableCycles: 4,
    }),
    health,
    classification: Object.freeze({
      ...CLASSIFICATION_THRESHOLDS,
      minimumPeriodicAmplitude: 0.1,
    }),
    expectations: Object.freeze([
      ...healthExpectations(health),
      expectation("meanDragCoefficient", ...input.dragRange, periodicSources, 0.1),
      expectation("liftRms", ...input.liftRmsRange, periodicSources, 0.05),
      expectation("periodicCycleCount", 4, 10, [VALIDATION_CONTRACT_SOURCE]),
      expectation("dominantFrequency", ...input.strouhalRange, periodicSources, 0.02),
      expectation("frequencyVariation", 0, 0.05, [VALIDATION_CONTRACT_SOURCE]),
      expectation("amplitudeVariation", 0, 0.1, [VALIDATION_CONTRACT_SOURCE]),
      expectation("frequencyUncertainty", 0, 0.02, [VALIDATION_CONTRACT_SOURCE]),
      expectation("strouhalNumber", ...input.strouhalRange, periodicSources, 0.02),
    ]),
  });
}

function evidenceFrom(definition: ValidationCaseDefinition): ReferenceCaseEvidence {
  return {
    configuration: definition.configuration,
    protocol: definition.protocol,
    health: definition.health,
    classification: definition.classification,
    expectations: definition.expectations,
  };
}

function requiredCase(
  definition: ValidationCaseDefinition | undefined,
  reynoldsNumber: number,
): ValidationCaseDefinition {
  if (definition === undefined) {
    throw new Error(`Missing committed Reynolds ${reynoldsNumber} reference case.`);
  }
  return definition;
}

function expectation(
  metric: MetricExpectation["metric"],
  minimum: number,
  maximum: number,
  sources: readonly ScientificSource[],
  tolerance = 0,
  applicableRegimes?: MetricExpectation["applicableRegimes"],
): MetricExpectation {
  return Object.freeze({
    metric,
    ...(applicableRegimes === undefined
      ? {}
      : { applicableRegimes: Object.freeze(applicableRegimes) }),
    range: Object.freeze({ minimum, maximum }),
    tolerance,
    sources: Object.freeze(sources),
  });
}
