// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/preact";
import { expect, it, vi } from "vitest";
import { ENGINE_PROTOCOL_VERSION, type EngineCommand, type EngineEvent } from "../src/engine/protocol.js";
import { useWakeEngine, type WakeWorkerPort } from "../src/ui/use-wake-engine.js";

it("replaces frame telemetry, rejects stale ordering and sessions, and clears it on tier change and recovery", async () => {
  Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", { configurable: true, value: () => ({}) });
  vi.stubGlobal("ResizeObserver", class { public observe(): void {} public disconnect(): void {} });
  const workers: Port[] = [];
  let session = 0;
  function Harness() {
    const engine = useWakeEngine({
      workerFactory: () => { const worker = new Port(); workers.push(worker); return worker; },
      sessionIdFactory: () => `session-${++session}`,
    });
    return <><canvas ref={engine.canvasRef} /><output aria-label="Signal">{JSON.stringify(engine.summary.liftSignal ?? null)}</output>
      <button onClick={() => engine.changeTier("cpu-balanced-d18")}>Change tier</button>
      <button onClick={engine.restartTier}>Recover</button></>;
  }
  const view = render(<Harness />);
  await act(async () => undefined);
  const output = screen.getByLabelText("Signal");
  const frame = (worker: Port, sequence: number, time: number): EngineEvent => ({
    protocolVersion: ENGINE_PROTOCOL_VERSION, sessionId: worker.commands[0]!.sessionId,
    sequence, type: "frame", width: 1, height: 1, pixels: new Uint8ClampedArray(4),
    liftSignal: { flowThroughTime: time, samples: [{ flowThroughTime: time, liftCoefficient: -0.2 }] },
  });
  const first = workers[0]!;
  act(() => first.onmessage?.({ data: frame(first, 3, 10) } as MessageEvent<EngineEvent>));
  expect(output.textContent).toContain('"flowThroughTime":10');
  act(() => first.onmessage?.({ data: frame(first, 2, 20) } as MessageEvent<EngineEvent>));
  expect(output.textContent).not.toContain('"flowThroughTime":20');
  fireEvent.click(screen.getByText("Change tier"));
  await act(async () => undefined);
  expect(output.textContent).toBe("null");
  const second = workers[1]!;
  act(() => second.onmessage?.({ data: frame(first, 99, 99) } as MessageEvent<EngineEvent>));
  expect(output.textContent).toBe("null");
  act(() => second.onmessage?.({ data: frame(second, 1, 0.05) } as MessageEvent<EngineEvent>));
  expect(output.textContent).toContain('"flowThroughTime":0.05');
  // A restarted experiment replaces its history even though the session is unchanged.
  act(() => second.onmessage?.({ data: frame(second, 2, 0) } as MessageEvent<EngineEvent>));
  expect(output.textContent).not.toContain('"flowThroughTime":0.05');
  fireEvent.click(screen.getByText("Recover"));
  await act(async () => undefined);
  expect(output.textContent).toBe("null");
  view.unmount();
  vi.unstubAllGlobals();
});

class Port implements WakeWorkerPort {
  public onmessage: WakeWorkerPort["onmessage"] = null;
  public onerror: WakeWorkerPort["onerror"] = null;
  public commands: EngineCommand[] = [];
  public postMessage(command: EngineCommand): void { this.commands.push(command); }
  public terminate(): void {}
}
