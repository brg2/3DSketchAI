import { expect, test } from "@playwright/test";
import { expectBoundsClose, expectBoundsExpanded, expectCanvasSnapshot, expectClose, expectGeometryChanged, expectPngImagesClose } from "../utils/assertions";
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

test("push/pull + face preview matches the committed primitive feature result", async ({ page }) => {
  await selectFace(page, "cube", 0);
  await activateTool(page, "Push/Pull");
  const drag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: 0,
    worldDelta: { x: 0, y: 0.6, z: 0 },
  });
  expect(drag).toBeTruthy();

  await page.mouse.move(drag!.start.x, drag!.start.y);
  await page.mouse.down();
  let previewImage: Buffer | null = null;
  try {
    await page.mouse.move(drag!.end.x, drag!.end.y, { steps: 10 });
    await waitForRenderCompletion(page);
    previewImage = await page.locator("canvas").screenshot();

    const previewScene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    const preview = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
    expect(previewScene.tool.dragging).toBe(true);
    expect(previewScene.previewFeatureGraphUpdate).toMatchObject({
      modified: true,
      reason: "modified_originating_primitive",
      featureId: "feature_1",
    });
    expect(previewScene.featureGraph).toHaveLength(1);
    expect(preview.mesh.vertexCount).toBe(24);
    expect(preview.mesh.triangleCount).toBe(12);
    expectBoundsClose(preview.mesh.worldBounds, {
      min: { x: -0.5, y: -0.5, z: -0.5 },
      max: { x: 0.5, y: 1.1, z: 0.5 },
    });
  } finally {
    await page.mouse.up();
  }
  await waitForRenderCompletion(page);
  const canvasBox = await page.locator("canvas").boundingBox();
  expect(canvasBox).toBeTruthy();
  await page.mouse.move(canvasBox!.x + 10, canvasBox!.y + 10);
  await waitForRenderCompletion(page);
  const committedImage = await page.locator("canvas").screenshot();
  expect(previewImage).toBeTruthy();

  const committedScene = await page.evaluate(() => window.__TEST_API__.getSceneState());
  const committed = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
  expect(committedScene.tool.dragging).toBe(false);
  expect(committedScene.featureGraph).toHaveLength(1);
  expect(committedScene.featureGraph[0]).toMatchObject({
    type: "create_primitive",
    params: {
      objectId: "cube",
      position: { x: 0, y: 0.3, z: 0 },
      size: { x: 1, y: 1.6, z: 1 },
    },
  });
  expect(committed.mesh.vertexCount).toBe(24);
  expect(committed.mesh.triangleCount).toBe(12);
  expectBoundsClose(committed.mesh.worldBounds, {
    min: { x: -0.5, y: -0.5, z: -0.5 },
    max: { x: 0.5, y: 1.1, z: 0.5 },
  });
  expectPngImagesClose(committedImage, previewImage!);
});

test("push/pull + adjacent faces fold into the primitive and preview matches commit", async ({ page }) => {
  await selectFace(page, "cube", 0);
  await activateTool(page, "Push/Pull");
  const topDrag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: 0,
    worldDelta: { x: 0, y: 0.6, z: 0 },
  });
  expect(topDrag).toBeTruthy();
  await performDrag(page, topDrag!);
  await waitForRenderCompletion(page);

  await selectFace(page, "cube", 1);
  await activateTool(page, "Push/Pull");
  const rightDrag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: 1,
    worldDelta: { x: 0.4, y: 0, z: 0 },
  });
  expect(rightDrag).toBeTruthy();

  await page.mouse.move(rightDrag!.start.x, rightDrag!.start.y);
  await page.mouse.down();
  let previewImage: Buffer | null = null;
  try {
    await page.mouse.move(rightDrag!.end.x, rightDrag!.end.y, { steps: 10 });
    await waitForRenderCompletion(page);
    previewImage = await page.locator("canvas").screenshot();

    const previewScene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    const preview = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
    expect(previewScene.tool.dragging).toBe(true);
    expect(previewScene.previewFeatureGraphUpdate).toMatchObject({
      modified: true,
      reason: "modified_originating_primitive",
      featureId: "feature_1",
    });
    expect(previewScene.featureGraph).toHaveLength(1);
    expect(preview.mesh.vertexCount).toBe(24);
    expect(preview.mesh.triangleCount).toBe(12);
    expectBoundsClose(preview.mesh.worldBounds, {
      min: { x: -0.5, y: -0.5, z: -0.5 },
      max: { x: 0.9, y: 1.1, z: 0.5 },
    });
  } finally {
    await page.mouse.up();
  }
  await waitForRenderCompletion(page);
  const canvasBox = await page.locator("canvas").boundingBox();
  expect(canvasBox).toBeTruthy();
  await page.mouse.move(canvasBox!.x + 10, canvasBox!.y + 10);
  await waitForRenderCompletion(page);
  const committedImage = await page.locator("canvas").screenshot();
  expect(previewImage).toBeTruthy();

  const committedScene = await page.evaluate(() => window.__TEST_API__.getSceneState());
  const committed = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
  expect(committedScene.featureGraph).toHaveLength(1);
  expect(committedScene.featureGraph[0]).toMatchObject({
    type: "create_primitive",
    params: {
      objectId: "cube",
      position: { x: 0.2, y: 0.3, z: 0 },
      size: { x: 1.4, y: 1.6, z: 1 },
    },
  });
  expect(committed.mesh.vertexCount).toBe(24);
  expect(committed.mesh.triangleCount).toBe(12);
  expectBoundsClose(committed.mesh.worldBounds, {
    min: { x: -0.5, y: -0.5, z: -0.5 },
    max: { x: 0.9, y: 1.1, z: 0.5 },
  });
  expectPngImagesClose(committedImage, previewImage!);
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
