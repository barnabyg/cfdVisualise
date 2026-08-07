import { describe, expect, it } from "vitest";

import {
  runValidation,
  type SolverBackend,
  type ValidationSuite,
} from "../src/validation/index.js";

describe("numerical health", () => {
  it("stops unavailable cases at the last valid frame when a diagnostic becomes non-finite", async () => {
    const suite: ValidationSuite = {
      schemaVersion: "1",
      id: "negative-health",
      metricVersions: { densityHealth: "1" },
      cases: [
        {
          schemaVersion: "1",
          id: "corrupted-density",
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
            domain: {
              upstreamDiameters: 8,
              downstreamDiameters: 24,
              lateralDiameters: 8,
            },
            cylinder: { cellsPerDiameter: 32, offsetX: 0, offsetY: 0 },
          },
          protocol: {
            warmUpFlowThroughTime: 1,
            sampleFlowThroughTime: 2,
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
          expectations: [],
        },
      ],
      reconciliations: [],
    };
    const backend: SolverBackend = {
      identity: {
        schemaVersion: "1",
        id: "cpu-test",
        kind: "cpu-worker",
        solver: "test TRT/BFL",
        solverVersion: "1.0.0",
        buildId: "test-build",
      },
      async *runCase() {
        yield healthySample(0);
        yield healthySample(1);
        yield { ...healthySample(2), domainMass: Number.NaN };
        yield healthySample(3);
      },
    };

    const manifest = await runValidation(suite, backend);

    expect(manifest.cases[0]).toMatchObject({
      status: "fail",
      availability: "unavailable",
      achieved: { steps: 1, flowThroughTime: 1 },
    });
    expect(manifest.cases[0]).not.toHaveProperty("regime");
    expect(manifest.cases[0]?.failures).toEqual([
      expect.stringContaining("corrupted-density"),
    ]);
    expect(manifest.cases[0]?.failures[0]).toContain("non-finite");
  });
});

function healthySample(step: number) {
  return {
    step,
    flowThroughTime: step,
    domainMass: 100,
    inletFlux: 1,
    outletFlux: 1,
    density: { minimum: 0.99, maximum: 1.01, mean: 1 },
    upstreamReflection: 0,
    fieldResidual: 0.0001,
    symmetryError: 0.0001,
    dragCoefficient: 2.1,
    liftCoefficient: 0,
  };
}
