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

test("WebGPU passive tracers are composited by the GPU renderer", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chrome", "WebGPU rendering uses software-backed Chrome.");
  await page.goto("http://127.0.0.1:4174/");

  const changedPixelCount = await page.evaluate(async () => {
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
    const withoutTracers = await execution.renderFrame(0, false);
    const withTracers = await execution.renderFrame(0.1, true);
    let changed = 0;
    for (let index = 0; index < withTracers.pixels.length; index += 4) {
      if (
        withTracers.pixels[index] !== withoutTracers.pixels[index]
        || withTracers.pixels[index + 1] !== withoutTracers.pixels[index + 1]
        || withTracers.pixels[index + 2] !== withoutTracers.pixels[index + 2]
      ) {
        changed += 1;
      }
    }
    await execution.execute({ type: "dispose" });
    backendResult.device.destroy();
    return changed;
  });

  expect(changedPixelCount).toBeGreaterThan(0);
});

test("supported WebGPU displays evidence for the exact selected engine identity", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chrome", "WebGPU validation uses software-backed Chrome.");
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.setItem("cfd-visualise-quality-tier", "webgpu-balanced-d18");
  });
  const workerCreated = page.waitForEvent("worker");
  await page.goto("/");
  const engineWorker = await workerCreated;
  expect(engineWorker.url()).toContain("webgpu-wake-worker");
  await expect(page.getByText(/WebGPU balanced · webgpu-reference/)).toBeVisible({
    timeout: 30_000,
  });
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
        return /CPU balanced .* cpu-reference/.test(text) || text.includes("Result unavailable");
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
