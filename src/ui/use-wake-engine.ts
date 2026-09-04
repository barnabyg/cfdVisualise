import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import {
  DEFAULT_PHYSICAL_SCENARIO,
  reynoldsNumber,
  type PhysicalScenario,
} from "../engine/physical-scenario.js";
import { WebGpuWakeSimulation } from "../engine/webgpu-wake-simulation.js";
import {
  ENGINE_PROTOCOL_VERSION,
  createEngineEventGate,
  type CanvasViewport,
  type QualityTierIdentity,
  type EngineBaseline,
  type EngineCommand,
  type EngineCommandPayload,
  type EngineEvent,
  type EngineSummary,
  type WakeEncodingFocus,
} from "../engine/protocol.js";
import {
  BUNDLED_QUALITY_TIERS,
  changeManualTier,
  selectBenchmarkTier,
  selectManualTier,
  type TierBenchmarkResult,
} from "../engine/quality-tiers.js";
import { CPU_PRODUCTION_TIER } from "../engine/cpu-tier.js";
import { createWebGpuValidationBackend } from "../validation/webgpu-backend.js";
import { CPU_PRODUCTION_VALIDATION_SUITE } from "../validation/cpu-production-reference.js";

interface TransferableCanvasElement extends HTMLCanvasElement {
  transferControlToOffscreen(): OffscreenCanvas;
}

export interface WakeWorkerPort {
  onmessage: ((event: MessageEvent<EngineEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(command: EngineCommand, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface UseWakeEngineOptions {
  readonly workerFactory?: () => WakeWorkerPort;
  readonly tierWorkerFactory?: (identity: QualityTierIdentity) => WakeWorkerPort;
  readonly benchmark?: (identity: QualityTierIdentity) => Promise<TierBenchmarkResult>;
  readonly sessionIdFactory?: () => string;
  readonly reducedMotion?: boolean;
}

export interface WakeEngineFacade {
  readonly canvasRef: (canvas: HTMLCanvasElement | null) => void;
  readonly summary: EngineSummary;
  readonly encodingFocus: WakeEncodingFocus;
  readonly tier?: QualityTierIdentity;
  readonly availableTiers: readonly QualityTierIdentity[];
  readonly unavailableReason?: string;
  readonly restartChoices?: readonly ("same-tier" | "lower-tier")[];
  readonly capturedStill?: EngineBaseline;
  play(): void;
  pause(): void;
  step(): void;
  restart(): void;
  restartTier(): void;
  changeTier(tierId: string): void;
  captureStill(): void;
  resetGuide(): void;
  setScenario(scenario: PhysicalScenario): void;
  setPlaybackRate(rate: number): void;
  setTracersEnabled(enabled: boolean): void;
  setEncodingFocus(focus: WakeEncodingFocus): void;
}

const INITIAL_SUMMARY: EngineSummary = Object.freeze({
  scenario: DEFAULT_PHYSICAL_SCENARIO,
  reynoldsNumber: 20,
  targetReynoldsNumber: 20,
  flowThroughTime: 0,
  regime: "developing",
  playback: "paused",
  targetPlaybackRate: 1,
  achievedPlaybackRate: 0,
  tracersEnabled: true,
});

export function useWakeEngine(options: UseWakeEngineOptions = {}): WakeEngineFacade {
  const workerRef = useRef<WakeWorkerPort>();
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const framePresenterRef = useRef<WorkerFramePresenter>();
  const sessionIdRef = useRef("");
  const scenarioRef = useRef<PhysicalScenario>(DEFAULT_PHYSICAL_SCENARIO);
  const encodingFocusRef = useRef<WakeEncodingFocus>("combined");
  const [summary, setSummary] = useState(INITIAL_SUMMARY);
  const [encodingFocus, setEncodingFocus] = useState<WakeEncodingFocus>("combined");
  const [tier, setTier] = useState<QualityTierIdentity>();
  const [selectedTier, setSelectedTier] = useState<QualityTierIdentity>();
  const [unavailableReason, setUnavailableReason] = useState<string>();
  const [restartChoices, setRestartChoices] = useState<readonly ("same-tier" | "lower-tier")[]>();
  const [engineGeneration, setEngineGeneration] = useState(0);
  const [capturedStill, setCapturedStill] = useState<EngineBaseline>();

  const canvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasElementRef.current = canvas;
  }, []);

  useEffect(() => {
    if (options.workerFactory !== undefined) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const storedTierId = globalThis.localStorage?.getItem("cfd-visualise-quality-tier");
        const selected = storedTierId === null || storedTierId === undefined
          ? await selectBenchmarkTier({
              benchmark: options.benchmark ?? benchmarkBrowserQualityTier,
            })
          : selectManualTier(storedTierId);
        if (!cancelled) setSelectedTier(selected.identity);
      } catch (error) {
        if (!cancelled) {
          setUnavailableReason(
            error instanceof Error
              ? error.message
              : "No validated quality tier is supported on this device.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (options.workerFactory === undefined && selectedTier === undefined) return undefined;
    const worker = options.workerFactory?.() ??
      (options.tierWorkerFactory ?? createBrowserWakeWorker)(selectedTier!);
    const sessionId = (options.sessionIdFactory ?? createSessionId)();
    const canvas = canvasElementRef.current;
    if (canvas === null) throw new Error("The wake canvas was not mounted.");
    const transferableCanvas = canvas as TransferableCanvasElement;
    const eventGate = createEngineEventGate(sessionId);
    workerRef.current = worker;
    sessionIdRef.current = sessionId;
    worker.onmessage = ({ data }) => {
      if (!eventGate.accept(data)) return;
      if (data.type === "ready") {
        setTier(data.tier);
        setRestartChoices(undefined);
      } else if (data.type === "summary") {
        scenarioRef.current = data.summary.scenario;
        setSummary(data.summary);
        setUnavailableReason(undefined);
        setRestartChoices(undefined);
      } else if (data.type === "still") {
        setCapturedStill({ image: data.image, summary: data.summary });
      } else if (data.type === "frame") {
        framePresenterRef.current?.present(data);
      } else {
        setUnavailableReason(data.reason);
        setRestartChoices(data.restartChoices);
      }
    };
    worker.onerror = (event) => {
      setUnavailableReason(event.message || "The CPU Worker stopped unexpectedly.");
    };
    const viewport = measureViewport(canvas);
    const reducedMotion =
      options.reducedMotion ??
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
      false;
    if (
      options.workerFactory !== undefined &&
      typeof transferableCanvas.transferControlToOffscreen === "function"
    ) {
      const offscreen = transferableCanvas.transferControlToOffscreen();
      worker.postMessage(
        envelope(sessionId, {
          type: "initialise",
          renderTarget: { kind: "offscreen-canvas", canvas: offscreen },
          viewport,
          scenario: scenarioRef.current,
          reducedMotion,
          encodingFocus: encodingFocusRef.current,
        }),
        [offscreen],
      );
    } else {
      framePresenterRef.current = new WorkerFramePresenter(canvas, viewport);
      worker.postMessage(
        envelope(sessionId, {
          type: "initialise",
          renderTarget: { kind: "frame-events" },
          viewport,
          scenario: scenarioRef.current,
          reducedMotion,
          encodingFocus: encodingFocusRef.current,
        }),
      );
    }
    const resizeObserver = new ResizeObserver(() => {
      const nextViewport = measureViewport(canvas);
      framePresenterRef.current?.resize(nextViewport);
      worker.postMessage(envelope(sessionId, { type: "resize", viewport: nextViewport }));
    });
    resizeObserver.observe(canvas);

    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      resizeObserver.disconnect();
      worker.postMessage(envelope(sessionId, { type: "dispose" }));
      worker.terminate();
      workerRef.current = undefined;
      framePresenterRef.current = undefined;
    };
    globalThis.addEventListener("pagehide", dispose, { once: true });

    return () => {
      globalThis.removeEventListener("pagehide", dispose);
      dispose();
    };
  }, [selectedTier?.id, engineGeneration]);

  const send = useCallback((payload: EngineCommandPayload) => {
    const worker = workerRef.current;
    if (worker === undefined) return;
    worker.postMessage(envelope(sessionIdRef.current, payload));
  }, []);

  return {
    canvasRef,
    summary,
    encodingFocus,
    availableTiers: BUNDLED_QUALITY_TIERS.map(({ identity }) => identity),
    ...(tier === undefined ? {} : { tier }),
    ...(unavailableReason === undefined ? {} : { unavailableReason }),
    ...(restartChoices === undefined ? {} : { restartChoices }),
    ...(capturedStill === undefined ? {} : { capturedStill }),
    play: () => send({ type: "play" }),
    pause: () => send({ type: "pause" }),
    step: () => send({ type: "step" }),
    restart: () => send({ type: "restart" }),
    restartTier: () => {
      setUnavailableReason(undefined);
      setRestartChoices(undefined);
      setEngineGeneration((generation) => generation + 1);
    },
    changeTier: (tierId) => {
      const selected = changeManualTier(tierId, (identity) => {
        setTier(undefined);
        setUnavailableReason(undefined);
        setRestartChoices(undefined);
        setCapturedStill(undefined);
        const scenario = scenarioRef.current;
        const activeReynoldsNumber = reynoldsNumber(scenario);
        setSummary({
          ...INITIAL_SUMMARY,
          scenario,
          reynoldsNumber: activeReynoldsNumber,
          targetReynoldsNumber: activeReynoldsNumber,
        });
        setSelectedTier(identity);
      });
      globalThis.localStorage?.setItem("cfd-visualise-quality-tier", selected.identity.id);
    },
    captureStill: () => send({ type: "capture-still" }),
    resetGuide: () => {
      setCapturedStill(undefined);
      scenarioRef.current = DEFAULT_PHYSICAL_SCENARIO;
      send({ type: "set-scenario", scenario: DEFAULT_PHYSICAL_SCENARIO });
      send({ type: "restart" });
      send({ type: "play" });
    },
    setScenario: (scenario) => {
      scenarioRef.current = scenario;
      send({ type: "set-scenario", scenario });
    },
    setPlaybackRate: (targetFlowThroughTimePerSecond) =>
      send({ type: "set-playback-rate", targetFlowThroughTimePerSecond }),
    setTracersEnabled: (enabled) => send({ type: "set-tracers-enabled", enabled }),
    setEncodingFocus: (focus) => {
      encodingFocusRef.current = focus;
      setEncodingFocus(focus);
      send({ type: "set-encoding-focus", focus });
    },
  };
}

function envelope<T extends EngineCommandPayload>(
  sessionId: string,
  payload: T,
): T & {
  readonly protocolVersion: typeof ENGINE_PROTOCOL_VERSION;
  readonly sessionId: string;
} {
  return { protocolVersion: ENGINE_PROTOCOL_VERSION, sessionId, ...payload };
}

function measureViewport(canvas: HTMLCanvasElement): CanvasViewport {
  const bounds = canvas.getBoundingClientRect();
  return {
    cssWidth: Math.max(1, bounds.width || canvas.clientWidth || 960),
    cssHeight: Math.max(1, bounds.height || canvas.clientHeight || 540),
    pixelRatio: Math.max(1, globalThis.devicePixelRatio || 1),
  };
}

function createBrowserWakeWorker(identity: QualityTierIdentity): WakeWorkerPort {
  if (identity.backendId === "webgpu-reference") {
    return new Worker(new URL("../engine/webgpu-wake-worker.js", import.meta.url), {
      type: "module",
      name: "cfd-visualise-webgpu-reference-wake",
    });
  }
  return new Worker(new URL("../engine/cpu-wake-worker.js", import.meta.url), {
    type: "module",
    name: `cfd-visualise-${identity.backendId}-wake`,
  });
}

export async function benchmarkBrowserQualityTier(
  identity: QualityTierIdentity,
): Promise<TierBenchmarkResult> {
  if (identity.backendId === CPU_PRODUCTION_TIER.backendId) {
    const definition = CPU_PRODUCTION_VALIDATION_SUITE.cases[0];
    if (definition === undefined) {
      return { status: "unsupported", reason: "No bundled CPU benchmark case." };
    }
    try {
      const flowThroughTimePerSecond = await benchmarkCpuWorker(definition);
      return {
        status: "supported",
        flowThroughTimePerSecond,
      };
    } catch (error) {
      return {
        status: "unsupported",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (identity.backendId !== "webgpu-reference") {
    return { status: "unsupported", reason: "Unknown backend identity." };
  }
  const backend = await createWebGpuValidationBackend();
  if (backend.status !== "ready") {
    return { status: "unsupported", reason: backend.message };
  }
  let simulation: WebGpuWakeSimulation | undefined;
  try {
    simulation = await WebGpuWakeSimulation.create(
      backend.device,
      DEFAULT_PHYSICAL_SCENARIO,
    );
    for (let index = 0; index < 2; index += 1) {
      await simulation.advanceBy(0.4);
    }
    await simulation.renderFrame(0.8, true);

    const advanceCount = 4;
    const started = performance.now();
    for (let index = 0; index < advanceCount; index += 1) {
      await simulation.advanceBy(0.4);
      if ((index + 1) % 2 === 0) await simulation.renderFrame(0.8, true);
    }
    const elapsedSeconds = Math.max((performance.now() - started) / 1000, Number.EPSILON);
    return {
      status: "supported",
      flowThroughTimePerSecond: (advanceCount * 0.4) / elapsedSeconds,
    };
  } catch (error) {
    return {
      status: "unsupported",
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      await simulation?.dispose();
    } finally {
      backend.device.destroy();
    }
  }
}

function benchmarkCpuWorker(
  definition: (typeof CPU_PRODUCTION_VALIDATION_SUITE.cases)[number],
): Promise<number> {
  const worker = new Worker(new URL("../engine/cpu-capability-worker.js", import.meta.url), {
    type: "module",
    name: "cfd-visualise-cpu-capability",
  });
  return new Promise((resolvePromise, reject) => {
    worker.onmessage = ({ data }: MessageEvent<
      { readonly flowThroughTimePerSecond: number } | { readonly error: string }
    >) => {
      worker.terminate();
      if ("error" in data) reject(new Error(data.error));
      else resolvePromise(data.flowThroughTimePerSecond);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "CPU capability benchmark failed."));
    };
    worker.postMessage({ definition });
  });
}

function createSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `wake-${Date.now()}-${Math.random()}`;
}

/** Presents fully composed Worker frames; it never owns field or tracer rendering. */
class WorkerFramePresenter {
  private readonly context: CanvasRenderingContext2D;
  private readonly buffer = document.createElement("canvas");
  private readonly bufferContext: CanvasRenderingContext2D;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    viewport: CanvasViewport,
  ) {
    const context = canvas.getContext("2d", { alpha: false });
    const bufferContext = this.buffer.getContext("2d", { alpha: false });
    if (context === null || bufferContext === null) {
      throw new Error("The wake canvas could not create a 2D context.");
    }
    this.context = context;
    this.bufferContext = bufferContext;
    this.resize(viewport);
  }

  public resize(viewport: CanvasViewport): void {
    this.canvas.width = Math.max(1, Math.round(viewport.cssWidth * viewport.pixelRatio));
    this.canvas.height = Math.max(1, Math.round(viewport.cssHeight * viewport.pixelRatio));
  }

  public present(
    frame: Pick<
      Extract<EngineEvent, { readonly type: "frame" }>,
      "width" | "height" | "pixels"
    >,
  ): void {
    if (this.buffer.width !== frame.width || this.buffer.height !== frame.height) {
      this.buffer.width = frame.width;
      this.buffer.height = frame.height;
    }
    const image = this.bufferContext.createImageData(frame.width, frame.height);
    image.data.set(frame.pixels);
    this.bufferContext.putImageData(image, 0, 0);
    this.context.imageSmoothingEnabled = true;
    this.context.drawImage(this.buffer, 0, 0, this.canvas.width, this.canvas.height);
  }
}
