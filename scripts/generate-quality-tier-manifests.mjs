import { fileURLToPath } from "node:url";

import { runNodeCommand } from "./run-node-command.mjs";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const cpuExitCode = await runNodeCommand({
  workspace,
  label: "CPU quality-tier scientific evidence",
  entrypoint: "node_modules/vite-node/vite-node.mjs",
  arguments: ["scripts/generate-cpu-production-manifest.ts"],
});
const webGpuExitCode = await runNodeCommand({
  workspace,
  label: "WebGPU quality-tier scientific evidence",
  entrypoint: "scripts/generate-webgpu-backend-manifest.mjs",
});
let lockExitCode = 0;
if (cpuExitCode === 0 && webGpuExitCode === 0) {
  lockExitCode = await runNodeCommand({
    workspace,
    label: "validation evidence lock",
    entrypoint: "scripts/check-validation-evidence.mjs",
    arguments: ["--update"],
  });
}
process.exitCode = cpuExitCode || webGpuExitCode || lockExitCode;
