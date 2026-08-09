import { describe, expect, it } from "vitest";

import { CpuWakeSimulation } from "../src/engine/cpu-wake-simulation.js";
import { DEFAULT_PHYSICAL_SCENARIO } from "../src/engine/physical-scenario.js";

describe("CPU wake simulation", () => {
  it("advances incrementally, adapts in place, and restarts for diameter changes", () => {
    const simulation = new CpuWakeSimulation(DEFAULT_PHYSICAL_SCENARIO, {
      cellsPerDiameter: 12,
      domain: { upstreamDiameters: 2, downstreamDiameters: 3, lateralDiameters: 2 },
    });

    const advanced = simulation.advanceBy(0.1);
    expect(advanced.flowThroughTime).toBeGreaterThan(0);
    expect(advanced.availability).toBe("available");

    const adapting = simulation.setScenario({
      ...DEFAULT_PHYSICAL_SCENARIO,
      flowSpeedMetersPerSecond: 0.01,
    });
    expect(adapting).toMatchObject({ regime: "adapting", targetReynoldsNumber: 100 });
    expect(adapting.flowThroughTime).toBe(advanced.flowThroughTime);

    simulation.advanceBy(0.25);
    expect(simulation.summary().reynoldsNumber).toBeGreaterThan(20);
    expect(simulation.summary().reynoldsNumber).toBeLessThan(100);

    const restarted = simulation.setScenario({
      ...DEFAULT_PHYSICAL_SCENARIO,
      flowSpeedMetersPerSecond: 0.001,
      cylinderDiameterMeters: 0.02,
    });
    expect(restarted).toMatchObject({
      flowThroughTime: 0,
      reynoldsNumber: 20,
      regime: "developing",
    });
  });
});
