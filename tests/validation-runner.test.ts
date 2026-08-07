import { describe, expect, it } from "vitest";

import {
  parseValidationManifest,
  runValidation,
  type SolverBackend,
  type ValidationSuite,
} from "../src/validation/index.js";

describe("validation runner", () => {
  it("emits deterministic passing evidence for a declared steady case", async () => {
    const suite = validationSuite();
    const backend = syntheticBackend();

    const first = await runValidation(suite, backend);
    const second = await runValidation(suite, backend);

    expect(first).toEqual(second);
    expect(parseValidationManifest(first)).toEqual(first);
    expect(first.status).toBe("pass");
    expect(first.cases[0]).toMatchObject({
      caseId: "re20-steady",
      status: "pass",
      regime: "steady",
      achieved: { steps: 4, flowThroughTime: 4 },
    });
    expect(first.cases[0]?.metrics.meanDragCoefficient).toMatchObject({
      applicability: "applicable",
      measured: 2.1,
      status: "pass",
    });
    expect(first.cases[0]?.metrics.strouhalNumber).toEqual({
      schemaVersion: "1",
      applicability: "inapplicable",
      status: "not-assessed",
      message: "Strouhal number is inapplicable without a stable periodic lift signal.",
    });
  });

  it("rejects incompatible or non-finite contracts before executing a backend", async () => {
    const suite = validationSuite();
    const backend = syntheticBackend();
    let executions = 0;
    const guardedBackend: SolverBackend = {
      ...backend,
      async *runCase(definition) {
        executions += 1;
        yield* backend.runCase(definition);
      },
    };

    await expect(
      runValidation(
        {
          ...suite,
          cases: [{ ...suite.cases[0]!, schemaVersion: "2" }],
        } as unknown as ValidationSuite,
        guardedBackend,
      ),
    ).rejects.toThrow("case schema version");
    await expect(
      runValidation(
        {
          ...suite,
          cases: [{ ...suite.cases[0]!, reynoldsNumber: Number.NaN }],
        },
        guardedBackend,
      ),
    ).rejects.toThrow("finite number");
    expect(executions).toBe(0);
  });

  it("emits actionable evidence for a synthetic scientific failure", async () => {
    const manifest = await runValidation(validationSuite(), syntheticBackend(2.5));

    expect(manifest.cases[0]).toMatchObject({
      status: "fail",
      availability: "available",
      regime: "steady",
      metrics: {
        meanDragCoefficient: {
          schemaVersion: "1",
          measured: 2.5,
          expected: { minimum: 2, maximum: 2.2 },
          tolerance: 0,
          status: "fail",
          message: expect.stringContaining("Case re20-steady"),
        },
      },
      failures: [
        "Case re20-steady: meanDragCoefficient measured 2.5; expected [2, 2.2] with tolerance 0.",
      ],
    });
  });
});

function validationSuite(): ValidationSuite {
  return {
    schemaVersion: "1",
    id: "smoke-suite",
    metricVersions: {
      densityHealth: "1",
      fluxBalance: "1",
    },
    cases: [
      {
        schemaVersion: "1",
        id: "re20-steady",
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
          cylinder: {
            cellsPerDiameter: 32,
            offsetX: 0,
            offsetY: 0,
          },
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
        expectations: [
          {
            metric: "meanDragCoefficient",
            range: { minimum: 2, maximum: 2.2 },
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
      },
    ],
    reconciliations: [],
  };
}

function syntheticBackend(dragCoefficient = 2.1): SolverBackend {
  return {
    identity: {
      schemaVersion: "1",
      id: "cpu-test",
      kind: "cpu-worker",
      solver: "test TRT/BFL",
      solverVersion: "1.0.0",
      buildId: "test-build",
    },
    async *runCase() {
      yield sample(0, 0, 100, 1, 0, 0, dragCoefficient);
      yield sample(1, 1, 100, 1, 1, 1, dragCoefficient);
      yield sample(2, 2, 100, 1, 1, 1, dragCoefficient);
      yield sample(3, 3, 100, 1, 1, 1, dragCoefficient);
      yield sample(4, 4, 100, 1, 1, 1, dragCoefficient);
    },
  };
}

function sample(
  step: number,
  flowThroughTime: number,
  domainMass: number,
  meanDensity: number,
  inletFlux: number,
  outletFlux: number,
  dragCoefficient = 2.1,
) {
  return {
    step,
    flowThroughTime,
    domainMass,
    inletFlux,
    outletFlux,
    density: { minimum: 0.99, maximum: 1.01, mean: meanDensity },
    upstreamReflection: 0,
    fieldResidual: 0.0001,
    symmetryError: 0.0001,
    dragCoefficient,
    liftCoefficient: 0,
  };
}
