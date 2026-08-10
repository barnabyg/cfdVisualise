import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  spawnViteServer,
  stopViteServer,
  waitForViteServer,
} from "./vite-server.mjs";
import { validationEvidenceSourceFingerprint } from "./validation-evidence.mjs";

const port = 4174;
const origin = `http://127.0.0.1:${port}`;
const componentNames = ["canonical", "grid-placement", "domain-boundary"];
const intermediateDirectory = resolve(
  "node_modules/.cache/cfd-visualise-webgpu-evidence",
);
const requestedComponent = process.argv
  .find((argument) => argument.startsWith("--component="))
  ?.slice("--component=".length);
const evidenceFingerprint = (await validationEvidenceSourceFingerprint()).slice(0, 16);

await mkdir(intermediateDirectory, { recursive: true });

if (requestedComponent !== undefined) {
  if (!componentNames.includes(requestedComponent)) {
    throw new Error(`Unknown WebGPU validation component ${requestedComponent}.`);
  }
  const artifact = await runInBrowser({ componentName: requestedComponent });
  await writeFile(componentPath(requestedComponent), artifact.manifest, "utf8");
  if (artifact.summary.status !== "pass") {
    throw new Error(
      `${requestedComponent} WebGPU evidence failed after its manifest was written.`,
    );
  }
  console.log(
    `Checkpointed passing ${requestedComponent} WebGPU evidence with ${artifact.summary.cases} cases.`,
  );
} else {
  for (const component of componentNames) {
    try {
      await access(componentPath(component));
      console.log(`Reusing checkpointed ${component} WebGPU evidence.`);
    } catch {
      await runComponent(component);
    }
  }
  const componentInputs = await Promise.all(
    componentNames.map((component) => readFile(componentPath(component), "utf8")),
  );
  const artifacts = await runInBrowser({ componentInputs });
  await writeFile(
    new URL("../src/validation/webgpu-backend-manifest.json", import.meta.url),
    artifacts.webGpu,
    "utf8",
  );
  await writeFile(
    new URL("../src/engine/cpu-production-manifest.json", import.meta.url),
    artifacts.cpu,
    "utf8",
  );
  if (artifacts.summary.status !== "pass") {
    throw new Error("Generated WebGPU quality-tier evidence did not pass.");
  }
  console.log(
    `Wrote passing ${artifacts.summary.backendId} evidence with ${artifacts.summary.cases} cases and ${artifacts.summary.reconciliations} reconciliations.`,
  );
}

async function runInBrowser(input) {
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
    return await page.evaluate(async (request) => {
      const backendModule = await import(
        /* @vite-ignore */ "/src/validation/webgpu-backend.ts"
      );
      const referenceModule = await import(
        /* @vite-ignore */ "/src/validation/webgpu-reference.ts"
      );
      const validationModule = await import(
        /* @vite-ignore */ "/src/validation/run-validation.ts"
      );
      const parityModule = await import(
        /* @vite-ignore */ "/src/validation/backend-parity.ts"
      );
      const schemaModule = await import(
        /* @vite-ignore */ "/src/validation/manifest-schema.ts"
      );
      const cpuModule = await import(/* @vite-ignore */ "/src/engine/cpu-tier.ts");

      if ("componentName" in request) {
        const suite = referenceModule.WEBGPU_PRODUCTION_COMPONENT_SUITES[
          request.componentName
        ];
        if (suite === undefined) throw new Error("Missing WebGPU component suite.");
        const backendResult = await backendModule.createWebGpuValidationBackend();
        if (backendResult.status !== "ready") {
          throw new Error(`${backendResult.reason}: ${backendResult.message}`);
        }
        const manifest = await validationModule.runValidation(suite, backendResult.backend);
        backendResult.device.destroy();
        return {
          manifest: schemaModule.serializeValidationManifest(manifest),
          summary: { status: manifest.status, cases: manifest.cases.length },
        };
      }

      const componentManifests = request.componentInputs.map((serialized) =>
        schemaModule.parseValidationManifest(JSON.parse(serialized)),
      );
      const webGpuManifest = schemaModule.parseValidationManifest({
        schemaVersion: "1",
        suite: {
          id: referenceModule.WEBGPU_PRODUCTION_VALIDATION_SUITE.id,
          schemaVersion: "1",
          metricVersions:
            referenceModule.WEBGPU_PRODUCTION_VALIDATION_SUITE.metricVersions,
          evidenceScope:
            referenceModule.WEBGPU_PRODUCTION_VALIDATION_SUITE.evidenceScope,
          qualityTier:
            referenceModule.WEBGPU_PRODUCTION_VALIDATION_SUITE.qualityTier,
        },
        backend: componentManifests[0].backend,
        status: componentManifests.every(({ status }) => status === "pass")
          ? "pass"
          : "fail",
        cases: componentManifests.flatMap(({ cases }) => cases),
        reconciliations: componentManifests.flatMap(
          ({ reconciliations }) => reconciliations,
        ),
      });
      const backendReconciliation = parityModule.reconcileBackendManifests(
        referenceModule.WEBGPU_BACKEND_PARITY_DEFINITION,
        cpuModule.CPU_PRODUCTION_MANIFEST,
        webGpuManifest,
      );
      const completeWebGpuManifest = {
        ...webGpuManifest,
        status:
          webGpuManifest.status === "pass" &&
          backendReconciliation.status === "pass"
            ? "pass"
            : "fail",
        reconciliations: [
          ...webGpuManifest.reconciliations,
          backendReconciliation,
        ],
      };
      const completeCpuManifest = {
        ...cpuModule.CPU_PRODUCTION_MANIFEST,
        status:
          cpuModule.CPU_PRODUCTION_MANIFEST.status === "pass" &&
          backendReconciliation.status === "pass"
            ? "pass"
            : "fail",
        reconciliations: [
          ...cpuModule.CPU_PRODUCTION_MANIFEST.reconciliations.filter(
            ({ kind }) => kind !== "backend",
          ),
          backendReconciliation,
        ],
      };
      return {
        webGpu: schemaModule.serializeValidationManifest(completeWebGpuManifest),
        cpu: schemaModule.serializeValidationManifest(completeCpuManifest),
        summary: {
          backendId: completeWebGpuManifest.backend.id,
          status: completeWebGpuManifest.status,
          cases: completeWebGpuManifest.cases.length,
          reconciliations: completeWebGpuManifest.reconciliations.length,
        },
      };
    }, input);
  } finally {
    await browser?.close();
    await stopViteServer(vite);
  }
}

function runComponent(component) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), `--component=${component}`],
      { stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0 || code === 1) resolvePromise();
      else reject(new Error(`${component} WebGPU evidence exited with code ${code}.`));
    });
  });
}

function componentPath(component) {
  return resolve(intermediateDirectory, `${component}-${evidenceFingerprint}.json`);
}
