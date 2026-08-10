import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { childExitCode } from "./vite-server.mjs";

export async function runNodeCommand({
  workspace,
  label,
  entrypoint,
  arguments: arguments_ = [],
  env = process.env,
}) {
  process.stdout.write(`\n${label}\n`);
  const child = spawn(
    process.execPath,
    [resolve(workspace, entrypoint), ...arguments_],
    { cwd: workspace, env, stdio: "inherit" },
  );
  return childExitCode(child);
}
