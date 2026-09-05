import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_PHYSICAL_SCENARIO } from "../src/engine/physical-scenario.js";
import { ENGINE_PROTOCOL_VERSION, type EngineCommand, type EngineCommandPayload, type EngineEvent } from "../src/engine/protocol.js";

afterEach(() => vi.unstubAllGlobals());

it("publishes lift with the rendered CPU frame, flushes pause and step, and clears restart history", async () => {
  const events: EngineEvent[] = [];
  const scope = {
    onmessage: null as ((event: MessageEvent<EngineCommand>) => void) | null,
    postMessage: (event: EngineEvent) => events.push(event),
    close: () => undefined,
  };
  vi.stubGlobal("self", scope);
  await import("../src/engine/cpu-wake-worker.js");
  const send = (payload: EngineCommandPayload, sessionId = "telemetry") => scope.onmessage?.({
    data: { protocolVersion: ENGINE_PROTOCOL_VERSION, sessionId, ...payload },
  } as MessageEvent<EngineCommand>);
  send({ type: "initialise", renderTarget: { kind: "frame-events" },
    viewport: { cssWidth: 420, cssHeight: 340, pixelRatio: 1 },
    scenario: DEFAULT_PHYSICAL_SCENARIO, reducedMotion: true, encodingFocus: "combined" });
  send({ type: "step" });
  const frames = () => events.filter((event) => event.type === "frame");
  const stepped = frames().at(-1)!;
  expect(stepped.liftSignal?.flowThroughTime).toBeCloseTo(0.05);
  expect(stepped.liftSignal?.samples).toHaveLength(1);
  expect(stepped.liftSignal?.samples[0]?.flowThroughTime).toBe(stepped.liftSignal?.flowThroughTime);
  const summary = events.at(-1)!;
  expect(summary.type).toBe("summary");
  if (summary.type !== "summary") throw new Error("Expected summary after frame");
  expect(summary.summary.liftSignal).toEqual(stepped.liftSignal);
  expect(summary.sequence).toBeGreaterThan(stepped.sequence);
  const count = events.length;
  send({ type: "restart" }, "stale-session");
  expect(events).toHaveLength(count);
  send({ type: "pause" });
  expect(frames().at(-1)?.liftSignal).toEqual(stepped.liftSignal);
  send({ type: "restart" });
  expect(frames().at(-1)?.liftSignal).toEqual({ flowThroughTime: 0, samples: [] });
  send({ type: "step" });
  expect(frames().at(-1)?.liftSignal?.samples).toHaveLength(1);
  send({ type: "dispose" });
});
