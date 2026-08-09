import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import {
  spawnViteServer,
  stopViteServer,
  waitForViteServer,
} from "./vite-server.mjs";

const port = 4174;
const origin = `http://127.0.0.1:${port}`;
const webGpuChromeArgs = JSON.parse(
  await readFile(new URL("./webgpu-chrome-profile.json", import.meta.url), "utf8"),
);
const vite = spawnViteServer({ port });

let browser;
try {
  await waitForViteServer(origin, "WebGPU validation server");
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: webGpuChromeArgs,
  });
  const page = await browser.newPage();
  await page.goto(origin);
  const manifest = await page.evaluate(async () => {
    const backendPath = "/src/validation/webgpu-backend.ts";
    const referencePath = "/src/validation/webgpu-reference.ts";
    const validationPath = "/src/validation/run-validation.ts";
    const parityPath = "/src/validation/backend-parity.ts";
    const cpuManifestPath = "/src/engine/cpu-tier.ts";
    const backendModule = await import(/* @vite-ignore */ backendPath);
    const referenceModule = await import(/* @vite-ignore */ referencePath);
    const validationModule = await import(/* @vite-ignore */ validationPath);
    const parityModule = await import(/* @vite-ignore */ parityPath);
    const cpuModule = await import(/* @vite-ignore */ cpuManifestPath);
    const backendResult = await backendModule.createWebGpuValidationBackend();
    if (backendResult.status !== "ready") {
      throw new Error(`${backendResult.reason}: ${backendResult.message}`);
    }
    const webGpuManifest = await validationModule.runValidation(
      referenceModule.WEBGPU_BACKEND_VALIDATION_SUITE,
      backendResult.backend,
    );
    const backendReconciliation = parityModule.reconcileBackendManifests(
      referenceModule.WEBGPU_BACKEND_PARITY_DEFINITION,
      cpuModule.CPU_PRODUCTION_MANIFEST,
      webGpuManifest,
    );
    backendResult.device.destroy();
    return {
      ...webGpuManifest,
      status:
        webGpuManifest.status === "pass" &&
        backendReconciliation.status === "pass"
          ? "pass"
          : "fail",
      reconciliations: [backendReconciliation],
    };
  });
  await writeFile(
    new URL("../src/validation/webgpu-backend-manifest.json", import.meta.url),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  if (manifest.status !== "pass") {
    throw new Error("Generated WebGPU backend reconciliation evidence did not pass.");
  }
  console.log(
    `Wrote passing ${manifest.backend.id} evidence with ${manifest.cases.length} cases and ${manifest.reconciliations.length} reconciliation.`,
  );
} finally {
  await browser?.close();
  await stopViteServer(vite);
}
