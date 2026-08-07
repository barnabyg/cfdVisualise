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
    const backend: SolverBackend = {
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
        const drag = definition.id === baseline.id ? 2 : 2.03;
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
  });
});

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
