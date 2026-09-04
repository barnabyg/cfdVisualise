import { once } from "node:events";
import { readFileSync } from "node:fs";
import { get } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";

import {
  defaultDashboardPort,
  verificationProfiles,
} from "../scripts/run-verification.mjs";
import { startDashboard } from "../scripts/test-dashboard/server.mjs";
import {
  applyDashboardEvent,
  createDashboardState,
} from "../scripts/test-dashboard/state.mjs";
import TestDashboardPlaywrightReporter from "../scripts/test-dashboard/playwright-reporter.mjs";
import TestDashboardVitestReporter from "../scripts/test-dashboard/vitest-reporter.mjs";

const dashboards = [];
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

afterEach(async () => {
  await Promise.all(dashboards.splice(0).map((dashboard) => dashboard.close()));
});

describe("verification profiles", () => {
  it("preserves the merge-gate ordering", () => {
    expect(verificationProfiles.verify.map(({ id }) => id)).toEqual([
      "typecheck",
      "unit",
      "evidence-check",
      "build",
      "browser-smoke",
    ]);
  });

  it("keeps engine, compatibility, and release checks in explicit profiles", () => {
    expect(verificationProfiles.engine.slice(0, 5)).toEqual(verificationProfiles.verify);
    expect(verificationProfiles.engine.map(({ id }) => id)).not.toContain("firefox-webgpu");
    expect(verificationProfiles.compat.map(({ id }) => id)).toEqual([
      "typecheck",
      "unit",
      "evidence-check",
      "build",
      "browser-compat",
      "firefox-webgpu",
    ]);
    expect(verificationProfiles.release.map(({ id }) => id)).toEqual([
      "evidence-generate",
      "evidence-diff",
      "typecheck",
      "unit",
      "evidence-check",
      "build",
      "browser-compat",
      "release-guides",
    ]);
  });

  it("keeps routine browser commands on the primary browser", () => {
    expect(packageJson.scripts["test:browser"]).toContain("--project=chrome");
    expect(packageJson.scripts["test:browser:smoke"]).toContain("--project=chrome");
    expect(packageJson.scripts["test:guide:cpu"]).toContain("--project=chrome");
    for (const script of ["test:browser", "test:browser:smoke", "test:guide:cpu"]) {
      expect(packageJson.scripts[script]).not.toContain("--project=firefox");
      expect(packageJson.scripts[script]).not.toContain("--project=webkit");
    }
    expect(packageJson.scripts["test:browser:compat"]).toContain("--project=firefox");
    expect(packageJson.scripts["test:browser:compat"]).toContain("--project=webkit");
  });
});

describe("terminal progress", () => {
  it("reports exact Vitest file progress", async () => {
    const output = [];
    const reporter = new TestDashboardVitestReporter({
      write: (line) => output.push(line),
    });
    const tests = [
      { result: () => ({ state: "passed" }) },
      { result: () => ({ state: "passed" }) },
    ];
    const module = {
      moduleId: "tests/example.test.ts",
      children: { allTests: () => tests },
      state: () => "passed",
    };

    reporter.onTestRunStart([{ moduleId: module.moduleId }, { moduleId: "tests/other.test.ts" }]);
    await reporter.onTestModuleEnd(module);

    expect(output).toEqual([
      "[progress] Vitest: 0 of 2 test files completed.\n",
      "[progress] Vitest: test file 1 of 2 completed (passed, 2 tests): tests/example.test.ts\n",
    ]);
  });

  it("reports exact Playwright test progress", () => {
    const output = [];
    const reporter = new TestDashboardPlaywrightReporter({
      write: (line) => output.push(line),
    });
    const test = {
      id: "test-1",
      retries: 0,
      titlePath: () => ["suite", "works"],
      location: { file: "tests/browser/example.e2e.ts" },
      parent: { project: () => ({ name: "chrome" }) },
    };
    const result = { retry: 0, status: "passed", duration: 12 };

    reporter.onBegin(undefined, { allTests: () => [test] });
    reporter.onTestBegin(test, result);
    reporter.onTestEnd(test, result);

    expect(output).toEqual([
      "[progress] Playwright: 0 of 1 tests completed.\n",
      "[progress] Playwright: test 1 of 1 started: chrome › suite > works\n",
      "\n[progress] Playwright: test 1 of 1 completed (passed): chrome › suite > works\n",
    ]);
    expect(reporter.printsToStdio()).toBe(true);
  });
});

describe("dashboard convention", () => {
  it("uses a stable local port unless the environment overrides it", () => {
    expect(defaultDashboardPort).toBe(4176);
  });
});

describe("dashboard state", () => {
  it("tracks stages, test results, output, and the final result", () => {
    const state = createDashboardState();
    applyDashboardEvent(state, {
      type: "run:start",
      runId: "run-1",
      label: "ticket-1",
      profile: "verify",
      branch: "feature",
      commit: "abc1234",
      totalStages: 1,
      at: "2026-08-12T10:00:00.000Z",
    });
    applyDashboardEvent(state, {
      type: "stage:start",
      id: "unit",
      label: "Vitest",
      at: "2026-08-12T10:00:01.000Z",
    });
    applyDashboardEvent(state, { type: "test:plan", count: 1 });
    applyDashboardEvent(state, {
      type: "test:start",
      source: "vitest",
      id: "test-1",
      title: "works",
      at: "2026-08-12T10:00:02.000Z",
    });
    applyDashboardEvent(state, {
      type: "test:end",
      source: "vitest",
      id: "test-1",
      title: "works",
      status: "passed",
      durationMs: 12,
    });
    applyDashboardEvent(state, {
      type: "stage:output",
      stageId: "unit",
      stream: "stdout",
      text: "1 test passed",
    });
    applyDashboardEvent(state, {
      type: "stage:end",
      id: "unit",
      exitCode: 0,
      durationMs: 1000,
    });
    applyDashboardEvent(state, {
      type: "run:end",
      exitCode: 0,
      durationMs: 1000,
    });

    expect(state.status).toBe("passed");
    expect(state.stages[0]).toMatchObject({ status: "passed", exitCode: 0 });
    expect(state.tests).toMatchObject({ planned: 1, completed: 1, passed: 1 });
    expect(state.tests.active).toEqual([]);
    expect(state.tests.recent[0]).toMatchObject({ title: "works", status: "passed" });
    expect(state.output.at(-1)?.text).toBe("1 test passed");
  });
});

describe("dashboard server", () => {
  it("serves the UI and accepts authenticated local events", async () => {
    const dashboard = await startDashboard();
    dashboards.push(dashboard);

    const page = await fetch(dashboard.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Verification dashboard");

    const eventResponse = await fetch(dashboard.eventsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "run:start",
        runId: "run-2",
        label: "server-test",
        profile: "verify",
        branch: "main",
        commit: "abc1234",
        totalStages: 5,
      }),
    });
    expect(eventResponse.status).toBe(204);

    const state = await fetch(new URL("api/state", dashboard.url)).then((response) => response.json());
    expect(state).toMatchObject({
      status: "running",
      run: { id: "run-2", label: "server-test", totalStages: 5 },
    });
  });

  it("reports a busy fixed port so a caller can allocate a concurrent fallback", async () => {
    const first = await startDashboard();
    dashboards.push(first);
    const port = Number(new URL(first.url).port);

    await expect(startDashboard({ port })).rejects.toMatchObject({ code: "EADDRINUSE" });
  });

  it("closes promptly while a browser event stream is connected", async () => {
    const dashboard = await startDashboard();
    dashboards.push(dashboard);
    const request = get(new URL("events", dashboard.url));
    await once(request, "response");

    const result = await Promise.race([
      dashboard.close().then(() => "closed"),
      delay(500).then(() => "timed-out"),
    ]);

    expect(result).toBe("closed");
    request.destroy();
  });
});
