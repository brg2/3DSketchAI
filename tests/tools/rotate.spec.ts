import { expect, test } from "@playwright/test";
import { expectCanvasSnapshot, expectClose, expectGeometryChanged } from "../utils/assertions";
import { getDragPath, performDrag, waitForRenderCompletion } from "../utils/interaction";
import { activateTool, loadKnownScene, selectFace, selectObject } from "../utils/selection";

test.beforeEach(async ({ page }) => {
  await loadKnownScene(page);
});

test("rotate + object rotates the cube around Y without moving it", async ({ page }) => {
  const before = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));

  await selectObject(page, "cube");
  await activateTool(page, "Rotate");
  const drag = await getDragPath(page, {
    objectName: "cube",
    screenDelta: { x: 80, y: 0 },
  });
  expect(drag).toBeTruthy();
  await performDrag(page, drag!);
  await waitForRenderCompletion(page);

  const after = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
  expectClose(after.state.rotation.y, 0.8);
  expectClose(after.position.x, before.position.x);
  expectClose(after.position.y, before.position.y);
  expectClose(after.position.z, before.position.z);
  expect(after.mesh.vertexCount).toBe(before.mesh.vertexCount);
  expect(after.mesh.triangleCount).toBe(before.mesh.triangleCount);

  await expectCanvasSnapshot(page, "rotate-object-cube.png");
});

test("shift + rotate + object rotates the cube around the alternate X axis", async ({ page }) => {
  const before = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));

  await selectObject(page, "cube");
  await activateTool(page, "Rotate");
  const drag = await getDragPath(page, {
    objectName: "cube",
    screenDelta: { x: 80, y: 0 },
  });
  expect(drag).toBeTruthy();
  await performDrag(page, { ...drag!, modifiers: ["Shift"] });
  await waitForRenderCompletion(page);

  const after = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
  expectClose(after.state.rotation.x, 0.8);
  expectClose(after.state.rotation.y, 0);
  expectClose(after.state.rotation.z, 0);
  expectClose(after.position.x, before.position.x);
  expectClose(after.position.y, before.position.y);
  expectClose(after.position.z, before.position.z);
  expect(after.mesh.vertexCount).toBe(before.mesh.vertexCount);
  expect(after.mesh.triangleCount).toBe(before.mesh.triangleCount);

  await expectCanvasSnapshot(page, "shift-rotate-object-cube-x-axis.png");
});

test("rotate + face updates cube face geometry", async ({ page }) => {
  const before = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));

  await selectFace(page, "cube", 0);
  await activateTool(page, "Rotate");
  const drag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: 0,
    screenDelta: { x: 60, y: 0 },
  });
  expect(drag).toBeTruthy();
  await performDrag(page, drag!);
  await waitForRenderCompletion(page);

  const after = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
  expectGeometryChanged(before, after);
  expectClose(after.state.rotation.x, before.state.rotation.x);
  expectClose(after.state.rotation.y, before.state.rotation.y);
  expectClose(after.state.rotation.z, before.state.rotation.z);
  expect(after.mesh.vertexCount).toBe(before.mesh.vertexCount);
  expect(after.mesh.triangleCount).toBe(before.mesh.triangleCount);

  await expectCanvasSnapshot(page, "rotate-face-top-cube.png");
});

test("shift + rotate + face uses the alternate face tilt axis", async ({ page }) => {
  const before = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));

  await selectFace(page, "cube", 0);
  await activateTool(page, "Rotate");
  const drag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: 0,
    screenDelta: { x: 60, y: 0 },
  });
  expect(drag).toBeTruthy();
  await performDrag(page, { ...drag!, modifiers: ["Shift"] });
  await waitForRenderCompletion(page);

  const scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
  const after = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
  const rotateFeature = scene.featureGraph.find((feature) => feature.type === "rotate");
  const faceTilt = rotateFeature.params.faceTilts[0];

  expectGeometryChanged(before, after);
  expect(faceTilt).toMatchObject({
    faceAxis: "y",
    faceSign: 1,
    hingeAxis: "z",
    hingeSideAxis: "x",
  });
  expectClose(faceTilt.angle, 0.6);
  expectClose(after.state.rotation.x, before.state.rotation.x);
  expectClose(after.state.rotation.y, before.state.rotation.y);
  expectClose(after.state.rotation.z, before.state.rotation.z);
  expect(after.mesh.vertexCount).toBe(before.mesh.vertexCount);
  expect(after.mesh.triangleCount).toBe(before.mesh.triangleCount);

  await expectCanvasSnapshot(page, "shift-rotate-face-top-cube-alternate-axis.png");
});
