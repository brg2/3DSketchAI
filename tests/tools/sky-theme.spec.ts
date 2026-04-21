import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";

test("sky and frame themes: dropdowns, persistence, and distinct atmospheres", async ({ page }) => {
  await page.goto("/?e2e=1");

  await page.waitForFunction(() => typeof (window as any).__TEST_API__?.setupDeterministicScene === "function");
  await page.evaluate(() => (window as any).__TEST_API__.setupDeterministicScene());

  const canvas = page.locator("#viewport");
  await expect(canvas).toBeVisible();
  const body = page.locator("body");

  const outDir = path.join(process.cwd(), "test-results", "sky-theme");
  await fs.mkdir(outDir, { recursive: true });

  // Theme control lives in the Settings panel.
  await page.locator("#panel-tab-settings").click();
  const uiThemeSelect = page.locator("#ui-theme");
  const skySelect = page.locator("#sky-theme");
  await expect(uiThemeSelect).toBeVisible();
  await expect(skySelect).toBeVisible();
  const solidField = page.locator("#sky-solid-field");
  const solidToggle = page.locator("#sky-solid-toggle");
  const solidPopover = page.locator("#sky-solid-popover");
  const solidColorInput = page.locator("#sky-solid-color-input");
  const solidHexInput = page.locator("#sky-solid-hex-input");

  // Full-app baseline with the light UI frame and clear noon sky.
  await uiThemeSelect.selectOption("light");
  await page.waitForTimeout(150);
  await expect(body).toHaveAttribute("data-ui-theme", "light");
  await page.screenshot({ path: path.join(outDir, "full-ui-light.png"), fullPage: true });

  // Auto mode follows the desktop preference.
  await uiThemeSelect.selectOption("auto");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(body).toHaveAttribute("data-ui-theme", "dark");
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, "full-ui-dark-auto.png"), fullPage: true });

  // Reload should restore the selected UI mode and resolve it from the current desktop preference.
  await page.reload();
  await page.waitForFunction(() => document.body?.dataset?.uiTheme === "dark");
  await expect(uiThemeSelect).toHaveValue("auto");

  // Switch to Solid Color and set a custom value.
  await page.locator("#panel-tab-settings").click();
  await skySelect.selectOption("solidColor");
  await expect(solidField).toBeVisible();
  await solidToggle.click();
  await expect(solidPopover).toBeVisible();
  await solidHexInput.fill("#ff7f50");
  await solidColorInput.evaluate((input) => {
    const element = input;
    element.value = "#ff7f50";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, "full-solid-color.png"), fullPage: true });

  // Reload should restore both theme and color from session state.
  await page.reload();
  await page.waitForFunction(() => document.body?.dataset?.skyTheme === "solidColor");
  await expect(solidHexInput).toHaveValue("#FF7F50");

  // Switch to Night Sky for a second distinct atmosphere state.
  await page.locator("#panel-tab-settings").click();
  await skySelect.selectOption("nightSky");
  await expect(solidField).toBeHidden();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, "full-night-sky.png"), fullPage: true });

  // Close-up: UI theme selector and the solid color mini dialog.
  const uiBox = await uiThemeSelect.boundingBox();
  if (uiBox) {
    await page.screenshot({
      path: path.join(outDir, "closeup-ui-theme.png"),
      clip: {
        x: Math.max(0, uiBox.x - 40),
        y: Math.max(0, uiBox.y - 40),
        width: Math.min(560, uiBox.width + 320),
        height: Math.min(360, uiBox.height + 240),
      },
    });
  } else {
    await page.screenshot({ path: path.join(outDir, "closeup-ui-theme.png") });
  }
});
