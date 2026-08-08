import { PERIODIC_RE100_VALIDATION_SUITE } from "./periodic-re100-reference.js";
import { STEADY_RE20_VALIDATION_SUITE } from "./steady-re20-reference.js";
import {
  VALIDATION_SCHEMA_VERSION,
  type ReconciliationDefinition,
  type ValidationCaseDefinition,
  type ValidationSuite,
} from "./types.js";

const MAXIMUM_DRAG_CHANGE = 0.01;
const MAXIMUM_STROUHAL_CHANGE = 0.01;
const MAXIMUM_RECIRCULATION_CHANGE = 0.02;
const STEADY_PRODUCTION_CANDIDATE_RESOLUTIONS = [16, 18] as const;
const PERIODIC_PRODUCTION_CANDIDATE_RESOLUTIONS = [18, 19] as const;
const FINE_REFERENCE_RESOLUTION = 20;
const PLACEMENT_RESOLUTION = 18;
const PERIODIC_CONVERGENCE_WARM_UP_FLOW_THROUGH_TIME = 80;
const PERIODIC_CONVERGENCE_SAMPLE_INTERVAL = 0.4;
const FRACTIONAL_PLACEMENT = Object.freeze({ offsetX: 0.5, offsetY: 0 });

const steadyReference = requiredReferenceCase(
  STEADY_RE20_VALIDATION_SUITE.cases[0],
  "steady Reynolds 20",
);
const periodicReference = requiredReferenceCase(
  PERIODIC_RE100_VALIDATION_SUITE.cases[0],
  "periodic Reynolds 100",
);

const steadyGridCases = gridCases(
  steadyReference,
  "grid-steady-re020",
  "grid-steady-re020",
  STEADY_PRODUCTION_CANDIDATE_RESOLUTIONS,
);
const periodicGridCases = gridCases(
  periodicReference,
  "grid-periodic-re100",
  "grid-periodic-re100",
  PERIODIC_PRODUCTION_CANDIDATE_RESOLUTIONS,
);

const sensitivityCases = Object.freeze([
  ...steadyGridCases,
  ...periodicGridCases,
  placementCase(
    steadyReference,
    "placement-steady-re020-shifted-d18",
    "placement-steady-re020",
  ),
  placementCase(
    periodicReference,
    "placement-periodic-re100-shifted-d18",
    "placement-periodic-re100",
  ),
] satisfies readonly ValidationCaseDefinition[]);

const reconciliations = Object.freeze([
  reconciliation({
    id: "grid-steady-re020",
    kind: "grid",
    baselineCaseId: "grid-steady-re020-candidate-d16",
    comparisonCaseIds: [
      "grid-steady-re020-candidate-d18",
      "grid-steady-re020-reference-d20",
    ],
    maximumRelativeChange: {
      meanDragCoefficient: MAXIMUM_DRAG_CHANGE,
      recirculationLength: MAXIMUM_RECIRCULATION_CHANGE,
    },
  }),
  reconciliation({
    id: "grid-periodic-re100",
    kind: "grid",
    baselineCaseId: "grid-periodic-re100-candidate-d18",
    comparisonCaseIds: [
      "grid-periodic-re100-candidate-d19",
      "grid-periodic-re100-reference-d20",
    ],
    maximumRelativeChange: {
      meanDragCoefficient: MAXIMUM_DRAG_CHANGE,
      strouhalNumber: MAXIMUM_STROUHAL_CHANGE,
    },
  }),
  reconciliation({
    id: "placement-steady-re020",
    kind: "cylinder-placement",
    baselineCaseId: "grid-steady-re020-candidate-d18",
    comparisonCaseIds: ["placement-steady-re020-shifted-d18"],
    maximumRelativeChange: {
      meanDragCoefficient: MAXIMUM_DRAG_CHANGE,
      recirculationLength: MAXIMUM_RECIRCULATION_CHANGE,
    },
  }),
  reconciliation({
    id: "placement-periodic-re100",
    kind: "cylinder-placement",
    baselineCaseId: "grid-periodic-re100-candidate-d18",
    comparisonCaseIds: ["placement-periodic-re100-shifted-d18"],
    maximumRelativeChange: {
      meanDragCoefficient: MAXIMUM_DRAG_CHANGE,
      strouhalNumber: MAXIMUM_STROUHAL_CHANGE,
    },
  }),
] satisfies readonly ReconciliationDefinition[]);

export const GRID_AND_PLACEMENT_CONVERGENCE_VALIDATION_SUITE = Object.freeze({
  schemaVersion: VALIDATION_SCHEMA_VERSION,
  id: "grid-and-placement-convergence-cpu-reference-v1",
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
    upstreamReflection: "2",
  }),
  cases: sensitivityCases,
  reconciliations,
} satisfies ValidationSuite);

function gridCases(
  reference: ValidationCaseDefinition,
  idPrefix: string,
  cohort: string,
  productionCandidateResolutions: readonly number[],
): readonly ValidationCaseDefinition[] {
  return Object.freeze([
    ...productionCandidateResolutions.map((cellsPerDiameter) =>
      configuredCase(reference, {
        id: `${idPrefix}-candidate-d${cellsPerDiameter}`,
        cohort,
        cellsPerDiameter,
        qualityTier: `production-candidate-d${cellsPerDiameter}`,
      }),
    ),
    configuredCase(reference, {
      id: `${idPrefix}-reference-d${FINE_REFERENCE_RESOLUTION}`,
      cohort,
      cellsPerDiameter: FINE_REFERENCE_RESOLUTION,
      qualityTier: `fine-reference-d${FINE_REFERENCE_RESOLUTION}`,
    }),
  ]);
}

function placementCase(
  reference: ValidationCaseDefinition,
  id: string,
  cohort: string,
): ValidationCaseDefinition {
  return configuredCase(reference, {
    id,
    cohort,
    cellsPerDiameter: PLACEMENT_RESOLUTION,
    qualityTier: `placement-sensitivity-d${PLACEMENT_RESOLUTION}`,
    ...FRACTIONAL_PLACEMENT,
  });
}

function configuredCase(
  reference: ValidationCaseDefinition,
  input: {
    readonly id: string;
    readonly cohort: string;
    readonly cellsPerDiameter: number;
    readonly qualityTier: string;
    readonly offsetX?: number;
    readonly offsetY?: number;
  },
): ValidationCaseDefinition {
  return Object.freeze({
    ...reference,
    id: input.id,
    cohort: input.cohort,
    configuration: Object.freeze({
      ...reference.configuration,
      qualityTier: input.qualityTier,
      cylinder: Object.freeze({
        cellsPerDiameter: input.cellsPerDiameter,
        offsetX: input.offsetX ?? 0,
        offsetY: input.offsetY ?? 0,
      }),
    }),
    protocol:
      reference.reynoldsNumber === 100
        ? Object.freeze({
            ...reference.protocol,
            warmUpFlowThroughTime:
              PERIODIC_CONVERGENCE_WARM_UP_FLOW_THROUGH_TIME,
            sampleInterval: PERIODIC_CONVERGENCE_SAMPLE_INTERVAL,
          })
        : reference.protocol,
  });
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

function requiredReferenceCase(
  reference: ValidationCaseDefinition | undefined,
  label: string,
): ValidationCaseDefinition {
  if (reference === undefined) {
    throw new Error(`Missing committed ${label} reference case.`);
  }
  return reference;
}
