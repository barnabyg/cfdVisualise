import { FULL_REYNOLDS_ENVELOPE_VALIDATION_SUITE } from "./full-reynolds-envelope-reference.js";
import {
  VALIDATION_SCHEMA_VERSION,
  type BoundaryConfiguration,
  type DomainConfiguration,
  type ReconciliationDefinition,
  type MetricExpectation,
  type ScientificSource,
  type ValidationCaseDefinition,
  type ValidationSuite,
} from "./types.js";

const MAXIMUM_DRAG_CHANGE = 0.01;
const MAXIMUM_STROUHAL_CHANGE = 0.01;
const MAXIMUM_RECIRCULATION_CHANGE = 0.02;
const PRODUCTION_RESOLUTION = 18;
const SELECTED_PRODUCTION_DOMAIN = Object.freeze({
  upstreamDiameters: 6,
  downstreamDiameters: 14,
  lateralDiameters: 8,
} satisfies DomainConfiguration);
const SELECTED_PRODUCTION_BOUNDARIES = Object.freeze({
  inlet: "regularized-velocity",
  lateral: "free-slip",
  outlet: "fixed-density-nee",
  cylinder: "linear-bfl",
} satisfies BoundaryConfiguration);
const REYNOLDS_CHANGE = Object.freeze({
  initialReynoldsNumber: 20,
  atFlowThroughTime: 8,
  rampFlowThroughTime: 4,
  observationFlowThroughTime: 4,
});
const OPEN_BOUNDARY_REFLECTION_SOURCE = Object.freeze({
  id: "wissocq-sagaut-2009",
  url: "https://doi.org/10.1016/j.camwa.2009.02.014",
  convention:
    "Open-boundary effects are assessed through reflected disturbances; this suite applies a project tolerance of 0.02 to the normalized upstream velocity probe.",
} satisfies ScientificSource);

const representativeReferences = [5, 45, 100].map((reynoldsNumber) =>
  requiredReferenceCase(reynoldsNumber),
);
const domainSensitivityCases = representativeReferences.flatMap((reference) =>
  domainCases(reference),
);
const boundarySensitivityCases = Object.freeze([
  configuredCase(requiredReferenceCase(20), {
    id: "boundary-re020-production",
    cohort: "boundary-inlet-re020",
    qualityTier: "boundary-production-re020-d18",
  }),
  configuredCase(requiredReferenceCase(20), {
    id: "boundary-re020-equilibrium-inlet",
    cohort: "boundary-inlet-re020",
    qualityTier: "boundary-equilibrium-inlet-d18",
    boundaries: { ...SELECTED_PRODUCTION_BOUNDARIES, inlet: "equilibrium-velocity" },
  }),
  configuredCase(requiredReferenceCase(45), {
    id: "boundary-re045-periodic-lateral",
    cohort: "boundary-lateral-re045",
    qualityTier: "boundary-periodic-lateral-d18",
    boundaries: { ...SELECTED_PRODUCTION_BOUNDARIES, lateral: "periodic" },
  }),
  configuredCase(requiredReferenceCase(100), {
    id: "boundary-re100-convective-outlet",
    cohort: "boundary-outlet-re100",
    qualityTier: "boundary-convective-outlet-d18",
    boundaries: { ...SELECTED_PRODUCTION_BOUNDARIES, outlet: "convective" },
  }),
] satisfies readonly ValidationCaseDefinition[]);
const disturbanceProbe = createDisturbanceProbe();

const reconciliations = Object.freeze([
  ...[5, 45, 100].map((reynoldsNumber) =>
    reconciliation({
      id: `domain-re${caseSuffix(reynoldsNumber)}`,
      kind: "domain",
      baselineCaseId: `domain-re${caseSuffix(reynoldsNumber)}-production`,
      comparisonCaseIds: [
        `domain-re${caseSuffix(reynoldsNumber)}-upstream-plus0p5d`,
        `domain-re${caseSuffix(reynoldsNumber)}-downstream-plus2d`,
        `domain-re${caseSuffix(reynoldsNumber)}-lateral-plus1d`,
      ],
      maximumRelativeChange: comparisonMetrics(reynoldsNumber),
    }),
  ),
  reconciliation({
    id: "boundary-inlet-re020",
    kind: "boundary",
    baselineCaseId: "boundary-re020-production",
    comparisonCaseIds: ["boundary-re020-equilibrium-inlet"],
    maximumRelativeChange: comparisonMetrics(20),
  }),
  reconciliation({
    id: "boundary-lateral-re045",
    kind: "boundary",
    baselineCaseId: "domain-re045-production",
    comparisonCaseIds: ["boundary-re045-periodic-lateral"],
    maximumRelativeChange: comparisonMetrics(45),
  }),
  reconciliation({
    id: "boundary-outlet-re100",
    kind: "boundary",
    baselineCaseId: "domain-re100-production",
    comparisonCaseIds: ["boundary-re100-convective-outlet"],
    maximumRelativeChange: comparisonMetrics(100),
  }),
] satisfies readonly ReconciliationDefinition[]);

export const DOMAIN_AND_BOUNDARY_VALIDATION_SUITE = Object.freeze({
  schemaVersion: VALIDATION_SCHEMA_VERSION,
  id: "domain-and-open-boundary-cpu-reference-v1",
  metricVersions: Object.freeze({
    convergence: "1",
    densityHealth: "1",
    drag: "1",
    fieldResidual: "1",
    fluxBalance: "1",
    liftPeriodicity: "2",
    recirculationLength: "1",
    strouhal: "2",
    symmetry: "1",
    upstreamReflection: "3",
  }),
  evidenceScope: Object.freeze({
    selectedProductionDomain: SELECTED_PRODUCTION_DOMAIN,
    selectedProductionBoundaries: SELECTED_PRODUCTION_BOUNDARIES,
    benchmarkRoles: Object.freeze([
      Object.freeze({ id: "open-cylinder-wake", role: "product-validation" as const }),
      Object.freeze({ id: "confined-channel", role: "solver-regression" as const }),
    ]),
  }),
  cases: Object.freeze([
    ...domainSensitivityCases,
    ...boundarySensitivityCases,
    disturbanceProbe,
  ]),
  reconciliations,
} satisfies ValidationSuite);

function domainCases(reference: ValidationCaseDefinition): readonly ValidationCaseDefinition[] {
  const suffix = caseSuffix(reference.reynoldsNumber);
  const cohort = `domain-re${suffix}`;
  return Object.freeze([
    configuredCase(reference, {
      id: `${cohort}-production`,
      cohort,
      qualityTier: `domain-production-re${suffix}-d18`,
    }),
    configuredCase(reference, {
      id: `${cohort}-upstream-plus0p5d`,
      cohort,
      qualityTier: `domain-upstream-plus0p5d-re${suffix}-d18`,
      domain: {
        ...SELECTED_PRODUCTION_DOMAIN,
        upstreamDiameters: 6.5,
      },
    }),
    configuredCase(reference, {
      id: `${cohort}-downstream-plus2d`,
      cohort,
      qualityTier: `domain-downstream-plus2d-re${suffix}-d18`,
      domain: { ...SELECTED_PRODUCTION_DOMAIN, downstreamDiameters: 16 },
    }),
    configuredCase(reference, {
      id: `${cohort}-lateral-plus1d`,
      cohort,
      qualityTier: `domain-lateral-plus1d-re${suffix}-d18`,
      domain: {
        ...SELECTED_PRODUCTION_DOMAIN,
        lateralDiameters: 9,
      },
    }),
  ]);
}

function configuredCase(
  reference: ValidationCaseDefinition,
  input: {
    readonly id: string;
    readonly cohort: string;
    readonly qualityTier: string;
    readonly domain?: DomainConfiguration;
    readonly boundaries?: BoundaryConfiguration;
  },
): ValidationCaseDefinition {
  const protocol =
    reference.reynoldsNumber === 100
      ? Object.freeze({
          ...reference.protocol,
          warmUpFlowThroughTime: 80,
          sampleInterval: 0.4,
        })
      : reference.reynoldsNumber === 5
        ? Object.freeze({
            ...reference.protocol,
            warmUpFlowThroughTime: 80,
          })
        : reference.protocol;
  return Object.freeze({
    ...reference,
    id: input.id,
    cohort: input.cohort,
    configuration: Object.freeze({
      ...reference.configuration,
      qualityTier: input.qualityTier,
      domain: Object.freeze(input.domain ?? SELECTED_PRODUCTION_DOMAIN),
      boundaries: Object.freeze(input.boundaries ?? SELECTED_PRODUCTION_BOUNDARIES),
      cylinder: Object.freeze({
        cellsPerDiameter: PRODUCTION_RESOLUTION,
        offsetX: 0,
        offsetY: 0,
      }),
    }),
    protocol,
    expectations: reference.expectations,
  });
}

function createDisturbanceProbe(): ValidationCaseDefinition {
  const reference = requiredReferenceCase(100);
  const configured = configuredCase(reference, {
    id: "disturbance-re100-from-re020",
    cohort: "upstream-disturbance-re100",
    qualityTier: "upstream-disturbance-re100-d18",
  });
  const retainedMetrics: readonly MetricExpectation["metric"][] = [
    "densityMinimum",
    "densityMaximum",
    "meanDensity",
    "meanDensityDrift",
    "nonFiniteValueCount",
    "nonPositiveDensityCount",
    "fluxResidual",
    "upstreamReflection",
  ];
  return Object.freeze({
    ...configured,
    expectedRegimes: Object.freeze(["unclassified", "periodically-shedding"] as const),
    protocol: Object.freeze({
      warmUpFlowThroughTime: 16,
      sampleFlowThroughTime: 4,
      sampleInterval: 0.4,
      reynoldsChange: REYNOLDS_CHANGE,
    }),
    expectations: Object.freeze([
      ...reference.expectations.filter(({ metric }) => retainedMetrics.includes(metric)),
      disturbanceExpectation("startupUpstreamReflection", 0, 0.02),
      disturbanceExpectation("reynoldsChangeUpstreamReflection", 0, 0.02),
      disturbanceExpectation(
        "startupMeanDensityDrift",
        0,
        reference.health.maximumMeanDensityDrift,
      ),
      disturbanceExpectation(
        "startupFluxResidual",
        -reference.health.maximumFluxResidual,
        reference.health.maximumFluxResidual,
      ),
      disturbanceExpectation(
        "reynoldsChangeMeanDensityDrift",
        0,
        reference.health.maximumMeanDensityDrift,
      ),
      disturbanceExpectation(
        "reynoldsChangeFluxResidual",
        -reference.health.maximumFluxResidual,
        reference.health.maximumFluxResidual,
      ),
    ]),
  });
}

function disturbanceExpectation(
  metric: MetricExpectation["metric"],
  minimum: number,
  maximum: number,
): MetricExpectation {
  return Object.freeze({
    metric,
    range: Object.freeze({ minimum, maximum }),
    tolerance: 0,
    sources: Object.freeze([OPEN_BOUNDARY_REFLECTION_SOURCE]),
  });
}

function comparisonMetrics(
  reynoldsNumber: number,
): ReconciliationDefinition["maximumRelativeChange"] {
  if (reynoldsNumber === 20) {
    return Object.freeze({
      meanDragCoefficient: MAXIMUM_DRAG_CHANGE,
      recirculationLength: MAXIMUM_RECIRCULATION_CHANGE,
    });
  }
  if (reynoldsNumber === 100) {
    return Object.freeze({
      meanDragCoefficient: MAXIMUM_DRAG_CHANGE,
      strouhalNumber: MAXIMUM_STROUHAL_CHANGE,
    });
  }
  if (reynoldsNumber === 45) {
    return Object.freeze({
      meanDragCoefficient: MAXIMUM_DRAG_CHANGE,
      recirculationLength: MAXIMUM_RECIRCULATION_CHANGE,
    });
  }
  return Object.freeze({ meanDragCoefficient: MAXIMUM_DRAG_CHANGE });
}

function reconciliation(
  input: Omit<ReconciliationDefinition, "schemaVersion" | "requireSameRegime">,
): ReconciliationDefinition {
  return Object.freeze({
    schemaVersion: VALIDATION_SCHEMA_VERSION,
    ...input,
    comparisonCaseIds: Object.freeze(input.comparisonCaseIds),
    maximumRelativeChange: Object.freeze(input.maximumRelativeChange),
    requireSameRegime: true,
  });
}

function requiredReferenceCase(reynoldsNumber: number): ValidationCaseDefinition {
  const reference = FULL_REYNOLDS_ENVELOPE_VALIDATION_SUITE.cases.find(
    (definition) => definition.reynoldsNumber === reynoldsNumber,
  );
  if (reference === undefined) {
    throw new Error(`Missing committed Reynolds ${reynoldsNumber} reference case.`);
  }
  return reference;
}

function caseSuffix(reynoldsNumber: number): string {
  return String(reynoldsNumber).padStart(3, "0");
}
