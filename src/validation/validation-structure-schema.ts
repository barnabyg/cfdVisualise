import type { SchemaPrimitives } from "./schema-primitives.js";

type SchemaErrorFactory = (message: string) => Error;

export function createValidationStructureValidators(
  primitives: SchemaPrimitives,
  createError: SchemaErrorFactory,
) {
  const { array, finite, nonNegative, oneOf, positive, record, text } = primitives;

  function validateEvidenceScope(value: unknown, location: string): void {
    const scope = record(value, location);
    const domain = record(scope.selectedProductionDomain, `${location} production domain`);
    positive(domain.upstreamDiameters, `${location} upstream extent`);
    positive(domain.downstreamDiameters, `${location} downstream extent`);
    positive(domain.lateralDiameters, `${location} lateral extent`);

    const boundaries = record(
      scope.selectedProductionBoundaries,
      `${location} production boundaries`,
    );
    oneOf(boundaries.inlet, ["regularized-velocity"], `${location} production inlet boundary`);
    oneOf(boundaries.lateral, ["free-slip"], `${location} production lateral boundary`);
    oneOf(boundaries.outlet, ["fixed-density-nee"], `${location} production outlet boundary`);
    oneOf(boundaries.cylinder, ["linear-bfl"], `${location} production cylinder boundary`);

    const benchmarkRoles = array(scope.benchmarkRoles, `${location} benchmark roles`);
    if (benchmarkRoles.length === 0) {
      throw createError(`${location} needs at least one benchmark role.`);
    }
    const declaredRoles = new Map<string, unknown>();
    benchmarkRoles.forEach((value, index) => {
      const benchmark = record(value, `${location} benchmark ${index}`);
      const id = text(benchmark.id, `${location} benchmark ${index} id`);
      if (declaredRoles.has(id)) {
        throw createError(`${location} benchmark ${id} must be declared exactly once.`);
      }
      declaredRoles.set(id, benchmark.role);
    });
    if (declaredRoles.get("open-cylinder-wake") !== "product-validation") {
      throw createError(`${location} open-cylinder-wake benchmark must be product-validation.`);
    }
    if (declaredRoles.get("confined-channel") !== "solver-regression") {
      throw createError(`${location} confined-channel benchmark must be solver-regression.`);
    }
    if (declaredRoles.size !== 2) {
      throw createError(`${location} may only declare the accepted open-cylinder and confined-channel benchmarks.`);
    }
  }

  function validateSamplingProtocol(
    value: unknown,
    location: string,
    targetReynoldsNumber: number,
  ): void {
    const protocol = record(value, `${location} protocol`);
    const warmUpFlowThroughTime = nonNegative(
      protocol.warmUpFlowThroughTime,
      `${location} warm-up window`,
    );
    positive(protocol.sampleFlowThroughTime, `${location} sample window`);
    const sampleInterval = positive(protocol.sampleInterval, `${location} sample interval`);
    if (protocol.minimumStableCycles !== undefined) {
      positive(protocol.minimumStableCycles, `${location} minimum stable cycles`);
    }
    if (protocol.reynoldsChange === undefined) {
      return;
    }

    const change = record(protocol.reynoldsChange, `${location} Reynolds change`);
    const initialReynoldsNumber = positive(
      change.initialReynoldsNumber,
      `${location} initial Reynolds number`,
    );
    const atFlowThroughTime = positive(
      change.atFlowThroughTime,
      `${location} Reynolds-change time`,
    );
    const rampFlowThroughTime = positive(
      change.rampFlowThroughTime,
      `${location} Reynolds-change ramp window`,
    );
    const observationFlowThroughTime = positive(
      change.observationFlowThroughTime,
      `${location} Reynolds-change observation window`,
    );
    if (initialReynoldsNumber === targetReynoldsNumber) {
      throw createError(`${location} Reynolds change must change the Reynolds number.`);
    }
    if (
      atFlowThroughTime + rampFlowThroughTime + observationFlowThroughTime >
      warmUpFlowThroughTime
    ) {
      throw createError(
        `${location} Reynolds-change ramp and observation must finish during warm-up.`,
      );
    }
    for (const [label, duration] of [
      ["change time", atFlowThroughTime],
      ["ramp window", rampFlowThroughTime],
      ["observation window", observationFlowThroughTime],
    ] as const) {
      if (Math.abs(duration / sampleInterval - Math.round(duration / sampleInterval)) > 1e-9) {
        throw createError(`${location} Reynolds ${label} must align with the sample interval.`);
      }
    }
  }

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
    validateEvidenceScope,
    validateNumericalConfiguration,
    validateRange,
    validateSamplingProtocol,
  };
}
