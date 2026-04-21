import { expect, test } from "./fixtures";
import { expectBoundsClose, expectBoundsExpanded, expectCanvasSnapshot, expectClose, expectGeometryChanged, expectVectorClose } from "../utils/assertions";
import { getDragPath, performDrag, waitForRenderCompletion } from "../utils/interaction";
import { activateTool, loadKnownScene, selectEdge, selectFace, selectObject, selectVertex } from "../utils/selection";

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

test("move + face hides preselection while previewing the drag", async ({ page }) => {
  await selectFace(page, "cube", 1);
  await activateTool(page, "Move");
  const drag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: 1,
    worldDelta: { x: 0.5, y: 0, z: 0 },
  });
  expect(drag).toBeTruthy();

  await page.mouse.move(drag!.start.x, drag!.start.y);
  await page.mouse.down();
  await page.mouse.move(
    drag!.start.x + ((drag!.end.x - drag!.start.x) / 2),
    drag!.start.y + ((drag!.end.y - drag!.start.y) / 2),
    { steps: 4 },
  );
  await waitForRenderCompletion(page, 1);

  const preselection = await page.evaluate(() => window.__TEST_API__.getPreselectionState());
  expect(preselection).toMatchObject({
    dragging: true,
    faceVisible: false,
    edgeVisible: false,
    vertexVisible: false,
  });

  await page.mouse.up();
  await waitForRenderCompletion(page);
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

test("move + edge moves the selected edge along X only", async ({ page }) => {
  const before = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));

  await selectEdge(page, "cube", 0);
  await activateTool(page, "Move");
  const drag = await getDragPath(page, {
    objectName: "cube",
    edgeIndex: 0,
    worldDelta: { x: 0.5, y: 0, z: 0 },
  });
  expect(drag).toBeTruthy();
  await performDrag(page, drag!);
  await waitForRenderCompletion(page);

  const scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
  const after = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
  const moveFeature = scene.featureGraph.find((feature) => feature.type === "move");

  expectGeometryChanged(before, after);
  expectBoundsExpanded(before.mesh.worldBounds, after.mesh.worldBounds, "x", 0.5);
  expectClose(after.mesh.worldBounds.min.x, before.mesh.worldBounds.min.x);
  expectClose(after.position.y, before.position.y);
  expectClose(after.position.z, before.position.z);
  expect(moveFeature.target.selection.mode).toBe("edge");
  expect(moveFeature.params.subshapeMove).toMatchObject({
    mode: "edge",
  });
  expect(moveFeature.params.subshapeMove.edge.keys).toEqual(expect.arrayContaining(["px_py_nz", "px_py_pz"]));
  expectClose(moveFeature.params.delta.x, 0.5);
  expectClose(moveFeature.params.delta.y, 0);
  expectClose(moveFeature.params.delta.z, 0);

  await expectCanvasSnapshot(page, "move-edge-top-right-cube.png");
});

test("shift + move + edge moves the selected edge on the alternate Y axis", async ({ page }) => {
  const before = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));

  await selectEdge(page, "cube", 1);
  await activateTool(page, "Move");
  const drag = await getDragPath(page, {
    objectName: "cube",
    edgeIndex: 1,
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
  expect(moveFeature.target.selection.mode).toBe("edge");
  expect(moveFeature.params.subshapeMove).toMatchObject({
    mode: "edge",
  });
  expect(moveFeature.params.subshapeMove.edge.keys).toEqual(expect.arrayContaining(["nx_py_pz", "px_py_pz"]));
  expectClose(moveFeature.params.delta.x, 0);
  expectClose(moveFeature.params.delta.y, 1);
  expectClose(moveFeature.params.delta.z, 0);

  await expectCanvasSnapshot(page, "shift-move-edge-top-front-cube-y-axis.png");
});

test("move + vertex moves the selected vertex in the screen plane", async ({ page }) => {
  const before = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));

  await selectVertex(page, "cube", 0);
  await activateTool(page, "Move");
  const drag = await getDragPath(page, {
    objectName: "cube",
    vertexIndex: 0,
    worldDelta: { x: 0.5, y: 0, z: -0.4 },
  });
  expect(drag).toBeTruthy();
  await performDrag(page, drag!);
  await waitForRenderCompletion(page);

  const scene = await page.evaluate(() => window.__TEST_API__.getSceneState());
  const after = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
  const moveFeature = scene.featureGraph.find((feature) => feature.type === "move");

  expectGeometryChanged(before, after);
  expectBoundsExpanded(before.mesh.worldBounds, after.mesh.worldBounds, "x", 0.5);
  expectClose(after.mesh.worldBounds.min.x, before.mesh.worldBounds.min.x);
  expectClose(after.position.x, before.position.x);
  expectClose(after.position.y, before.position.y);
  expectClose(after.position.z, before.position.z);
  expect(moveFeature.target.selection.mode).toBe("vertex");
  expect(moveFeature.params.subshapeMove).toMatchObject({
    mode: "vertex",
    vertex: { key: "px_py_pz" },
  });
  expectClose(moveFeature.params.delta.x, 0.5);
  expectClose(moveFeature.params.delta.y, 0);
  expectClose(moveFeature.params.delta.z, -0.4);

  await expectCanvasSnapshot(page, "move-vertex-top-right-front-cube.png");
});
