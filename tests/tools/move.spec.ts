import { expect, test } from "@playwright/test";
import { expectBoundsClose, expectBoundsExpanded, expectCanvasSnapshot, expectClose, expectGeometryChanged, expectVectorClose } from "../utils/assertions";
import { getDragPath, performDrag, waitForRenderCompletion } from "../utils/interaction";
import { activateTool, loadKnownScene, selectFace, selectObject } from "../utils/selection";

test.beforeEach(async ({ page }) => {
  await loadKnownScene(page);
});

test("move + object drags the cube along X only", async ({ page }) => {
  const before = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));

  await selectObject(page, "cube");
  await activateTool(page, "Move");
  const drag = await getDragPath(page, {
    objectName: "cube",
    worldDelta: { x: 1, y: 0, z: 0 },
  });
  expect(drag).toBeTruthy();
  await performDrag(page, drag!);
  await waitForRenderCompletion(page);

  const after = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
  expectVectorClose(after.position, { x: 1, y: 0, z: 0 });
  expectClose(after.position.y, before.position.y);
  expectClose(after.position.z, before.position.z);
  expect(after.mesh.vertexCount).toBe(before.mesh.vertexCount);
  expect(after.mesh.triangleCount).toBe(before.mesh.triangleCount);
  expectBoundsClose(after.mesh.worldBounds, {
    min: { x: 0.5, y: -0.5, z: -0.5 },
    max: { x: 1.5, y: 0.5, z: 0.5 },
  });

  await expectCanvasSnapshot(page, "move-object-cube.png");
});

test("shift + move + object drags the cube on the alternate Y axis", async ({ page }) => {
  const before = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));

  await selectObject(page, "cube");
  await activateTool(page, "Move");
  const drag = await getDragPath(page, {
    objectName: "cube",
    screenDelta: { x: 0, y: -50 },
  });
  expect(drag).toBeTruthy();
  await performDrag(page, { ...drag!, modifiers: ["Shift"] });
  await waitForRenderCompletion(page);

  const scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
  const after = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
  const cubeFeature = scene.featureGraph.find((feature) => feature.type === "create_primitive" && feature.params?.objectId === "cube");

  expectVectorClose(after.position, { x: 0, y: 1, z: 0 });
  expectClose(after.position.x, before.position.x);
  expectClose(after.position.z, before.position.z);
  expectVectorClose(cubeFeature.params.position, { x: 0, y: 1, z: 0 });
  expectBoundsClose(after.mesh.worldBounds, {
    min: { x: -0.5, y: 0.5, z: -0.5 },
    max: { x: 0.5, y: 1.5, z: 0.5 },
  });

  await expectCanvasSnapshot(page, "shift-move-object-cube-y-axis.png");
});

test("move + face moves the top face outward", async ({ page }) => {
  const before = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));

  await selectFace(page, "cube", 1);
  await activateTool(page, "Move");
  const drag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: 1,
    worldDelta: { x: 0.5, y: 0, z: 0 },
  });
  expect(drag).toBeTruthy();
  await performDrag(page, drag!);
  await waitForRenderCompletion(page);

  const after = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
  expectGeometryChanged(before, after);
  expectBoundsExpanded(before.mesh.worldBounds, after.mesh.worldBounds, "x", 0.5);
  expectClose(after.mesh.worldBounds.min.x, before.mesh.worldBounds.min.x);
  expectClose(after.position.y, before.position.y);
  expectClose(after.position.z, before.position.z);

  await expectCanvasSnapshot(page, "move-face-right-cube.png");
});

test("shift + move + face moves the selected face on the alternate Y axis", async ({ page }) => {
  const before = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));

  await selectFace(page, "cube", 0);
  await activateTool(page, "Move");
  const drag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: 0,
    screenDelta: { x: 0, y: -50 },
  });
  expect(drag).toBeTruthy();
  await performDrag(page, { ...drag!, modifiers: ["Shift"] });
  await waitForRenderCompletion(page);

  const scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
  const after = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
  const moveFeature = scene.featureGraph.find((feature) => feature.type === "move");

  expectGeometryChanged(before, after);
  expectBoundsExpanded(before.mesh.worldBounds, after.mesh.worldBounds, "y", 0.9);
  expectClose(after.mesh.worldBounds.min.y, before.mesh.worldBounds.min.y);
  expectClose(moveFeature.params.delta.x, 0);
  expectClose(moveFeature.params.delta.y, 1);
  expectClose(moveFeature.params.delta.z, 0);
  expect(moveFeature.params.subshapeMove).toMatchObject({
    mode: "face",
    faceAxis: "y",
    faceSign: 1,
  });

  await expectCanvasSnapshot(page, "shift-move-face-top-cube-y-axis.png");
});
