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
  await expect(page.getByText(/baseline measured/i)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("radio", { name: /become unsteady/i }).check();
  await page.getByRole("button", { name: /commit prediction/i }).click();
  await expect(page.getByText(/prediction compared/i)).toBeVisible({ timeout: 120_000 });
  const durationSeconds = (performance.now() - started) / 1_000;

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
