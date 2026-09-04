import { CpuWakeSimulation } from "./cpu-wake-simulation.js";
import { CPU_PRODUCTION_TIER } from "./cpu-tier.js";
import {
  ENGINE_PROTOCOL_VERSION,
  type EngineCommand,
  type EngineEvent,
  type EngineSummary,
  type WakeEncodingFocus,
} from "./protocol.js";
import { WakeRasterRenderer, WakeRenderer } from "./wake-renderer.js";

interface WakeWorkerScope {
  onmessage: ((event: MessageEvent<EngineCommand>) => void) | null;
  postMessage(event: EngineEvent, transfer?: Transferable[]): void;
  close(): void;
}

const scope = self as unknown as WakeWorkerScope;
const FIXED_STEP_FLOW_THROUGH_TIME = 0.05;
const PLAYBACK_DIAGNOSTIC_FLOW_THROUGH_TIME = 0.4;
const PLAYBACK_ADVANCE_FLOW_THROUGH_TIME = 0.4;

let sessionId: string | undefined;
let sequence = 0;
let simulation: CpuWakeSimulation | undefined;
let renderer: WakeRenderer | undefined;
let rasterRenderer: WakeRasterRenderer | undefined;
let playback: "playing" | "paused" = "paused";
let targetPlaybackRate: number = CPU_PRODUCTION_TIER.defaultPlaybackRate;
let achievedPlaybackRate = 0;
let tracersEnabled = true;
let encodingFocus: WakeEncodingFocus = "combined";
let timer: ReturnType<typeof setTimeout> | undefined;
let lastAdvanceAt = performance.now();
let lastSummaryAt = 0;
let lastAdvanceDuration = 0;

type EngineEventPayload =
  | Pick<Extract<EngineEvent, { readonly type: "ready" }>, "type" | "tier">
  | Pick<Extract<EngineEvent, { readonly type: "summary" }>, "type" | "summary">
  | Pick<
      Extract<EngineEvent, { readonly type: "still" }>,
      "type" | "image" | "summary"
    >
  | Pick<
      Extract<EngineEvent, { readonly type: "frame" }>,
      "type" | "width" | "height" | "pixels"
    >
  | Pick<
      Extract<EngineEvent, { readonly type: "unavailable" }>,
      "type" | "reason" | "restartChoices"
    >;

scope.onmessage = ({ data }) => {
  try {
    if (data.protocolVersion !== ENGINE_PROTOCOL_VERSION) return;
    if (data.type === "initialise") {
      initialise(data);
      return;
    }
    if (sessionId === undefined || data.sessionId !== sessionId || simulation === undefined) return;
    switch (data.type) {
      case "resize":
        renderer?.resize(data.viewport);
        render(0);
        break;
      case "play":
        playback = "playing";
        scheduleAdvance();
        emitSummary(true);
        break;
      case "pause":
        pause();
        emitSummary(true);
        break;
      case "step":
        pause();
        advance(FIXED_STEP_FLOW_THROUGH_TIME);
        break;
      case "restart":
        simulation.restart();
        renderer?.clearTracers();
        render(0);
        emitSummary(true);
        break;
      case "capture-still":
        void captureStill();
        break;
      case "set-scenario":
        simulation.setScenario(data.scenario);
        render(0);
        emitSummary(true);
        break;
      case "set-playback-rate":
        if (
          !Number.isFinite(data.targetFlowThroughTimePerSecond) ||
          data.targetFlowThroughTimePerSecond <= 0
        ) {
          throw new RangeError("Playback rate must be positive and finite.");
        }
        targetPlaybackRate = data.targetFlowThroughTimePerSecond;
        emitSummary(true);
        break;
      case "set-tracers-enabled":
        tracersEnabled = data.enabled;
        if (!tracersEnabled) {
          renderer?.clearTracers();
          rasterRenderer?.clearTracers();
        }
        render(0);
        emitSummary(true);
        break;
      case "set-encoding-focus":
        encodingFocus = data.focus;
        render(0);
        break;
      case "dispose":
        pause();
        sessionId = undefined;
        simulation = undefined;
        renderer = undefined;
        rasterRenderer = undefined;
        scope.close();
        break;
      default:
        data satisfies never;
    }
  } catch (error) {
    pause();
    emitUnavailable(error instanceof Error ? error.message : "The CPU result is unavailable.");
  }
};

function initialise(command: Extract<EngineCommand, { readonly type: "initialise" }>): void {
  pause();
  sessionId = command.sessionId;
  sequence = 0;
  simulation = new CpuWakeSimulation(command.scenario);
  renderer =
    command.renderTarget.kind === "offscreen-canvas"
      ? new WakeRenderer(
          command.renderTarget.canvas,
          command.viewport,
          CPU_PRODUCTION_TIER.cellsPerDiameter,
        )
      : undefined;
  rasterRenderer =
    command.renderTarget.kind === "frame-events"
      ? new WakeRasterRenderer(CPU_PRODUCTION_TIER.cellsPerDiameter)
      : undefined;
  playback = "paused";
  tracersEnabled = !command.reducedMotion;
  encodingFocus = command.encodingFocus;
  targetPlaybackRate = CPU_PRODUCTION_TIER.defaultPlaybackRate;
  achievedPlaybackRate = 0;
  render(0);
  emit({ type: "ready", tier: CPU_PRODUCTION_TIER });
  emitSummary(true);
}

function scheduleAdvance(): void {
  if (playback !== "playing" || timer !== undefined) return;
  const targetDelay =
    (PLAYBACK_ADVANCE_FLOW_THROUGH_TIME / targetPlaybackRate) * 1000 - lastAdvanceDuration;
  const delay = Math.max(0, targetDelay);
  timer = setTimeout(() => {
    timer = undefined;
    if (playback !== "playing") return;
    const started = performance.now();
    advance(PLAYBACK_ADVANCE_FLOW_THROUGH_TIME);
    lastAdvanceDuration = performance.now() - started;
    scheduleAdvance();
  }, delay);
}

function advance(amount: number): void {
  if (simulation === undefined) return;
  const now = performance.now();
  const elapsedSeconds = Math.max((now - lastAdvanceAt) / 1000, Number.EPSILON);
  lastAdvanceAt = now;
  let remaining = amount;
  let summary = simulation.summary();
  while (remaining > 1e-9) {
    const increment = Math.min(remaining, PLAYBACK_DIAGNOSTIC_FLOW_THROUGH_TIME);
    summary = simulation.advanceBy(increment);
    remaining -= increment;
    if (summary.availability === "unavailable") break;
  }
  achievedPlaybackRate = amount / elapsedSeconds;
  if (summary.availability === "unavailable") {
    pause();
    emitUnavailable(summary.unavailableReason ?? "Numerical health checks failed.");
    return;
  }
  render(amount);
  emitSummary(playback === "paused" || now - lastSummaryAt >= 100);
}

function render(flowThroughIncrement: number): void {
  if (simulation === undefined) return;
  const field = simulation.flowField();
  if (renderer !== undefined) {
    renderer.render(field, flowThroughIncrement, tracersEnabled, encodingFocus);
    return;
  }
  if (rasterRenderer !== undefined) {
    const frame = rasterRenderer.render(
      field,
      flowThroughIncrement,
      tracersEnabled,
      encodingFocus,
    );
    if (frame === undefined) return;
    emit(
      { type: "frame", ...frame },
      [frame.pixels.buffer as ArrayBuffer],
    );
  }
}

function pause(): void {
  playback = "paused";
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

function emitSummary(force: boolean): void {
  if (!force || simulation === undefined) return;
  lastSummaryAt = performance.now();
  emit({ type: "summary", summary: currentEngineSummary() });
}

async function captureStill(): Promise<void> {
  if (simulation === undefined) return;
  try {
    const image =
      renderer !== undefined
        ? await renderer.captureStill()
        : rasterRenderer?.captureStill(
            simulation.flowField(),
            tracersEnabled,
            encodingFocus,
          );
    if (image === undefined) throw new Error("The Worker renderer is unavailable.");
    emit({ type: "still", image, summary: currentEngineSummary() });
  } catch (error) {
    pause();
    emitUnavailable(
      error instanceof Error ? error.message : "The baseline still could not be captured.",
    );
  }
}

function currentEngineSummary(): EngineSummary {
  if (simulation === undefined) {
    throw new Error("The CPU wake simulation is not initialised.");
  }
  const summary = simulation.summary();
  return {
    scenario: summary.scenario,
    reynoldsNumber: summary.reynoldsNumber,
    targetReynoldsNumber: summary.targetReynoldsNumber,
    flowThroughTime: summary.flowThroughTime,
    regime: summary.regime,
    playback,
    targetPlaybackRate,
    achievedPlaybackRate,
    tracersEnabled,
    ...(summary.strouhalNumber === undefined
      ? {}
      : { strouhalNumber: summary.strouhalNumber }),
  };
}

function emitUnavailable(reason: string): void {
  emit({
    type: "unavailable",
    reason: `${reason} No physical conclusion should be drawn from this result.`,
    restartChoices: ["same-tier"],
  });
}

function emit(payload: EngineEventPayload, transfer?: Transferable[]): void {
  if (sessionId === undefined) return;
  sequence += 1;
  const event = {
    protocolVersion: ENGINE_PROTOCOL_VERSION,
    sessionId,
    sequence,
    ...payload,
  } as EngineEvent;
  scope.postMessage(event, transfer);
}
