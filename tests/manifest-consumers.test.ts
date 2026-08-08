import { describe, expect, it } from "vitest";

import {
  createMethodAndValidationModel,
  evaluateReleaseGate,
  type ValidationManifest,
} from "../src/validation/index.js";

describe("validation manifest consumers", () => {
  it("shows the exact passing backend, tier, solver, suite, and source evidence", () => {
    const model = createMethodAndValidationModel(validManifest(), {
      backendId: "cpu-reference",
      qualityTier: "reference",
      buildId: "build-1",
    });

    expect(model).toMatchObject({
      status: "validated",
      suiteId: "reference-v1",
      backendId: "cpu-reference",
      qualityTier: "reference",
      solver: "D2Q9 TRT/BFL",
      buildId: "build-1",
    });
    expect(model.status === "validated" ? model.sources : []).toEqual([
      {
        id: "published-reference",
        url: "https://example.test/reference",
        convention: "time mean after warm-up",
      },
    ]);
  });

  it("shows mismatched evidence as unavailable", () => {
    expect(
      createMethodAndValidationModel(validManifest(), {
        backendId: "webgpu-tier",
        qualityTier: "fast",
        buildId: "build-1",
      }),
    ).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("does not match"),
    });
  });

  it("distinguishes missing, failing, and incompatible evidence", () => {
    const active = {
      backendId: "cpu-reference",
      qualityTier: "reference",
      buildId: "build-1",
    };
    const valid = validManifest();
    const failed = {
      ...valid,
      status: "fail" as const,
      cases: [
        {
          ...valid.cases[0]!,
          status: "fail" as const,
          failures: ["Case re5: drag measured 4; expected [1, 3] with tolerance 0."],
        },
        ...valid.cases.slice(1),
      ],
    };

    expect(createMethodAndValidationModel(undefined, active)).toMatchObject({
      evidenceState: "missing",
    });
    expect(createMethodAndValidationModel(failed, active)).toMatchObject({
      evidenceState: "failing",
      reason: expect.stringContaining("Case re5"),
    });
    expect(createMethodAndValidationModel({ ...valid, schemaVersion: "2" }, active)).toMatchObject({
      evidenceState: "incompatible",
    });
  });

  it("shows a passing synthetic manifest while keeping release completeness separate", () => {
    const complete = validManifest();
    const partial = { ...complete, cases: [complete.cases[0]], reconciliations: [] };
    const active = {
      backendId: "cpu-reference",
      qualityTier: "reference",
      buildId: "build-1",
    };

    expect(createMethodAndValidationModel(partial, active)).toMatchObject({
      status: "validated",
      evidenceState: "passing",
    });
    expect(
      evaluateReleaseGate({
        manifest: partial,
        active,
        guideDurationSeconds: 80,
        maximumGuideDurationSeconds: 90,
      }),
    ).toMatchObject({
      status: "fail",
      validation: { status: "fail", reason: expect.stringContaining("Re=20") },
    });
  });

  it("reports scientific validation and guide performance as separate release gates", () => {
    const result = evaluateReleaseGate({
      manifest: validManifest(),
      active: {
        backendId: "cpu-reference",
        qualityTier: "reference",
        buildId: "build-1",
      },
      guideDurationSeconds: 95,
      maximumGuideDurationSeconds: 90,
    });

    expect(result).toEqual({
      status: "fail",
      validation: { status: "pass" },
      performance: {
        status: "fail",
        guideDurationSeconds: 95,
        maximumGuideDurationSeconds: 90,
      },
    });
  });
});

function validManifest(): ValidationManifest {
  return {
    schemaVersion: "1",
    suite: {
      id: "reference-v1",
      schemaVersion: "1",
      metricVersions: { drag: "1" },
    },
    backend: {
      schemaVersion: "1",
      id: "cpu-reference",
      kind: "cpu-worker",
      solver: "D2Q9 TRT/BFL",
      solverVersion: "1.0.0",
      buildId: "build-1",
    },
    status: "pass",
    cases: [
      ...[5, 20, 40, 45, 50, 100, 150].map(referenceCase),
      sensitivityCase("re20-grid48", 20, { cellsPerDiameter: 48 }),
      sensitivityCase("re20-grid64", 20, { cellsPerDiameter: 64 }),
      sensitivityCase("re20-shift", 20, { offsetX: 0.5 }),
      sensitivityCase("re20-domain-upstream", 20, { upstreamDiameters: 10 }),
      sensitivityCase("re20-domain-downstream", 20, { downstreamDiameters: 32 }),
      sensitivityCase("re20-domain-lateral", 20, { lateralDiameters: 10 }),
      sensitivityCase("re5-boundary", 5, { inlet: "equilibrium-velocity" }),
      sensitivityCase("re45-boundary", 45, { lateral: "periodic" }),
      sensitivityCase("re100-boundary", 100, { outlet: "convective" }),
    ],
    reconciliations: ["grid", "domain", "cylinder-placement", "boundary", "backend"].flatMap(
      reconciliationEvidence,
    ),
  };
}

function referenceCase(reynoldsNumber: number): ValidationManifest["cases"][number] {
  const regime = reynoldsNumber >= 50 ? "periodically-shedding" : "steady";
  const metrics: Record<string, ValidationManifest["cases"][number]["metrics"][string]> = {
    meanDragCoefficient: metricEvidence(2.1),
    ...(regime === "steady"
      ? { recirculationLength: metricEvidence(1.2) }
      : { liftRms: metricEvidence(0.2), strouhalNumber: metricEvidence(0.2) }),
  };
  return {
    schemaVersion: "1",
    caseId: `re${reynoldsNumber}`,
    reynoldsNumber,
    configuration: {
      backendId: "cpu-reference",
      qualityTier: "reference",
      precision: "float64",
      collision: "D2Q9 TRT",
      boundaries: {
        inlet: "regularized-velocity",
        lateral: "free-slip",
        outlet: "fixed-density-nee",
        cylinder: "linear-bfl",
      },
      domain: { upstreamDiameters: 8, downstreamDiameters: 24, lateralDiameters: 8 },
      cylinder: { cellsPerDiameter: 32, offsetX: 0, offsetY: 0 },
    },
    definition: manifestDefinition(reynoldsNumber, regime),
    status: "pass",
    availability: "available",
    regime,
    achieved: {
      steps: 100,
      flowThroughTime: 10,
      warmUpFlowThroughTime: 5,
      sampleFlowThroughTime: 5,
    },
    metrics,
    failures: [],
  };
}

function manifestDefinition(reynoldsNumber: number, regime: "steady" | "periodically-shedding") {
  const cylinderDiameterMeters = reynoldsNumber === 5 ? 0.005 : 0.01;
  return {
    schemaVersion: "1" as const,
    physicalScenario: {
      flowSpeedMetersPerSecond:
        (reynoldsNumber * 0.000001) / cylinderDiameterMeters,
      cylinderDiameterMeters,
      kinematicViscositySquareMetersPerSecond: 0.000001,
    },
    expectedRegimes: [regime],
    protocol: {
      warmUpFlowThroughTime: 5,
      sampleFlowThroughTime: 5,
      sampleInterval: 1,
    },
    health: {
      targetDensity: 1,
      densityRange: { minimum: 0.9, maximum: 1.1 },
      maximumMeanDensityDrift: 0.01,
      maximumFluxResidual: 0.01,
      maximumUpstreamReflection: 0.01,
    },
    classification: {
      maximumSteadyFieldResidual: 0.001,
      maximumSteadySymmetryError: 0.001,
      maximumSteadyLiftRms: 0.001,
      maximumSteadyDragRelativeVariation: 0.01,
      minimumPeriodicCycles: 4,
      maximumPeriodicFrequencyVariation: 0.02,
      maximumPeriodicAmplitudeVariation: 0.05,
    },
  };
}

function sensitivityCase(
  caseId: string,
  reynoldsNumber: number,
  change: {
    readonly cellsPerDiameter?: number;
    readonly offsetX?: number;
    readonly upstreamDiameters?: number;
    readonly downstreamDiameters?: number;
    readonly lateralDiameters?: number;
    readonly inlet?: "equilibrium-velocity";
    readonly lateral?: "periodic";
    readonly outlet?: "convective";
  },
): ValidationManifest["cases"][number] {
  const baseline = referenceCase(reynoldsNumber);
  return {
    ...baseline,
    caseId,
    configuration: {
      ...baseline.configuration,
      qualityTier: `sensitivity-${caseId}`,
      domain: {
        ...baseline.configuration.domain,
        upstreamDiameters:
          change.upstreamDiameters ?? baseline.configuration.domain.upstreamDiameters,
        downstreamDiameters:
          change.downstreamDiameters ?? baseline.configuration.domain.downstreamDiameters,
        lateralDiameters:
          change.lateralDiameters ?? baseline.configuration.domain.lateralDiameters,
      },
      cylinder: {
        ...baseline.configuration.cylinder,
        cellsPerDiameter:
          change.cellsPerDiameter ?? baseline.configuration.cylinder.cellsPerDiameter,
        offsetX: change.offsetX ?? baseline.configuration.cylinder.offsetX,
      },
      boundaries: {
        ...baseline.configuration.boundaries,
        inlet: change.inlet ?? baseline.configuration.boundaries.inlet,
        lateral: change.lateral ?? baseline.configuration.boundaries.lateral,
        outlet: change.outlet ?? baseline.configuration.boundaries.outlet,
      },
    },
  };
}

function metricEvidence(measured: number) {
  return {
    schemaVersion: "1" as const,
    applicability: "applicable" as const,
    measured,
    expected: { minimum: 0, maximum: 3 },
    tolerance: 0,
    sources: [
      {
        id: "published-reference",
        url: "https://example.test/reference",
        convention: "time mean after warm-up",
      },
    ],
    status: "pass" as const,
  };
}

function reconciliationEvidence(
  kind: string,
): readonly ValidationManifest["reconciliations"][number][] {
  const comparisonIds: Record<string, readonly string[]> = {
    grid: ["re20-grid48", "re20-grid64"],
    domain: ["re20-domain-upstream", "re20-domain-downstream", "re20-domain-lateral"],
    "cylinder-placement": ["re20-shift"],
    backend: ["re20"],
  };
  const cohorts =
    kind === "boundary"
      ? [
          { baselineCaseId: "re5", comparisonIds: ["re5-boundary"] },
          { baselineCaseId: "re45", comparisonIds: ["re45-boundary"] },
          { baselineCaseId: "re100", comparisonIds: ["re100-boundary"] },
        ]
      : [{ baselineCaseId: "re20", comparisonIds: comparisonIds[kind] ?? [] }];
  return cohorts.map(({ baselineCaseId, comparisonIds }, cohortIndex) => {
    const periodic = baselineCaseId === "re100";
    const metrics = {
      meanDragCoefficient: comparisonMetric(0.01),
      ...(periodic
        ? { strouhalNumber: comparisonMetric(0.01) }
        : { recirculationLength: comparisonMetric(0.02) }),
    };
    return {
      schemaVersion: "1",
      id: `${kind}-evidence-${cohortIndex}`,
      kind: kind as ValidationManifest["reconciliations"][number]["kind"],
      baselineCaseId,
      comparisons: comparisonIds.map((comparisonCaseId) => ({
        comparisonCaseId,
      ...(kind === "backend"
        ? {
            baselineBackendId: "cpu-reference",
            comparisonBackendId: "webgpu-reference",
            baselineBackendKind: "cpu-worker" as const,
            comparisonBackendKind: "webgpu" as const,
          }
        : {}),
        baselineRegime: periodic ? "periodically-shedding" : "steady",
        comparisonRegime: periodic ? "periodically-shedding" : "steady",
        metrics,
        status: "pass",
      })),
      status: "pass",
      failures: [],
    };
  });
}

function comparisonMetric(maximumRelativeChange: number) {
  return {
    baseline: 1,
    comparison: 1,
    relativeChange: 0,
    maximumRelativeChange,
    status: "pass" as const,
  };
}
