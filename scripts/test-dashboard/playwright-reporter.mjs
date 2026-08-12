import { postDashboardEvent } from "./post-event.mjs";

export default class TestDashboardPlaywrightReporter {
  constructor() {
    this.pending = new Set();
  }

  enqueue(event) {
    const request = postDashboardEvent(event);
    this.pending.add(request);
    void request.finally(() => this.pending.delete(request));
  }

  onBegin(_config, suite) {
    this.enqueue({
      type: "test:plan",
      source: "playwright",
      count: suite.allTests().length,
    });
  }

  onTestBegin(test, result) {
    this.enqueue({
      type: "test:start",
      source: "playwright",
      id: playwrightTestId(test, result),
      title: test.titlePath().join(" > "),
      file: test.location.file,
      project: test.parent.project()?.name,
    });
  }

  onTestEnd(test, result) {
    this.enqueue({
      type: "test:end",
      source: "playwright",
      id: playwrightTestId(test, result),
      title: test.titlePath().join(" > "),
      file: test.location.file,
      project: test.parent.project()?.name,
      status: normaliseStatus(result.status),
      durationMs: result.duration,
      error: result.error?.message,
    });
  }

  async onEnd() {
    await Promise.allSettled([...this.pending]);
  }

  printsToStdio() {
    return false;
  }
}

function playwrightTestId(test, result) {
  return `playwright:${test.id}:${result.retry}`;
}

function normaliseStatus(status) {
  if (status === "passed") return "passed";
  if (status === "failed" || status === "timedOut" || status === "interrupted") {
    return "failed";
  }
  return "skipped";
}
