import { describe, expect, it } from "vitest";

import {
  REFERENCE_CASE_CATALOGUE,
  createReferenceValidationSuite,
  type ReferenceCaseEvidence,
} from "../src/validation/index.js";

describe("reference case catalogue", () => {
  it("declares the validated envelope endpoints and brackets shedding onset", () => {
    expect(REFERENCE_CASE_CATALOGUE.map((definition) => definition.reynoldsNumber)).toEqual([
      5, 20, 40, 45, 50, 100, 150,
    ]);
    expect(REFERENCE_CASE_CATALOGUE.find((definition) => definition.reynoldsNumber === 45))
      .toMatchObject({ expectedRegimes: ["steady", "unclassified"] });
    expect(REFERENCE_CASE_CATALOGUE.find((definition) => definition.reynoldsNumber === 50))
      .toMatchObject({ expectedRegimes: ["periodically-shedding", "unclassified"] });
  });

  it("assembles one versioned data catalogue only when every case has declared evidence", () => {
    const evidence = Object.fromEntries(
      REFERENCE_CASE_CATALOGUE.map((definition) => [definition.id, caseEvidence()]),
    ) as Record<(typeof REFERENCE_CASE_CATALOGUE)[number]["id"], ReferenceCaseEvidence>;

    const suite = createReferenceValidationSuite({
      id: "cpu-reference-v1",
      metricVersions: { drag: "1" },
      evidence,
      sensitivityCases: [],
      reconciliations: [],
    });

    expect(suite.schemaVersion).toBe("1");
    expect(suite.cases).toHaveLength(7);
    expect(suite.cases[0]).toMatchObject({
      id: "open-cylinder-re005",
      reynoldsNumber: 5,
      physicalScenario: {
        flowSpeedMetersPerSecond: 0.001,
        cylinderDiameterMeters: 0.005,
        kinematicViscositySquareMetersPerSecond: 0.000001,
      },
    });
  });

  it("refuses to invent missing case evidence or tolerances", () => {
    expect(() =>
      createReferenceValidationSuite({
        id: "incomplete",
        metricVersions: {},
        evidence: {} as Record<
          (typeof REFERENCE_CASE_CATALOGUE)[number]["id"],
          ReferenceCaseEvidence
        >,
        sensitivityCases: [],
        reconciliations: [],
      }),
    ).toThrow("open-cylinder-re005");
  });
});

function caseEvidence(): ReferenceCaseEvidence {
  return {
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
    protocol: {
      warmUpFlowThroughTime: 10,
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
        metric: "meanDragCoefficient",
        range: { minimum: 1, maximum: 10 },
        tolerance: 0,
        sources: [
          {
            id: "fixture-source",
            url: "https://example.test/reference",
            convention: "test fixture only",
          },
        ],
      },
    ],
  };
}
