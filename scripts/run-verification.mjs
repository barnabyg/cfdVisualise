import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { startDashboard } from "./test-dashboard/server.mjs";

const npmEntrypoint = process.env.npm_execpath;
export const defaultDashboardPort = 4176;

const coreStages = [
  npmStage("typecheck", "TypeScript", "typecheck"),
  npmStage("unit", "Vitest", "test"),
  npmStage("evidence-check", "Evidence freshness", "check:evidence"),
  npmStage("build", "Production build", "build"),
];
const mergeStages = [
  ...coreStages,
  npmStage("browser-smoke", "Primary-browser smoke", "test:browser:smoke"),
];

const evidenceStages = [
  npmStage("evidence-generate", "Generate validation evidence", "validate:quality-tiers"),
  {
    id: "evidence-diff",
    label: "Reject validation evidence drift",
    command: "git",
    args: [
      "diff",
      "--exit-code",
      "HEAD",
      "--",
      "src/engine/cpu-production-manifest.json",
      "src/validation/webgpu-backend-manifest.json",
      "validation-evidence-lock.json",
    ],
  },
];

export const verificationProfiles = {
  verify: mergeStages,
  engine: [
    ...mergeStages,
    npmStage("cpu-guide", "Real CPU guide", "test:guide:cpu"),
  ],
  compat: [
    ...coreStages,
    npmStage("browser-compat", "Cross-browser compatibility matrix", "test:browser:compat"),
    npmStage("firefox-webgpu", "Firefox WebGPU guide", "test:firefox-webgpu"),
  ],
  evidence: evidenceStages,
  release: [
    ...evidenceStages,
    ...coreStages,
    npmStage("browser-compat", "Cross-browser compatibility matrix", "test:browser:compat"),
    npmStage("release-guides", "Release guide gates", "test:guide:release"),
  ],
};

export async function runVerification(profileName, options = {}) {
  const stages = verificationProfiles[profileName];
  if (stages === undefined) {
    throw new Error(`Unknown verification profile: ${profileName}`);
  }

  const startedAt = Date.now();
  const runId = randomUUID();
  const branch = gitValue(["branch", "--show-current"]) || "detached HEAD";
  const commit = gitValue(["rev-parse", "--short", "HEAD"]) || "unknown commit";
  const label = process.env.CFD_TEST_RUN_LABEL || branch;
  const dashboardEnabled = options.dashboardEnabled
    ?? (process.env.CI === undefined && process.env.CFD_TEST_DASHBOARD !== "0");
  let dashboard;

  if (dashboardEnabled) {
    try {
      const configuredPort = Number(
        process.env.CFD_TEST_DASHBOARD_PORT ?? defaultDashboardPort,
      );
      try {
        dashboard = await startDashboard({ port: configuredPort });
      } catch (error) {
        if (process.env.CFD_TEST_DASHBOARD_PORT !== undefined || error?.code !== "EADDRINUSE") {
          throw error;
        }
        dashboard = await startDashboard();
        process.stdout.write(
          `Dashboard port ${defaultDashboardPort} is busy; using a free port for this concurrent run.\n`,
        );
      }
      process.stdout.write(`\nVerification dashboard: ${dashboard.url}\n`);
      process.stdout.write(`TEST_DASHBOARD_URL=${dashboard.url}\n\n`);
    } catch (error) {
      process.stderr.write(`Dashboard unavailable; continuing in the terminal. ${errorMessage(error)}\n`);
    }
  }

  const publish = (event) => dashboard?.publish({
    ...event,
    at: event.at ?? new Date().toISOString(),
  });
  publish({
    type: "run:start",
    runId,
    label,
    profile: profileName,
    branch,
    commit,
    totalStages: stages.length,
  });

  let exitCode = 0;
  try {
    for (const [stageIndex, stage] of stages.entries()) {
      const stageStartedAt = Date.now();
      const ordinal = stageIndex + 1;
      process.stdout.write(
        `\n[verification] Stage ${ordinal} of ${stages.length} started: ${stage.label}\n`,
      );
      publish({ type: "stage:start", id: stage.id, label: stage.label });
      exitCode = await runStage(stage, {
        ...process.env,
        ...(dashboard === undefined
          ? {}
          : { CFD_TEST_DASHBOARD_EVENTS_URL: dashboard.eventsUrl }),
      }, publish);
      publish({
        type: "stage:end",
        id: stage.id,
        exitCode,
        durationMs: Date.now() - stageStartedAt,
      });
      process.stdout.write(
        `[verification] Stage ${ordinal} of ${stages.length} completed (${exitCode === 0 ? "passed" : "failed"}): ${stage.label}\n`,
      );
      if (exitCode !== 0) break;
    }
  } finally {
    publish({
      type: "run:end",
      exitCode,
      durationMs: Date.now() - startedAt,
    });
    if (dashboard !== undefined) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
      await dashboard.close();
    }
  }

  return exitCode;
}

function npmStage(id, label, script) {
  if (npmEntrypoint !== undefined) {
    return {
      id,
      label,
      command: process.execPath,
      args: [npmEntrypoint, "run", script],
    };
  }
  return {
    id,
    label,
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", script],
    shell: process.platform === "win32",
  };
}

function runStage(stage, env, publish) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(stage.command, stage.args, {
      cwd: process.cwd(),
      env,
      shell: stage.shell ?? false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = createLineSink(stage.id, "stdout", process.stdout, publish);
    const stderr = createLineSink(stage.id, "stderr", process.stderr, publish);
    child.stdout.on("data", stdout.write);
    child.stderr.on("data", stderr.write);
    child.once("error", reject);
    child.once("exit", (code) => {
      stdout.flush();
      stderr.flush();
      resolvePromise(code ?? 1);
    });
  });
}

function createLineSink(stageId, stream, terminal, publish) {
  let pending = "";
  const emit = (line) => publish({
    type: "stage:output",
    stageId,
    stream,
    text: stripAnsi(line),
  });
  return {
    write(chunk) {
      const text = chunk.toString();
      terminal.write(text);
      pending += text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.length > 0) emit(line);
    },
    flush() {
      if (pending.length > 0) emit(pending);
      pending = "";
    },
  };
}

function stripAnsi(value) {
  return value.replaceAll(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function gitValue(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

const entrypoint = process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href;
if (entrypoint === import.meta.url) {
  const profileName = process.argv[2] ?? "verify";
  try {
    process.exitCode = await runVerification(profileName);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
}
