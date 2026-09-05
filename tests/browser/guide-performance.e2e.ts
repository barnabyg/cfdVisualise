import { expect, test } from "@playwright/test";

test("the real CPU guide completes across the browser matrix", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    localStorage.setItem("cfd-visualise-quality-tier", "cpu-balanced-d18");
  });
  await page.goto("/");
  await expect(page.getByText(/CPU balanced · cpu-reference/)).toBeVisible({
    timeout: 20_000,
  });

  const started = performance.now();
  await page.getByRole("button", { name: /start guided experiment/i }).click();
  await expect(page.locator("[data-guide-stage=baseline]")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const key = page.getByRole("region", { name: "Wake encoding key" });
  const wake = page.getByRole("img", { name: /Full-domain wake/ });
  const checkMobileKey = async () => {
    const fieldBounds = await wake.boundingBox();
    const keyBounds = await key.boundingBox();
    expect(keyBounds!.y).toBeGreaterThanOrEqual(fieldBounds!.y + fieldBounds!.height);
  };
  await checkMobileKey();
  await expect(page.getByText(/baseline measured/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-guide-stage=prediction]")).toBeVisible();
  await page.getByRole("radio", { name: /become unsteady/i }).check();
  await page.getByRole("button", { name: /commit prediction/i }).click();
  await expect(page.locator("[data-guide-stage=adapting]")).toBeVisible();
  await checkMobileKey();
  const signal = page.getByRole("region", { name: "Canvas guide and shedding signal" });
  await expect(signal.getByRole("heading", { name: "Shedding signal" })).toBeVisible();
  await expect(page.locator("[data-guide-stage=observing]")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const cursor = signal.getByText(/Wake cursor/);
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeDisabled();
  const paused = await cursor.textContent();
  await page.waitForTimeout(500);
  await expect(cursor).toHaveText(paused!);
  await page.getByRole("button", { name: /Step 0.05/ }).click();
  await expect(cursor).not.toHaveText(paused!);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByText(/prediction compared/i)).toBeVisible({ timeout: 120_000 });
  const durationSeconds = (performance.now() - started) / 1_000;
  await expect(page.locator("[data-guide-stage=complete]")).toBeVisible();
  await expect(signal.getByText(/One measured cycle/)).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("region", { name: "Wake view", exact: true }).screenshot({ path: testInfo.outputPath("visual-experience-2-wake.png") });
  await page.screenshot({ path: testInfo.outputPath("visual-experience-2-desktop.png"), fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("[data-guide-stage=complete]")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await signal.scrollIntoViewIfNeeded();
  await signal.screenshot({ path: testInfo.outputPath("visual-experience-2-mobile-signal.png") });
  await page.screenshot({ path: testInfo.outputPath("visual-experience-2-mobile.png"), fullPage: true });

  console.info(
    `Production CPU guide duration (${testInfo.project.name}): ${durationSeconds.toFixed(2)}s`,
  );
  await testInfo.attach("guide-performance", {
    body: `${JSON.stringify({
      schemaVersion: "1",
      backendId: "cpu-reference",
      qualityTier: "cpu-balanced-d18",
      browser: testInfo.project.name,
      guideDurationSeconds: durationSeconds,
    })}\n`,
    contentType: "application/json",
  });
  expect(durationSeconds).toBeLessThanOrEqual(90);
});
