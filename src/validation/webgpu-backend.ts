import {
  VALIDATION_SCHEMA_VERSION,
  type BackendIdentity,
  type FixedStepSolverBackend,
  type SolverBackend,
  type ValidationCaseDefinition,
  type ValidationSample,
} from "./types.js";
import type {
  WebGpuAdapterHandle,
  WebGpuDeviceHandle,
  WebGpuNavigatorHandle,
} from "./webgpu-api.js";
import {
  WebGpuExecutionError,
  createWebGpuCaseRuntime,
  type WebGpuCaseRuntime,
} from "./webgpu-runtime.js";
export { WebGpuExecutionError } from "./webgpu-runtime.js";

export type { WebGpuAdapterHandle, WebGpuDeviceHandle } from "./webgpu-api.js";

export const WEBGPU_MATCHED_CONFIGURATION_MIN_BUFFER_BYTES = 8 * 1024 * 1024;

export const WEBGPU_BACKEND_IDENTITY = Object.freeze({
  schemaVersion: VALIDATION_SCHEMA_VERSION,
  id: "webgpu-reference",
  kind: "webgpu",
  solver: "D2Q9 TRT/BFL open-cylinder WebGPU",
  solverVersion: "1.0.0",
  buildId: "ticket-08",
} satisfies BackendIdentity);

export interface WebGpuPlatform {
  requestAdapter(): Promise<WebGpuAdapterHandle | null>;
}

export interface WebGpuUnavailableResult {
  readonly status: "unavailable";
  readonly reason:
    | "missing-adapter"
    | "unsupported-capability"
    | "diagnostic-failure"
    | "device-lost";
  readonly message: string;
}

export type WebGpuCaseRuntimeFactory = (
  device: WebGpuDeviceHandle,
) => WebGpuCaseRuntime;

export interface WebGpuReadyResult {
  readonly status: "ready";
  readonly backend: FixedStepSolverBackend;
  readonly device: WebGpuDeviceHandle;
  readonly deviceLost: Promise<WebGpuUnavailableResult>;
}

export type WebGpuBackendResult = WebGpuUnavailableResult | WebGpuReadyResult;

export type WebGpuCaseExecutionResult =
  | {
      readonly status: "complete";
      readonly samples: readonly ValidationSample[];
    }
  | WebGpuUnavailableResult;

export function createBrowserWebGpuPlatform(
  navigatorObject: { readonly gpu?: WebGpuNavigatorHandle } = globalThis.navigator as {
    readonly gpu?: WebGpuNavigatorHandle;
  },
): WebGpuPlatform {
  return {
    requestAdapter: () =>
      navigatorObject.gpu?.requestAdapter({ powerPreference: "high-performance" }) ??
      Promise.resolve(null),
  };
}

export async function collectWebGpuValidationCase(
  backend: SolverBackend,
  definition: ValidationCaseDefinition,
): Promise<WebGpuCaseExecutionResult> {
  const samples: ValidationSample[] = [];
  try {
    for await (const sample of backend.runCase(definition)) samples.push(sample);
    return { status: "complete", samples };
  } catch (error) {
    if (error instanceof WebGpuExecutionError) {
      return {
        status: "unavailable",
        reason: error.reason,
        message: error.message,
      };
    }
    return {
      status: "unavailable",
      reason: "diagnostic-failure",
      message: `WebGPU case execution failed before diagnostics completed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export async function createWebGpuValidationBackend(
  platform: WebGpuPlatform = createBrowserWebGpuPlatform(),
  runtimeFactory: WebGpuCaseRuntimeFactory = createWebGpuCaseRuntime,
): Promise<WebGpuBackendResult> {
  const adapter = await platform.requestAdapter();
  if (adapter === null) {
    return {
      status: "unavailable",
      reason: "missing-adapter",
      message: "WebGPU is unavailable because the browser did not provide an adapter.",
    };
  }
  if (
    adapter.limits.maxBufferSize < WEBGPU_MATCHED_CONFIGURATION_MIN_BUFFER_BYTES ||
    adapter.limits.maxStorageBufferBindingSize <
      WEBGPU_MATCHED_CONFIGURATION_MIN_BUFFER_BYTES
  ) {
    return {
      status: "unavailable",
      reason: "unsupported-capability",
      message:
        "WebGPU is unavailable because the adapter cannot hold the matched configuration's GPU-resident fields.",
    };
  }
  let device: WebGpuDeviceHandle;
  try {
    device = await adapter.requestDevice({
      label: "cfdVisualise WebGPU validation device",
      requiredLimits: {
        maxBufferSize: WEBGPU_MATCHED_CONFIGURATION_MIN_BUFFER_BYTES,
        maxStorageBufferBindingSize: WEBGPU_MATCHED_CONFIGURATION_MIN_BUFFER_BYTES,
      },
    });
  } catch {
    return {
      status: "unavailable",
      reason: "unsupported-capability",
      message:
        "WebGPU is unavailable because the adapter could not create the required device.",
    };
  }
  let runtime: WebGpuCaseRuntime;
  try {
    runtime = runtimeFactory(device);
  } catch (error) {
    return {
      status: "unavailable",
      reason: "diagnostic-failure",
      message: `WebGPU runtime initialisation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  return {
    status: "ready",
    device,
    deviceLost: device.lost.then((information) => ({
      status: "unavailable",
      reason: "device-lost",
      message: `The WebGPU result is unavailable because the device was lost${
        information.message === undefined ? "." : `: ${information.message}.`
      }`,
    })),
    backend: {
      schemaVersion: VALIDATION_SCHEMA_VERSION,
      identity: WEBGPU_BACKEND_IDENTITY,
      runCase(definition) {
        return runtime.runCase(definition);
      },
      createCase(definition) {
        return runtime.createCase(definition);
      },
    },
  };
}
