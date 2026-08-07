import { VALIDATION_SCHEMA_VERSION } from "./types.js";

type SchemaErrorFactory = (message: string) => Error;

export function createSchemaPrimitives(createError: SchemaErrorFactory) {
  function record(value: unknown, location: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw createError(`${location} must be an object.`);
    }
    return value as Record<string, unknown>;
  }

  function array(value: unknown, location: string): unknown[] {
    if (!Array.isArray(value)) {
      throw createError(`${location} must be an array.`);
    }
    return value;
  }

  function text(value: unknown, location: string): string {
    if (typeof value !== "string" || value.length === 0) {
      throw createError(`${location} must be non-empty text.`);
    }
    return value;
  }

  function finite(value: unknown, location: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw createError(`${location} must be a finite number.`);
    }
    return value;
  }

  function positive(value: unknown, location: string): number {
    const result = finite(value, location);
    if (result <= 0) {
      throw createError(`${location} must be positive.`);
    }
    return result;
  }

  function nonNegative(value: unknown, location: string): number {
    const result = finite(value, location);
    if (result < 0) {
      throw createError(`${location} must be non-negative.`);
    }
    return result;
  }

  function oneOf(value: unknown, choices: readonly string[], location: string): void {
    if (typeof value !== "string" || !choices.includes(value)) {
      throw createError(`${location} must be one of ${choices.join(", ")}.`);
    }
  }

  function schemaVersion(value: unknown, location: string): void {
    if (value !== VALIDATION_SCHEMA_VERSION) {
      throw createError(
        `${location} schema version must be ${VALIDATION_SCHEMA_VERSION}.`,
      );
    }
  }

  function versionedRecord(value: unknown, location: string): Record<string, unknown> {
    const result = record(value, location);
    schemaVersion(result.schemaVersion, location);
    return result;
  }

  return {
    array,
    finite,
    nonNegative,
    oneOf,
    positive,
    record,
    schemaVersion,
    text,
    versionedRecord,
  };
}

export function relativeDifference(left: number, right: number): number {
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), Number.EPSILON);
}
