import { createSchemaPrimitives, relativeDifference } from "./schema-primitives.js";
import {
  FLOW_REGIMES,
  VALIDATION_SCHEMA_VERSION,
  type ValidationManifest,
} from "./types.js";
import { createValidationStructureValidators } from "./validation-structure-schema.js";

export class ValidationManifestSchemaError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ValidationManifestSchemaError";
  }
}

const primitives = createSchemaPrimitives(
  (message) => new ValidationManifestSchemaError(message),
);
const {
  array,
  finite,
  nonNegative,
  oneOf,
  positive,
  record,
  schemaVersion,
  text,
} = primitives;
const { validateClassificationThresholds, validateNumericalConfiguration, validateRange } =
  createValidationStructureValidators(
    primitives,
    (message) => new ValidationManifestSchemaError(message),
  );

export function parseValidationManifest(input: unknown): ValidationManifest {
  const manifest = record(input, "Validation manifest");
  if (manifest.schemaVersion !== VALIDATION_SCHEMA_VERSION) {
    throw new ValidationManifestSchemaError(
      `Unsupported validation manifest schema version: ${String(manifest.schemaVersion)}.`,
    );
  }
  oneOf(manifest.status, ["pass", "fail"], "Validation manifest status");
  validateSuite(manifest.suite);
  validateBackend(manifest.backend);
  const cases = array(manifest.cases, "Validation manifest cases");
  cases.forEach((value, index) => validateCase(value, index));
  const backendId = record(manifest.backend, "Backend identity").id;
  cases.forEach((value, index) => {
    const caseBackendId = record(
      record(value, `Case ${index}`).configuration,
      `Case ${index} configuration`,
    ).backendId;
    if (caseBackendId !== backendId) {
      throw new ValidationManifestSchemaError(
        `Case ${index} backend ${String(caseBackendId)} does not match manifest backend ${String(backendId)}.`,
      );
    }
  });
  const reconciliations = array(
    manifest.reconciliations,
    "Validation manifest reconciliations",
  );
  reconciliations.forEach((value, index) => validateReconciliation(value, index));
  if (
    manifest.status === "pass" &&
    [...cases, ...reconciliations].some(
      (value) => record(value, "Manifest result").status !== "pass",
    )
  ) {
    throw new ValidationManifestSchemaError(
      "A passing validation manifest cannot contain a failing case or reconciliation.",
    );
  }
  return input as ValidationManifest;
}

export function serializeValidationManifest(input: unknown): string {
  const manifest = parseValidationManifest(input);
  return `${JSON.stringify(canonicalize(manifest), undefined, 2)}\n`;
}

function validateSuite(value: unknown): void {
  const suite = record(value, "Validation suite identity");
  text(suite.id, "Validation suite id");
  if (suite.schemaVersion !== VALIDATION_SCHEMA_VERSION) {
    throw new ValidationManifestSchemaError(
      `Validation suite schema version must be ${VALIDATION_SCHEMA_VERSION}.`,
    );
  }
  const versions = record(suite.metricVersions, "Metric versions");
  for (const [metric, version] of Object.entries(versions)) {
    text(metric, "Metric id");
    text(version, `Metric version for ${metric}`);
  }
}

function validateBackend(value: unknown): void {
  const backend = record(value, "Backend identity");
  schemaVersion(backend.schemaVersion, "Backend identity");
  text(backend.id, "Backend id");
  oneOf(backend.kind, ["cpu-worker", "webgpu"], "Backend kind");
  text(backend.solver, "Solver identity");
  text(backend.solverVersion, "Solver version");
  text(backend.buildId, "Build id");
}

function validateCase(value: unknown, index: number): void {
  const result = record(value, `Case ${index}`);
  schemaVersion(result.schemaVersion, `Case ${index}`);
  text(result.caseId, `Case ${index} id`);
  const reynoldsNumber = finite(result.reynoldsNumber, `Case ${index} Reynolds number`);
  oneOf(result.status, ["pass", "fail"], `Case ${index} status`);
  oneOf(result.availability, ["available", "unavailable"], `Case ${index} availability`);
  if (result.status === "pass" && result.availability !== "available") {
    throw new ValidationManifestSchemaError(`Passing case ${index} must be available.`);
  }
  if (result.availability === "available") {
    validateRegime(result.regime, `Case ${index} regime`);
  } else if (result.regime !== undefined) {
    throw new ValidationManifestSchemaError(
      `Unavailable case ${index} cannot report a measured flow regime.`,
    );
  }
  validateNumericalConfiguration(
    result.configuration,
    `Case ${index} configuration`,
  );
  validateDefinition(result.definition, reynoldsNumber, index);
  const achieved = record(result.achieved, `Case ${index} achieved protocol`);
  finite(achieved.steps, `Case ${index} achieved steps`);
  finite(achieved.flowThroughTime, `Case ${index} achieved flow-through time`);
  finite(achieved.warmUpFlowThroughTime, `Case ${index} warm-up flow-through time`);
  finite(achieved.sampleFlowThroughTime, `Case ${index} sample flow-through time`);
  const metrics = record(result.metrics, `Case ${index} metrics`);
  for (const [metric, evidence] of Object.entries(metrics)) {
    validateMetric(evidence, `Case ${index} metric ${metric}`);
  }
  const applicableMetrics = Object.values(metrics)
    .map((value) => record(value, `Case ${index} metric evidence`))
    .filter((metric) => metric.applicability === "applicable");
  strings(result.failures, `Case ${index} failures`);
  if (result.status === "pass" && array(result.failures, `Case ${index} failures`).length > 0) {
    throw new ValidationManifestSchemaError(`Passing case ${index} cannot contain failures.`);
  }
  if (
    result.status === "pass" &&
    applicableMetrics.length === 0
  ) {
    throw new ValidationManifestSchemaError(
      `Passing case ${index} needs at least one applicable scientific metric.`,
    );
  }
  if (
    result.status === "pass" &&
    applicableMetrics.some((metric) => metric.status !== "pass")
  ) {
    throw new ValidationManifestSchemaError(
      `Passing case ${index} cannot contain failed or unassessed applicable metric evidence.`,
    );
  }
}

function validateDefinition(value: unknown, reynoldsNumber: number, caseIndex: number): void {
  const definition = record(value, `Case ${caseIndex} definition`);
  schemaVersion(definition.schemaVersion, `Case ${caseIndex} definition`);
  const scenario = record(
    definition.physicalScenario,
    `Case ${caseIndex} physical scenario`,
  );
  const speed = positive(
    scenario.flowSpeedMetersPerSecond,
    `Case ${caseIndex} flow speed`,
  );
  const diameter = positive(
    scenario.cylinderDiameterMeters,
    `Case ${caseIndex} cylinder diameter`,
  );
  const viscosity = positive(
    scenario.kinematicViscositySquareMetersPerSecond,
    `Case ${caseIndex} kinematic viscosity`,
  );
  const scenarioReynoldsNumber = (speed * diameter) / viscosity;
  if (relativeDifference(scenarioReynoldsNumber, reynoldsNumber) > 1e-9) {
    throw new ValidationManifestSchemaError(
      `Case ${caseIndex} physical scenario produces Reynolds number ${scenarioReynoldsNumber}, not ${reynoldsNumber}.`,
    );
  }
  const expectedRegimes = array(definition.expectedRegimes, `Case ${caseIndex} expected regimes`);
  if (expectedRegimes.length === 0) {
    throw new ValidationManifestSchemaError(`Case ${caseIndex} needs an expected regime.`);
  }
  for (const regime of expectedRegimes) {
    oneOf(
      regime,
      FLOW_REGIMES,
      `Case ${caseIndex} expected regime`,
    );
  }
  const protocol = record(definition.protocol, `Case ${caseIndex} protocol`);
  nonNegative(protocol.warmUpFlowThroughTime, `Case ${caseIndex} warm-up window`);
  positive(protocol.sampleFlowThroughTime, `Case ${caseIndex} sample window`);
  positive(protocol.sampleInterval, `Case ${caseIndex} sample interval`);
  if (protocol.minimumStableCycles !== undefined) {
    positive(protocol.minimumStableCycles, `Case ${caseIndex} minimum stable cycles`);
  }
  const health = record(definition.health, `Case ${caseIndex} health thresholds`);
  positive(health.targetDensity, `Case ${caseIndex} target density`);
  validateRange(health.densityRange, `Case ${caseIndex} density range`);
  nonNegative(health.maximumMeanDensityDrift, `Case ${caseIndex} density drift`);
  nonNegative(health.maximumFluxResidual, `Case ${caseIndex} flux residual`);
  nonNegative(health.maximumUpstreamReflection, `Case ${caseIndex} upstream reflection`);
  validateClassificationThresholds(definition.classification, `Case ${caseIndex}`);
}

function validateMetric(value: unknown, location: string): void {
  const metric = record(value, location);
  schemaVersion(metric.schemaVersion, location);
  oneOf(metric.applicability, ["applicable", "inapplicable"], `${location} applicability`);
  oneOf(metric.status, ["pass", "fail", "not-assessed"], `${location} status`);
  const measured =
    metric.measured === undefined
      ? undefined
      : finite(metric.measured, `${location} must have a finite measured value`);
  if (metric.applicability === "inapplicable") {
    if (metric.status !== "not-assessed") {
      throw new ValidationManifestSchemaError(
        `${location} has invalid applicability: an inapplicable metric must not be assessed.`,
      );
    }
    return;
  }
  if (metric.status === "pass" && metric.measured === undefined) {
    throw new ValidationManifestSchemaError(`${location} passed without a measured value.`);
  }
  const expected = record(metric.expected, `${location} expected range`);
  const minimum = finite(expected.minimum, `${location} expected minimum`);
  const maximum = finite(expected.maximum, `${location} expected maximum`);
  if (minimum > maximum) {
    throw new ValidationManifestSchemaError(`${location} expected range is inverted.`);
  }
  const tolerance = finite(metric.tolerance, `${location} tolerance`);
  if (tolerance < 0) {
    throw new ValidationManifestSchemaError(`${location} tolerance must not be negative.`);
  }
  const measurementPasses =
    measured !== undefined &&
    measured >= minimum - tolerance &&
    measured <= maximum + tolerance;
  if ((metric.status === "pass") !== measurementPasses) {
    throw new ValidationManifestSchemaError(
      `${location} status contradicts its measured value, expected range, and tolerance.`,
    );
  }
  if (metric.status === "not-assessed") {
    throw new ValidationManifestSchemaError(
      `${location} is applicable and must be assessed as pass or fail.`,
    );
  }
  const sources = array(metric.sources, `${location} scientific sources`);
  if (sources.length === 0) {
    throw new ValidationManifestSchemaError(`${location} requires at least one scientific source.`);
  }
  sources.forEach((source, sourceIndex) => {
    const item = record(source, `${location} scientific source ${sourceIndex}`);
    text(item.id, `${location} scientific source ${sourceIndex} id`);
    text(item.url, `${location} scientific source ${sourceIndex} URL`);
    text(item.convention, `${location} scientific source ${sourceIndex} convention`);
  });
}

function validateReconciliation(value: unknown, index: number): void {
  const result = record(value, `Reconciliation ${index}`);
  schemaVersion(result.schemaVersion, `Reconciliation ${index}`);
  text(result.id, `Reconciliation ${index} id`);
  oneOf(
    result.kind,
    ["grid", "domain", "cylinder-placement", "boundary", "backend"],
    `Reconciliation ${index} kind`,
  );
  text(result.baselineCaseId, `Reconciliation ${index} baseline case id`);
  const comparisons = array(result.comparisons, `Reconciliation ${index} comparisons`);
  if (comparisons.length === 0) {
    throw new ValidationManifestSchemaError(`Reconciliation ${index} needs a comparison.`);
  }
  comparisons.forEach((value, comparisonIndex) => {
    const comparison = record(
      value,
      `Reconciliation ${index} comparison ${comparisonIndex}`,
    );
    text(
      comparison.comparisonCaseId,
      `Reconciliation ${index} comparison ${comparisonIndex} case id`,
    );
    if (comparison.baselineBackendId !== undefined) {
      text(
        comparison.baselineBackendId,
        `Reconciliation ${index} comparison ${comparisonIndex} baseline backend`,
      );
    }
    if (comparison.comparisonBackendId !== undefined) {
      text(
        comparison.comparisonBackendId,
        `Reconciliation ${index} comparison ${comparisonIndex} comparison backend`,
      );
    }
    if (comparison.baselineBackendKind !== undefined) {
      oneOf(
        comparison.baselineBackendKind,
        ["cpu-worker", "webgpu"],
        `Reconciliation ${index} comparison ${comparisonIndex} baseline backend kind`,
      );
    }
    if (comparison.comparisonBackendKind !== undefined) {
      oneOf(
        comparison.comparisonBackendKind,
        ["cpu-worker", "webgpu"],
        `Reconciliation ${index} comparison ${comparisonIndex} comparison backend kind`,
      );
    }
    if (comparison.baselineRegime !== undefined) {
      validateRegime(
        comparison.baselineRegime,
        `Reconciliation ${index} comparison ${comparisonIndex} baseline regime`,
      );
    }
    if (comparison.comparisonRegime !== undefined) {
      validateRegime(
        comparison.comparisonRegime,
        `Reconciliation ${index} comparison ${comparisonIndex} comparison regime`,
      );
    }
    const metrics = record(
      comparison.metrics,
      `Reconciliation ${index} comparison ${comparisonIndex} metrics`,
    );
    if (comparison.status === "pass" && Object.keys(metrics).length === 0) {
      throw new ValidationManifestSchemaError(
        `Passing reconciliation ${index} comparison ${comparisonIndex} needs metric evidence.`,
      );
    }
    for (const [metric, value] of Object.entries(metrics)) {
      const evidence = record(
        value,
        `Reconciliation ${index} comparison ${comparisonIndex} metric ${metric}`,
      );
      finite(evidence.baseline, `Reconciliation ${index} ${metric} baseline`);
      finite(evidence.comparison, `Reconciliation ${index} ${metric} comparison`);
      const relativeChange = nonNegative(
        evidence.relativeChange,
        `Reconciliation ${index} ${metric} change`,
      );
      const maximumRelativeChange = nonNegative(
        evidence.maximumRelativeChange,
        `Reconciliation ${index} ${metric} maximum change`,
      );
      oneOf(evidence.status, ["pass", "fail"], `Reconciliation ${index} ${metric} status`);
      if (
        (relativeChange <= maximumRelativeChange) !==
        (evidence.status === "pass")
      ) {
        throw new ValidationManifestSchemaError(
          `Reconciliation ${index} ${metric} status contradicts its declared threshold.`,
        );
      }
    }
    oneOf(
      comparison.status,
      ["pass", "fail"],
      `Reconciliation ${index} comparison ${comparisonIndex} status`,
    );
    if (
      comparison.status === "pass" &&
      (comparison.baselineRegime === undefined || comparison.comparisonRegime === undefined)
    ) {
      throw new ValidationManifestSchemaError(
        `Passing reconciliation ${index} comparison ${comparisonIndex} requires both regimes.`,
      );
    }
    if (
      comparison.status === "pass" &&
      Object.values(metrics).some(
        (value) => record(value, "Reconciliation metric evidence").status !== "pass",
      )
    ) {
      throw new ValidationManifestSchemaError(
        `Passing reconciliation ${index} comparison ${comparisonIndex} cannot contain a failing metric.`,
      );
    }
    if (
      comparison.status === "pass" &&
      comparison.baselineRegime !== undefined &&
      comparison.comparisonRegime !== undefined &&
      comparison.baselineRegime !== comparison.comparisonRegime
    ) {
      throw new ValidationManifestSchemaError(
        `Passing reconciliation ${index} comparison ${comparisonIndex} cannot change regime.`,
      );
    }
  });
  oneOf(result.status, ["pass", "fail"], `Reconciliation ${index} status`);
  strings(result.failures, `Reconciliation ${index} failures`);
  if (
    result.status === "pass" &&
    array(result.failures, `Reconciliation ${index} failures`).length > 0
  ) {
    throw new ValidationManifestSchemaError(
      `Passing reconciliation ${index} cannot contain failures.`,
    );
  }
  if (
    result.status === "pass" &&
    comparisons.some((value) => record(value, "Reconciliation comparison").status !== "pass")
  ) {
    throw new ValidationManifestSchemaError(
      `Passing reconciliation ${index} cannot contain a failing comparison.`,
    );
  }
}

function validateRegime(value: unknown, location: string): void {
  oneOf(
    value,
    FLOW_REGIMES,
    location,
  );
}

function strings(value: unknown, location: string): void {
  for (const item of array(value, location)) {
    text(item, `${location} item`);
  }
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "number") {
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}
