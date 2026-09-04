import { mkdir, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { runNodeCommand } from "./run-node-command.mjs";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const reportDirectory = resolve(workspace, "release-evidence");
const measurementDirectory = resolve(reportDirectory, "guide-performance");
if (!measurementDirectory.startsWith(`${resolve(workspace)}${sep}`)) {
  throw new Error("Release evidence directory escaped the workspace.");
}
await rm(measurementDirectory, { recursive: true, force: true });
await mkdir(measurementDirectory, { recursive: true });

const environment = {
  ...process.env,
  CFD_GUIDE_PERFORMANCE_DIR: measurementDirectory,
};
const progressReporter = ",./scripts/test-dashboard/playwright-reporter.mjs";
process.stdout.write("[progress] Release guide gates: 0 of 3 stages completed.\n");
process.stdout.write("[progress] Release guide gates: stage 1 of 3 started: CPU browser-matrix guide.\n");
const cpuExitCode = await runNodeCommand({
  workspace,
  label: "CPU browser-matrix guide gate",
  entrypoint: "scripts/run-browser-tests.mjs",
  arguments: [
    "tests/browser/guide-performance.e2e.ts",
    "--project=chromium",
    "--project=firefox",
    "--project=webkit",
    `--reporter=list,./scripts/guide-performance-reporter.mjs${progressReporter}`,
  ],
  env: environment,
});
process.stdout.write(
  `[progress] Release guide gates: stage 1 of 3 completed (${cpuExitCode === 0 ? "passed" : "failed"}): CPU browser-matrix guide.\n`,
);
process.stdout.write("[progress] Release guide gates: stage 2 of 3 started: Firefox WebGPU guide.\n");
const webGpuExitCode = await runNodeCommand({
  workspace,
  label: "Firefox WebGPU guide gate",
  entrypoint: "scripts/run-firefox-webgpu-test.mjs",
  env: environment,
});
process.stdout.write(
  `[progress] Release guide gates: stage 2 of 3 completed (${webGpuExitCode === 0 ? "passed" : "failed"}): Firefox WebGPU guide.\n`,
);
process.stdout.write("[progress] Release guide gates: stage 3 of 3 started: release gate report.\n");
const reportExitCode = await runNodeCommand({
  workspace,
  label: "release gate report",
  entrypoint: "node_modules/vite-node/vite-node.mjs",
  arguments: ["scripts/write-release-gate-report.ts"],
  env: environment,
});
process.stdout.write(
  `[progress] Release guide gates: stage 3 of 3 completed (${reportExitCode === 0 ? "passed" : "failed"}): release gate report.\n`,
);

process.exitCode = cpuExitCode || webGpuExitCode || reportExitCode;
