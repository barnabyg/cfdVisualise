import type { SchemaPrimitives } from "./schema-primitives.js";

type SchemaErrorFactory = (message: string) => Error;

export function createValidationStructureValidators(
  primitives: SchemaPrimitives,
  createError: SchemaErrorFactory,
) {
  const { finite, nonNegative, oneOf, positive, record, text } = primitives;

  function validateNumericalConfiguration(value: unknown, location: string): void {
    const configuration = record(value, location);
    text(configuration.backendId, `${location} backend id`);
    text(configuration.qualityTier, `${location} quality tier`);
    oneOf(configuration.precision, ["float32", "float64", "mixed"], `${location} precision`);
    if (configuration.latticeSpeed !== undefined) {
      const latticeSpeed = positive(configuration.latticeSpeed, `${location} lattice speed`);
      if (latticeSpeed >= 1 / Math.sqrt(3)) {
        throw createError(`${location} lattice speed must remain below the D2Q9 sound speed.`);
      }
    }
    if (configuration.initialTransversePerturbation !== undefined) {
      nonNegative(
        configuration.initialTransversePerturbation,
        `${location} initial transverse perturbation`,
      );
    }
    if (configuration.upstreamReflectionMode !== undefined) {
      oneOf(
        configuration.upstreamReflectionMode,
        ["velocity-vector-about-mean", "streamwise-from-inlet"],
        `${location} upstream reflection mode`,
      );
    }
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

  function validateClassificationThresholds(value: unknown, location: string): void {
    const classification = record(value, `${location} classification thresholds`);
    const nonNegativeThresholds = [
      ["maximumSteadyFieldResidual", "steady field residual"],
      ["maximumSteadySymmetryError", "steady symmetry error"],
      ["maximumSteadyLiftRms", "steady lift RMS"],
      ["maximumSteadyDragRelativeVariation", "steady drag variation"],
      ["maximumPeriodicFrequencyVariation", "periodic frequency variation"],
      ["maximumPeriodicAmplitudeVariation", "periodic amplitude variation"],
    ] as const;
    for (const [field, label] of nonNegativeThresholds) {
      primitives.nonNegative(classification[field], `${location} ${label}`);
    }
    positive(classification.minimumPeriodicCycles, `${location} periodic cycles`);
    if (classification.minimumPeriodicAmplitude !== undefined) {
      positive(classification.minimumPeriodicAmplitude, `${location} periodic amplitude`);
    }
  }

  function validateRange(value: unknown, location: string): void {
    const range = record(value, location);
    const minimum = finite(range.minimum, `${location} minimum`);
    const maximum = finite(range.maximum, `${location} maximum`);
    if (minimum > maximum) {
      throw createError(`${location} is inverted.`);
    }
  }

  return {
    validateClassificationThresholds,
    validateNumericalConfiguration,
    validateRange,
  };
}
