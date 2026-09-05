import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  test(`wake-first layout and sandbox controls at ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("cfd-visualise-quality-tier", "cpu-balanced-d18"));
    await page.goto("/");
    const wake = page.getByRole("img", { name: /Full-domain wake/ });
    const play = page.getByRole("button", { name: "Play", exact: true });
    await expect(play).toBeEnabled({ timeout: 20_000 });
    const bounds = await wake.boundingBox();
    expect(bounds!.width).toBeGreaterThan(viewport.width === 1440 ? 800 : viewport.width === 1024 ? 640 : 340);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(bounds!.width / bounds!.height).toBeCloseTo(21 / 17, 2);
    expect((await play.boundingBox())!.y).toBeLessThan(bounds!.y);
    const hud = page.getByRole("region", { name: "Learning readouts" });
    await expect(hud.getByText("Reynolds number", { exact: true })).toBeVisible();
    await expect(hud.getByText("paused", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`initial-${viewport.width}.png`), fullPage: true });

    await page.getByRole("button", { name: "Skip to sandbox" }).click();
    const advanced = page.locator("details").filter({ has: page.locator("summary", { hasText: "Advanced controls" }) });
    const disclosure = advanced.locator("summary");
    await expect(advanced).not.toHaveAttribute("open", "");
    await expect(disclosure).toContainText("CPU balanced");
    await disclosure.focus();
    await page.keyboard.press("Enter");
    await expect(advanced).toHaveAttribute("open", "");
    await advanced.getByRole("checkbox", { name: "Passive tracers" }).check();
    await advanced.getByRole("combobox", { name: "Playback rate" }).selectOption("0.5");
    await expect(disclosure).toContainText("0.5× · tracers on");
    await disclosure.click();
    await disclosure.click();
    await expect(advanced.getByRole("checkbox", { name: "Passive tracers" })).toBeChecked();
    await expect(advanced.getByRole("combobox", { name: "Playback rate" })).toHaveValue("0.5");
    await expect(advanced.getByRole("combobox", { name: "Quality tier" })).toBeEnabled();
    const speed = page.locator("#speed-value");
    await speed.fill("0.003");
    await speed.press("Tab");
    await expect(speed).toHaveValue("0.003");
    await play.click();
    await expect(hud.getByText("playing", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(hud.getByText("paused", { exact: true })).toBeVisible();
    const evidence = page.locator("details").filter({ has: page.locator("summary", { hasText: "Method and validation" }) });
    await evidence.locator("summary").click();
    await expect(page.getByRole("region", { name: "Method and validation" })).toBeVisible();
    await evidence.locator("summary").click();
    await expect(evidence.getByText("Evidence passed", { exact: true })).toBeVisible();
    await page.emulateMedia({ forcedColors: "active" });
    await expect(page.getByText(/−2 ↻ clockwise.*0 neutral.*\+2 ↺ counter-clockwise/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`high-contrast-${viewport.width}.png`), fullPage: true });
  });
}
