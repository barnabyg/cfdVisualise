import { postDashboardEvent } from "./post-event.mjs";

export default class TestDashboardVitestReporter {
  constructor() {
    this.collectedModules = new Set();
  }

  async onTestModuleCollected(testModule) {
    if (this.collectedModules.has(testModule.moduleId)) return;
    this.collectedModules.add(testModule.moduleId);
    await postDashboardEvent({
      type: "test:plan",
      source: "vitest",
      count: [...testModule.children.allTests()].length,
    });
  }

  async onTestCaseReady(testCase) {
    await postDashboardEvent({
      type: "test:start",
      source: "vitest",
      id: `vitest:${testCase.id}`,
      title: testCase.fullName,
      file: testCase.module.moduleId,
    });
  }

  async onTestCaseResult(testCase) {
    const result = testCase.result();
    const diagnostic = testCase.diagnostic();
    await postDashboardEvent({
      type: "test:end",
      source: "vitest",
      id: `vitest:${testCase.id}`,
      title: testCase.fullName,
      file: testCase.module.moduleId,
      status: result.state,
      durationMs: diagnostic?.duration,
      error: result.errors?.[0]?.message,
    });
  }
}
