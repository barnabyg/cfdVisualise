import { describe, expect, it } from "vitest";

import { FULL_REYNOLDS_ENVELOPE_VALIDATION_SUITE } from "../src/validation/index.js";

describe("full Reynolds envelope reference catalogue", () => {
  it("commits every endpoint and onset case with explicit sourced evidence", () => {
    expect(FULL_REYNOLDS_ENVELOPE_VALIDATION_SUITE).toMatchObject({
      schemaVersion: "1",
      id: "full-reynolds-envelope-cpu-reference-v1",
    });
    expect(
      FULL_REYNOLDS_ENVELOPE_VALIDATION_SUITE.cases.map(
        ({ reynoldsNumber }) => reynoldsNumber,
      ),
    ).toEqual([5, 20, 40, 45, 50, 100, 150]);

    const casesByReynolds = new Map(
      FULL_REYNOLDS_ENVELOPE_VALIDATION_SUITE.cases.map((definition) => [
        definition.reynoldsNumber,
        definition,
      ]),
    );
    expect(casesByReynolds.get(5)?.expectedRegimes).toEqual(["steady"]);
    expect(casesByReynolds.get(20)?.expectedRegimes).toEqual(["steady"]);
    expect(casesByReynolds.get(40)?.expectedRegimes).toEqual(["steady"]);
    expect(casesByReynolds.get(45)?.expectedRegimes).toEqual([
      "steady",
      "unclassified",
    ]);
    expect(casesByReynolds.get(50)?.expectedRegimes).toEqual([
      "periodically-shedding",
      "unclassified",
    ]);
    expect(casesByReynolds.get(100)?.expectedRegimes).toEqual([
      "periodically-shedding",
    ]);
    expect(casesByReynolds.get(150)?.expectedRegimes).toEqual([
      "periodically-shedding",
    ]);

    for (const definition of FULL_REYNOLDS_ENVELOPE_VALIDATION_SUITE.cases) {
      expect(definition.configuration).toMatchObject({
        backendId: "cpu-reference",
        collision: "D2Q9 TRT",
        boundaries: {
          inlet: "regularized-velocity",
          lateral: "free-slip",
          outlet: "fixed-density-nee",
          cylinder: "linear-bfl",
        },
      });
      expect(definition.configuration.domain.upstreamDiameters).toBeGreaterThan(0);
      expect(definition.configuration.domain.downstreamDiameters).toBeGreaterThan(0);
      expect(definition.configuration.domain.lateralDiameters).toBeGreaterThan(0);
      expect(definition.configuration.cylinder).toMatchObject({
        cellsPerDiameter: expect.any(Number),
        offsetX: 0,
        offsetY: 0,
      });
      expect(definition.configuration.cylinder.cellsPerDiameter).toBeGreaterThan(0);
      expect(definition.protocol.warmUpFlowThroughTime).toBeGreaterThan(0);
      expect(definition.protocol.sampleFlowThroughTime).toBeGreaterThan(0);
      expect(definition.protocol.sampleInterval).toBeGreaterThan(0);
      expect(definition.expectations.length).toBeGreaterThan(0);
      expect(
        definition.expectations.every(
          ({ range, tolerance, sources }) =>
            range.minimum <= range.maximum &&
            Number.isFinite(tolerance) &&
            tolerance >= 0 &&
            sources.length > 0 &&
            sources.every(
              ({ id, url, convention }) =>
                id.length > 0 &&
                url.startsWith("https://") &&
                convention.length > 0,
            ),
        ),
      ).toBe(true);
      expect(
        definition.expectations
          .flatMap(({ sources }) => sources)
          .some(({ id }) => id !== "cfd-visualise-ticket-04"),
      ).toBe(true);
    }
  });

  it("declares steady, periodic, and onset-dependent metric applicability", () => {
    const casesByReynolds = new Map(
      FULL_REYNOLDS_ENVELOPE_VALIDATION_SUITE.cases.map((definition) => [
        definition.reynoldsNumber,
        new Map(
          definition.expectations.map((expectation) => [
            expectation.metric,
            expectation,
          ]),
        ),
      ]),
    );

    for (const reynoldsNumber of [5, 20, 40]) {
      const expectations = casesByReynolds.get(reynoldsNumber);
      expect(expectations?.has("fieldResidual")).toBe(true);
      expect(expectations?.has("symmetryError")).toBe(true);
      expect(expectations?.has("meanDragCoefficient")).toBe(true);
    }
    for (const reynoldsNumber of [20, 40]) {
      expect(casesByReynolds.get(reynoldsNumber)?.has("recirculationLength")).toBe(
        true,
      );
    }
    for (const reynoldsNumber of [100, 150]) {
      const expectations = casesByReynolds.get(reynoldsNumber);
      for (const metric of [
        "meanDragCoefficient",
        "liftRms",
        "periodicCycleCount",
        "frequencyVariation",
        "amplitudeVariation",
        "strouhalNumber",
      ] as const) {
        expect(expectations?.has(metric)).toBe(true);
      }
    }

    expect(
      casesByReynolds.get(45)?.get("recirculationLength")?.applicableRegimes,
    ).toEqual(["steady"]);
    expect(
      casesByReynolds.get(50)?.get("strouhalNumber")?.applicableRegimes,
    ).toEqual(["periodically-shedding"]);
  });
});
