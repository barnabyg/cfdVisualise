import { spawn } from "node:child_process";
import {
  childExitCode,
  spawnViteServer,
  stopViteServer,
  waitForViteServer,
} from "./vite-server.mjs";

const vite = spawnViteServer({ port: 4173, preview: true });
const validationVite = spawnViteServer({ port: 4174 });

let exitCode = 1;
try {
  await Promise.all([
    waitForViteServer("http://127.0.0.1:4173", "production preview", 50),
    waitForViteServer("http://127.0.0.1:4174", "WebGPU validation server", 50),
  ]);
  const playwright = spawn(
    process.execPath,
    ["./node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  exitCode = await childExitCode(playwright);
} finally {
  await Promise.all([stopViteServer(vite), stopViteServer(validationVite)]);
}

process.exit(exitCode);
