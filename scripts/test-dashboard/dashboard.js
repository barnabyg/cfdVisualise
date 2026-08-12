const elements = {
  activeTests: document.querySelector("#active-tests"),
  elapsed: document.querySelector("#elapsed"),
  failures: document.querySelector("#failures"),
  failuresPanel: document.querySelector("#failures-panel"),
  metadata: document.querySelector("#metadata"),
  output: document.querySelector("#output"),
  outputStage: document.querySelector("#output-stage"),
  progress: document.querySelector("#progress"),
  recentTests: document.querySelector("#recent-tests"),
  runLabel: document.querySelector("#run-label"),
  stages: document.querySelector("#stages"),
  stageSummary: document.querySelector("#stage-summary"),
  status: document.querySelector("#status"),
  testCounts: document.querySelector("#test-counts"),
  testSummary: document.querySelector("#test-summary"),
};

let state;
let receivedAt = Date.now();
const eventSource = new EventSource("/events");
eventSource.addEventListener("state", ({ data }) => {
  state = JSON.parse(data);
  receivedAt = Date.now();
  render();
});

setInterval(() => {
  if (state?.status === "running") renderElapsed();
}, 500);

function render() {
  renderHeader();
  renderStages();
  renderTests();
  renderOutput();
  renderFailures();
}

function renderHeader() {
  const run = state.run;
  const status = state.status;
  elements.status.className = `status ${status}`;
  elements.status.textContent = capitalise(status);
  elements.runLabel.textContent = run === undefined
    ? "Waiting for a verification run…"
    : `${run.label} · ${run.profile} verification`;
  elements.metadata.replaceChildren();
  if (run !== undefined) {
    for (const value of [run.branch, run.commit, `${run.totalStages} stages`]) {
      elements.metadata.append(textElement("span", value));
    }
  }
  renderElapsed();
}

function renderElapsed() {
  const run = state?.run;
  if (run === undefined) {
    elements.elapsed.textContent = "00:00";
    return;
  }
  const end = run.finishedAt === undefined ? Date.now() : Date.parse(run.finishedAt);
  elements.elapsed.textContent = formatClock(end - Date.parse(run.startedAt));
}

function renderStages() {
  const total = state.run?.totalStages ?? 0;
  const completed = state.stages.filter(({ status }) => status === "passed" || status === "failed").length;
  elements.stageSummary.textContent = `${completed} of ${total} complete`;
  elements.progress.style.width = `${total === 0 ? 0 : (completed / total) * 100}%`;
  elements.stages.replaceChildren();
  state.stages.forEach((stage, index) => {
    const card = document.createElement("article");
    card.className = `stage ${stage.status}`;
    const top = document.createElement("div");
    top.className = "stage-top";
    top.append(textElement("span", String(index + 1).padStart(2, "0"), "stage-index"));
    top.append(textElement("span", stage.status, `badge ${stage.status}`));
    card.append(top);
    card.append(textElement("p", stage.label, "stage-label"));
    card.append(textElement("p", formatDuration(stage.durationMs), "stage-time"));
    elements.stages.append(card);
  });
  for (let index = state.stages.length; index < total; index += 1) {
    const card = document.createElement("article");
    card.className = "stage pending";
    const top = document.createElement("div");
    top.className = "stage-top";
    top.append(textElement("span", String(index + 1).padStart(2, "0"), "stage-index"));
    top.append(textElement("span", "pending", "badge pending"));
    card.append(top, textElement("p", "Queued", "stage-label"));
    elements.stages.append(card);
  }
}

function renderTests() {
  const tests = state.tests;
  elements.testSummary.textContent = `${tests.completed} / ${tests.planned}`;
  elements.testCounts.replaceChildren(
    countElement("passed", tests.passed),
    countElement("failed", tests.failed),
    countElement("skipped", tests.skipped),
    countElement("active", tests.active.length),
  );
  elements.activeTests.replaceChildren();
  elements.activeTests.classList.toggle("empty", tests.active.length === 0);
  if (tests.active.length === 0) {
    elements.activeTests.textContent = state.status === "running"
      ? "The current stage has no individual test activity."
      : "No test is currently running.";
  } else {
    for (const test of tests.active.slice(0, 6)) {
      const item = document.createElement("div");
      item.className = "active-test";
      item.append(
        textElement("span", test.title, "test-title"),
        textElement("span", [test.project, shortFile(test.file)].filter(Boolean).join(" · "), "test-meta"),
      );
      elements.activeTests.append(item);
    }
  }
  elements.recentTests.replaceChildren();
  for (const test of tests.recent.slice(0, 7)) {
    const row = document.createElement("div");
    row.className = "test-row";
    row.append(
      textElement("span", test.title, "test-title"),
      textElement("span", `${test.status} ${formatDuration(test.durationMs)}`, `test-status ${test.status}`),
    );
    elements.recentTests.append(row);
  }
}

function renderOutput() {
  const current = state.stages.find(({ id }) => id === state.currentStageId)
    ?? state.stages.at(-1);
  elements.outputStage.textContent = current?.label ?? "Idle";
  const text = state.output.map(({ text: line }) => line).join("\n");
  const shouldStick = elements.output.scrollTop + elements.output.clientHeight >= elements.output.scrollHeight - 24;
  elements.output.textContent = text || "Waiting for output…";
  if (shouldStick) elements.output.scrollTop = elements.output.scrollHeight;
}

function renderFailures() {
  const failures = state.tests.failures;
  elements.failuresPanel.hidden = failures.length === 0;
  elements.failures.replaceChildren();
  for (const failure of failures) {
    const item = document.createElement("article");
    item.className = "failure";
    item.append(textElement("strong", failure.title));
    if (failure.file) item.append(textElement("p", shortFile(failure.file), "test-meta"));
    if (failure.error) item.append(textElement("pre", failure.error));
    elements.failures.append(item);
  }
}

function countElement(label, value) {
  const element = document.createElement("div");
  element.className = `count ${label}`;
  element.append(textElement("strong", value), textElement("span", label));
  return element;
}

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text ?? "";
  return element;
}

function shortFile(file) {
  return file?.replaceAll("\\", "/").split("/").slice(-3).join("/");
}

function formatDuration(durationMs) {
  if (durationMs === undefined) return "";
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

function formatClock(durationMs) {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function capitalise(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
