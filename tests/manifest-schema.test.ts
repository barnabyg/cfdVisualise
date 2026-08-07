import { describe, expect, it } from "vitest";

import {
  parseValidationManifest,
  serializeValidationManifest,
  type ValidationManifest,
} from "../src/validation/index.js";

describe("validation manifest schema", () => {
  it("rejects unknown versions, non-finite measurements, and missing provenance", () => {
    const valid = validManifest();

    expect(() =>
      parseValidationManifest({ ...valid, schemaVersion: "2" }),
    ).toThrow("Unsupported validation manifest schema version");

    expect(() =>
      parseValidationManifest({
        ...valid,
        cases: [
          {
            ...valid.cases[0],
            metrics: {
              meanDragCoefficient: {
                ...valid.cases[0]!.metrics.meanDragCoefficient,
                measured: Number.NaN,
              },
            },
          },
        ],
      }),
    ).toThrow("finite measured value");

    expect(() =>
      parseValidationManifest({
        ...valid,
        cases: [
          {
            ...valid.cases[0],
            metrics: {
              meanDragCoefficient: {
                ...valid.cases[0]!.metrics.meanDragCoefficient,
                sources: [],
              },
            },
          },
        ],
      }),
    ).toThrow("scientific source");
  });

  it("returns compatible evidence without adding volatile metadata", () => {
    expect(parseValidationManifest(validManifest())).toEqual(validManifest());
  });

  it("rejects case definitions whose physical scenario does not produce the declared Reynolds number", () => {
    const valid = validManifest();
    expect(() =>
      parseValidationManifest({
        ...valid,
        cases: [
          {
            ...valid.cases[0],
            definition: {
              ...valid.cases[0]!.definition,
              physicalScenario: {
                ...valid.cases[0]!.definition.physicalScenario,
                flowSpeedMetersPerSecond: 0.003,
              },
            },
          },
        ],
      }),
    ).toThrow("physical scenario produces Reynolds number");
  });

  it("serializes stable scientific content canonically", () => {
    const first = validManifest();
    const second = validManifest();
    const firstWithMetrics = {
      ...first,
      suite: { ...first.suite, metricVersions: { symmetry: "2", drag: "1" } },
    };
    const secondWithMetrics = {
      ...second,
      suite: { ...second.suite, metricVersions: { drag: "1", symmetry: "2" } },
    };

    expect(serializeValidationManifest(firstWithMetrics)).toBe(
      serializeValidationManifest(secondWithMetrics),
    );
    expect(serializeValidationManifest(firstWithMetrics)).not.toContain("timestamp");
  });

  it("rejects a passing reconciliation that contains failed metric evidence", () => {
    const valid = validManifest();
    expect(() =>
      parseValidationManifest({
        ...valid,
        reconciliations: [
          {
            id: "corrupt-grid",
            kind: "grid",
            baselineCaseId: "re20",
            comparisons: [
              {
                comparisonCaseId: "re20-finer",
                baselineRegime: "steady",
                comparisonRegime: "steady",
                metrics: {
                  meanDragCoefficient: {
                    baseline: 2,
                    comparison: 2.1,
                    relativeChange: 0.05,
                    maximumRelativeChange: 0.01,
                    status: "fail",
                  },
                },
                status: "pass",
              },
            ],
            status: "pass",
            failures: [],
          },
        ],
      }),
    ).toThrow("cannot contain a failing metric");
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
      id: "cpu-reference",
      kind: "cpu-worker",
      solver: "D2Q9 TRT/BFL",
      solverVersion: "1.0.0",
      buildId: "build-1",
    },
    status: "pass",
    cases: [
      {
        caseId: "re20",
        reynoldsNumber: 20,
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
          domain: {
            upstreamDiameters: 8,
            downstreamDiameters: 24,
            lateralDiameters: 8,
          },
          cylinder: { cellsPerDiameter: 32, offsetX: 0, offsetY: 0 },
        },
        definition: manifestDefinition(),
        status: "pass",
        regime: "steady",
        achieved: {
          steps: 100,
          flowThroughTime: 10,
          warmUpFlowThroughTime: 5,
          sampleFlowThroughTime: 5,
        },
        metrics: {
          meanDragCoefficient: {
            applicability: "applicable",
            measured: 2.1,
            expected: { minimum: 2, maximum: 2.2 },
            tolerance: 0,
            sources: [
              {
                id: "published-reference",
                url: "https://example.test/reference",
                convention: "time mean after warm-up",
              },
            ],
            status: "pass",
          },
        },
        failures: [],
      },
    ],
    reconciliations: [],
  };
}

function manifestDefinition() {
  return {
    physicalScenario: {
      flowSpeedMetersPerSecond: 0.002,
      cylinderDiameterMeters: 0.01,
      kinematicViscositySquareMetersPerSecond: 0.000001,
    },
    expectedRegimes: ["steady"] as const,
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
