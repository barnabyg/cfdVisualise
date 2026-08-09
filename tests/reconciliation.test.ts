import { describe, expect, it } from "vitest";

import {
  reconcileBackendManifests,
  runValidation,
  type SolverBackend,
  type ValidationCaseDefinition,
  type ValidationSuite,
  type ValidationManifest,
} from "../src/validation/index.js";

describe("cross-run reconciliation", () => {
  it("fails cases whose drag changes beyond the declared inclusive threshold", async () => {
    const baseline = steadyCase("re20-grid-32", 32);
    const comparison = steadyCase("re20-grid-48", 48);
    const suite: ValidationSuite = {
      schemaVersion: "1",
      id: "grid-reconciliation",
      metricVersions: { drag: "1" },
      cases: [baseline, comparison],
      reconciliations: [
        {
          schemaVersion: "1",
          id: "re20-grid",
          kind: "grid",
          baselineCaseId: baseline.id,
          comparisonCaseIds: [comparison.id],
          maximumRelativeChange: { meanDragCoefficient: 0.01 },
          requireSameRegime: true,
        },
      ],
    };
    const backend = steadyBackend(baseline.id, 2.03);

    const manifest = await runValidation(suite, backend);

    expect(manifest.status).toBe("fail");
    expect(manifest.reconciliations[0]).toMatchObject({
      id: "re20-grid",
      status: "fail",
    });
    expect(manifest.reconciliations[0]?.failures[0]).toContain("re20-grid-32");
    expect(manifest.reconciliations[0]?.failures[0]).toContain("re20-grid-48");
    expect(manifest.reconciliations[0]?.failures[0]).toContain("0.015");
    expect(manifest.reconciliations[0]?.failures[0]).toContain("0.01");
    expect(manifest.reconciliations[0]?.failures[0]).toContain(
      "Grid reconciliation re20-grid",
    );
    expect(manifest.reconciliations[0]?.comparisons[0]).toMatchObject({
      comparisonCaseId: "re20-grid-48",
      metrics: {
        meanDragCoefficient: {
          baseline: 2,
          comparison: 2.03,
          relativeChange: 0.015,
          maximumRelativeChange: 0.01,
          status: "fail",
        },
      },
      status: "fail",
    });

    const cpuManifest: ValidationManifest = {
      ...manifest,
      status: "pass",
      reconciliations: [],
    };
    const gpuManifest: ValidationManifest = {
      ...cpuManifest,
      backend: {
        ...cpuManifest.backend,
        id: "gpu-test",
        kind: "webgpu",
      },
      cases: cpuManifest.cases.map((result) => ({
        ...result,
        configuration: { ...result.configuration, backendId: "gpu-test" },
      })),
    };
    expect(
      reconcileBackendManifests(
        {
          id: "cpu-gpu-parity",
          caseIds: ["re20-grid-32"],
          maximumRelativeChange: { meanDragCoefficient: 0.01 },
        },
        cpuManifest,
        gpuManifest,
      ),
    ).toMatchObject({
      kind: "backend",
      status: "pass",
      comparisons: [
        {
          comparisonCaseId: "re20-grid-32",
          baselineBackendId: "cpu-test",
          comparisonBackendId: "gpu-test",
          baselineBackendKind: "cpu-worker",
          comparisonBackendKind: "webgpu",
          status: "pass",
        },
      ],
    });

    const mismatchedProtocol: ValidationManifest = {
      ...gpuManifest,
      cases: gpuManifest.cases.map((result, index) =>
        index === 0
          ? {
              ...result,
              definition: {
                ...result.definition,
                protocol: { ...result.definition.protocol, sampleInterval: 0.5 },
              },
            }
          : result,
      ),
    };
    expect(
      reconcileBackendManifests(
        {
          id: "cpu-gpu-parity",
          caseIds: ["re20-grid-32"],
          maximumRelativeChange: { meanDragCoefficient: 0.01 },
        },
        cpuManifest,
        mismatchedProtocol,
      ),
    ).toMatchObject({
      status: "fail",
      failures: [expect.stringContaining("identical scenario, protocol")],
    });

    const reorderedConfiguration: ValidationManifest = {
      ...gpuManifest,
      cases: gpuManifest.cases.map((result) => ({
        ...result,
        configuration: {
          collision: result.configuration.collision,
          cylinder: result.configuration.cylinder,
          domain: result.configuration.domain,
          boundaries: result.configuration.boundaries,
          precision: result.configuration.precision,
          qualityTier: result.configuration.qualityTier,
          backendId: result.configuration.backendId,
        },
      })),
    };
    expect(
      reconcileBackendManifests(
        {
          id: "cpu-gpu-parity",
          caseIds: ["re20-grid-32"],
          maximumRelativeChange: { meanDragCoefficient: 0.01 },
        },
        cpuManifest,
        reorderedConfiguration,
      ),
    ).toMatchObject({ status: "pass", failures: [] });
  });

  it("identifies cylinder placement as the cause of a failed comparison", async () => {
    const centred = steadyCase("re20-centred", 32);
    const shifted: ValidationCaseDefinition = {
      ...steadyCase("re20-shifted", 32),
      configuration: {
        ...centred.configuration,
        cylinder: {
          ...centred.configuration.cylinder,
          offsetX: 0.5,
        },
      },
    };
    const suite: ValidationSuite = {
      schemaVersion: "1",
      id: "placement-reconciliation",
      metricVersions: { drag: "1" },
      cases: [centred, shifted],
      reconciliations: [
        {
          schemaVersion: "1",
          id: "re20-placement",
          kind: "cylinder-placement",
          baselineCaseId: centred.id,
          comparisonCaseIds: [shifted.id],
          maximumRelativeChange: { meanDragCoefficient: 0.01 },
          requireSameRegime: true,
        },
      ],
    };
    const backend = steadyBackend(centred.id, 2.03);

    const manifest = await runValidation(suite, backend);

    expect(manifest.reconciliations[0]?.failures).toEqual([
      expect.stringContaining(
        "Cylinder-placement reconciliation re20-placement",
      ),
    ]);
  });

  it("reports measured and allowed metric deltas when an input case fails", async () => {
    const baseline = steadyCase("re20-baseline", 32);
    const comparison = steadyCase("re20-comparison", 48);
    const manifest = await runValidation(
      reconciliationSuite(baseline, comparison, {
        meanDragCoefficient: 0.01,
      }),
      steadyBackend(baseline.id, 2.5),
    );

    expect(manifest.reconciliations[0]?.failures).toEqual([
      expect.stringContaining("meanDragCoefficient measured delta 0.25"),
    ]);
    expect(manifest.reconciliations[0]?.failures[0]).toContain(
      "allowed delta 0.01",
    );
  });

  it("reports an unavailable measured delta with its declared metric gate", async () => {
    const baseline = steadyCase("re20-baseline", 32);
    const comparison = steadyCase("re20-comparison", 48);
    const manifest = await runValidation(
      reconciliationSuite(baseline, comparison, {
        recirculationLength: 0.02,
      }),
      steadyBackend(baseline.id, 2),
    );

    expect(manifest.reconciliations[0]?.failures).toEqual([
      "Grid reconciliation re20-test: recirculationLength measured delta unavailable between re20-baseline and re20-comparison; allowed delta 0.02.",
    ]);
  });

  it("reports the intended configuration pair when the baseline is missing", async () => {
    const baseline = steadyCase("re20-baseline", 32);
    const comparison = steadyCase("re20-comparison", 48);
    const suite = reconciliationSuite(baseline, comparison, {
      meanDragCoefficient: 0.01,
    });
    const manifest = await runValidation(
      { ...suite, cases: [comparison] },
      steadyBackend(baseline.id, 2),
    );

    expect(manifest.reconciliations[0]?.failures).toEqual([
      expect.stringContaining(
        "configuration pair re20-baseline and re20-comparison",
      ),
    ]);
  });
});

function reconciliationSuite(
  baseline: ValidationCaseDefinition,
  comparison: ValidationCaseDefinition,
  maximumRelativeChange: ValidationSuite["reconciliations"][number]["maximumRelativeChange"],
): ValidationSuite {
  return {
    schemaVersion: "1",
    id: "reconciliation-test",
    metricVersions: { drag: "1", recirculationLength: "1" },
    cases: [baseline, comparison],
    reconciliations: [
      {
        schemaVersion: "1",
        id: "re20-test",
        kind: "grid",
        baselineCaseId: baseline.id,
        comparisonCaseIds: [comparison.id],
        maximumRelativeChange,
        requireSameRegime: true,
      },
    ],
  };
}

function steadyBackend(
  baselineCaseId: string,
  comparisonDrag: number,
): SolverBackend {
  return {
    schemaVersion: "1",
    identity: {
      schemaVersion: "1",
      id: "cpu-test",
      kind: "cpu-worker",
      solver: "test TRT/BFL",
      solverVersion: "1.0.0",
      buildId: "test-build",
    },
    async *runCase(definition) {
      const drag = definition.id === baselineCaseId ? 2 : comparisonDrag;
      for (let step = 0; step <= 2; step += 1) {
        yield {
          step,
          flowThroughTime: step,
          domainMass: 100,
          inletFlux: 1,
          outletFlux: 1,
          density: { minimum: 0.99, maximum: 1.01, mean: 1 },
          upstreamReflection: 0,
          fieldResidual: 0.0001,
          symmetryError: 0.0001,
          dragCoefficient: drag,
          liftCoefficient: 0,
        };
      }
    },
  };
}

function steadyCase(id: string, cellsPerDiameter: number): ValidationCaseDefinition {
  return {
    schemaVersion: "1",
    id,
    reynoldsNumber: 20,
    physicalScenario: {
      flowSpeedMetersPerSecond: 0.002,
      cylinderDiameterMeters: 0.01,
      kinematicViscositySquareMetersPerSecond: 0.000001,
    },
    expectedRegimes: ["steady"],
    configuration: {
      backendId: "cpu-test",
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
      cylinder: { cellsPerDiameter, offsetX: 0, offsetY: 0 },
    },
    protocol: {
      warmUpFlowThroughTime: 1,
      sampleFlowThroughTime: 1,
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
    expectations: [
      {
        metric: "meanDragCoefficient",
        range: { minimum: 1.9, maximum: 2.1 },
        tolerance: 0,
        sources: [
          {
            id: "worked-reference",
            url: "https://example.test/reference",
            convention: "time mean after warm-up",
          },
        ],
      },
    ],
  };
}
