import { postDashboardEvent } from "./post-event.mjs";

export default class TestDashboardPlaywrightReporter {
  constructor(options = {}) {
    this.pending = new Set();
    this.total = 0;
    this.started = 0;
    this.completed = 0;
    this.write = options.write ?? ((line) => process.stdout.write(line));
  }

  enqueue(event) {
    const request = postDashboardEvent(event);
    this.pending.add(request);
    void request.finally(() => this.pending.delete(request));
  }

  onBegin(_config, suite) {
    this.total = suite.allTests().length;
    this.write(`[progress] Playwright: 0 of ${this.total} tests completed.\n`);
    this.enqueue({
      type: "test:plan",
      source: "playwright",
      count: suite.allTests().length,
    });
  }

  onTestBegin(test, result) {
    this.started += 1;
    this.write(
      `[progress] Playwright: test ${this.started} of ${this.total} started: ${testLabel(test)}\n`,
    );
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
    const willRetry =
      result.status !== "passed" &&
      result.status !== "skipped" &&
      result.retry < test.retries;
    if (willRetry) {
      this.write(
        `\n[progress] Playwright: retry ${result.retry + 1} completed (${normaliseStatus(result.status)}): ${testLabel(test)}\n`,
      );
    } else {
      this.completed += 1;
      this.write(
        `\n[progress] Playwright: test ${this.completed} of ${this.total} completed (${normaliseStatus(result.status)}): ${testLabel(test)}\n`,
      );
    }
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
    return true;
  }
}

function testLabel(test) {
  const project = test.parent.project()?.name;
  const title = test.titlePath().filter(Boolean);
  if (project !== undefined && title[0] === project) title.shift();
  return `${project === undefined ? "" : `${project} › `}${title.join(" > ")}`;
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
