export function createDashboardState() {
  return {
    status: "waiting",
    run: undefined,
    stages: [],
    currentStageId: undefined,
    tests: {
      planned: 0,
      completed: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      active: [],
      recent: [],
      failures: [],
    },
    output: [],
    updatedAt: new Date().toISOString(),
  };
}

export function applyDashboardEvent(state, event) {
  state.updatedAt = event.at ?? new Date().toISOString();

  switch (event.type) {
    case "run:start":
      state.status = "running";
      state.run = {
        id: event.runId,
        label: event.label,
        profile: event.profile,
        branch: event.branch,
        commit: event.commit,
        startedAt: event.at,
        totalStages: event.totalStages,
      };
      break;
    case "stage:start":
      state.currentStageId = event.id;
      state.stages.push({
        id: event.id,
        label: event.label,
        status: "running",
        startedAt: event.at,
        durationMs: undefined,
        exitCode: undefined,
      });
      break;
    case "stage:output":
      state.output.push({
        stageId: event.stageId,
        stream: event.stream,
        text: event.text,
      });
      state.output.splice(0, Math.max(0, state.output.length - 250));
      break;
    case "stage:end": {
      const stage = state.stages.find(({ id }) => id === event.id);
      if (stage !== undefined) {
        stage.status = event.exitCode === 0 ? "passed" : "failed";
        stage.durationMs = event.durationMs;
        stage.exitCode = event.exitCode;
      }
      state.currentStageId = undefined;
      break;
    }
    case "test:plan":
      state.tests.planned += event.count;
      break;
    case "test:start":
      if (!state.tests.active.some(({ id }) => id === event.id)) {
        state.tests.active.push({
          id: event.id,
          source: event.source,
          title: event.title,
          file: event.file,
          project: event.project,
          startedAt: event.at,
        });
      }
      break;
    case "test:end": {
      const activeIndex = state.tests.active.findIndex(({ id }) => id === event.id);
      const active = activeIndex === -1 ? undefined : state.tests.active[activeIndex];
      if (activeIndex !== -1) state.tests.active.splice(activeIndex, 1);

      const result = {
        id: event.id,
        source: event.source ?? active?.source,
        title: event.title ?? active?.title ?? event.id,
        file: event.file ?? active?.file,
        project: event.project ?? active?.project,
        status: event.status,
        durationMs: event.durationMs,
        error: event.error,
      };
      state.tests.completed += 1;
      if (event.status === "passed") state.tests.passed += 1;
      else if (event.status === "failed") state.tests.failed += 1;
      else state.tests.skipped += 1;
      state.tests.recent.unshift(result);
      state.tests.recent.splice(80);
      if (event.status === "failed") {
        state.tests.failures.unshift(result);
        state.tests.failures.splice(20);
      }
      break;
    }
    case "run:end":
      state.status = event.exitCode === 0 ? "passed" : "failed";
      state.currentStageId = undefined;
      if (state.run !== undefined) {
        state.run.finishedAt = event.at;
        state.run.durationMs = event.durationMs;
        state.run.exitCode = event.exitCode;
      }
      break;
  }

  return state;
}
