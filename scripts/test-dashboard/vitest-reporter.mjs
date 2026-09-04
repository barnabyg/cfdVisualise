import { postDashboardEvent } from "./post-event.mjs";

export default class TestDashboardVitestReporter {
  constructor(options = {}) {
    this.collectedModules = new Set();
    this.totalModules = 0;
    this.completedModules = 0;
    this.write = options.write ?? ((line) => process.stdout.write(line));
  }

  onTestRunStart(specifications) {
    this.totalModules = specifications.length;
    this.completedModules = 0;
    this.write(
      `[progress] Vitest: 0 of ${this.totalModules} test files completed.\n`,
    );
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

  async onTestModuleEnd(testModule) {
    this.completedModules += 1;
    const tests = [...testModule.children.allTests()];
    const failed = tests.filter((test) => test.result().state === "failed").length;
    const status = failed === 0 ? "passed" : "failed";
    const testLabel = tests.length === 1 ? "test" : "tests";
    this.write(
      `[progress] Vitest: test file ${this.completedModules} of ${this.totalModules} completed (${status}, ${tests.length} ${testLabel}): ${testModule.moduleId}\n`,
    );
  }
}
