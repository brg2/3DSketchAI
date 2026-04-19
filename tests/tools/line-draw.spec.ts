import { expect, test } from "@playwright/test";
import { expectCanvasSnapshot } from "../utils/assertions";
import { expectFeatureGraphIntegrity } from "../utils/feature-graph";
import { activateTool, loadKnownScene } from "../utils/selection";

async function clickCanvasAtClientPoint(page, point) {
  const box = await page.locator("canvas").boundingBox();
  expect(box).toBeTruthy();
  await page.locator("canvas").click({
    position: {
      x: point.x - box!.x,
      y: point.y - box!.y,
    },
  });
}

async function dblclickCanvasAtClientPoint(page, point) {
  const box = await page.locator("canvas").boundingBox();
  expect(box).toBeTruthy();
  await page.locator("canvas").dblclick({
    position: {
      x: point.x - box!.x,
      y: point.y - box!.y,
    },
  });
}

test.describe("line draw tool", () => {
  test.beforeEach(async ({ page }) => {
    await loadKnownScene(page);
  });

  test("commits an open polyline guide feature on a picked face plane", async ({ page }) => {
    await page.getByRole("button", { name: "Face" }).click();
    await activateTool(page, "Line Draw");

    const path = await page.evaluate(() => window.__TEST_API__.getPolylineDrawPath({
      objectName: "cube",
      faceIndex: 0,
      points: [
        { x: -0.28, y: -0.2 },
        { x: 0.22, y: -0.2 },
        { x: 0.22, y: 0.24 },
      ],
    }));
    expect(path).toBeTruthy();
    expect(path.length).toBe(3);

    await clickCanvasAtClientPoint(page, path[0].client);
    await page.mouse.move(path[1].client.x, path[1].client.y, { steps: 6 });

    let scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    expect(scene.tool.activeTool).toBe("lineDraw");
    expect(scene.featureGraph).toHaveLength(1);

    await clickCanvasAtClientPoint(page, path[1].client);
    await page.mouse.move(path[2].client.x, path[2].client.y, { steps: 6 });
    await dblclickCanvasAtClientPoint(page, path[2].client);
    await page.evaluate(() => window.__TEST_API__.nextFrame(3));

    const graph = await expectFeatureGraphIntegrity(page);
    expect(graph.featureCount).toBe(2);
    expect(graph.features[1].type).toBe("polyline");
    expect(graph.features[1].target.objectId).toBe("cube");
    expect(graph.features[1].dependsOn).toEqual(["feature_1"]);
    expect(graph.features[1].params.objectId).toBe("polyline_1");
    expect(graph.features[1].params.closed).toBe(false);
    expect(graph.features[1].params.points).toHaveLength(3);
    expect(graph.features[1].params.plane.normal).toMatchObject({ x: 0, y: 1, z: 0 });

    scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    expect(scene.objects.polyline_1.primitive).toBe("polyline");
    await expectCanvasSnapshot(page, "line-draw-open-polyline-face.png");
  });

  test("clicking the first point closes and commits the polyline", async ({ page }) => {
    await page.getByRole("button", { name: "Face" }).click();
    await activateTool(page, "Line Draw");

    const path = await page.evaluate(() => window.__TEST_API__.getPolylineDrawPath({
      objectName: "cube",
      faceIndex: 0,
      points: [
        { x: -0.24, y: -0.22 },
        { x: 0.26, y: -0.22 },
        { x: 0.02, y: 0.24 },
      ],
    }));
    expect(path).toBeTruthy();

    await clickCanvasAtClientPoint(page, path[0].client);
    await clickCanvasAtClientPoint(page, path[1].client);
    await clickCanvasAtClientPoint(page, path[2].client);
    await clickCanvasAtClientPoint(page, path[0].client);
    await page.evaluate(() => window.__TEST_API__.nextFrame(3));

    const graph = await expectFeatureGraphIntegrity(page);
    expect(graph.featureCount).toBe(2);
    expect(graph.features[1].type).toBe("polyline");
    expect(graph.features[1].params.closed).toBe(true);
    expect(graph.features[1].params.points).toHaveLength(3);
  });
});
