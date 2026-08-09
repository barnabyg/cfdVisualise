import { createSchemaPrimitives, relativeDifference } from "./schema-primitives.js";
import { createValidationStructureValidators } from "./validation-structure-schema.js";
import {
  FLOW_REGIMES,
  VALIDATION_SCHEMA_VERSION,
  type BackendIdentity,
  type SolverBackend,
  type ValidationSuite,
} from "./types.js";

const OBSERVABLE_METRICS = [
  "densityMinimum",
  "densityMaximum",
  "meanDragCoefficient",
  "dragRelativeVariation",
  "liftRms",
  "periodicCycleCount",
  "dominantFrequency",
  "frequencyVariation",
  "amplitudeVariation",
  "frequencyUncertainty",
  "recirculationLength",
  "strouhalNumber",
  "meanDensity",
  "meanDensityDrift",
  "nonFiniteValueCount",
  "nonPositiveDensityCount",
  "fluxResidual",
  "upstreamReflection",
  "startupUpstreamReflection",
  "reynoldsChangeUpstreamReflection",
  "startupMeanDensityDrift",
  "startupFluxResidual",
  "reynoldsChangeMeanDensityDrift",
  "reynoldsChangeFluxResidual",
  "fieldResidual",
  "symmetryError",
] as const;

export class ValidationContractSchemaError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ValidationContractSchemaError";
  }
}

const primitives = createSchemaPrimitives(
  (message) => new ValidationContractSchemaError(message),
);
const {
  array,
  nonNegative,
  oneOf: choice,
  positive,
  record,
  text,
  versionedRecord,
} = primitives;
const {
  validateClassificationThresholds,
  validateEvidenceScope,
  validateNumericalConfiguration,
  validateRange,
  validateSamplingProtocol,
} = createValidationStructureValidators(
  primitives,
  (message) => new ValidationContractSchemaError(message),
);

export function parseValidationSuite(input: unknown): ValidationSuite {
  const suite = versionedRecord(input, "Validation suite");
  text(suite.id, "Validation suite id");
  const metricVersions = record(suite.metricVersions, "Validation suite metric versions");
  for (const [metric, version] of Object.entries(metricVersions)) {
    text(metric, "Metric id");
    text(version, `Metric version for ${metric}`);
  }
  array(suite.cases, "Validation suite cases").forEach(validateCaseDefinition);
  array(suite.reconciliations, "Validation suite reconciliations").forEach(
    validateReconciliationDefinition,
  );
  if (suite.evidenceScope !== undefined) {
    validateEvidenceScope(suite.evidenceScope, "Validation suite evidence scope");
  }
  return input as ValidationSuite;
}

export function parseSolverBackend(input: unknown): SolverBackend {
  const backend = versionedRecord(input, "Solver backend");
  if (typeof backend.runCase !== "function") {
    throw new ValidationContractSchemaError("Solver backend runCase must be a function.");
  }
  validateBackendIdentity(backend.identity);
  return input as SolverBackend;
}

function validateCaseDefinition(value: unknown, index: number): void {
  const location = `Validation case ${index}`;
  const definition = record(value, location);
  if (definition.schemaVersion !== VALIDATION_SCHEMA_VERSION) {
    throw new ValidationContractSchemaError(
      `Validation case schema version at index ${index} must be ${VALIDATION_SCHEMA_VERSION}.`,
    );
  }
  text(definition.id, `${location} id`);
  const reynoldsNumber = positive(definition.reynoldsNumber, `${location} Reynolds number`);

  const scenario = record(definition.physicalScenario, `${location} physical scenario`);
  const speed = positive(scenario.flowSpeedMetersPerSecond, `${location} flow speed`);
  const diameter = positive(scenario.cylinderDiameterMeters, `${location} cylinder diameter`);
  const viscosity = positive(
    scenario.kinematicViscositySquareMetersPerSecond,
    `${location} kinematic viscosity`,
  );
  if (relativeDifference((speed * diameter) / viscosity, reynoldsNumber) > 1e-9) {
    throw new ValidationContractSchemaError(
      `${location} physical scenario is incompatible with its Reynolds number.`,
    );
  }

  const expectedRegimes = array(definition.expectedRegimes, `${location} expected regimes`);
  if (expectedRegimes.length === 0) {
    throw new ValidationContractSchemaError(`${location} needs an expected regime.`);
  }
  expectedRegimes.forEach((regime) => choice(regime, FLOW_REGIMES, `${location} regime`));
  validateNumericalConfiguration(
    definition.configuration,
    `${location} configuration`,
  );
  validateSamplingProtocol(definition.protocol, location, reynoldsNumber);
  validateHealth(definition.health, location);
  validateClassificationThresholds(definition.classification, location);

  const expectations = array(definition.expectations, `${location} expectations`);
  if (expectations.length === 0) {
    throw new ValidationContractSchemaError(
      `${location} needs at least one scientific metric expectation.`,
    );
  }
  expectations.forEach((expectation, expectationIndex) => {
    const metric = record(expectation, `${location} expectation ${expectationIndex}`);
    choice(metric.metric, OBSERVABLE_METRICS, `${location} expectation metric`);
    if (metric.applicableRegimes !== undefined) {
      const applicableRegimes = array(
        metric.applicableRegimes,
        `${location} expectation applicable regimes`,
      );
      if (applicableRegimes.length === 0) {
        throw new ValidationContractSchemaError(
          `${location} expectation needs at least one applicable regime.`,
        );
      }
      applicableRegimes.forEach((regime) =>
        choice(regime, FLOW_REGIMES, `${location} expectation applicable regime`),
      );
      if (applicableRegimes.some((regime) => !expectedRegimes.includes(regime))) {
        throw new ValidationContractSchemaError(
          `${location} expectation applies outside the case's expected regimes.`,
        );
      }
    }
    validateRange(metric.range, `${location} expectation range`);
    nonNegative(metric.tolerance, `${location} expectation tolerance`);
    const sources = array(metric.sources, `${location} expectation sources`);
    if (sources.length === 0) {
      throw new ValidationContractSchemaError(`${location} expectation needs a source.`);
    }
    sources.forEach((source, sourceIndex) => {
      const evidence = record(source, `${location} source ${sourceIndex}`);
      text(evidence.id, `${location} source id`);
      text(evidence.url, `${location} source URL`);
      text(evidence.convention, `${location} source convention`);
    });
  });
  if (definition.cohort !== undefined) {
    text(definition.cohort, `${location} cohort`);
  }
}

function validateHealth(value: unknown, caseLocation: string): void {
  const health = record(value, `${caseLocation} health thresholds`);
  positive(health.targetDensity, `${caseLocation} target density`);
  validateRange(health.densityRange, `${caseLocation} density range`);
  nonNegative(health.maximumMeanDensityDrift, `${caseLocation} density drift`);
  nonNegative(health.maximumFluxResidual, `${caseLocation} flux residual`);
  nonNegative(health.maximumUpstreamReflection, `${caseLocation} upstream reflection`);
}

function validateReconciliationDefinition(value: unknown, index: number): void {
  const location = `Reconciliation definition ${index}`;
  const definition = versionedRecord(value, location);
  text(definition.id, `${location} id`);
  choice(
    definition.kind,
    ["grid", "domain", "cylinder-placement", "boundary", "backend"],
    `${location} kind`,
  );
  text(definition.baselineCaseId, `${location} baseline case id`);
  array(definition.comparisonCaseIds, `${location} comparison case ids`).forEach(
    (caseId, caseIndex) => text(caseId, `${location} comparison case ${caseIndex}`),
  );
  const maximumChanges = record(
    definition.maximumRelativeChange,
    `${location} maximum relative changes`,
  );
  for (const [metric, maximumChange] of Object.entries(maximumChanges)) {
    choice(metric, ["meanDragCoefficient", "recirculationLength", "strouhalNumber"], `${location} metric`);
    nonNegative(maximumChange, `${location} maximum change for ${metric}`);
  }
  if (typeof definition.requireSameRegime !== "boolean") {
    throw new ValidationContractSchemaError(`${location} requireSameRegime must be boolean.`);
  }
}

function validateBackendIdentity(input: unknown): asserts input is BackendIdentity {
  const identity = versionedRecord(input, "Backend identity");
  text(identity.id, "Backend id");
  choice(identity.kind, ["cpu-worker", "webgpu"], "Backend kind");
  text(identity.solver, "Backend solver");
  text(identity.solverVersion, "Backend solver version");
  text(identity.buildId, "Backend build id");
}
