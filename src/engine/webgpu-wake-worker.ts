import { createWebGpuValidationBackend } from "../validation/webgpu-backend.js";
import type { WebGpuDeviceHandle } from "../validation/webgpu-api.js";
import { WEBGPU_PRODUCTION_TIER } from "./quality-tiers.js";
import {
  ENGINE_PROTOCOL_VERSION,
  type EngineCommand,
  type EngineEvent,
  type EngineSummary,
} from "./protocol.js";
import { WebGpuWakeSimulation } from "./webgpu-wake-simulation.js";

interface WakeWorkerScope {
  onmessage: ((event: MessageEvent<EngineCommand>) => void) | null;
  postMessage(event: EngineEvent, transfer?: Transferable[]): void;
  close(): void;
}

const scope = self as unknown as WakeWorkerScope;
const FIXED_STEP_FLOW_THROUGH_TIME = 0.05;
const PLAYBACK_ADVANCE_FLOW_THROUGH_TIME = 0.4;

let sessionId: string | undefined;
let sequence = 0;
let simulation: WebGpuWakeSimulation | undefined;
let device: WebGpuDeviceHandle | undefined;
let renderCanvas: OffscreenCanvas | undefined;
let renderContext: OffscreenCanvasRenderingContext2D | undefined;
let fieldCanvas: OffscreenCanvas | undefined;
let fieldContext: OffscreenCanvasRenderingContext2D | undefined;
let playback: "playing" | "paused" = "paused";
let targetPlaybackRate: number = WEBGPU_PRODUCTION_TIER.defaultPlaybackRate;
let achievedPlaybackRate = 0;
let tracersEnabled = true;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastAdvanceAt = performance.now();
let lastAdvanceDuration = 0;
let commandQueue = Promise.resolve();

type EngineEventPayload =
  | Pick<Extract<EngineEvent, { readonly type: "ready" }>, "type" | "tier">
  | Pick<Extract<EngineEvent, { readonly type: "summary" }>, "type" | "summary">
  | Pick<Extract<EngineEvent, { readonly type: "still" }>, "type" | "image" | "summary">
  | Pick<Extract<EngineEvent, { readonly type: "frame" }>, "type" | "width" | "height" | "pixels">
  | Pick<Extract<EngineEvent, { readonly type: "unavailable" }>, "type" | "reason" | "restartChoices">;

scope.onmessage = ({ data }) => {
  if (data.protocolVersion !== ENGINE_PROTOCOL_VERSION) return;
  commandQueue = commandQueue
    .then(() => handleCommand(data))
    .catch((error: unknown) => {
      pause();
      emitUnavailable(error instanceof Error ? error.message : "The WebGPU result is unavailable.");
    });
};

async function handleCommand(data: EngineCommand): Promise<void> {
  if (data.type === "initialise") {
    await initialise(data);
    return;
  }
  if (sessionId === undefined || data.sessionId !== sessionId || simulation === undefined) return;
  switch (data.type) {
    case "resize":
      resizeRenderCanvas(data.viewport);
      await renderFrame(0);
      break;
    case "play":
      playback = "playing";
      scheduleAdvance();
      emitSummary();
      break;
    case "pause":
      pause();
      emitSummary();
      break;
    case "step":
      pause();
      await advance(FIXED_STEP_FLOW_THROUGH_TIME);
      break;
    case "restart":
      await simulation.restart();
      clearTracers();
      await renderFrame(0);
      emitSummary();
      break;
    case "capture-still":
      await captureStill();
      break;
    case "set-scenario":
      await simulation.setScenario(data.scenario);
      await renderFrame(0);
      emitSummary();
      break;
    case "set-playback-rate":
      if (!Number.isFinite(data.targetFlowThroughTimePerSecond) || data.targetFlowThroughTimePerSecond <= 0) {
        throw new RangeError("Playback rate must be positive and finite.");
      }
      targetPlaybackRate = data.targetFlowThroughTimePerSecond;
      emitSummary();
      break;
    case "set-tracers-enabled":
      tracersEnabled = data.enabled;
      if (!tracersEnabled) clearTracers();
      await renderFrame(0);
      emitSummary();
      break;
    case "dispose":
      pause();
      await simulation.dispose();
      device?.destroy();
      sessionId = undefined;
      simulation = undefined;
      device = undefined;
      renderCanvas = undefined;
      renderContext = undefined;
      fieldCanvas = undefined;
      fieldContext = undefined;
      scope.close();
      break;
    default:
      data satisfies never;
  }
}

async function initialise(
  command: Extract<EngineCommand, { readonly type: "initialise" }>,
): Promise<void> {
  pause();
  sessionId = command.sessionId;
  sequence = 0;
  const backend = await createWebGpuValidationBackend();
  if (backend.status !== "ready") throw new Error(`${backend.reason}: ${backend.message}`);
  device = backend.device;
  simulation = await WebGpuWakeSimulation.create(device, command.scenario);
  renderCanvas = command.renderTarget.kind === "offscreen-canvas"
    ? command.renderTarget.canvas
    : undefined;
  renderContext = renderCanvas?.getContext("2d", { alpha: false }) ?? undefined;
  fieldCanvas = new OffscreenCanvas(1, 1);
  fieldContext = fieldCanvas.getContext("2d", { alpha: false }) ?? undefined;
  if (fieldContext === undefined || (renderCanvas !== undefined && renderContext === undefined)) {
    throw new Error("The WebGPU worker could not create its frame presentation context.");
  }
  resizeRenderCanvas(command.viewport);
  playback = "paused";
  tracersEnabled = !command.reducedMotion;
  targetPlaybackRate = WEBGPU_PRODUCTION_TIER.defaultPlaybackRate;
  achievedPlaybackRate = 0;
  await renderFrame(0);
  emit({ type: "ready", tier: WEBGPU_PRODUCTION_TIER });
  emitSummary();
}

function scheduleAdvance(): void {
  if (playback !== "playing" || timer !== undefined) return;
  const targetDelay =
    (PLAYBACK_ADVANCE_FLOW_THROUGH_TIME / targetPlaybackRate) * 1000 - lastAdvanceDuration;
  timer = setTimeout(() => {
    timer = undefined;
    if (playback !== "playing") return;
    const started = performance.now();
    commandQueue = commandQueue
      .then(() => advance(PLAYBACK_ADVANCE_FLOW_THROUGH_TIME))
      .then(() => {
        lastAdvanceDuration = performance.now() - started;
        scheduleAdvance();
      })
      .catch((error: unknown) => {
        pause();
        emitUnavailable(error instanceof Error ? error.message : "The WebGPU result is unavailable.");
      });
  }, Math.max(0, targetDelay));
}

async function advance(amount: number): Promise<void> {
  if (simulation === undefined) return;
  const now = performance.now();
  const elapsedSeconds = Math.max((now - lastAdvanceAt) / 1000, Number.EPSILON);
  lastAdvanceAt = now;
  const summary = await simulation.advanceBy(amount);
  achievedPlaybackRate = amount / elapsedSeconds;
  if (summary.availability === "unavailable") {
    pause();
    emitUnavailable(summary.unavailableReason ?? "Numerical health checks failed.");
    return;
  }
  await renderFrame(amount);
  emitSummary();
}

async function renderFrame(_flowThroughIncrement: number): Promise<void> {
  if (simulation === undefined) return;
  const frame = await simulation.renderFrame(_flowThroughIncrement, tracersEnabled);
  if (fieldCanvas === undefined || fieldContext === undefined) {
    throw new Error("The WebGPU worker frame buffer is unavailable.");
  }
  if (fieldCanvas.width !== frame.width || fieldCanvas.height !== frame.height) {
    fieldCanvas.width = frame.width;
    fieldCanvas.height = frame.height;
  }
  const image = fieldContext.createImageData(frame.width, frame.height);
  image.data.set(frame.pixels);
  fieldContext.putImageData(image, 0, 0);
  drawDomainCoordinates(fieldContext, frame.width, frame.height);
  if (renderCanvas !== undefined && renderContext !== undefined) {
    renderContext.imageSmoothingEnabled = true;
    renderContext.drawImage(fieldCanvas, 0, 0, renderCanvas.width, renderCanvas.height);
    return;
  }
  const presentedPixels = new Uint8ClampedArray(
    fieldContext.getImageData(0, 0, frame.width, frame.height).data,
  );
  emit(
    { type: "frame", width: frame.width, height: frame.height, pixels: presentedPixels },
    [presentedPixels.buffer as ArrayBuffer],
  );
}

async function captureStill(): Promise<void> {
  if (simulation === undefined) return;
  await renderFrame(0);
  const captureCanvas = renderCanvas ?? fieldCanvas;
  if (captureCanvas === undefined) throw new Error("The Worker renderer is unavailable.");
  const image = await captureCanvas.convertToBlob({ type: "image/png" });
  emit({ type: "still", image, summary: currentEngineSummary() });
}

function clearTracers(): void {
  simulation?.resetTracers();
}

function resizeRenderCanvas(viewport: Extract<EngineCommand, { readonly type: "resize" | "initialise" }>['viewport']): void {
  if (renderCanvas === undefined) return;
  renderCanvas.width = Math.max(1, Math.round(viewport.cssWidth * viewport.pixelRatio));
  renderCanvas.height = Math.max(1, Math.round(viewport.cssHeight * viewport.pixelRatio));
}

function drawDomainCoordinates(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  context.fillStyle = "rgba(247, 250, 252, 0.9)";
  context.strokeStyle = "rgba(247, 250, 252, 0.65)";
  context.lineWidth = 1;
  context.font = "12px system-ui";
  context.fillText("x/D →", Math.max(4, width - 42), Math.max(14, height - 6));
  context.fillText("y/D", 6, 14);
  context.beginPath();
  context.moveTo(6, Math.max(18, height - 16));
  context.lineTo(Math.max(18, width - 8), Math.max(18, height - 16));
  context.moveTo(16, Math.max(18, height - 6));
  context.lineTo(16, 8);
  context.stroke();
}

function pause(): void {
  playback = "paused";
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

function emitSummary(): void {
  if (simulation !== undefined) emit({ type: "summary", summary: currentEngineSummary() });
}

function currentEngineSummary(): EngineSummary {
  if (simulation === undefined) throw new Error("The WebGPU wake simulation is not initialised.");
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
    ...(summary.strouhalNumber === undefined ? {} : { strouhalNumber: summary.strouhalNumber }),
  };
}

function emitUnavailable(reason: string): void {
  emit({
    type: "unavailable",
    reason: `${reason} No physical conclusion should be drawn from this result.`,
    restartChoices: ["same-tier", "lower-tier"],
  });
}

function emit(payload: EngineEventPayload, transfer?: Transferable[]): void {
  if (sessionId === undefined) return;
  sequence += 1;
  scope.postMessage({
    protocolVersion: ENGINE_PROTOCOL_VERSION,
    sessionId,
    sequence,
    ...payload,
  } as EngineEvent, transfer);
}
