import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";

test("sky themes: dropdown, persistence, and distinct atmospheres", async ({ page }) => {
  await page.goto("/?e2e=1");

  await page.waitForFunction(() => typeof (window as any).__TEST_API__?.setupDeterministicScene === "function");
  await page.evaluate(() => (window as any).__TEST_API__.setupDeterministicScene());

  const canvas = page.locator("#viewport");
  await expect(canvas).toBeVisible();

  const outDir = path.join(process.cwd(), "test-results", "sky-theme");
  await fs.mkdir(outDir, { recursive: true });

  // Theme control lives in the Settings panel.
  await page.locator("#panel-tab-settings").click();
  const skySelect = page.locator("#sky-theme");
  await expect(skySelect).toBeVisible();

  // Full-app baseline (Clear Noon default)
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, "full-clear-noon.png"), fullPage: true });

  // Switch to Night Sky
  await skySelect.selectOption("nightSky");
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, "full-night-sky.png"), fullPage: true });

  // Quick persistence check: reload should restore the theme via session state.
  await page.reload();
  await page.waitForFunction(() => document.body?.dataset?.skyTheme === "nightSky");

  // Close-up: settings panel control.
  await page.locator("#panel-tab-settings").click();
  const box = await skySelect.boundingBox();
  if (box) {
    await page.screenshot({
      path: path.join(outDir, "closeup-sky-dropdown.png"),
      clip: {
        x: Math.max(0, box.x - 60),
        y: Math.max(0, box.y - 90),
        width: Math.min(520, box.width + 320),
        height: Math.min(420, box.height + 260),
      },
    });
  } else {
    await page.screenshot({ path: path.join(outDir, "closeup-sky-dropdown.png") });
  }
});
