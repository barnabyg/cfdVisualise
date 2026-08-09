import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const vite = spawn(
  process.execPath,
  ["./node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4173"],
  { stdio: "inherit" },
);

let exitCode = 1;
try {
  await waitForPreview();
  const playwright = spawn(
    process.execPath,
    ["./node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  exitCode = await childExitCode(playwright);
} finally {
  vite.kill();
  await Promise.race([childExitCode(vite), delay(2_000)]);
}

process.exit(exitCode);

async function waitForPreview() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:4173");
      if (response.ok) return;
    } catch {
      // The preview process is still starting.
    }
    await delay(100);
  }
  throw new Error("Vite preview did not start within five seconds.");
}

function childExitCode(child) {
  return new Promise((resolve) => {
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
