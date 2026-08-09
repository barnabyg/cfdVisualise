import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export function spawnViteServer({ port, preview = false }) {
  return spawn(
    process.execPath,
    [
      "./node_modules/vite/bin/vite.js",
      ...(preview ? ["preview"] : []),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { stdio: "inherit" },
  );
}

export async function waitForViteServer(url, label, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The Vite process is still starting.
    }
    await delay(100);
  }
  throw new Error(`${label} did not start within ${attempts / 10} seconds.`);
}

export async function stopViteServer(server) {
  server.kill();
  await Promise.race([childExitCode(server), delay(2_000)]);
}

export function childExitCode(child) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => {
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
