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

  it("reports complete stable-periodic lift evidence in flow-through-time units", () => {
    const samples = Array.from({ length: 81 }, (_, index) => ({
      flowThroughTime: index * 0.25,
      liftCoefficient: 0.3 * Math.sin(2 * Math.PI * 0.2 * index * 0.25),
    }));

    const analysis = analyseLiftSignal(samples, {
      minimumCycles: 4,
      minimumAmplitude: 0.1,
      maximumFrequencyVariation: 0.02,
      maximumAmplitudeVariation: 0.05,
    });

    expect(analysis).toMatchObject({
      outcome: "stable-periodic",
      stable: true,
      dominantFrequency: 0.2,
      strouhalNumber: 0.2,
      cycles: 4,
      frequencyVariation: 0,
      amplitudeVariation: 0,
      frequencyUncertainty: 0.025,
    });
    expect(analysis.liftRms).toBeCloseTo(0.21, 2);
    expect(analysis.amplitude).toBeCloseTo(0.3, 2);
  });

  it("distinguishes an unstable periodic signal from a developing signal", () => {
    const unstable = Array.from({ length: 81 }, (_, index) => {
      const flowThroughTime = index * 0.25;
      const amplitude = flowThroughTime <= 10 ? 0.15 : 0.35;
      return {
        flowThroughTime,
        liftCoefficient: amplitude * Math.sin(2 * Math.PI * 0.2 * flowThroughTime),
      };
    });

    expect(
      analyseLiftSignal(unstable, {
        minimumCycles: 4,
        minimumAmplitude: 0.1,
        maximumFrequencyVariation: 0.02,
        maximumAmplitudeVariation: 0.05,
      }),
    ).toMatchObject({
      outcome: "unstable-periodic",
      stable: false,
      dominantFrequency: 0.2,
      cycles: 4,
    });
  });

  it("detects frequency drift finer than a half-window Fourier bin", () => {
    const drifting = Array.from({ length: 129 }, (_, index) => {
      const flowThroughTime = index * 0.25;
      const phaseCycles =
        flowThroughTime <= 16
          ? 0.16 * flowThroughTime
          : 0.16 * 16 + 0.18 * (flowThroughTime - 16);
      return {
        flowThroughTime,
        liftCoefficient: 0.3 * Math.sin(2 * Math.PI * phaseCycles),
      };
    });

    expect(
      analyseLiftSignal(drifting, {
        minimumCycles: 4,
        minimumAmplitude: 0.1,
        maximumFrequencyVariation: 0.05,
        maximumAmplitudeVariation: 0.1,
      }),
    ).toMatchObject({
      outcome: "unstable-periodic",
      stable: false,
    });
    expect(
      analyseLiftSignal(drifting, {
        minimumCycles: 4,
        minimumAmplitude: 0.1,
        maximumFrequencyVariation: 0.05,
        maximumAmplitudeVariation: 0.1,
      }).frequencyVariation,
    ).toBeGreaterThan(0.05);
  });

  it("reports developing and unavailable signal outcomes without inventing Strouhal evidence", () => {
    const developing = Array.from({ length: 21 }, (_, index) => ({
      flowThroughTime: index * 0.25,
      liftCoefficient: 0.3 * Math.sin(2 * Math.PI * 0.2 * index * 0.25),
    }));
    const thresholds = {
      minimumCycles: 4,
      minimumAmplitude: 0.1,
      maximumFrequencyVariation: 0.02,
      maximumAmplitudeVariation: 0.05,
    };

    expect(analyseLiftSignal(developing, thresholds)).toMatchObject({
      outcome: "developing",
      stable: false,
    });
    expect(
      analyseLiftSignal(
        developing.map((sample, index) =>
          index === 10 ? { ...sample, liftCoefficient: Number.NaN } : sample,
        ),
        thresholds,
      ),
    ).toMatchObject({
      outcome: "unavailable",
      stable: false,
      reason: expect.stringContaining("finite"),
    });
  });
});
