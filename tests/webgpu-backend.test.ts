import { describe, expect, it } from "vitest";

import {
  WEBGPU_BACKEND_IDENTITY,
  collectWebGpuValidationCase,
  createWebGpuValidationBackend,
  type WebGpuDeviceHandle,
} from "../src/validation/webgpu-backend.js";
import {
  WebGpuExecutionError,
  webGpuTracerDirectionEmphasis,
} from "../src/validation/webgpu-runtime.js";
import { STEADY_RE20_VALIDATION_SUITE } from "../src/validation/index.js";

describe("WebGPU validation backend", () => {
  it("keeps a head-to-tail brightness gradient as a static direction cue", () => {
    expect(webGpuTracerDirectionEmphasis(0)).toBeCloseTo(0.45);
    expect(webGpuTracerDirectionEmphasis(0.5)).toBeGreaterThan(
      webGpuTracerDirectionEmphasis(0),
    );
    expect(webGpuTracerDirectionEmphasis(1)).toBe(1);
  });

  it("reports an explicit unavailable state when no adapter exists", async () => {
    const result = await createWebGpuValidationBackend({
      requestAdapter: async () => null,
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "missing-adapter",
      message: "WebGPU is unavailable because the browser did not provide an adapter.",
    });
  });

  it("reports an unsupported capability before requesting a device", async () => {
    let requestedDevice = false;
    const result = await createWebGpuValidationBackend({
      requestAdapter: async () => ({
        limits: {
          maxBufferSize: 4_194_304,
          maxStorageBufferBindingSize: 4_194_304,
        },
        requestDevice: async () => {
          requestedDevice = true;
          throw new Error("must not request an unsupported device");
        },
      }),
    });

    expect(requestedDevice).toBe(false);
    expect(result).toEqual({
      status: "unavailable",
      reason: "unsupported-capability",
      message:
        "WebGPU is unavailable because the adapter cannot hold the matched configuration's GPU-resident fields.",
    });
  });

  it("creates a backend at the shared validation seam", async () => {
    const device = {
      lost: new Promise<never>(() => undefined),
    } as unknown as WebGpuDeviceHandle;
    const result = await createWebGpuValidationBackend(
      {
        requestAdapter: async () => ({
          limits: {
            maxBufferSize: 128 * 1024 * 1024,
            maxStorageBufferBindingSize: 128 * 1024 * 1024,
          },
          requestDevice: async () => device,
        }),
      },
      () => ({
        async *runCase() {
          return;
        },
        async createCase() {
          throw new Error("not used");
        },
      }),
    );

    expect(result).toMatchObject({
      status: "ready",
      backend: {
        schemaVersion: "1",
        identity: WEBGPU_BACKEND_IDENTITY,
      },
    });
  });

  it("reports a diagnostic failure without returning physical samples", async () => {
    const device = {
      lost: new Promise<never>(() => undefined),
    } as unknown as WebGpuDeviceHandle;
    const backendResult = await createWebGpuValidationBackend(
      {
        requestAdapter: async () => ({
          limits: {
            maxBufferSize: 128 * 1024 * 1024,
            maxStorageBufferBindingSize: 128 * 1024 * 1024,
          },
          requestDevice: async () => device,
        }),
      },
      () => ({
        async *runCase() {
          throw new WebGpuExecutionError(
            "diagnostic-failure",
            "The compact reduction contained NaN.",
          );
        },
        async createCase() {
          throw new Error("not used");
        },
      }),
    );
    if (backendResult.status !== "ready") {
      throw new Error("Expected the injected WebGPU device to be ready.");
    }

    const execution = await collectWebGpuValidationCase(
      backendResult.backend,
      STEADY_RE20_VALIDATION_SUITE.cases[0]!,
    );

    expect(execution).toEqual({
      status: "unavailable",
      reason: "diagnostic-failure",
      message: "The compact reduction contained NaN.",
    });
  });

  it("classifies native runtime failures instead of leaking browser exceptions", async () => {
    const backend = {
      schemaVersion: "1" as const,
      identity: WEBGPU_BACKEND_IDENTITY,
      async *runCase() {
        throw new Error("OperationError: mapping failed");
      },
    };

    await expect(
      collectWebGpuValidationCase(
        backend,
        STEADY_RE20_VALIDATION_SUITE.cases[0]!,
      ),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "diagnostic-failure",
      message:
        "WebGPU case execution failed before diagnostics completed: OperationError: mapping failed",
    });
  });
});
