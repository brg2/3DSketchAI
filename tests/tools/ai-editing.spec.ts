import { expect, test } from "./fixtures";
import { expectCanvasSnapshot } from "../utils/assertions";
import { loadKnownScene } from "../utils/selection";

test.describe("AI feature graph editing", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("https://api.openai.com/v1/responses", async (route) => {
      const request = route.request();
      expect(request.method()).toBe("POST");
      const body = request.postDataJSON();
      expect(JSON.stringify(body)).toContain("featureGraph");
      expect(JSON.stringify(body)).toContain("selection");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          output_text: JSON.stringify({
            operations: [
              { type: "add_parameter", parameter: { name: "ai_width", value: 2 } },
              {
                type: "update_feature_params",
                featureId: "feature_1",
                params: { size: { x: { $param: "ai_width" } } },
              },
            ],
          }),
        }),
      });
    });
    await loadKnownScene(page);
  });

  test("submits and applies a provider patch without a backend proxy or key leakage", async ({ page }) => {
    await expect(page.getByRole("tab", { name: "Graph" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "AI" })).toHaveCount(0);
    const prompt = page.getByRole("textbox", { name: "Prompt" });
    await expect(prompt).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit prompt" })).toBeVisible();
    await expect(page.getByLabel("Provider")).toBeHidden();

    await page.getByRole("tab", { name: "Settings" }).click();
    await page.getByLabel("API Key").fill("sk-test-local-only");
    await page.getByRole("button", { name: "Save Key" }).click();
    await expect(page.getByText("Key stored locally encrypted.")).toBeVisible();

    await page.getByRole("tab", { name: "Graph" }).click();
    await prompt.fill("Make the cube wider with a named parameter.");
    await prompt.press("Enter");
    await expect.poll(async () => {
      const graph = await page.evaluate(() => window.__TEST_API__.getFeatureGraph());
      return graph.parameters;
    }).toEqual([{ name: "ai_width", value: 2 }]);
    await expect(prompt).toHaveValue("");

    await prompt.press("ArrowUp");
    await expect(prompt).toHaveValue("Make the cube wider with a named parameter.");
    await prompt.press("ArrowDown");
    await expect(prompt).toHaveValue("");
    await expect(page.getByText("ai_width")).toBeVisible();
    await expect(page.getByLabel("AI patch preview")).toHaveCount(0);

    const graph = await page.evaluate(() => window.__TEST_API__.getFeatureGraph());
    expect(graph.parameters).toEqual([{ name: "ai_width", value: 2 }]);
    expect(graph.features[0].params.size.x).toEqual({ $param: "ai_width" });
    expect(JSON.stringify(graph)).not.toContain("sk-test-local-only");

    const context = await page.evaluate(() => window.__TEST_API__.getAiContext("inspect"));
    expect(JSON.stringify(context)).not.toContain("sk-test-local-only");

    await expectCanvasSnapshot(page, "ai-editing-applied-parameter-patch.png");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => page.evaluate(() => window.__TEST_API__.getFeatureGraph()))
      .toMatchObject({ parameters: [] });
  });
});
