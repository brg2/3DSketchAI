import { expect, test } from "./fixtures";
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

async function drawTopFaceSegment(page, points) {
  await page.getByRole("button", { name: "Face" }).click();
  await activateTool(page, "Line Draw");

  const path = await page.evaluate((drawPoints) => window.__TEST_API__.getLineDrawPath({
    objectName: "cube",
    faceIndex: 0,
    points: drawPoints,
  }), points);
  expect(path).toBeTruthy();
  expect(path.length).toBe(2);

  await clickCanvasAtClientPoint(page, path[0].client);
  await page.mouse.move(path[1].client.x, path[1].client.y, { steps: 6 });
  await dblclickCanvasAtClientPoint(page, path[1].client);
  await page.evaluate(() => window.__TEST_API__.nextFrame(5));
  return path;
}

async function pushPullAtWorldPoints(page, startWorld, endWorld) {
  await dragPushPullPreview(page, startWorld, endWorld);
  await page.mouse.up();
  await page.evaluate(() => window.__TEST_API__.nextFrame(8));
}

async function dragPushPullPreview(page, startWorld, endWorld) {
  await page.getByRole("button", { name: "Face" }).click();
  await activateTool(page, "Push/Pull");
  const [start, end] = await page.evaluate(([from, to]) => [
    window.__TEST_API__.getCanvasPointForWorldPoint(from),
    window.__TEST_API__.getCanvasPointForWorldPoint(to),
  ], [startWorld, endWorld]);
  const canvas = page.locator("canvas");
  await canvas.hover({ position: await relativeCanvasPoint(page, start) });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
}

async function relativeCanvasPoint(page, point) {
  const box = await page.locator("canvas").boundingBox();
  expect(box).toBeTruthy();
  return {
    x: point.x - box!.x,
    y: point.y - box!.y,
  };
}

test.describe("line draw sketch splits", () => {
  test.describe.configure({ mode: "parallel" });

  test.beforeEach(async ({ page }) => {
    await loadKnownScene(page);
  });

  test("commits an open line as a first-class sketch_split BREP face split", async ({ page }) => {
    await drawTopFaceSegment(page, [
      { x: -0.48, y: -0.48 },
      { x: 0.48, y: 0.48 },
    ]);

    const graph = await expectFeatureGraphIntegrity(page);
    expect(graph.featureCount).toBe(2);
    expect(graph.features.map((feature) => feature.type)).toEqual(["create_primitive", "sketch_split"]);
    expect(graph.features[1].target.objectId).toBe("cube");
    expect(graph.features[1].dependsOn).toEqual(["feature_1"]);
    expect(graph.features[1].params.sketchId).toBe("sketch_1");
    expect(graph.features[1].params.segments).toHaveLength(1);
    expect(graph.features[1].params.targetSelector).toMatchObject({
      featureId: "feature_1",
      role: "face.py",
    });

    const scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    expect(Object.keys(scene.objects)).toEqual(["cube"]);
    const cubeMesh = scene.meshes.find((mesh) => mesh.objectId === "cube");
    expect(cubeMesh.vertexCount).toBeGreaterThan(24);
    const splitRegions = new Set(cubeMesh.provenance
      .filter((entry) => entry.featureId === "feature_2" && entry.role?.startsWith("split.sketch_1.region."))
      .map((entry) => entry.role));
    expect(splitRegions.size).toBe(2);
    expect(cubeMesh.faceGroups.filter((group) => group.provenance?.featureId === "feature_2")).toHaveLength(2);
    expect(cubeMesh.renderEdges).toHaveLength(1);

    await page.getByRole("button", { name: "Face" }).click();
    const splitFacePoint = await page.evaluate(() => window.__TEST_API__.getCanvasPointForWorldPoint({
      x: -0.16,
      y: 0.5,
      z: -0.16,
    }));
    await page.mouse.move(splitFacePoint.x, splitFacePoint.y, { steps: 4 });
    await page.evaluate(() => window.__TEST_API__.nextFrame(3));
    const preselection = await page.evaluate(() => window.__TEST_API__.getPreselectionState());
    expect(preselection.faceVisible).toBe(true);
    expect(preselection.faceVertexCount).toBe(3);
    await page.mouse.move(10, 10);
    await page.evaluate(() => window.__TEST_API__.nextFrame(3));

    await expectCanvasSnapshot(page, "line-draw-sketch-split-diagonal.png");
  });

  test("drawing a second diagonal on a split top face re-enters the originating sketch", async ({ page }) => {
    await drawTopFaceSegment(page, [
      { x: -0.48, y: -0.48 },
      { x: 0.48, y: 0.48 },
    ]);

    let graph = await expectFeatureGraphIntegrity(page);
    expect(graph.featureCount).toBe(2);
    expect(graph.features[1].params.segments).toHaveLength(1);

    await drawTopFaceSegment(page, [
      { x: -0.48, y: 0.48 },
      { x: 0.48, y: -0.48 },
    ]);

    graph = await expectFeatureGraphIntegrity(page);
    expect(graph.featureCount).toBe(2);
    expect(graph.features.map((feature) => feature.type)).toEqual(["create_primitive", "sketch_split"]);
    expect(graph.features[1].id).toBe("feature_2");
    expect(graph.features[1].params.sketchId).toBe("sketch_1");
    expect(graph.features[1].params.segments).toHaveLength(2);

    const scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    expect(Object.keys(scene.objects)).toEqual(["cube"]);
    const cubeMesh = scene.meshes.find((mesh) => mesh.objectId === "cube");
    expect(cubeMesh.triangleCount).toBeGreaterThanOrEqual(14);
    const splitRegions = new Set(cubeMesh.provenance
      .filter((entry) => entry.featureId === "feature_2" && entry.role?.startsWith("split.sketch_1.region."))
      .map((entry) => entry.role));
    expect(splitRegions.size).toBeGreaterThanOrEqual(4);
    expect(cubeMesh.renderEdges).toHaveLength(2);
    await expectCanvasSnapshot(page, "line-draw-sketch-split-x.png");
  });

  test("push-pulling one split top sub-face commits a profile push_pull for only that region", async ({ page }) => {
    await drawTopFaceSegment(page, [
      { x: -0.48, y: -0.48 },
      { x: 0.48, y: 0.48 },
    ]);

    await pushPullAtWorldPoints(
      page,
      { x: -0.16, y: 0.5, z: -0.16 },
      { x: -0.16, y: 0.8, z: -0.16 },
    );

    const graph = await expectFeatureGraphIntegrity(page);
    expect(graph.features.map((feature) => feature.type)).toEqual(["create_primitive", "sketch_split", "push_pull"]);
    expect(graph.features[0].params.size).toEqual({ x: 1, y: 1, z: 1 });
    expect(graph.features[2].target.selection.selector).toMatchObject({
      featureId: "feature_2",
      role: "split.sketch_1.region.n.face.py",
      sketchId: "sketch_1",
    });
    expect(graph.features[2].params.profile).toMatchObject({
      featureId: "feature_2",
      targetId: "cube",
      closed: true,
    });
    expect(graph.features[2].params.profile.points).toHaveLength(3);

    const vertices = await page.evaluate(() => window.__TEST_API__.getMeshVertices("cube"));
    const topKeys = new Set(vertices
      .filter((point) => Math.abs(point.y - 0.8) < 0.01)
      .map((point) => `${point.x.toFixed(3)}:${point.z.toFixed(3)}`));
    expect(topKeys.size).toBe(3);

    const scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    const cubeMesh = scene.meshes.find((mesh) => mesh.objectId === "cube");
    expect(cubeMesh.renderEdges.filter((edge) => edge.points.every((point) => Math.abs(point.y - 0.5) < 0.01))).toHaveLength(0);
  });

  test("push-pull drag preview replays the feature graph through BREP for split sub-faces", async ({ page }) => {
    await drawTopFaceSegment(page, [
      { x: -0.48, y: -0.48 },
      { x: 0.48, y: 0.48 },
    ]);

    await dragPushPullPreview(
      page,
      { x: -0.16, y: 0.5, z: -0.16 },
      { x: -0.16, y: 0.75, z: -0.16 },
    );

    await expect.poll(async () => {
      const vertices = await page.evaluate(() => window.__TEST_API__.getMeshVertices("cube"));
      return new Set(vertices
        .filter((point) => Math.abs(point.y - 0.75) < 0.015)
        .map((point) => `${point.x.toFixed(3)}:${point.z.toFixed(3)}`)).size;
    }).toBe(3);

    const scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    expect(scene.hasActiveSession).toBe(true);
    expect(scene.featureGraph).toHaveLength(2);
    expect(scene.previewFeatureGraphUpdate).toMatchObject({
      created: true,
      reason: "fallback_new_feature",
    });

    await page.mouse.up();
    await page.evaluate(() => window.__TEST_API__.nextFrame(8));
  });
});
