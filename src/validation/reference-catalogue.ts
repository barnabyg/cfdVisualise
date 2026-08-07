import type {
  FlowRegime,
  MetricExpectation,
  PhysicalScenario,
  ReconciliationDefinition,
  ValidationCaseDefinition,
  ValidationSuite,
} from "./types.js";

export interface ReferenceCaseCatalogueEntry {
  readonly id: string;
  readonly reynoldsNumber: number;
  readonly physicalScenario: PhysicalScenario;
  readonly expectedRegimes: readonly FlowRegime[];
}

export type ReferenceCaseEvidence = Pick<
  ValidationCaseDefinition,
  "configuration" | "protocol" | "health" | "classification" | "expectations"
>;

export const REFERENCE_CASE_CATALOGUE = Object.freeze([
  referenceCase("open-cylinder-re005", 5, ["steady"], 0.001, 0.005),
  referenceCase("open-cylinder-re020", 20, ["steady"], 0.002, 0.01),
  referenceCase("open-cylinder-re040", 40, ["steady"], 0.004, 0.01),
  referenceCase("open-cylinder-re045", 45, ["steady", "unclassified"], 0.0045, 0.01),
  referenceCase(
    "open-cylinder-re050",
    50,
    ["periodically-shedding", "unclassified"],
    0.005,
    0.01,
  ),
  referenceCase("open-cylinder-re100", 100, ["periodically-shedding"], 0.01, 0.01),
  referenceCase("open-cylinder-re150", 150, ["periodically-shedding"], 0.015, 0.01),
] as const);

export type ReferenceCaseId = (typeof REFERENCE_CASE_CATALOGUE)[number]["id"];

export interface CreateReferenceValidationSuiteInput {
  readonly id: string;
  readonly metricVersions: Readonly<Record<string, string>>;
  readonly evidence: Readonly<Partial<Record<ReferenceCaseId, ReferenceCaseEvidence>>>;
  readonly sensitivityCases: readonly ValidationCaseDefinition[];
  readonly reconciliations: readonly ReconciliationDefinition[];
}

export function createReferenceValidationSuite(
  input: CreateReferenceValidationSuiteInput,
): ValidationSuite {
  const cases = REFERENCE_CASE_CATALOGUE.map((catalogueEntry) => {
    const evidence = input.evidence[catalogueEntry.id];
    if (evidence === undefined) {
      throw new Error(
        `Reference case ${catalogueEntry.id} has no committed evidence; tolerances will not be invented.`,
      );
    }
    validateExpectations(catalogueEntry.id, evidence.expectations);
    return {
      schemaVersion: "1",
      ...catalogueEntry,
      ...evidence,
    } satisfies ValidationCaseDefinition;
  });
  const allCases = [...cases, ...input.sensitivityCases];
  const caseIds = new Set(allCases.map((definition) => definition.id));
  if (caseIds.size !== allCases.length) {
    throw new Error("Reference and sensitivity case identifiers must be unique.");
  }
  return {
    schemaVersion: "1",
    id: input.id,
    metricVersions: input.metricVersions,
    cases: allCases,
    reconciliations: input.reconciliations,
  };
}

function referenceCase<
  const Id extends string,
  const Reynolds extends number,
  const Regimes extends readonly FlowRegime[],
>(
  id: Id,
  reynoldsNumber: Reynolds,
  expectedRegimes: Regimes,
  flowSpeedMetersPerSecond: number,
  cylinderDiameterMeters: number,
) {
  return Object.freeze({
    id,
    reynoldsNumber,
    expectedRegimes: Object.freeze(expectedRegimes),
    physicalScenario: Object.freeze({
      flowSpeedMetersPerSecond,
      cylinderDiameterMeters,
      kinematicViscositySquareMetersPerSecond: 0.000001,
    }),
  });
}

function validateExpectations(
  caseId: string,
  expectations: readonly MetricExpectation[],
): void {
  if (expectations.length === 0) {
    throw new Error(`Reference case ${caseId} must declare at least one published expectation.`);
  }
  for (const expectation of expectations) {
    if (
      !Number.isFinite(expectation.range.minimum) ||
      !Number.isFinite(expectation.range.maximum) ||
      expectation.range.minimum > expectation.range.maximum ||
      !Number.isFinite(expectation.tolerance) ||
      expectation.tolerance < 0
    ) {
      throw new Error(`Reference case ${caseId} has an invalid ${expectation.metric} range or tolerance.`);
    }
    if (
      expectation.sources.length === 0 ||
      expectation.sources.some(
        (source) => source.id.length === 0 || source.url.length === 0 || source.convention.length === 0,
      )
    ) {
      throw new Error(`Reference case ${caseId} has an unsourced ${expectation.metric} expectation.`);
    }
  }
}
