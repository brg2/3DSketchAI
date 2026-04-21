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

function offsetWorld(point, axis, distance) {
  return {
    x: point.x + (axis?.x ?? 0) * distance,
    y: point.y + (axis?.y ?? 0) * distance,
    z: point.z + (axis?.z ?? 0) * distance,
  };
}

function expectNoLargePreviewSheets(scene, limit = 1.25) {
  for (const mesh of scene.meshes) {
    const bounds = mesh.worldBounds;
    expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(limit);
    expect(bounds.max.y - bounds.min.y).toBeLessThanOrEqual(limit);
    expect(bounds.max.z - bounds.min.z).toBeLessThanOrEqual(limit);
  }
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

async function drawSplitTriangleOnRightFace(page) {
  await page.getByRole("button", { name: "Face" }).click();
  await activateTool(page, "Line Draw");

  const path = await page.evaluate(() => window.__TEST_API__.getPolylineDrawPath({
    objectName: "cube",
    faceIndex: 1,
    points: [
      { x: -0.18, y: 0.22 },
      { x: 0.12, y: 0.22 },
      { x: -0.02, y: -0.08 },
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

async function drawBoundarySplitTriangleOnRightFace(page) {
  await page.getByRole("button", { name: "Face" }).click();
  await activateTool(page, "Line Draw");

  const path = await page.evaluate(() => window.__TEST_API__.getPolylineDrawPath({
    objectName: "cube",
    faceIndex: 1,
    points: [
      { x: -0.16, y: 0.5 },
      { x: 0.16, y: 0.5 },
      { x: 0, y: 0.14 },
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

  test("previews the first snap point before placing the start point", async ({ page }) => {
    await page.getByRole("button", { name: "Face" }).click();
    await activateTool(page, "Line Draw");

    const face = await page.evaluate(() => window.__TEST_API__.getFaceData("cube")[0]);
    expect(face).toBeTruthy();
    await page.mouse.move(face.click.x, face.click.y);
    await page.evaluate(() => window.__TEST_API__.nextFrame(5));

    let overlay = await page.evaluate(() => window.__TEST_API__.getLineDrawOverlayState());
    expect(overlay.active).toBe(false);
    expect(overlay.snapVisible).toBe(true);
    expect(overlay.snapPoint.x).toBeCloseTo(face.center.x, 5);
    expect(overlay.snapPoint.y).toBeCloseTo(face.center.y, 5);
    expect(overlay.snapPoint.z).toBeCloseTo(face.center.z, 5);
    await expectCanvasSnapshot(page, "line-draw-start-unsnapped-preview.png");

    const vertex = await page.evaluate(() => window.__TEST_API__.getVertexData("cube")[0]);
    expect(vertex).toBeTruthy();
    await page.mouse.move(vertex.click.x, vertex.click.y);
    await page.evaluate(() => window.__TEST_API__.nextFrame(5));

    overlay = await page.evaluate(() => window.__TEST_API__.getLineDrawOverlayState());
    expect(overlay.active).toBe(false);
    expect(overlay.snapVisible).toBe(true);
    expect(overlay.snapPoint.x).toBeCloseTo(vertex.world.x, 5);
    expect(overlay.snapPoint.y).toBeCloseTo(vertex.world.y, 5);
    expect(overlay.snapPoint.z).toBeCloseTo(vertex.world.z, 5);
    await expectCanvasSnapshot(page, "line-draw-start-snap-preview.png");

    await clickCanvasAtClientPoint(page, vertex.click);
    overlay = await page.evaluate(() => window.__TEST_API__.getLineDrawOverlayState());
    expect(overlay.active).toBe(true);
    expect(overlay.points[0].x).toBeCloseTo(vertex.world.x, 5);
    expect(overlay.points[0].y).toBeCloseTo(vertex.world.y, 5);
    expect(overlay.points[0].z).toBeCloseTo(vertex.world.z, 5);
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
    expectNoLargePreviewSheets(await page.evaluate(() => window.__TEST_API__.getSceneState()));
    await expectCanvasSnapshot(page, "line-draw-split-pull-preview.png");

    await page.mouse.up();
    await page.evaluate(() => window.__TEST_API__.nextFrame(5));
    const graph = await expectFeatureGraphIntegrity(page);
    expect(graph.features[2].type).toBe("push_pull");
    expect(graph.features[2].params.profile.objectId).toBe("polyline_1");
    expect(graph.features[2].params.distance).toBeLessThan(0);
  });

  test("side-face split pull preview hides the source shell", async ({ page }) => {
    const path = await drawSplitTriangleOnRightFace(page);
    const splitCenter = averageWorld(path);
    const start = await page.evaluate((point) => window.__TEST_API__.getCanvasPointForWorldPoint(point), splitCenter);
    const end = await page.evaluate(
      (point) => window.__TEST_API__.getCanvasPointForWorldPoint({ x: point.x - 0.2, y: point.y, z: point.z }),
      splitCenter,
    );
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();

    await activateTool(page, "Push/Pull");
    await startCanvasDragBetweenClientPoints(page, start, end);
    await page.evaluate(() => window.__TEST_API__.nextFrame(5));
    expectNoLargePreviewSheets(await page.evaluate(() => window.__TEST_API__.getSceneState()));
    await expectCanvasSnapshot(page, "line-draw-side-split-pull-preview.png");

    await page.mouse.up();
    await page.evaluate(() => window.__TEST_API__.nextFrame(5));
    const graph = await expectFeatureGraphIntegrity(page);
    expect(graph.features[2].type).toBe("push_pull");
    expect(graph.features[2].params.profile.objectId).toBe("polyline_1");
    expect(graph.features[2].params.distance).toBeLessThan(0);
  });

  test("boundary-touching side-face split pull preview does not leave z-fighting on adjacent face", async ({ page }) => {
    const path = await drawBoundarySplitTriangleOnRightFace(page);
    const splitCenter = averageWorld(path);
    const start = await page.evaluate((point) => window.__TEST_API__.getCanvasPointForWorldPoint(point), splitCenter);
    const end = { x: start.x, y: start.y + 40 };
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();

    await activateTool(page, "Push/Pull");
    await startCanvasDragBetweenClientPoints(page, start, end);
    await page.evaluate(() => window.__TEST_API__.nextFrame(5));
    expectNoLargePreviewSheets(await page.evaluate(() => window.__TEST_API__.getSceneState()));
    await expectCanvasSnapshot(page, "line-draw-boundary-side-split-pull-preview.png");

    await page.mouse.up();
    await page.evaluate(() => window.__TEST_API__.nextFrame(5));
    const graph = await expectFeatureGraphIntegrity(page);
    expect(graph.features[2].type).toBe("push_pull");
    expect(graph.features[2].params.profile.objectId).toBe("polyline_1");
    expect(graph.features[2].params.distance).toBeLessThan(0);
  });

  test("split face pull commits a clean pocket", async ({ page }) => {
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
    await dragCanvasBetweenClientPoints(page, start, end);
    await page.evaluate(() => window.__TEST_API__.nextFrame(5));

    const graph = await expectFeatureGraphIntegrity(page);
    expect(graph.features[2].type).toBe("push_pull");
    expect(graph.features[2].params.profile.objectId).toBe("polyline_1");
    expect(graph.features[2].params.distance).toBeLessThan(0);

    const scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    const cubeMesh = scene.meshes.find((mesh) => mesh.objectId === "cube" && mesh.vertexCount > 3);
    const splitMesh = scene.meshes.find((mesh) => mesh.objectId === "cube" && mesh.vertexCount === 4);
    expect(cubeMesh.worldBounds.max.y).toBeCloseTo(0.5, 3);
    expect(splitMesh.worldBounds.max.y).toBeLessThan(0.5);
    await expectCanvasSnapshot(page, "line-draw-split-pull-commit.png");
  });

  test("side-face split pull commits visible cut geometry", async ({ page }) => {
    const path = await drawSplitTriangleOnRightFace(page);
    const splitCenter = averageWorld(path);
    const start = await page.evaluate((point) => window.__TEST_API__.getCanvasPointForWorldPoint(point), splitCenter);
    const end = await page.evaluate(
      (point) => window.__TEST_API__.getCanvasPointForWorldPoint({ x: point.x - 0.2, y: point.y, z: point.z }),
      splitCenter,
    );
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();

    await activateTool(page, "Push/Pull");
    await dragCanvasBetweenClientPoints(page, start, end);
    await page.evaluate(() => window.__TEST_API__.nextFrame(5));

    const graph = await expectFeatureGraphIntegrity(page);
    expect(graph.features[2].type).toBe("push_pull");
    expect(graph.features[2].params.profile.objectId).toBe("polyline_1");
    expect(graph.features[2].params.distance).toBeLessThan(0);

    const scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    const cubeMesh = scene.meshes.find((mesh) => mesh.objectId === "cube" && mesh.vertexCount > 3);
    const splitMesh = scene.meshes.find((mesh) => mesh.objectId === "cube" && mesh.vertexCount === 3);
    expect(cubeMesh.vertexCount).toBeGreaterThan(24);
    expect(splitMesh.worldBounds.max.x).toBeLessThan(0.5);
    await expectCanvasSnapshot(page, "line-draw-side-split-pull-commit.png");
  });

  test("through side-face split pull does not leave the cutter cap face", async ({ page }) => {
    const path = await drawSplitTriangleOnRightFace(page);
    const splitCenter = averageWorld(path);
    const start = await page.evaluate((point) => window.__TEST_API__.getCanvasPointForWorldPoint(point), splitCenter);
    const end = await page.evaluate(
      (point) => window.__TEST_API__.getCanvasPointForWorldPoint({ x: point.x - 1.2, y: point.y, z: point.z }),
      splitCenter,
    );
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();

    await activateTool(page, "Push/Pull");
    await startCanvasDragBetweenClientPoints(page, start, end);
    await page.evaluate(() => window.__TEST_API__.nextFrame(5));
    const previewScene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    expect(previewScene.meshes.some((mesh) => mesh.geometrySignature?.includes?.("\"primitive\":\"polyline\""))).toBe(false);

    await page.mouse.up();
    await page.evaluate(() => window.__TEST_API__.nextFrame(5));

    const graph = await expectFeatureGraphIntegrity(page);
    expect(graph.features[2].type).toBe("push_pull");
    expect(graph.features[2].params.profile.objectId).toBe("polyline_1");
    expect(graph.features[2].params.distance).toBeLessThan(-1);

    const scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    expect(scene.objects.polyline_1).toBeUndefined();
    expect(scene.meshes.some((mesh) => mesh.geometrySignature?.includes?.("\"primitive\":\"polyline\""))).toBe(false);
    await expectCanvasSnapshot(page, "line-draw-side-split-through-pull-commit.png");
  });

  test("reverse-extruding a committed profile pull replays from the original split face", async ({ page }) => {
    const path = await drawSplitRectangleOnTopFace(page);
    const splitCenter = averageWorld(path);
    const firstStart = await page.evaluate((point) => window.__TEST_API__.getCanvasPointForWorldPoint(point), splitCenter);
    const firstEnd = await page.evaluate(
      (point) => window.__TEST_API__.getCanvasPointForWorldPoint({ x: point.x, y: point.y - 0.26, z: point.z }),
      splitCenter,
    );
    expect(firstStart).toBeTruthy();
    expect(firstEnd).toBeTruthy();

    await activateTool(page, "Push/Pull");
    await dragCanvasBetweenClientPoints(page, firstStart, firstEnd);
    await page.evaluate(() => window.__TEST_API__.nextFrame(5));

    const afterFirst = await page.evaluate(() => window.__TEST_API__.getFeatureGraph());
    expect(afterFirst.features[2].type).toBe("push_pull");
    expect(afterFirst.features[2].params.distance).toBeLessThan(0);

    const axis = afterFirst.features[2].params.axis;
    const movedProfilePoints = afterFirst.features[2].params.profile.points.map((point) => (
      offsetWorld(point, axis, afterFirst.features[2].params.distance)
    ));
    const movedCenter = averageWorld(movedProfilePoints.map((world) => ({ world })));
    const secondStart = await page.evaluate((point) => window.__TEST_API__.getCanvasPointForWorldPoint(point), movedCenter);
    const secondEnd = await page.evaluate(
      ({ point, axis }) => window.__TEST_API__.getCanvasPointForWorldPoint({
        x: point.x + (axis?.x ?? 0) * 0.62,
        y: point.y + (axis?.y ?? 0) * 0.62,
        z: point.z + (axis?.z ?? 0) * 0.62,
      }),
      { point: movedCenter, axis },
    );
    expect(secondStart).toBeTruthy();
    expect(secondEnd).toBeTruthy();

    await activateTool(page, "Push/Pull");
    await dragCanvasBetweenClientPoints(page, secondStart, secondEnd);
    await page.evaluate(() => window.__TEST_API__.nextFrame(5));

    const graph = await expectFeatureGraphIntegrity(page);
    expect(graph.featureCount).toBe(3);
    expect(graph.features[2].type).toBe("push_pull");
    expect(graph.features[2].params.distance).toBeGreaterThan(0.2);
    expect(graph.features[2].params.profile.points[0].y).toBeCloseTo(0.5, 3);

    const scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    const cubeMesh = scene.meshes.find((mesh) => mesh.objectId === "cube" && mesh.vertexCount > 3);
    expect(cubeMesh.worldBounds.max.y).toBeGreaterThan(0.6);
    expect(cubeMesh.worldBounds.max.y).toBeLessThan(1.1);
    expect(cubeMesh.worldBounds.min.x).toBeCloseTo(-0.5, 3);
    expect(cubeMesh.worldBounds.max.x).toBeCloseTo(0.5, 3);
    expect(cubeMesh.worldBounds.min.z).toBeCloseTo(-0.5, 3);
    expect(cubeMesh.worldBounds.max.z).toBeCloseTo(0.5, 3);
    await expectCanvasSnapshot(page, "line-draw-reverse-profile-pushpull-commit.png");
  });
});
