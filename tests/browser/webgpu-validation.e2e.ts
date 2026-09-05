import { expect, test } from "@playwright/test";

test("WebGPU executes the shared TRT/BFL seam with limited diagnostics", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chrome", "WebGPU validation uses software-backed Chrome.");
  await page.goto("http://127.0.0.1:4174/");

  const result = await page.evaluate(async () => {
    const backendPath = "/src/validation/webgpu-backend.ts";
    const referencePath = "/src/validation/webgpu-reference.ts";
    const cpuPath = "/src/validation/cpu-reference-backend.ts";
    const backendModule = await import(/* @vite-ignore */ backendPath);
    const referenceModule = await import(/* @vite-ignore */ referencePath);
    const cpuModule = await import(/* @vite-ignore */ cpuPath);
    const backendResult = await backendModule.createWebGpuValidationBackend();
    if (backendResult.status !== "ready") return backendResult;
    const reference = referenceModule.WEBGPU_BACKEND_VALIDATION_SUITE.cases[1];
    const definition = {
      ...reference,
      id: "webgpu-compact-browser",
      configuration: {
        ...reference.configuration,
        domain: {
          upstreamDiameters: 2,
          downstreamDiameters: 3,
          lateralDiameters: 2,
        },
      },
      protocol: {
        warmUpFlowThroughTime: 0,
        sampleFlowThroughTime: 0.4,
        sampleInterval: 0.4,
      },
      expectations: [],
    };
    const gpuCase = await backendResult.backend.createCase(definition);
    const initial = await gpuCase.execute({
      type: "sample-diagnostics",
      step: 0,
      flowThroughTime: 0,
      stepsSinceSample: 0,
    });
    await gpuCase.execute({
      type: "advance-fixed-steps",
      stepCount: 90,
      reynoldsNumber: 100,
    });
    const final = await gpuCase.execute({
      type: "sample-diagnostics",
      step: 90,
      flowThroughTime: 0.4,
      stepsSinceSample: 90,
    });
    await gpuCase.execute({ type: "dispose" });
    const cpuCase = cpuModule.createCpuFixedStepCase({
      ...definition,
      configuration: {
        ...definition.configuration,
        backendId: "cpu-reference",
        qualityTier: "cpu-browser-parity",
        precision: "float64",
      },
    });
    const cpuInitial = await cpuCase.execute({
      type: "sample-diagnostics",
      step: 0,
      flowThroughTime: 0,
      stepsSinceSample: 0,
    });
    await cpuCase.execute({
      type: "advance-fixed-steps",
      stepCount: 90,
      reynoldsNumber: 100,
    });
    const cpuFinal = await cpuCase.execute({
      type: "sample-diagnostics",
      step: 90,
      flowThroughTime: 0.4,
      stepsSinceSample: 90,
    });
    await cpuCase.execute({ type: "dispose" });
    backendResult.device.destroy();
    return { status: "complete", samples: [initial, final], cpuSamples: [cpuInitial, cpuFinal] };
  });

  if (result.status === "unavailable") {
    throw new Error(`WebGPU unavailable: ${result.reason}: ${result.message}`);
  }

  expect(result).toMatchObject({
    status: "complete",
    samples: [
      {
        step: 0,
        flowThroughTime: 0,
        density: {
          nonFiniteValueCount: 0,
          nonPositiveValueCount: 0,
        },
      },
      {
        step: 90,
        flowThroughTime: 0.4,
        density: {
          nonFiniteValueCount: 0,
          nonPositiveValueCount: 0,
        },
      },
    ],
  });
  const gpuFinal = result.samples[1]!;
  const cpuFinal = result.cpuSamples[1]!;
  expect(result.samples[0]!.symmetryError).toBeCloseTo(
    result.cpuSamples[0]!.symmetryError,
    7,
  );
  expect(gpuFinal.density.mean).toBeCloseTo(cpuFinal.density.mean, 5);
  expect(gpuFinal.dragCoefficient).toBeCloseTo(cpuFinal.dragCoefficient, 3);
  expect(gpuFinal.liftCoefficient).toBeCloseTo(cpuFinal.liftCoefficient, 3);
  expect(gpuFinal.fieldResidual).toBeCloseTo(cpuFinal.fieldResidual, 4);
});

test("WebGPU boundary alternatives remain finite", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chrome", "WebGPU validation uses software-backed Chrome.");
  test.setTimeout(90_000);
  await page.goto("http://127.0.0.1:4174/");

  const samples = await page.evaluate(async () => {
    const backendPath = "/src/validation/webgpu-backend.ts";
    const referencePath = "/src/validation/webgpu-reference.ts";
    const backendModule = await import(/* @vite-ignore */ backendPath);
    const referenceModule = await import(/* @vite-ignore */ referencePath);
    const backendResult = await backendModule.createWebGpuValidationBackend();
    if (backendResult.status !== "ready") {
      throw new Error(`${backendResult.reason}: ${backendResult.message}`);
    }
    const observed = [];
    for (const caseId of [
      "boundary-re020-equilibrium-inlet",
      "boundary-re045-periodic-lateral",
      "boundary-re100-convective-outlet",
    ]) {
      const source = referenceModule.WEBGPU_PRODUCTION_VALIDATION_SUITE.cases.find(
        ({ id }: { id: string }) => id === caseId,
      );
      if (source === undefined) throw new Error(`${caseId} is missing.`);
      const definition = {
        ...source,
        id: `webgpu-${caseId}-repro`,
        configuration: {
          ...source.configuration,
          domain: {
            upstreamDiameters: 2,
            downstreamDiameters: 3,
            lateralDiameters: 2,
          },
        },
      };
      const execution = await backendResult.backend.createCase(definition);
      for (let step = 90; step <= 900; step += 90) {
        await execution.execute({
          type: "advance-fixed-steps",
          stepCount: 90,
          reynoldsNumber: source.reynoldsNumber,
        });
        observed.push(
          await execution.execute({
            type: "sample-diagnostics",
            step,
            flowThroughTime:
              (step * execution.latticeSpeed) / execution.cylinderDiameter,
            stepsSinceSample: 90,
          }),
        );
      }
      await execution.execute({ type: "dispose" });
    }
    backendResult.device.destroy();
    return observed;
  });

  expect(samples).toHaveLength(30);
  for (const sample of samples) {
    expect(sample?.density.nonFiniteValueCount).toBe(0);
    expect(sample?.density.nonPositiveValueCount).toBe(0);
    expect(sample?.density.minimum).toBeGreaterThan(0);
  }
});

test("WebGPU combines tracers with vorticity and honours encoding focus", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chrome", "WebGPU rendering uses software-backed Chrome.");
  await page.goto("http://127.0.0.1:4174/");

  const rendering = await page.evaluate(async () => {
    const backendPath = "/src/validation/webgpu-backend.ts";
    const referencePath = "/src/validation/webgpu-reference.ts";
    const runtimePath = "/src/validation/webgpu-runtime.ts";
    const backendModule = await import(/* @vite-ignore */ backendPath);
    const referenceModule = await import(/* @vite-ignore */ referencePath);
    const runtimeModule = await import(/* @vite-ignore */ runtimePath);
    const backendResult = await backendModule.createWebGpuValidationBackend();
    if (backendResult.status !== "ready") {
      throw new Error(`${backendResult.reason}: ${backendResult.message}`);
    }
    const source = referenceModule.WEBGPU_BACKEND_VALIDATION_SUITE.cases[1];
    const definition = {
      ...source,
      id: "webgpu-tracer-render-browser",
      configuration: {
        ...source.configuration,
        domain: {
          upstreamDiameters: 2,
          downstreamDiameters: 3,
          lateralDiameters: 2,
        },
      },
    };
    const execution = await runtimeModule.createWebGpuInteractiveCase(
      backendResult.device,
      definition,
    );
    await execution.execute({
      type: "advance-fixed-steps",
      stepCount: 540,
      reynoldsNumber: source.reynoldsNumber,
    });
    const withoutTracers = await execution.renderFrame(0, false);
    const withTracers = await execution.renderFrame(0.1, true);
    const motionFocused = await execution.renderFrame(0, true, "motion");
    const rotationFocused = await execution.renderFrame(0, true, "rotation");
    const pixelDifference = (
      left: Uint8ClampedArray,
      right: Uint8ClampedArray,
    ) => {
      let changed = 0;
      let total = 0;
      for (let index = 0; index < left.length; index += 4) {
        const difference = Math.abs(left[index]! - right[index]!)
          + Math.abs(left[index + 1]! - right[index + 1]!)
          + Math.abs(left[index + 2]! - right[index + 2]!);
        if (difference > 0) changed += 1;
        total += difference;
      }
      return { changed, total };
    };
    const combinedTracerDifference = pixelDifference(withoutTracers.pixels, withTracers.pixels);
    const rotationTracerDifference = pixelDifference(withoutTracers.pixels, rotationFocused.pixels);
    const focusDifference = pixelDifference(withTracers.pixels, motionFocused.pixels);
    await execution.execute({ type: "dispose" });
    backendResult.device.destroy();
    return {
      combinedTracerDifference,
      rotationTracerDifference,
      focusDifference,
    };
  });

  expect(rendering.combinedTracerDifference.changed).toBeGreaterThan(0);
  expect(rendering.rotationTracerDifference.total).toBeLessThan(
    rendering.combinedTracerDifference.total,
  );
  expect(rendering.focusDifference.changed).toBeGreaterThan(0);
});

test("WebGPU tracer respawns do not draw domain-spanning segments", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chrome", "WebGPU rendering uses software-backed Chrome.");
  await page.goto("http://127.0.0.1:4174/");

  const longestTracerRun = await page.evaluate(async () => {
    const backendPath = "/src/validation/webgpu-backend.ts";
    const referencePath = "/src/validation/webgpu-reference.ts";
    const runtimePath = "/src/validation/webgpu-runtime.ts";
    const backendModule = await import(/* @vite-ignore */ backendPath);
    const referenceModule = await import(/* @vite-ignore */ referencePath);
    const runtimeModule = await import(/* @vite-ignore */ runtimePath);
    const backendResult = await backendModule.createWebGpuValidationBackend();
    if (backendResult.status !== "ready") {
      throw new Error(`${backendResult.reason}: ${backendResult.message}`);
    }
    const source = referenceModule.WEBGPU_BACKEND_VALIDATION_SUITE.cases[1];
    const definition = {
      ...source,
      id: "webgpu-tracer-respawn-browser",
      configuration: {
        ...source.configuration,
        domain: {
          upstreamDiameters: 2,
          downstreamDiameters: 3,
          lateralDiameters: 2,
        },
      },
    };
    const execution = await runtimeModule.createWebGpuInteractiveCase(
      backendResult.device,
      definition,
    );
    const frame = await execution.renderFrame(10, true);
    let longest = 0;
    for (let y = 1; y + 1 < frame.height; y += 1) {
      let run = 0;
      for (let x = 1; x + 1 < frame.width; x += 1) {
        const index = (y * frame.width + x) * 4;
        const red = frame.pixels[index]!;
        const green = frame.pixels[index + 1]!;
        const blue = frame.pixels[index + 2]!;
        const nearlyGrey = Math.max(red, green, blue) - Math.min(red, green, blue) < 12;
        if (nearlyGrey && red > 80) {
          run += 1;
          longest = Math.max(longest, run);
        } else {
          run = 0;
        }
      }
    }
    await execution.execute({ type: "dispose" });
    backendResult.device.destroy();
    return { longest, width: frame.width };
  });

  expect(longestTracerRun.longest).toBeLessThan(longestTracerRun.width / 3);
});

test("supported WebGPU displays evidence for the exact selected engine identity", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chrome", "WebGPU validation uses software-backed Chrome.");
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.setItem("cfd-visualise-quality-tier", "webgpu-balanced-d18");
  });
  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    const audit = globalThis as typeof globalThis & { __liftFrames?: unknown[] };
    audit.__liftFrames = [];
    globalThis.Worker = class extends NativeWorker {
      public constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", ({ data }) => {
          if (data.type === "frame") {
            audit.__liftFrames!.push(data.liftSignal);
            audit.__liftFrames = audit.__liftFrames!.slice(-4);
          }
        });
      }
    };
  });
  const workerCreated = page.waitForEvent("worker");
  await page.goto("/");
  const engineWorker = await workerCreated;
  expect(engineWorker.url()).toContain("webgpu-wake-worker");
  await expect(page.locator("summary", { hasText: /Advanced controls.*WebGPU balanced/ })).toBeVisible({
    timeout: 30_000,
  });
  const validationDisclosure = page.locator("details").filter({
    has: page.locator("summary", { hasText: "Method and validation" }),
  });
  await expect(validationDisclosure).not.toHaveAttribute("open", "");
  await expect(validationDisclosure.getByText("Evidence passed", { exact: true })).toBeVisible();
  await validationDisclosure.locator("summary").click();
  const validation = page.getByRole("region", { name: "Method and validation" });
  await expect(validation).toHaveAttribute("data-evidence-state", "passing");
  await expect(
    validation.getByText("webgpu-reference / webgpu-balanced-d18 / ticket-08"),
  ).toBeVisible();
  await page.getByRole("button", { name: /step 0\.05 D\/U/i }).click();
  const flowTime = page
    .getByRole("region", { name: "Learning readouts" })
    .getByText("Flow-through time")
    .locator("..").locator("dd");
  await expect(flowTime).not.toHaveText("0.00 D/U", { timeout: 20_000 });
  const latestSignal = () => page.evaluate(() => {
    const audit = globalThis as typeof globalThis & {
      __liftFrames?: { flowThroughTime: number; samples: { flowThroughTime: number; liftCoefficient: number }[] }[];
    };
    return audit.__liftFrames?.at(-1);
  });
  await expect.poll(async () => (await latestSignal())?.samples.length).toBe(1);
  const steppedSignal = await latestSignal();
  expect(steppedSignal?.flowThroughTime).toBeCloseTo(0.05);
  expect(steppedSignal?.samples[0]?.flowThroughTime).toBe(steppedSignal?.flowThroughTime);
  expect(Number.isFinite(steppedSignal?.samples[0]?.liftCoefficient)).toBe(true);
  await page.getByRole("button", { name: "Restart experiment", exact: true }).click();
  await expect.poll(latestSignal).toEqual({ flowThroughTime: 0, samples: [] });
});

test("production WebGPU device loss freezes the result and offers validated recovery", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chrome", "WebGPU validation uses software-backed Chrome.");
  test.setTimeout(60_000);
  await page.route("**/webgpu-wake-worker-*.js", async (route) => {
    const response = await route.fetch();
    const workerSource = await response.text();
    await route.fulfill({
      response,
      body: `${deviceLossInjection()}\n${workerSource}`,
      contentType: "text/javascript",
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem("cfd-visualise-quality-tier", "webgpu-balanced-d18");
  });

  await page.goto("/");
  await expect(page.locator("summary", { hasText: /Advanced controls.*WebGPU balanced/ })).toBeVisible({
    timeout: 30_000,
  });
  const unavailable = page.getByRole("alert");
  await expect(unavailable).toContainText(/WebGPU.*device.*lost/i, { timeout: 20_000 });
  await expect(
    page.getByRole("button", { name: "Restart WebGPU balanced" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restart on CPU balanced" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("failure-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(unavailable).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("failure-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Restart on CPU balanced" }).click();
  await expect(unavailable).toHaveCount(0);
  await expect(page.locator("summary", { hasText: /Advanced controls.*CPU balanced/ })).toBeVisible({ timeout: 20_000 });
});

test("the local capability benchmark rejects a WebGPU tier below its bundled pace", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chrome", "WebGPU benchmark uses software-backed Chrome.");
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.removeItem("cfd-visualise-quality-tier"));
  await page.goto("/");
  await expect
    .poll(
      async () => {
        const text = await page.locator("body").innerText();
        return /Advanced controls.*CPU balanced/s.test(text) || text.includes("Result unavailable");
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  expect(page.workers().some((worker) => worker.url().includes("webgpu-wake-worker"))).toBe(false);
  const unavailable = page.getByRole("alert");
  if (await unavailable.isVisible()) {
    await expect(unavailable).toContainText(/webgpu-balanced-d18: measured .* requires 1\.2/);
  }
});

test("WebGPU reports browser capability, diagnostic, and device-loss states", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chrome", "WebGPU validation uses software-backed Chrome.");
  await page.goto("http://127.0.0.1:4174/");

  const states = await page.evaluate(async () => {
    const backendPath = "/src/validation/webgpu-backend.ts";
    const referencePath = "/src/validation/webgpu-reference.ts";
    const backendModule = await import(/* @vite-ignore */ backendPath);
    const referenceModule = await import(/* @vite-ignore */ referencePath);
    const missing = await backendModule.createWebGpuValidationBackend({
      requestAdapter: async () => null,
    });
    const unsupported = await backendModule.createWebGpuValidationBackend({
      requestAdapter: async () => ({
        limits: {
          maxBufferSize: 1024,
          maxStorageBufferBindingSize: 1024,
        },
        requestDevice: async () => {
          throw new Error("unsupported device must not be requested");
        },
      }),
    });

    const gpu = (navigator as Navigator & { gpu: { requestAdapter(): Promise<any> } }).gpu;
    const adapter = await gpu.requestAdapter();
    if (adapter === null) throw new Error("Software WebGPU adapter was not available.");
    const nativeDevice = await adapter.requestDevice({
      requiredLimits: {
        maxBufferSize: 8 * 1024 * 1024,
        maxStorageBufferBindingSize: 8 * 1024 * 1024,
      },
    });
    const bindMember = (target: object, property: PropertyKey) => {
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    };
    const readbackFailureDevice = new Proxy(nativeDevice, {
      get(target, property) {
        if (property !== "createBuffer") return bindMember(target, property);
        return (descriptor: { label?: string }) => {
          const buffer = target.createBuffer(descriptor);
          if (descriptor.label !== "limited diagnostic readback") return buffer;
          return new Proxy(buffer, {
            get(bufferTarget, bufferProperty) {
              if (bufferProperty === "mapAsync") {
                return () => Promise.reject(new DOMException("browser readback failure", "OperationError"));
              }
              return bindMember(bufferTarget, bufferProperty);
            },
          });
        };
      },
    });
    const diagnosticReady = await backendModule.createWebGpuValidationBackend(
      {
        requestAdapter: async () => ({
          limits: adapter.limits,
          requestDevice: async () => readbackFailureDevice,
        }),
      },
    );
    if (diagnosticReady.status !== "ready") throw new Error("Wrapped adapter was not ready.");
    const diagnostic = await backendModule.collectWebGpuValidationCase(
      diagnosticReady.backend,
      referenceModule.WEBGPU_BACKEND_VALIDATION_SUITE.cases[0],
    );
    nativeDevice.destroy();

    const lossReady = await backendModule.createWebGpuValidationBackend();
    if (lossReady.status !== "ready") throw new Error("Device-loss adapter was not ready.");
    lossReady.device.destroy();
    const deviceLoss = await lossReady.deviceLost;
    return { missing, unsupported, diagnostic, deviceLoss };
  });

  expect(states).toMatchObject({
    missing: { status: "unavailable", reason: "missing-adapter" },
    unsupported: { status: "unavailable", reason: "unsupported-capability" },
    diagnostic: { status: "unavailable", reason: "diagnostic-failure" },
    deviceLoss: { status: "unavailable", reason: "device-lost" },
  });
});

function deviceLossInjection(): string {
  return `
    {
      const nativeGpu = navigator.gpu;
      const requestAdapter = nativeGpu.requestAdapter.bind(nativeGpu);
      const injectedGpu = new Proxy(nativeGpu, {
        get(target, property) {
          if (property !== "requestAdapter") {
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          }
          return async (...adapterArguments) => {
            const adapter = await requestAdapter(...adapterArguments);
            if (adapter === null) return null;
            const requestDevice = adapter.requestDevice.bind(adapter);
            return new Proxy(adapter, {
              get(adapterTarget, adapterProperty) {
                if (adapterProperty !== "requestDevice") {
                  const value = Reflect.get(adapterTarget, adapterProperty, adapterTarget);
                  return typeof value === "function" ? value.bind(adapterTarget) : value;
                }
                return async (...deviceArguments) => {
                  const device = await requestDevice(...deviceArguments);
                  setTimeout(() => device.destroy(), 1_500);
                  return device;
                };
              },
            });
          };
        },
      });
      Object.defineProperty(navigator, "gpu", {
        configurable: true,
        value: injectedGpu,
      });
    }
  `;
}
