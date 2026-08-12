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

const dashboards = [];

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

  it("extends rather than weakens the engine and release profiles", () => {
    expect(verificationProfiles.engine.slice(0, 5)).toEqual(verificationProfiles.verify);
    expect(verificationProfiles.engine.map(({ id }) => id)).toContain("firefox-webgpu");
    expect(verificationProfiles.release.map(({ id }) => id)).toEqual([
      "evidence-generate",
      "evidence-diff",
      ...verificationProfiles.verify.map(({ id }) => id),
      "release-guides",
    ]);
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
});
