import { describe, expect, it } from "vitest";

import {
  runValidation,
  type SolverBackend,
  type ValidationCaseDefinition,
  type ValidationSuite,
} from "../src/validation/index.js";

describe("periodic regime evidence", () => {
  it("measures Strouhal only after a stable multi-cycle lift signal", async () => {
    const definition: ValidationCaseDefinition = {
      schemaVersion: "1",
      id: "re100-periodic",
      reynoldsNumber: 100,
      physicalScenario: {
        flowSpeedMetersPerSecond: 0.01,
        cylinderDiameterMeters: 0.01,
        kinematicViscositySquareMetersPerSecond: 0.000001,
      },
      expectedRegimes: ["periodically-shedding"],
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
        sampleFlowThroughTime: 20,
        sampleInterval: 0.25,
        minimumStableCycles: 4,
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
          metric: "strouhalNumber",
          range: { minimum: 0.19, maximum: 0.21 },
          tolerance: 0,
          sources: [
            {
              id: "analytic-signal",
              url: "https://example.test/analytic-signal",
              convention: "f D / U from a stable lift signal",
            },
          ],
        },
      ],
    };
    const suite: ValidationSuite = {
      schemaVersion: "1",
      id: "periodic-suite",
      metricVersions: { liftPeriodicity: "1", strouhal: "1" },
      cases: [definition],
      reconciliations: [],
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
      async *runCase() {
        for (let index = 0; index <= 84; index += 1) {
          const flowThroughTime = index * 0.25;
          yield {
            step: index,
            flowThroughTime,
            domainMass: 100,
            inletFlux: 1,
            outletFlux: 1,
            density: { minimum: 0.99, maximum: 1.01, mean: 1 },
            upstreamReflection: 0,
            fieldResidual: 0.01,
            symmetryError: 0.05,
            dragCoefficient: 1.35,
            liftCoefficient: 0.3 * Math.sin(2 * Math.PI * 0.2 * flowThroughTime),
          };
        }
      },
    };

    const manifest = await runValidation(suite, backend);

    expect(manifest.cases[0]).toMatchObject({
      status: "pass",
      regime: "periodically-shedding",
    });
    expect(manifest.cases[0]?.metrics.strouhalNumber).toMatchObject({
      applicability: "applicable",
      measured: 0.2,
      status: "pass",
    });
  });
});
