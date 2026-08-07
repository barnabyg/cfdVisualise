import type { SchemaPrimitives } from "./schema-primitives.js";

type SchemaErrorFactory = (message: string) => Error;

export function createValidationStructureValidators(
  primitives: SchemaPrimitives,
  createError: SchemaErrorFactory,
) {
  const { finite, oneOf, positive, record, text } = primitives;

  function validateNumericalConfiguration(value: unknown, location: string): void {
    const configuration = record(value, location);
    text(configuration.backendId, `${location} backend id`);
    text(configuration.qualityTier, `${location} quality tier`);
    oneOf(configuration.precision, ["float32", "float64", "mixed"], `${location} precision`);
    oneOf(configuration.collision, ["D2Q9 TRT"], `${location} collision`);

    const boundaries = record(configuration.boundaries, `${location} boundaries`);
    oneOf(
      boundaries.inlet,
      ["regularized-velocity", "equilibrium-velocity"],
      `${location} inlet boundary`,
    );
    oneOf(
      boundaries.lateral,
      ["free-slip", "periodic", "no-slip"],
      `${location} lateral boundary`,
    );
    oneOf(
      boundaries.outlet,
      ["fixed-density-nee", "convective", "extrapolated"],
      `${location} outlet boundary`,
    );
    oneOf(boundaries.cylinder, ["linear-bfl"], `${location} cylinder boundary`);

    const domain = record(configuration.domain, `${location} domain`);
    positive(domain.upstreamDiameters, `${location} upstream extent`);
    positive(domain.downstreamDiameters, `${location} downstream extent`);
    positive(domain.lateralDiameters, `${location} lateral extent`);

    const cylinder = record(configuration.cylinder, `${location} cylinder`);
    positive(cylinder.cellsPerDiameter, `${location} cylinder resolution`);
    finite(cylinder.offsetX, `${location} cylinder x offset`);
    finite(cylinder.offsetY, `${location} cylinder y offset`);
  }

  function validateRange(value: unknown, location: string): void {
    const range = record(value, location);
    const minimum = finite(range.minimum, `${location} minimum`);
    const maximum = finite(range.maximum, `${location} maximum`);
    if (minimum > maximum) {
      throw createError(`${location} is inverted.`);
    }
  }

  return { validateNumericalConfiguration, validateRange };
}
