import { describe, expect, it } from "vitest";

import {
  analyseLiftSignal,
  measureCentrelineSymmetry,
  measureRecirculationLength,
  reconcileDomainMass,
} from "../src/validation/index.js";

describe("validation metrics", () => {
  it("measures mirrored-field symmetry with a normalized L2 norm", () => {
    expect(measureCentrelineSymmetry([1, 2], [1, 2])).toBe(0);
    expect(measureCentrelineSymmetry([1, -1], [1, 1])).toBeCloseTo(Math.SQRT2);
  });

  it("measures recirculation from the cylinder rear surface to an interpolated zero crossing", () => {
    expect(measureRecirculationLength([1, 2, 3], [-1, -0.5, 0.5], 1)).toBe(1.5);
    expect(measureRecirculationLength([1, 2, 3], [-1, -0.5, -0.1], 1)).toBeUndefined();
  });

  it("reconciles open-domain mass change with time-integrated inlet and outlet flux", () => {
    expect(
      reconcileDomainMass({
        initialMass: 100,
        finalMass: 100.5,
        samples: [
          { flowThroughTime: 0, inletFlux: 2, outletFlux: 1.5 },
          { flowThroughTime: 1, inletFlux: 2, outletFlux: 1.5 },
        ],
      }),
    ).toEqual({
      signedBalance: 0,
      normalizedResidual: 0,
      meanInletFlux: 2,
      meanOutletFlux: 1.5,
      sampleDuration: 1,
    });
  });

  it("identifies a stable periodic lift signal without field hashing", () => {
    const samples = Array.from({ length: 81 }, (_, index) => ({
      flowThroughTime: index * 0.25,
      liftCoefficient: 0.3 * Math.sin(2 * Math.PI * 0.2 * index * 0.25),
    }));

    expect(
      analyseLiftSignal(samples, {
        minimumCycles: 4,
        maximumFrequencyVariation: 0.02,
        maximumAmplitudeVariation: 0.05,
      }),
    ).toMatchObject({
      stable: true,
      strouhalNumber: 0.2,
      cycles: 4,
    });
  });
});
