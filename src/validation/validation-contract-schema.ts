import { createSchemaPrimitives, relativeDifference } from "./schema-primitives.js";
import {
  FLOW_REGIMES,
  VALIDATION_SCHEMA_VERSION,
  type BackendIdentity,
  type SolverBackend,
  type ValidationSuite,
} from "./types.js";

const OBSERVABLE_METRICS = [
  "meanDragCoefficient",
  "liftRms",
  "recirculationLength",
  "strouhalNumber",
  "meanDensity",
  "fluxResidual",
  "upstreamReflection",
] as const;

export class ValidationContractSchemaError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ValidationContractSchemaError";
  }
}

const {
  array,
  finite,
  nonNegative,
  oneOf: choice,
  positive,
  record,
  text,
  versionedRecord,
} = createSchemaPrimitives((message) => new ValidationContractSchemaError(message));

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
  validateConfiguration(definition.configuration, location);
  validateProtocol(definition.protocol, location);
  validateHealth(definition.health, location);
  validateClassification(definition.classification, location);

  const expectations = array(definition.expectations, `${location} expectations`);
  if (expectations.length === 0) {
    throw new ValidationContractSchemaError(
      `${location} needs at least one scientific metric expectation.`,
    );
  }
  expectations.forEach((expectation, expectationIndex) => {
    const metric = record(expectation, `${location} expectation ${expectationIndex}`);
    choice(metric.metric, OBSERVABLE_METRICS, `${location} expectation metric`);
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

function validateConfiguration(value: unknown, caseLocation: string): void {
  const configuration = record(value, `${caseLocation} configuration`);
  text(configuration.backendId, `${caseLocation} backend id`);
  text(configuration.qualityTier, `${caseLocation} quality tier`);
  choice(configuration.precision, ["float32", "float64", "mixed"], `${caseLocation} precision`);
  choice(configuration.collision, ["D2Q9 TRT"], `${caseLocation} collision`);
  const boundaries = record(configuration.boundaries, `${caseLocation} boundaries`);
  choice(
    boundaries.inlet,
    ["regularized-velocity", "equilibrium-velocity"],
    `${caseLocation} inlet`,
  );
  choice(boundaries.lateral, ["free-slip", "periodic", "no-slip"], `${caseLocation} lateral`);
  choice(
    boundaries.outlet,
    ["fixed-density-nee", "convective", "extrapolated"],
    `${caseLocation} outlet`,
  );
  choice(boundaries.cylinder, ["linear-bfl"], `${caseLocation} cylinder boundary`);
  const domain = record(configuration.domain, `${caseLocation} domain`);
  positive(domain.upstreamDiameters, `${caseLocation} upstream extent`);
  positive(domain.downstreamDiameters, `${caseLocation} downstream extent`);
  positive(domain.lateralDiameters, `${caseLocation} lateral extent`);
  const cylinder = record(configuration.cylinder, `${caseLocation} cylinder`);
  positive(cylinder.cellsPerDiameter, `${caseLocation} cylinder resolution`);
  finite(cylinder.offsetX, `${caseLocation} cylinder x offset`);
  finite(cylinder.offsetY, `${caseLocation} cylinder y offset`);
}

function validateProtocol(value: unknown, caseLocation: string): void {
  const protocol = record(value, `${caseLocation} protocol`);
  nonNegative(protocol.warmUpFlowThroughTime, `${caseLocation} warm-up window`);
  positive(protocol.sampleFlowThroughTime, `${caseLocation} sample window`);
  positive(protocol.sampleInterval, `${caseLocation} sample interval`);
  if (protocol.minimumStableCycles !== undefined) {
    positive(protocol.minimumStableCycles, `${caseLocation} minimum stable cycles`);
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

function validateClassification(value: unknown, caseLocation: string): void {
  const classification = record(value, `${caseLocation} classification thresholds`);
  nonNegative(
    classification.maximumSteadyFieldResidual,
    `${caseLocation} steady field residual`,
  );
  nonNegative(
    classification.maximumSteadySymmetryError,
    `${caseLocation} steady symmetry error`,
  );
  nonNegative(classification.maximumSteadyLiftRms, `${caseLocation} steady lift RMS`);
  nonNegative(
    classification.maximumSteadyDragRelativeVariation,
    `${caseLocation} steady drag variation`,
  );
  positive(classification.minimumPeriodicCycles, `${caseLocation} periodic cycles`);
  nonNegative(
    classification.maximumPeriodicFrequencyVariation,
    `${caseLocation} periodic frequency variation`,
  );
  nonNegative(
    classification.maximumPeriodicAmplitudeVariation,
    `${caseLocation} periodic amplitude variation`,
  );
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

function validateRange(value: unknown, location: string): void {
  const range = record(value, location);
  const minimum = finite(range.minimum, `${location} minimum`);
  const maximum = finite(range.maximum, `${location} maximum`);
  if (minimum > maximum) {
    throw new ValidationContractSchemaError(`${location} minimum cannot exceed maximum.`);
  }
}
