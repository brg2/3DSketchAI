import { expect, test } from "@playwright/test";
import { expectBoundsExpanded, expectCanvasSnapshot, expectClose, expectGeometryChanged } from "../utils/assertions";
import { getDragPath, performDrag, waitForRenderCompletion } from "../utils/interaction";
import { activateTool, loadKnownScene, selectFace, selectObject } from "../utils/selection";

test.beforeEach(async ({ page }) => {
  await loadKnownScene(page);
});

test("push/pull + face extrudes the cube top face upward", async ({ page }) => {
  const before = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));

  await selectFace(page, "cube", 0);
  await activateTool(page, "Push/Pull");
  const drag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: 0,
    worldDelta: { x: 0, y: 0.6, z: 0 },
  });
  expect(drag).toBeTruthy();
  await performDrag(page, drag!);
  await waitForRenderCompletion(page);

  const after = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
  expectGeometryChanged(before, after);
  expectBoundsExpanded(before.mesh.worldBounds, after.mesh.worldBounds, "y", 0.5);
  expect(after.mesh.vertexCount).toBeGreaterThanOrEqual(before.mesh.vertexCount);

  await expectCanvasSnapshot(page, "pushpull-face-top-cube.png");
});

test("push/pull + object uses the picked face and changes only geometry", async ({ page }) => {
  const before = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));

  await selectObject(page, "cube");
  await activateTool(page, "Push/Pull");
  const drag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: 0,
    worldDelta: { x: 0, y: 0.6, z: 0 },
  });
  expect(drag).toBeTruthy();
  await performDrag(page, drag!);
  await waitForRenderCompletion(page);

  const after = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
  expectGeometryChanged(before, after);
  expectBoundsExpanded(before.mesh.worldBounds, after.mesh.worldBounds, "y", 0.5);
  expectClose(after.position.x, before.position.x);
  expectClose(after.position.y, before.position.y + 0.3);
  expectClose(after.position.z, before.position.z);

  await expectCanvasSnapshot(page, "pushpull-object-picked-face-cube.png");
});
