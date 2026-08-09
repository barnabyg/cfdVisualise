import { describe, expect, it } from "vitest";

import {
  ENGINE_COMMAND_TYPES,
  ENGINE_PROTOCOL_VERSION,
  createEngineEventGate,
  type EngineEvent,
} from "../src/engine/protocol.js";

describe("wake engine protocol", () => {
  it("covers the lifecycle and rejects stale or out-of-order Worker events", () => {
    expect(ENGINE_COMMAND_TYPES).toEqual([
      "initialise",
      "resize",
      "play",
      "pause",
      "step",
      "restart",
      "capture-still",
      "set-scenario",
      "set-playback-rate",
      "set-tracers-enabled",
      "dispose",
    ]);

    const gate = createEngineEventGate("current");
    const event = (sessionId: string, sequence: number): EngineEvent => ({
      protocolVersion: ENGINE_PROTOCOL_VERSION,
      sessionId,
      sequence,
      type: "ready",
      tier: {
        id: "cpu-balanced",
        backendId: "cpu-reference",
        buildId: "ticket-06",
        label: "CPU balanced",
        cellsPerDiameter: 18,
        defaultPlaybackRate: 1.3,
      },
    });

    expect(gate.accept(event("previous", 1))).toBe(false);
    expect(gate.accept(event("current", 2))).toBe(true);
    expect(gate.accept(event("current", 1))).toBe(false);
    expect(gate.accept(event("current", 3))).toBe(true);
  });
});
