import { expect, test } from "@playwright/test";

test("editable physical values settle to sensible precision", async ({ page }) => {
  await page.goto("/");

  const editableValues = page.getByRole("spinbutton");
  await expect(editableValues).toHaveCount(3);

  const highPrecisionValues = ["0.0023456789", "0.0123456789", "0.00000123456789"];

  for (let index = 0; index < highPrecisionValues.length; index += 1) {
    const input = editableValues.nth(index);
    await input.fill(highPrecisionValues[index]!);
    await input.press("Tab");
    await expect.poll(async () => significantDigits(await input.inputValue())).toBeLessThanOrEqual(3);
  }
});

function significantDigits(value: string): number {
  return value
    .replace(/e[+-]?\d+$/i, "")
    .replace(".", "")
    .replace(/^[-0]+/, "")
    .length;
}
