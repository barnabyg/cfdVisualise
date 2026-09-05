import { describe, expect, it } from "vitest";
import { LiftDisplayHistory } from "../src/engine/lift-display-history.js";

describe("bounded explanatory lift telemetry", () => {
  it("bounds dense samples, rejects duplicate and invalid samples, and owns its snapshots", () => {
    const history = new LiftDisplayHistory();
    for (let index = 0; index < 300; index += 1) {
      history.append({ flowThroughTime: index / 100, liftCoefficient: 0.2 });
    }
    const before = history.snapshot();
    expect(before).toHaveLength(256);
    expect(before[0]?.flowThroughTime).toBe(0.44);
    history.append({ flowThroughTime: 2.99, liftCoefficient: 0.9 });
    history.append({ flowThroughTime: 1, liftCoefficient: 0.9 });
    history.append({ flowThroughTime: 3, liftCoefficient: NaN });
    expect(history.snapshot()).toEqual(before);
    history.append({ flowThroughTime: 40, liftCoefficient: -0.3 });
    expect(history.snapshot()).toEqual([{ flowThroughTime: 40, liftCoefficient: -0.3 }]);
    expect(before).toHaveLength(256);
    history.clear();
    expect(history.snapshot()).toEqual([]);
    history.append({ flowThroughTime: 0.05, liftCoefficient: 0.1 });
    expect(history.snapshot()).toEqual([{ flowThroughTime: 0.05, liftCoefficient: 0.1 }]);
  });
});
