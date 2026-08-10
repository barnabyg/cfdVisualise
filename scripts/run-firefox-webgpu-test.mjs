import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  spawnViteServer,
  stopViteServer,
  waitForViteServer,
} from "./vite-server.mjs";

// Playwright's headless Firefox does not expose a WebGPU adapter. Drive the installed,
// headed browser through its standard WebDriver BiDi endpoint for this compatibility gate.

class BidiSession {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolvePromise, reject) => {
      socket.addEventListener("open", resolvePromise, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new BidiSession(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextCommandId = 0;
    this.pending = new Map();
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      const waiter = this.pending.get(message.id);
      if (waiter === undefined) return;
      this.pending.delete(message.id);
      if (message.type === "error") waiter.reject(new Error(JSON.stringify(message)));
      else waiter.resolve(message);
    });
  }

  command(method, params = {}) {
    return new Promise((resolvePromise, reject) => {
      const id = ++this.nextCommandId;
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(context, expression) {
    const response = await this.command("script.evaluate", {
      expression,
      target: { context },
      awaitPromise: true,
    });
    const result = response.result.result ?? response.result;
    if (result.type === "exception") {
      throw new Error(result.exceptionDetails.text);
    }
    return result.value;
  }

  async close() {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    try {
      await this.command("session.end");
    } finally {
      this.socket.close();
    }
  }
}

const APP_PORT = 4175;
const APP_URL = `http://127.0.0.1:${APP_PORT}/`;
const WEBGPU_TIER_ID = "webgpu-balanced-d18";
const WEBGPU_EVIDENCE_IDENTITY =
  "webgpu-reference / webgpu-balanced-d18 / ticket-08";

const firefoxBinary = await resolveFirefoxBinary();
const bidiPort = await reservePort();
const profilePath = await mkdtemp(join(tmpdir(), "cfd-firefox-webgpu-"));
const vite = spawnViteServer({ port: APP_PORT });
const firefox = spawn(
  firefoxBinary,
  [
    "--new-instance",
    "--no-remote",
    "--remote-debugging-port",
    String(bidiPort),
    "--profile",
    profilePath,
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let firefoxOutput = "";
firefox.stdout.on("data", (chunk) => {
  firefoxOutput += chunk.toString();
});
firefox.stderr.on("data", (chunk) => {
  firefoxOutput += chunk.toString();
});

let session;
try {
  await waitForViteServer(APP_URL, "Firefox WebGPU test server", 100);
  const websocketBase = await waitForWebDriverBidi(firefox, () => firefoxOutput);
  session = await BidiSession.connect(`${websocketBase}/session`);
  await session.command("session.new", { capabilities: { alwaysMatch: {} } });
  const created = await session.command("browsingContext.create", { type: "tab" });
  const context = created.result.context;
  await session.command("browsingContext.navigate", {
    context,
    url: APP_URL,
    wait: "complete",
  });
  await session.evaluate(
    context,
    `localStorage.setItem("cfd-visualise-quality-tier", ${JSON.stringify(WEBGPU_TIER_ID)}); true`,
  );
  await session.command("browsingContext.reload", { context, wait: "complete" });

  const readyText = await waitForPageState(session, context, (text) => {
    if (text.includes("Result unavailable")) {
      throw new Error(`Firefox rejected the production WebGPU tier.\n${text.slice(-4_000)}`);
    }
    return text.includes(WEBGPU_EVIDENCE_IDENTITY);
  });
  if (!readyText.includes("Step 0.05 D/U")) {
    throw new Error("Firefox started WebGPU, but the step action is missing.");
  }
  const stepped = await session.evaluate(
    context,
    `(() => {
      const button = [...document.querySelectorAll("button")]
        .find((candidate) => (candidate.textContent ?? "").toLowerCase().includes("step 0.05 d/u"));
      button?.click();
      return button !== undefined;
    })()`,
  );
  if (stepped !== true) throw new Error("Could not advance the WebGPU experiment in Firefox.");
  await waitForScriptValue(
    session,
    context,
    `(() => {
      if (document.body.innerText.includes("Result unavailable")) {
        throw new Error("Firefox lost the production WebGPU tier while advancing.");
      }
      const term = [...document.querySelectorAll("dt")]
        .find((candidate) => /flow-through time/i.test(candidate.textContent ?? ""));
      return term?.nextElementSibling?.textContent?.trim() !== "0.00 D/U";
    })()`,
    20_000,
  );
  process.stdout.write(
    "Firefox compiled the production WebGPU tier and advanced a real experiment step.\n",
  );
} finally {
  await session?.close();
  firefox.kill();
  await Promise.race([waitForExit(firefox), delay(3_000)]);
  await stopViteServer(vite);
  await delay(500);
  const resolvedProfile = resolve(profilePath);
  if (resolvedProfile.startsWith(resolve(tmpdir()))) {
    await rm(resolvedProfile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}

async function resolveFirefoxBinary() {
  if (process.env.FIREFOX_BINARY !== undefined) {
    await access(process.env.FIREFOX_BINARY);
    return process.env.FIREFOX_BINARY;
  }
  const candidates =
    process.platform === "win32"
      ? [
          "C:/Program Files/Mozilla Firefox/firefox.exe",
          "C:/Program Files (x86)/Mozilla Firefox/firefox.exe",
        ]
      : process.platform === "darwin"
        ? ["/Applications/Firefox.app/Contents/MacOS/firefox"]
        : ["/usr/bin/firefox", "/usr/local/bin/firefox"];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next conventional installation path.
    }
  }
  throw new Error(
    "Firefox was not found. Set FIREFOX_BINARY to the installed Firefox executable.",
  );
}

function reservePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a Firefox WebDriver BiDi port."));
        return;
      }
      server.close((error) => {
        if (error !== undefined) reject(error);
        else resolvePromise(address.port);
      });
    });
  });
}

async function waitForWebDriverBidi(processHandle, output) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const endpoint = output().match(/ws:\/\/[^\s]+/)?.[0];
    if (endpoint !== undefined) return endpoint;
    if (processHandle.exitCode !== null) {
      throw new Error(`Firefox exited before WebDriver BiDi started.\n${output()}`);
    }
    await delay(100);
  }
  throw new Error(`Firefox WebDriver BiDi did not start.\n${output()}`);
}

async function waitForPageState(session, context, predicate, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastText = "";
  while (Date.now() < deadline) {
    lastText = await session.evaluate(context, "document.body.innerText");
    if (predicate(lastText)) return lastText;
    await delay(100);
  }
  throw new Error(`Firefox page state timed out.\n${lastText.slice(-4_000)}`);
}

async function waitForScriptValue(session, context, expression, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await session.evaluate(context, expression)) === true) return;
    await delay(100);
  }
  throw new Error(`Firefox script condition timed out: ${expression}`);
}

function waitForExit(processHandle) {
  if (processHandle.exitCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => processHandle.once("exit", resolvePromise));
}
