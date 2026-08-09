// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { ENGINE_PROTOCOL_VERSION, type EngineCommand, type EngineEvent, type EngineSummary } from "../src/engine/protocol.js";
import { InstrumentApp } from "../src/ui/instrument-app.js";
import type { WakeWorkerPort } from "../src/ui/use-wake-engine.js";

describe("instrument app", () => {
  it("runs the guide from a measured steady baseline to measured shedding", async () => {
    const worker = new FakeWorker();
    Object.defineProperty(HTMLCanvasElement.prototype, "transferControlToOffscreen", {
      configurable: true,
      value: () => ({}) as OffscreenCanvas,
    });
    vi.stubGlobal("ResizeObserver", class { public observe(): void {} public disconnect(): void {} });

    render(<InstrumentApp workerFactory={() => worker} reducedMotion />);
    await act(async () => undefined);
    expect(worker.commands[0]).toMatchObject({ type: "initialise", reducedMotion: true });
    expect(screen.getByRole("img", { name: /full-domain wake view/i })).toBeTruthy();
    expect(screen.getAllByText(/clockwise/i)).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /start guided experiment/i }));
    expect(worker.commands.slice(-3).map(({ type }) => type)).toEqual([
      "set-scenario",
      "restart",
      "play",
    ]);
    expect(worker.commands.at(-3)).toMatchObject({
      type: "set-scenario",
      scenario: { flowSpeedMetersPerSecond: 0.002 },
    });

    worker.emit(summaryEvent(worker, 1, { regime: "steady", flowThroughTime: 12 }));
    expect(worker.commands.at(-2)).toMatchObject({ type: "pause" });
    expect(worker.commands.at(-1)).toMatchObject({ type: "capture-still" });
    worker.emit({
      protocolVersion: ENGINE_PROTOCOL_VERSION,
      sessionId: worker.commands[0]!.sessionId,
      sequence: 2,
      type: "still",
      image: new Blob(["baseline"], { type: "image/png" }),
      summary: summaryEvent(worker, 2, { regime: "steady", flowThroughTime: 12 }).summary,
    });
    expect(await screen.findByText(/baseline measured/i)).toBeTruthy();
    expect(screen.getByRole("img", { name: /baseline normalized-vorticity still/i })).toBeTruthy();
    expect(screen.getByText(/live.*baseline/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /become unsteady/i }));
    fireEvent.click(screen.getByRole("button", { name: /commit prediction/i }));
    expect(worker.commands.at(-1)).toMatchObject({
      type: "set-scenario",
      scenario: { flowSpeedMetersPerSecond: 0.01 },
    });

    worker.emit(summaryEvent(worker, 3, { regime: "adapting", reynoldsNumber: 45 }));
    expect(await screen.findByText(/adapting the existing wake/i)).toBeTruthy();

    worker.emit(
      summaryEvent(worker, 4, {
        regime: "periodically-shedding",
        reynoldsNumber: 100,
        flowThroughTime: 50,
        strouhalNumber: 0.16,
      }),
    );
    expect(await screen.findByText(/prediction compared/i)).toBeTruthy();
    expect(screen.getByText("0.160")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /run guide again/i }));
    expect(worker.commands.at(-3)).toMatchObject({
      type: "set-scenario",
      scenario: { flowSpeedMetersPerSecond: 0.002 },
    });
  });
});

class FakeWorker implements WakeWorkerPort {
  public onmessage: ((event: MessageEvent<EngineEvent>) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public readonly commands: EngineCommand[] = [];
  public postMessage(command: EngineCommand): void { this.commands.push(command); }
  public terminate(): void {}
  public emit(event: EngineEvent): void {
    act(() => this.onmessage?.(new MessageEvent("message", { data: event })));
  }
}

function summaryEvent(
  worker: FakeWorker,
  sequence: number,
  changes: Partial<EngineSummary>,
): Extract<EngineEvent, { readonly type: "summary" }> {
  const initialise = worker.commands[0]!;
  const scenario = initialise.type === "initialise" ? initialise.scenario : undefined;
  if (scenario === undefined) throw new Error("Worker was not initialised.");
  return {
    protocolVersion: ENGINE_PROTOCOL_VERSION,
    sessionId: initialise.sessionId,
    sequence,
    type: "summary",
    summary: {
      scenario,
      reynoldsNumber: 20,
      targetReynoldsNumber: 20,
      flowThroughTime: 0,
      regime: "developing",
      playback: "playing",
      targetPlaybackRate: 1,
      achievedPlaybackRate: 1,
      tracersEnabled: false,
      ...changes,
    },
  };
}
