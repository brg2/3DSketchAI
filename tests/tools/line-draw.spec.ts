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

function averageWorld(points) {
  return points.reduce(
    (sum, entry) => ({
      x: sum.x + entry.world.x / points.length,
      y: sum.y + entry.world.y / points.length,
      z: sum.z + entry.world.z / points.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
}

async function dragCanvasBetweenClientPoints(page, start, end) {
  await startCanvasDragBetweenClientPoints(page, start, end);
  await page.mouse.up();
}

async function startCanvasDragBetweenClientPoints(page, start, end) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
}

async function drawSplitRectangleOnTopFace(page) {
  await page.getByRole("button", { name: "Face" }).click();
  await activateTool(page, "Line Draw");

  const path = await page.evaluate(() => window.__TEST_API__.getPolylineDrawPath({
    objectName: "cube",
    faceIndex: 0,
    points: [
      { x: -0.22, y: -0.2 },
      { x: 0.22, y: -0.2 },
      { x: 0.22, y: 0.22 },
      { x: -0.22, y: 0.22 },
    ],
  }));
  expect(path).toBeTruthy();

  for (const point of path) {
    await clickCanvasAtClientPoint(page, point.client);
  }
  await clickCanvasAtClientPoint(page, path[0].client);
  await page.evaluate(() => window.__TEST_API__.nextFrame(3));
  return path;
}

test.describe("line draw tool", () => {
  test.beforeEach(async ({ page }) => {
    await loadKnownScene(page);
  });

  test("commits a closed line draw as a selectable face split", async ({ page }) => {
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
    await clickCanvasAtClientPoint(page, path[2].client);
    await clickCanvasAtClientPoint(page, path[0].client);
    await page.evaluate(() => window.__TEST_API__.nextFrame(3));

    const graph = await expectFeatureGraphIntegrity(page);
    expect(graph.featureCount).toBe(2);
    expect(graph.features[1].type).toBe("polyline");
    expect(graph.features[1].target.objectId).toBe("cube");
    expect(graph.features[1].dependsOn).toEqual(["feature_1"]);
    expect(graph.features[1].params.objectId).toBe("polyline_1");
    expect(graph.features[1].params.closed).toBe(true);
    expect(graph.features[1].params.points).toHaveLength(3);
    expect(graph.features[1].params.plane.normal).toMatchObject({ x: 0, y: 1, z: 0 });

    scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    expect(scene.objects.polyline_1.primitive).toBe("polyline");
    expect(scene.meshes.some((mesh) => mesh.objectId === "cube" && mesh.vertexCount === 3)).toBe(true);
    await expectCanvasSnapshot(page, "line-draw-face-split.png");
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

  test("push/pull extrudes a split face region independently", async ({ page }) => {
    const path = await drawSplitRectangleOnTopFace(page);
    const splitCenter = averageWorld(path);
    const beforePush = await page.evaluate(() => window.__TEST_API__.getSceneState());
    const beforeCube = beforePush.meshes.find((mesh) => mesh.objectId === "cube" && mesh.vertexCount > 3);
    const start = await page.evaluate((point) => window.__TEST_API__.getCanvasPointForWorldPoint(point), splitCenter);
    const end = await page.evaluate(
      (point) => window.__TEST_API__.getCanvasPointForWorldPoint({ x: point.x, y: point.y + 0.34, z: point.z }),
      splitCenter,
    );
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();

    await activateTool(page, "Push/Pull");
    await dragCanvasBetweenClientPoints(page, start, end);
    await page.evaluate(() => window.__TEST_API__.nextFrame(5));

    const graph = await expectFeatureGraphIntegrity(page);
    expect(graph.featureCount).toBe(3);
    expect(graph.features[2].type).toBe("push_pull");
    expect(graph.features[2].target.objectId).toBe("cube");
    expect(graph.features[2].dependsOn).toEqual(["feature_2"]);
    expect(graph.features[2].params.profile.objectId).toBe("polyline_1");
    expect(graph.features[2].target.selection.profile.objectId).toBe("polyline_1");

    const scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    const cubeMesh = scene.meshes.find((mesh) => mesh.objectId === "cube" && mesh.vertexCount > 3);
    expect(cubeMesh.worldBounds.max.y).toBeGreaterThan(beforeCube.worldBounds.max.y + 0.2);
    await expectCanvasSnapshot(page, "line-draw-split-pushpull.png");
  });

  test("split face pull preview moves the selected region instead of drawing a prism tool", async ({ page }) => {
    const path = await drawSplitRectangleOnTopFace(page);
    const splitCenter = averageWorld(path);
    const start = await page.evaluate((point) => window.__TEST_API__.getCanvasPointForWorldPoint(point), splitCenter);
    const end = await page.evaluate(
      (point) => window.__TEST_API__.getCanvasPointForWorldPoint({ x: point.x, y: point.y - 0.26, z: point.z }),
      splitCenter,
    );
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();

    await activateTool(page, "Push/Pull");
    await startCanvasDragBetweenClientPoints(page, start, end);
    await page.evaluate(() => window.__TEST_API__.nextFrame(5));
    await expectCanvasSnapshot(page, "line-draw-split-pull-preview.png");

    await page.mouse.up();
    await page.evaluate(() => window.__TEST_API__.nextFrame(5));
    const graph = await expectFeatureGraphIntegrity(page);
    expect(graph.features[2].type).toBe("push_pull");
    expect(graph.features[2].params.profile.objectId).toBe("polyline_1");
    expect(graph.features[2].params.distance).toBeLessThan(0);
  });
});
