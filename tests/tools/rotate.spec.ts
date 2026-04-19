import { expect, test } from "@playwright/test";
import { expectCanvasSnapshot, expectClose, expectGeometryChanged, expectPngImagesClose } from "../utils/assertions";
import { getDragPath, performDrag, waitForRenderCompletion } from "../utils/interaction";
import { activateTool, loadKnownScene, selectEdge, selectFace, selectObject } from "../utils/selection";

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

test("rotate + adjacent faces preview matches the committed brep result", async ({ page }) => {
  await selectFace(page, "cube", 0);
  await activateTool(page, "Rotate");
  const firstDrag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: 0,
    screenDelta: { x: 60, y: 0 },
  });
  expect(firstDrag).toBeTruthy();
  await performDrag(page, firstDrag!);
  await waitForRenderCompletion(page);

  await selectFace(page, "cube", 1);
  await activateTool(page, "Rotate");
  const adjacentDrag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: 1,
    screenDelta: { x: 50, y: 0 },
  });
  expect(adjacentDrag).toBeTruthy();

  await page.mouse.move(adjacentDrag!.start.x, adjacentDrag!.start.y);
  await page.mouse.down();
  let previewImage: Buffer | null = null;
  try {
    await page.mouse.move(adjacentDrag!.end.x, adjacentDrag!.end.y, { steps: 10 });
    await waitForRenderCompletion(page);
    previewImage = await page.locator("canvas").screenshot();

    const previewScene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    const previewMesh = previewScene.meshes.find((mesh) => mesh.objectId === "cube");
    expect(previewScene.tool.dragging).toBe(true);
    expect(previewScene.previewFeatureGraphUpdate).toMatchObject({
      created: true,
      reason: "fallback_new_feature",
      featureId: "feature_3",
    });
    expect(previewScene.featureGraph).toHaveLength(2);
    expect(previewMesh.vertexCount).toBe(24);
    expect(previewMesh.triangleCount).toBe(12);
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
  const committedMesh = committedScene.meshes.find((mesh) => mesh.objectId === "cube");
  const rotateFeatures = committedScene.featureGraph.filter((feature) => feature.type === "rotate");
  expect(committedScene.tool.dragging).toBe(false);
  expect(rotateFeatures).toHaveLength(2);
  expect(rotateFeatures[0].target.selection.selector.role).toBe("face.py");
  expect(rotateFeatures[1].target.selection.selector.role).toBe("face.px");
  expect(committedMesh.vertexCount).toBe(24);
  expect(committedMesh.triangleCount).toBe(12);
  expectPngImagesClose(committedImage, previewImage!);
});

test("rotate + opposite faces preview matches the committed brep result", async ({ page }) => {
  await selectFace(page, "cube", 0);
  await activateTool(page, "Rotate");
  const topDrag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: 0,
    screenDelta: { x: 60, y: 0 },
  });
  expect(topDrag).toBeTruthy();
  await performDrag(page, topDrag!);
  await waitForRenderCompletion(page);

  await page.evaluate(() =>
    window.__TEST_API__.setCamera({
      position: { x: 4, y: -3, z: 5 },
      target: { x: 0, y: 0, z: 0 },
    }),
  );
  await waitForRenderCompletion(page);

  await selectFace(page, "cube", 5);
  await activateTool(page, "Rotate");
  const bottomDrag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: 5,
    screenDelta: { x: 50, y: 0 },
  });
  expect(bottomDrag).toBeTruthy();

  await page.mouse.move(bottomDrag!.start.x, bottomDrag!.start.y);
  await page.mouse.down();
  let previewImage: Buffer | null = null;
  try {
    await page.mouse.move(bottomDrag!.end.x, bottomDrag!.end.y, { steps: 10 });
    await waitForRenderCompletion(page);
    previewImage = await page.locator("canvas").screenshot();

    const previewScene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    const previewMesh = previewScene.meshes.find((mesh) => mesh.objectId === "cube");
    expect(previewScene.tool.dragging).toBe(true);
    expect(previewScene.previewFeatureGraphUpdate).toMatchObject({
      created: true,
      reason: "fallback_new_feature",
      featureId: "feature_3",
    });
    expect(previewScene.featureGraph).toHaveLength(2);
    expect(previewMesh.vertexCount).toBe(24);
    expect(previewMesh.triangleCount).toBe(12);
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
  const committedMesh = committedScene.meshes.find((mesh) => mesh.objectId === "cube");
  const rotateFeatures = committedScene.featureGraph.filter((feature) => feature.type === "rotate");
  expect(committedScene.tool.dragging).toBe(false);
  expect(rotateFeatures).toHaveLength(2);
  expect(rotateFeatures[0].target.selection.selector.role).toBe("face.py");
  expect(rotateFeatures[1].target.selection.selector.role).toBe("face.ny");
  expect(committedMesh.vertexCount).toBe(24);
  expect(committedMesh.triangleCount).toBe(12);
  expectPngImagesClose(committedImage, previewImage!);
});

test("rotate + tilted top then front face preview matches the committed brep result", async ({ page }) => {
  await selectFace(page, "cube", 0);
  await activateTool(page, "Rotate");
  const topDrag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: 0,
    screenDelta: { x: -60, y: 0 },
  });
  expect(topDrag).toBeTruthy();
  await performDrag(page, topDrag!);
  await waitForRenderCompletion(page);

  await selectFace(page, "cube", 2);
  await activateTool(page, "Rotate");
  const frontDrag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: 2,
    screenDelta: { x: 60, y: 0 },
  });
  expect(frontDrag).toBeTruthy();

  await page.mouse.move(frontDrag!.start.x, frontDrag!.start.y);
  await page.mouse.down();
  let previewImage: Buffer | null = null;
  try {
    await page.mouse.move(frontDrag!.end.x, frontDrag!.end.y, { steps: 10 });
    await waitForRenderCompletion(page);
    previewImage = await page.locator("canvas").screenshot();

    const previewScene = await page.evaluate(() => window.__TEST_API__.getSceneState());
    const previewMesh = previewScene.meshes.find((mesh) => mesh.objectId === "cube");
    expect(previewScene.tool.dragging).toBe(true);
    expect(previewScene.previewFeatureGraphUpdate).toMatchObject({
      created: true,
      reason: "fallback_new_feature",
      featureId: "feature_3",
    });
    expect(previewScene.featureGraph).toHaveLength(2);
    expect(previewMesh.worldBounds.max.z).toBeGreaterThan(0.7);
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
  const committedMesh = committedScene.meshes.find((mesh) => mesh.objectId === "cube");
  const rotateFeatures = committedScene.featureGraph.filter((feature) => feature.type === "rotate");
  expect(committedScene.tool.dragging).toBe(false);
  expect(rotateFeatures).toHaveLength(2);
  expect(rotateFeatures[0].target.selection.selector.role).toBe("face.py");
  expect(rotateFeatures[1].target.selection.selector.role).toBe("face.pz");
  expect(committedMesh.worldBounds.max.z).toBeGreaterThan(0.7);
  expectPngImagesClose(committedImage, previewImage!);
});

test("rotate + edge rotates around the normal object Y axis", async ({ page }) => {
  const before = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));

  await selectEdge(page, "cube", 0);
  await activateTool(page, "Rotate");
  const drag = await getDragPath(page, {
    objectName: "cube",
    edgeIndex: 0,
    screenDelta: { x: 60, y: 0 },
  });
  expect(drag).toBeTruthy();
  await performDrag(page, drag!);
  await waitForRenderCompletion(page);

  const scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
  const after = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
  const rotateFeature = scene.featureGraph.find((feature) => feature.type === "rotate");

  expectClose(after.state.rotation.x, 0);
  expectClose(after.state.rotation.y, 0.6);
  expectClose(after.state.rotation.z, 0);
  expectClose(after.position.x, before.position.x);
  expectClose(after.position.y, before.position.y);
  expectClose(after.position.z, before.position.z);
  expect(after.mesh.vertexCount).toBe(before.mesh.vertexCount);
  expect(after.mesh.triangleCount).toBe(before.mesh.triangleCount);
  expect(rotateFeature.target.selection.mode).toBe("edge");
  expect(rotateFeature.params.deltaEuler).toMatchObject({
    x: 0,
    y: 0.6,
    z: 0,
  });

  await expectCanvasSnapshot(page, "rotate-edge-top-right-cube-y-axis.png");
});

test("shift + rotate + edge rotates around the alternate object X axis", async ({ page }) => {
  const before = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));

  await selectEdge(page, "cube", 0);
  await activateTool(page, "Rotate");
  const drag = await getDragPath(page, {
    objectName: "cube",
    edgeIndex: 0,
    screenDelta: { x: 60, y: 0 },
  });
  expect(drag).toBeTruthy();
  await performDrag(page, { ...drag!, modifiers: ["Shift"] });
  await waitForRenderCompletion(page);

  const scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
  const after = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
  const rotateFeature = scene.featureGraph.find((feature) => feature.type === "rotate");

  expectClose(after.state.rotation.x, 0.6);
  expectClose(after.state.rotation.y, 0);
  expectClose(after.state.rotation.z, 0);
  expectClose(after.position.x, before.position.x);
  expectClose(after.position.y, before.position.y);
  expectClose(after.position.z, before.position.z);
  expect(after.mesh.vertexCount).toBe(before.mesh.vertexCount);
  expect(after.mesh.triangleCount).toBe(before.mesh.triangleCount);
  expect(rotateFeature.target.selection.mode).toBe("edge");
  expect(rotateFeature.params.deltaEuler).toMatchObject({
    x: 0.6,
    y: 0,
    z: 0,
  });

  await expectCanvasSnapshot(page, "shift-rotate-edge-top-right-cube-x-axis.png");
});
