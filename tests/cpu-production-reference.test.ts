import { describe, expect, it } from "vitest";

import {
  CPU_PRODUCTION_VALIDATION_SUITE,
} from "../src/validation/cpu-production-reference.js";
import {
  CPU_PRODUCTION_CELLS_PER_DIAMETER,
  CPU_PRODUCTION_QUALITY_TIER_ID,
} from "../src/validation/cpu-production-config.js";

describe("CPU production validation suite", () => {
  it("binds every canonical envelope case to the exact D18 tier and timestep", () => {
    const canonical = CPU_PRODUCTION_VALIDATION_SUITE.cases.filter(
      ({ id }) => id.startsWith("open-cylinder-"),
    );
    expect(canonical.map(({ reynoldsNumber }) => reynoldsNumber)).toEqual([
      5, 20, 40, 45, 50, 100, 150,
    ]);
    expect(
      canonical.every(
        ({ configuration, protocol }) =>
          configuration.qualityTier === CPU_PRODUCTION_QUALITY_TIER_ID &&
          configuration.cylinder.cellsPerDiameter ===
            CPU_PRODUCTION_CELLS_PER_DIAMETER &&
          Number.isInteger(
            (protocol.sampleInterval *
              configuration.cylinder.cellsPerDiameter) /
              (configuration.latticeSpeed ?? 0.08),
          ),
      ),
    ).toBe(true);
    expect(
      canonical.map(({ reynoldsNumber, protocol }) => [
        reynoldsNumber,
        protocol.sampleInterval,
      ]),
    ).toEqual([
      [5, 2],
      [20, 2],
      [40, 2],
      [45, 1],
      [50, 1],
      [100, 0.4],
      [150, 0.4],
    ]);
  });
});
