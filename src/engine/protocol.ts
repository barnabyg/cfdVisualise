import type { FlowRegime, PhysicalScenario } from "../validation/types.js";

export const ENGINE_PROTOCOL_VERSION = "1" as const;

export const ENGINE_COMMAND_TYPES = Object.freeze([
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
  "set-encoding-focus",
  "dispose",
] as const);

export type WakeEncodingFocus = "combined" | "motion" | "rotation";

export interface QualityTierIdentity {
  readonly id: string;
  readonly backendId: string;
  readonly buildId: string;
  readonly label: string;
  readonly cellsPerDiameter: number;
  readonly defaultPlaybackRate: number;
}

export type CpuQualityTierIdentity = QualityTierIdentity;

export interface CanvasViewport {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly pixelRatio: number;
}

interface CommandEnvelope {
  readonly protocolVersion: typeof ENGINE_PROTOCOL_VERSION;
  readonly sessionId: string;
}

export type EngineCommand =
  | (CommandEnvelope & {
      readonly type: "initialise";
      readonly renderTarget:
        | { readonly kind: "offscreen-canvas"; readonly canvas: OffscreenCanvas }
        | { readonly kind: "frame-events" };
      readonly viewport: CanvasViewport;
      readonly scenario: PhysicalScenario;
      readonly reducedMotion: boolean;
      readonly encodingFocus: WakeEncodingFocus;
    })
  | (CommandEnvelope & { readonly type: "resize"; readonly viewport: CanvasViewport })
  | (CommandEnvelope & { readonly type: "play" })
  | (CommandEnvelope & { readonly type: "pause" })
  | (CommandEnvelope & { readonly type: "step" })
  | (CommandEnvelope & { readonly type: "restart" })
  | (CommandEnvelope & { readonly type: "capture-still" })
  | (CommandEnvelope & {
      readonly type: "set-scenario";
      readonly scenario: PhysicalScenario;
    })
  | (CommandEnvelope & {
      readonly type: "set-playback-rate";
      readonly targetFlowThroughTimePerSecond: number;
    })
  | (CommandEnvelope & {
      readonly type: "set-tracers-enabled";
      readonly enabled: boolean;
    })
  | (CommandEnvelope & {
      readonly type: "set-encoding-focus";
      readonly focus: WakeEncodingFocus;
    })
  | (CommandEnvelope & { readonly type: "dispose" });

interface EventEnvelope {
  readonly protocolVersion: typeof ENGINE_PROTOCOL_VERSION;
  readonly sessionId: string;
  readonly sequence: number;
}

export interface EngineSummary {
  readonly scenario: PhysicalScenario;
  readonly reynoldsNumber: number;
  readonly targetReynoldsNumber: number;
  readonly flowThroughTime: number;
  readonly regime: FlowRegime;
  readonly playback: "playing" | "paused";
  readonly targetPlaybackRate: number;
  readonly achievedPlaybackRate: number;
  readonly tracersEnabled: boolean;
  readonly strouhalNumber?: number;
}

export interface EngineBaseline {
  readonly image: Blob;
  readonly summary: EngineSummary;
}

export type EngineCommandPayload = EngineCommand extends infer Command
  ? Command extends CommandEnvelope
    ? Omit<Command, keyof CommandEnvelope>
    : never
  : never;

export type EngineEvent =
  | (EventEnvelope & { readonly type: "ready"; readonly tier: QualityTierIdentity })
  | (EventEnvelope & { readonly type: "summary"; readonly summary: EngineSummary })
  | (EventEnvelope & { readonly type: "still" } & EngineBaseline)
  | (EventEnvelope & {
      readonly type: "frame";
      readonly width: number;
      readonly height: number;
      readonly pixels: Uint8ClampedArray;
    })
  | (EventEnvelope & {
      readonly type: "unavailable";
      readonly reason: string;
      readonly restartChoices: readonly ("same-tier" | "lower-tier")[];
    });

export interface EngineEventGate {
  accept(event: EngineEvent): boolean;
}

export function createEngineEventGate(sessionId: string): EngineEventGate {
  let latestSequence = -1;
  return {
    accept(event) {
      if (
        event.protocolVersion !== ENGINE_PROTOCOL_VERSION ||
        event.sessionId !== sessionId ||
        event.sequence <= latestSequence
      ) {
        return false;
      }
      latestSequence = event.sequence;
      return true;
    },
  };
}
