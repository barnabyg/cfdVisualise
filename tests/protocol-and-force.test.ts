import { describe, expect, it } from "vitest";

import {
  runValidation,
  type FlowRegime,
  type SolverBackend,
  type ValidationCaseDefinition,
  type ValidationSuite,
} from "../src/validation/index.js";

describe("validation protocol and steady force evidence", () => {
  it("does not label an oscillating-force field steady from residual and symmetry alone", async () => {
    const backend = backendWithSamples(
      [0, 1, 2, 3, 4].map((flowThroughTime) =>
        sample(flowThroughTime, flowThroughTime % 2 === 0 ? 0.1 : -0.1),
      ),
    );

    const manifest = await runValidation(suiteFor("unclassified"), backend);

    expect(manifest.cases[0]).toMatchObject({ status: "pass", regime: "unclassified" });
  });

  it("stops when backend diagnostics do not follow the declared sample interval", async () => {
    const manifest = await runValidation(
      suiteFor("steady"),
      backendWithSamples([sample(0, 0), sample(1.5, 0)]),
    );

    expect(manifest.cases[0]).toMatchObject({
      status: "fail",
      regime: "unavailable",
      achieved: { flowThroughTime: 0, steps: 0 },
    });
    expect(manifest.cases[0]?.failures[0]).toContain("declared interval 1");
  });
});

function suiteFor(expectedRegime: FlowRegime): ValidationSuite {
  return {
    schemaVersion: "1",
    id: "protocol-and-force",
    metricVersions: { forceStability: "1" },
    cases: [caseDefinition(expectedRegime)],
    reconciliations: [],
  };
}

function caseDefinition(expectedRegime: FlowRegime): ValidationCaseDefinition {
  return {
    id: "steady-force-check",
    reynoldsNumber: 20,
    physicalScenario: {
      flowSpeedMetersPerSecond: 0.002,
      cylinderDiameterMeters: 0.01,
      kinematicViscositySquareMetersPerSecond: 0.000001,
    },
    expectedRegimes: [expectedRegime],
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
      cylinder: { cellsPerDiameter: 32, offsetX: 0, offsetY: 0 },
    },
    protocol: {
      warmUpFlowThroughTime: 2,
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
  };
}

function backendWithSamples(samples: readonly ReturnType<typeof sample>[]): SolverBackend {
  return {
    identity: {
      id: "cpu-test",
      kind: "cpu-worker",
      solver: "test TRT/BFL",
      solverVersion: "1.0.0",
      buildId: "test-build",
    },
    async *runCase() {
      yield* samples;
    },
  };
}

function sample(flowThroughTime: number, liftCoefficient: number) {
  return {
    step: flowThroughTime,
    flowThroughTime,
    domainMass: 100,
    inletFlux: 1,
    outletFlux: 1,
    density: { minimum: 0.99, maximum: 1.01, mean: 1 },
    upstreamReflection: 0,
    fieldResidual: 0.0001,
    symmetryError: 0.0001,
    dragCoefficient: 2.1,
    liftCoefficient,
  };
}
