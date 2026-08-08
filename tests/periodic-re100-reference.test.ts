import { describe, expect, it } from "vitest";

import { PERIODIC_RE100_VALIDATION_SUITE } from "../src/validation/index.js";

describe("periodic Reynolds 100 reference case", () => {
  it("commits the developed periodic protocol, method, references, metrics, and tolerances", () => {
    expect(PERIODIC_RE100_VALIDATION_SUITE).toMatchObject({
      schemaVersion: "1",
      id: "periodic-re100-cpu-reference-v1",
      metricVersions: {
        densityHealth: "1",
        drag: "1",
        fluxBalance: "1",
        liftPeriodicity: "2",
        strouhal: "2",
        upstreamReflection: "2",
      },
      cases: [
        {
          id: "open-cylinder-re100",
          reynoldsNumber: 100,
          physicalScenario: {
            flowSpeedMetersPerSecond: 0.01,
            cylinderDiameterMeters: 0.01,
            kinematicViscositySquareMetersPerSecond: 0.000001,
          },
          expectedRegimes: ["periodically-shedding"],
          configuration: {
            backendId: "cpu-reference",
            precision: "float64",
            latticeSpeed: 0.08,
            initialTransversePerturbation: 0.001,
            upstreamReflectionMode: "streamwise-from-inlet",
            collision: "D2Q9 TRT",
            boundaries: {
              inlet: "regularized-velocity",
              lateral: "free-slip",
              outlet: "fixed-density-nee",
              cylinder: "linear-bfl",
            },
            cylinder: { offsetX: 0, offsetY: 0 },
          },
          protocol: {
            minimumStableCycles: 4,
          },
          classification: {
            minimumPeriodicCycles: 4,
            minimumPeriodicAmplitude: 0.1,
          },
        },
      ],
      reconciliations: [],
    });

    const definition = PERIODIC_RE100_VALIDATION_SUITE.cases[0]!;
    const strouhalRange = definition.expectations.find(
      ({ metric }) => metric === "strouhalNumber",
    )!.range;
    expect(definition.protocol.warmUpFlowThroughTime).toBeGreaterThan(0);
    expect(
      definition.protocol.warmUpFlowThroughTime * strouhalRange.minimum,
    ).toBeGreaterThanOrEqual(9);
    expect(definition.protocol.sampleFlowThroughTime).toBeGreaterThanOrEqual(25);
    expect(
      definition.protocol.sampleFlowThroughTime * strouhalRange.minimum,
    ).toBeGreaterThanOrEqual(definition.protocol.minimumStableCycles ?? 0);
    expect(definition.expectations.map(({ metric }) => metric)).toEqual([
      "densityMinimum",
      "densityMaximum",
      "meanDensity",
      "meanDensityDrift",
      "nonFiniteValueCount",
      "nonPositiveDensityCount",
      "fluxResidual",
      "upstreamReflection",
      "meanDragCoefficient",
      "liftRms",
      "periodicCycleCount",
      "dominantFrequency",
      "frequencyVariation",
      "amplitudeVariation",
      "frequencyUncertainty",
      "strouhalNumber",
    ]);
    expect(
      definition.expectations.every(
        ({ tolerance, sources }) =>
          Number.isFinite(tolerance) &&
          tolerance >= 0 &&
          sources.length > 0 &&
          sources.every(({ url }) => url.startsWith("https://")),
      ),
    ).toBe(true);
    expect(Object.isFrozen(PERIODIC_RE100_VALIDATION_SUITE)).toBe(true);
    expect(Object.isFrozen(definition.expectations)).toBe(true);
  });
});
