import { describe, expect, it } from "vitest";

import { STEADY_RE20_VALIDATION_SUITE } from "../src/validation/index.js";

describe("steady Reynolds 20 reference case", () => {
  it("commits the physical scenario, open-flow method, protocol, and evidence gates", () => {
    expect(STEADY_RE20_VALIDATION_SUITE).toMatchObject({
      schemaVersion: "1",
      id: "steady-re20-cpu-reference-v1",
      metricVersions: {
        densityHealth: "1",
        drag: "1",
        fieldResidual: "1",
        fluxBalance: "1",
        recirculationLength: "1",
        symmetry: "1",
      },
      cases: [
        {
          id: "open-cylinder-re020",
          reynoldsNumber: 20,
          physicalScenario: {
            flowSpeedMetersPerSecond: 0.002,
            cylinderDiameterMeters: 0.01,
            kinematicViscositySquareMetersPerSecond: 0.000001,
          },
          expectedRegimes: ["steady"],
          configuration: {
            backendId: "cpu-reference",
            precision: "float64",
            collision: "D2Q9 TRT",
            boundaries: {
              inlet: "regularized-velocity",
              lateral: "free-slip",
              outlet: "fixed-density-nee",
              cylinder: "linear-bfl",
            },
            cylinder: { offsetX: 0, offsetY: 0 },
          },
        },
      ],
      reconciliations: [],
    });

    const definition = STEADY_RE20_VALIDATION_SUITE.cases[0]!;
    expect(definition.protocol.warmUpFlowThroughTime).toBeGreaterThan(0);
    expect(definition.protocol.sampleFlowThroughTime).toBeGreaterThan(0);
    expect(definition.protocol.sampleInterval).toBeGreaterThan(0);
    expect(definition.expectations.map(({ metric }) => metric)).toEqual([
      "densityMinimum",
      "densityMaximum",
      "meanDensity",
      "meanDensityDrift",
      "nonFiniteValueCount",
      "nonPositiveDensityCount",
      "fluxResidual",
      "upstreamReflection",
      "fieldResidual",
      "symmetryError",
      "meanDragCoefficient",
      "dragRelativeVariation",
      "liftRms",
      "recirculationLength",
    ]);
    expect(
      definition.expectations.every(({ sources }) =>
        sources.every(({ url }) => url.startsWith("https://")),
      ),
    ).toBe(true);
    expect(Object.isFrozen(STEADY_RE20_VALIDATION_SUITE)).toBe(true);
    expect(Object.isFrozen(definition.expectations)).toBe(true);
  });
});
