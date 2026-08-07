import type {
  BackendIdentity,
  SolverBackend,
  ValidationSuite,
} from "./types.js";

export class ValidationContractSchemaError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ValidationContractSchemaError";
  }
}

export function parseValidationSuite(input: unknown): ValidationSuite {
  const suite = versionedRecord(input, "Validation suite");
  text(suite.id, "Validation suite id");
  const metricVersions = record(suite.metricVersions, "Validation suite metric versions");
  for (const [metric, version] of Object.entries(metricVersions)) {
    text(metric, "Metric id");
    text(version, `Metric version for ${metric}`);
  }
  const cases = array(suite.cases, "Validation suite cases");
  for (const [index, value] of cases.entries()) {
    const definition = record(value, `Validation case ${index}`);
    if (definition.schemaVersion !== "1") {
      throw new ValidationContractSchemaError(
        `Validation case schema version at index ${index} must be 1.`,
      );
    }
    text(definition.id, `Validation case ${index} id`);
  }
  const reconciliations = array(
    suite.reconciliations,
    "Validation suite reconciliations",
  );
  for (const [index, value] of reconciliations.entries()) {
    const definition = versionedRecord(value, `Reconciliation definition ${index}`);
    text(definition.id, `Reconciliation definition ${index} id`);
  }
  finiteNumbers(input, "Validation suite");
  return input as ValidationSuite;
}

export function parseSolverBackend(input: unknown): SolverBackend {
  const backend = record(input, "Solver backend");
  if (typeof backend.runCase !== "function") {
    throw new ValidationContractSchemaError("Solver backend runCase must be a function.");
  }
  validateBackendIdentity(backend.identity);
  finiteNumbers(input, "Solver backend");
  return input as SolverBackend;
}

function validateBackendIdentity(input: unknown): asserts input is BackendIdentity {
  const identity = versionedRecord(input, "Backend identity");
  text(identity.id, "Backend id");
  text(identity.solver, "Backend solver");
  text(identity.solverVersion, "Backend solver version");
  text(identity.buildId, "Backend build id");
  if (identity.kind !== "cpu-worker" && identity.kind !== "webgpu") {
    throw new ValidationContractSchemaError("Backend kind is incompatible.");
  }
}

function versionedRecord(value: unknown, location: string): Record<string, unknown> {
  const result = record(value, location);
  if (result.schemaVersion !== "1") {
    throw new ValidationContractSchemaError(`${location} schema version must be 1.`);
  }
  return result;
}

function finiteNumbers(value: unknown, location: string): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ValidationContractSchemaError(`${location} must contain only finite numbers.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => finiteNumbers(item, `${location}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      finiteNumbers(item, `${location}.${key}`);
    }
  }
}

function record(value: unknown, location: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationContractSchemaError(`${location} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, location: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationContractSchemaError(`${location} must be an array.`);
  }
  return value;
}

function text(value: unknown, location: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationContractSchemaError(`${location} must be non-empty text.`);
  }
  return value;
}
