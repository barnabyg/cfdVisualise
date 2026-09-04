import { fileURLToPath } from "node:url";

import { runNodeCommand } from "./run-node-command.mjs";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const totalStages = 3;
process.stdout.write(`[progress] Scientific evidence: 0 of ${totalStages} stages completed.\n`);
process.stdout.write(`[progress] Scientific evidence: stage 1 of ${totalStages} started: CPU quality-tier evidence\n`);
const cpuExitCode = await runNodeCommand({
  workspace,
  label: "CPU quality-tier scientific evidence",
  entrypoint: "node_modules/vite-node/vite-node.mjs",
  arguments: ["scripts/generate-cpu-production-manifest.ts"],
});
process.stdout.write(
  `[progress] Scientific evidence: stage 1 of ${totalStages} completed (${cpuExitCode === 0 ? "passed" : "failed"}): CPU quality-tier evidence\n`,
);
process.stdout.write(`[progress] Scientific evidence: stage 2 of ${totalStages} started: WebGPU quality-tier evidence\n`);
const webGpuExitCode = await runNodeCommand({
  workspace,
  label: "WebGPU quality-tier scientific evidence",
  entrypoint: "scripts/generate-webgpu-backend-manifest.mjs",
});
process.stdout.write(
  `[progress] Scientific evidence: stage 2 of ${totalStages} completed (${webGpuExitCode === 0 ? "passed" : "failed"}): WebGPU quality-tier evidence\n`,
);
let lockExitCode = 0;
if (cpuExitCode === 0 && webGpuExitCode === 0) {
  process.stdout.write(`[progress] Scientific evidence: stage 3 of ${totalStages} started: evidence lock\n`);
  lockExitCode = await runNodeCommand({
    workspace,
    label: "validation evidence lock",
    entrypoint: "scripts/check-validation-evidence.mjs",
    arguments: ["--update"],
  });
  process.stdout.write(
    `[progress] Scientific evidence: stage 3 of ${totalStages} completed (${lockExitCode === 0 ? "passed" : "failed"}): evidence lock\n`,
  );
} else {
  process.stdout.write(
    `[progress] Scientific evidence: stage 3 of ${totalStages} skipped because an earlier stage failed.\n`,
  );
}
process.exitCode = cpuExitCode || webGpuExitCode || lockExitCode;
