import { expect, test } from "./fixtures";
import { loadKnownScene } from "../utils/selection";

test.describe("Feature graph parameter editor", () => {
  test.beforeEach(async ({ page }) => {
    await loadKnownScene(page);
  });

  test("adds parameters and edits feature values through structured JSON tree", async ({ page }, testInfo) => {
    await page.getByRole("button", { name: "Add Parameter" }).click();
    await expect(page.getByLabel("Parameter name param_1")).toBeVisible();
    await expect(page.getByLabel("Parameter param_1 slider")).toHaveValue("0");
    await expect(page.getByLabel("Parameter param_1 value")).toHaveValue("0");
    await expect(page.getByLabel("Parameter Editor").getByText("size.x")).toHaveCount(0);

    await page.getByLabel("Parameter name param_1").fill("width");
    await page.getByLabel("Parameter name param_1").blur();
    await expect.poll(async () => {
      const graph = await page.evaluate(() => window.__TEST_API__.getFeatureGraph());
      return graph.parameters[0]?.name;
    }).toBe("width");

    await expect(page.locator("#code-view details").first()).toBeVisible();
    await page.getByLabel("Feature graph parameters.0.value").fill("4");
    await page.getByLabel("Feature graph parameters.0.value").blur();
    await expect(page.getByLabel("Parameter width slider")).toHaveValue("4");

    await page.getByLabel("Feature graph features.0.params.size.x").fill("width");
    await page.getByLabel("Feature graph features.0.params.size.x").blur();
    await expect.poll(async () => {
      const graph = await page.evaluate(() => window.__TEST_API__.getFeatureGraph());
      return graph.features[0].params.size.x;
    }).toEqual({ $param: "width" });

    await expect.poll(async () => {
      const graph = await page.evaluate(() => window.__TEST_API__.getFeatureGraph());
      return graph.parameters[0]?.value;
    }).toBe(4);
    await expect.poll(async () => {
      const cube = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
      return cube?.scale?.x;
    }).toBe(4);

    await page.getByLabel("Parameter name width").fill("model_width");
    await page.getByLabel("Parameter name width").blur();
    await expect.poll(async () => {
      const graph = await page.evaluate(() => window.__TEST_API__.getFeatureGraph());
      return {
        name: graph.parameters[0]?.name,
        ref: graph.features[0].params.size.x,
      };
    }).toEqual({ name: "model_width", ref: { $param: "model_width" } });

    await page.locator("#code-panel").screenshot({ path: testInfo.outputPath("parameter-editor-bound.png") });

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("replace its references");
      await dialog.accept();
    });
    await page.getByRole("button", { name: "Delete parameter model_width" }).click();
    await expect.poll(async () => {
      const graph = await page.evaluate(() => window.__TEST_API__.getFeatureGraph());
      return {
        parameters: graph.parameters,
        literal: graph.features[0].params.size.x,
      };
    }).toEqual({ parameters: [], literal: 4 });

    await expect(page.locator("#code-view")).toHaveAttribute("data-structured-json-editor", "true");
    await expect(page.locator("#code-view")).not.toHaveAttribute("contenteditable", "true");
  });
});
