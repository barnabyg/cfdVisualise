import { expect, test } from "@playwright/test";

test("production CPU Worker renders, resizes, rejects stale events, and disposes", async ({
  page,
}) => {
  const auditedCommands: string[] = [];
  await page.exposeFunction("__recordWakeCommand", (type: string) => {
    auditedCommands.push(type);
  });
  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    class AuditedWorker extends NativeWorker {
      public override postMessage(
        message: unknown,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
      ): void {
        const record = (
          globalThis as typeof globalThis & {
            __recordWakeCommand?: (type: string) => Promise<void>;
          }
        ).__recordWakeCommand;
        if (typeof message === "object" && message !== null) {
          void record?.((message as { type?: string }).type ?? "unknown");
        }
        const audit = globalThis as typeof globalThis & {
          __wakeAudit?: { worker?: Worker; initialise?: Record<string, unknown> };
        };
        audit.__wakeAudit ??= {};
        audit.__wakeAudit.worker = this;
        if (
          typeof message === "object" &&
          message !== null &&
          (message as { type?: string }).type === "initialise"
        ) {
          audit.__wakeAudit.initialise = message as Record<string, unknown>;
        }
        if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions);
        else super.postMessage(message, transferOrOptions);
      }
    }
    globalThis.Worker = AuditedWorker;
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const workerCreated = page.waitForEvent("worker");
  await page.goto("/");
  const productionWorker = await workerCreated;

  const wake = page.getByRole("img", { name: /full-domain wake view/i });
  await expect(wake).toBeVisible();
  await expect(page.getByText(/CPU balanced/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("checkbox", { name: /passive tracers/i })).not.toBeChecked();
  await expect(page.getByText("paused", { exact: true })).toBeVisible();

  const before = await wake.evaluate((canvas) => (canvas as HTMLCanvasElement).width);
  await page.setViewportSize({ width: 980, height: 760 });
  await expect.poll(() => wake.evaluate((canvas) => (canvas as HTMLCanvasElement).width)).not.toBe(before);

  await page.getByRole("button", { name: /start guided experiment/i }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("playing", { exact: true })).toBeVisible();

  const beforeStale = await page.getByText(/^[0-9]+\.[0-9]$/).first().textContent();
  await page.evaluate(() => {
    const audit = globalThis as typeof globalThis & {
      __wakeAudit?: { worker?: Worker; initialise?: Record<string, unknown> };
    };
    const worker = audit.__wakeAudit?.worker;
    const initialise = audit.__wakeAudit?.initialise;
    if (worker === undefined || initialise === undefined) {
      throw new Error("Wake Worker audit was not initialised.");
    }
    worker.onmessage?.(
      new MessageEvent("message", {
        data: {
          protocolVersion: initialise.protocolVersion,
          sessionId: initialise.sessionId,
          sequence: 0,
          type: "summary",
          summary: {
            scenario: initialise.scenario,
            reynoldsNumber: 999,
            targetReynoldsNumber: 999,
            flowThroughTime: 999,
            regime: "unclassified",
            playback: "playing",
            targetPlaybackRate: 1,
            achievedPlaybackRate: 1,
            tracersEnabled: false,
          },
        },
      }),
    );
  });
  await expect(page.getByText("999.0", { exact: true })).toHaveCount(0);
  expect(await page.getByText(/^[0-9]+\.[0-9]$/).first().textContent()).toBe(beforeStale);

  let workerClosed = false;
  productionWorker.once("close", () => {
    workerClosed = true;
  });
  await page.evaluate(() => globalThis.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect.poll(() => auditedCommands).toContain("dispose");
  await expect.poll(() => workerClosed).toBe(true);
});
