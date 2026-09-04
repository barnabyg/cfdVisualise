import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

import { applyDashboardEvent, createDashboardState } from "./state.mjs";

const assets = new Map([
  ["/", { file: "dashboard.html", type: "text/html; charset=utf-8" }],
  ["/dashboard.css", { file: "dashboard.css", type: "text/css; charset=utf-8" }],
  ["/dashboard.js", { file: "dashboard.js", type: "text/javascript; charset=utf-8" }],
]);

export async function startDashboard({ host = "127.0.0.1", port = 0 } = {}) {
  const state = createDashboardState();
  const clients = new Set();
  const eventToken = randomUUID();
  const loadedAssets = new Map();

  for (const [pathname, asset] of assets) {
    loadedAssets.set(pathname, {
      body: await readFile(new URL(asset.file, import.meta.url)),
      type: asset.type,
    });
  }

  const sendState = (response) => {
    response.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
  };

  const publish = (event) => {
    applyDashboardEvent(state, event);
    for (const client of clients) sendState(client);
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}`);
    const asset = loadedAssets.get(url.pathname);
    if (request.method === "GET" && asset !== undefined) {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'",
        "content-type": asset.type,
      });
      response.end(asset.body);
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      response.writeHead(200, {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream",
      });
      clients.add(response);
      sendState(response);
      request.once("close", () => clients.delete(response));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(state));
      return;
    }

    if (request.method === "POST" && url.pathname === `/api/events/${eventToken}`) {
      try {
        const body = await readJsonBody(request);
        publish(body);
        response.writeHead(204);
        response.end();
      } catch (error) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        response.end(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolvePromise();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Dashboard server did not bind to a TCP port.");
  }
  const url = `http://${host}:${address.port}/`;
  let closePromise;

  return {
    url,
    eventsUrl: `${url}api/events/${eventToken}`,
    publish,
    snapshot: () => structuredClone(state),
    close() {
      if (closePromise !== undefined) return closePromise;
      closePromise = new Promise((resolvePromise, reject) => {
        server.close((error) => (error === undefined ? resolvePromise() : reject(error)));
      });
      for (const client of clients) client.end();
      clients.clear();
      // A browser EventSource can reconnect while shutdown is in progress, and
      // ordinary keep-alive sockets otherwise delay server.close(). Verification
      // has finished, so no dashboard connection needs a graceful drain.
      server.closeAllConnections();
      return closePromise;
    },
  };
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Dashboard event exceeds 64 KiB.");
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (value === null || typeof value !== "object" || typeof value.type !== "string") {
    throw new Error("Dashboard event must be an object with a type.");
  }
  return value;
}
