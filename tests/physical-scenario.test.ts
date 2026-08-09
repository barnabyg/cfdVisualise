import { describe, expect, it } from "vitest";

import {
  DEFAULT_PHYSICAL_SCENARIO,
  coupledPhysicalIntervals,
  applyPhysicalScenarioChange,
  reynoldsNumber,
} from "../src/engine/physical-scenario.js";

describe("physical scenario", () => {
  it("derives Reynolds number and distinguishes in-place changes from restarts", () => {
    expect(reynoldsNumber(DEFAULT_PHYSICAL_SCENARIO)).toBeCloseTo(20);

    expect(
      applyPhysicalScenarioChange(DEFAULT_PHYSICAL_SCENARIO, {
        ...DEFAULT_PHYSICAL_SCENARIO,
        flowSpeedMetersPerSecond: 0.01,
      }),
    ).toMatchObject({ kind: "adapt", reynoldsNumber: 100 });

    expect(
      applyPhysicalScenarioChange(DEFAULT_PHYSICAL_SCENARIO, {
        ...DEFAULT_PHYSICAL_SCENARIO,
        cylinderDiameterMeters: 0.02,
        flowSpeedMetersPerSecond: 0.001,
      }),
    ).toMatchObject({ kind: "restart", reynoldsNumber: 20 });

    expect(() =>
      applyPhysicalScenarioChange(DEFAULT_PHYSICAL_SCENARIO, {
        flowSpeedMetersPerSecond: 0.001,
        cylinderDiameterMeters: 0.001,
        kinematicViscositySquareMetersPerSecond: 0.001,
      }),
    ).toThrow(/validated envelope/i);

    expect(() =>
      applyPhysicalScenarioChange(DEFAULT_PHYSICAL_SCENARIO, {
        flowSpeedMetersPerSecond: 3,
        cylinderDiameterMeters: 0.001,
        kinematicViscositySquareMetersPerSecond: 0.00003,
      }),
    ).toThrow(/physical scale/i);
  });

  it("derives coupled physical-control intervals inside the validated envelope", () => {
    expect(coupledPhysicalIntervals(DEFAULT_PHYSICAL_SCENARIO)).toEqual({
      speed: [0.001, 0.015],
      diameter: [0.0025, 0.075],
      viscosity: [0.0000005, 0.000004],
    });
  });
});
