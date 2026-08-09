// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/preact";
import { useEffect } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";

import { ENGINE_PROTOCOL_VERSION, type EngineCommand, type EngineEvent } from "../src/engine/protocol.js";
import { useWakeEngine, type WakeWorkerPort } from "../src/ui/use-wake-engine.js";

describe("useWakeEngine", () => {
  it("transfers, resizes, ignores stale events, and disposes the Worker", async () => {
    const worker = new FakeWorker();
    const offscreen = {} as OffscreenCanvas;
    Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", {
      configurable: true,
      value: () => offscreen,
    });
    let resize: (() => void) | undefined;
    class FakeResizeObserver {
      public constructor(callback: () => void) {
        resize = callback;
      }
      public observe(): void {}
      public disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    const view = render(<Harness worker={worker} />);
    await act(async () => undefined);

    expect(worker.commands[0]).toMatchObject({
      type: "initialise",
      renderTarget: { kind: "offscreen-canvas", canvas: offscreen },
    });
    act(() => resize?.());
    expect(worker.commands.some((command) => command.type === "resize")).toBe(true);

    const initialise = worker.commands[0]!;
    act(() => {
      worker.emit({
        protocolVersion: ENGINE_PROTOCOL_VERSION,
        sessionId: initialise.sessionId,
        sequence: 2,
        type: "ready",
        tier: {
          id: "cpu",
          backendId: "cpu-reference",
          buildId: "ticket-06",
          label: "CPU",
          cellsPerDiameter: 18,
          defaultPlaybackRate: 1.3,
        },
      });
      worker.emit({
        protocolVersion: ENGINE_PROTOCOL_VERSION,
        sessionId: initialise.sessionId,
        sequence: 1,
        type: "summary",
        summary: {
          scenario: initialise.type === "initialise" ? initialise.scenario : neverScenario(),
          reynoldsNumber: 999,
          targetReynoldsNumber: 999,
          flowThroughTime: 0,
          regime: "developing",
          playback: "paused",
          targetPlaybackRate: 1,
          achievedPlaybackRate: 0,
          tracersEnabled: true,
        },
      });
      worker.emit({
        protocolVersion: ENGINE_PROTOCOL_VERSION,
        sessionId: initialise.sessionId,
        sequence: 3,
        type: "still",
        image: new Blob(["still"], { type: "image/png" }),
        summary: {
          scenario: initialise.type === "initialise" ? initialise.scenario : neverScenario(),
          reynoldsNumber: 20,
          targetReynoldsNumber: 20,
          flowThroughTime: 12,
          regime: "steady",
          playback: "paused",
          targetPlaybackRate: 1,
          achievedPlaybackRate: 1,
          tracersEnabled: false,
        },
      });
    });
    expect(screen.getByText("CPU")).toBeTruthy();
    expect(screen.queryByText("999")).toBeNull();
    expect(screen.getByText("still:12")).toBeTruthy();

    view.unmount();
    expect(worker.commands.at(-1)).toMatchObject({ type: "dispose" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("keeps simulation in the Worker and blits frame events when canvas transfer is unavailable", async () => {
    const worker = new FakeWorker();
    Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", {
      configurable: true,
      value: undefined,
    });
    const drawImage = vi.fn();
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => ({
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        }),
        putImageData: vi.fn(),
        drawImage,
        imageSmoothingEnabled: false,
      }),
    });
    vi.stubGlobal("ResizeObserver", class {
      public observe(): void {}
      public disconnect(): void {}
    });

    const view = render(<Harness worker={worker} />);
    await act(async () => undefined);
    expect(worker.commands[0]).toMatchObject({
      type: "initialise",
      renderTarget: { kind: "frame-events" },
    });
    const initialise = worker.commands[0]!;
    worker.emit({
      protocolVersion: ENGINE_PROTOCOL_VERSION,
      sessionId: initialise.sessionId,
      sequence: 1,
      type: "frame",
      width: 2,
      height: 2,
      pixels: new Uint8ClampedArray(16),
    });
    expect(drawImage).toHaveBeenCalledOnce();
    view.unmount();
  });
});

function Harness({ worker }: { readonly worker: WakeWorkerPort }) {
  const engine = useWakeEngine({ workerFactory: () => worker, sessionIdFactory: () => "session" });
  useEffect(() => engine.pause, []);
  return (
    <>
      <canvas ref={engine.canvasRef} />
      <output>{engine.tier?.label}</output>
      <output>{engine.summary.reynoldsNumber}</output>
      <output>{engine.capturedStill && `still:${engine.capturedStill.summary.flowThroughTime}`}</output>
    </>
  );
}

class FakeWorker implements WakeWorkerPort {
  public onmessage: ((event: MessageEvent<EngineEvent>) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public readonly commands: EngineCommand[] = [];
  public readonly terminate = vi.fn();
  public postMessage(command: EngineCommand): void {
    this.commands.push(command);
  }
  public emit(event: EngineEvent): void {
    this.onmessage?.(new MessageEvent("message", { data: event }));
  }
}

function neverScenario(): never {
  throw new Error("Unreachable scenario fallback.");
}
