import { expect, type Page } from "@playwright/test";

type Point = { x: number; y: number };

export async function loadKnownScene(page: Page) {
  const alreadyLoaded = await page.evaluate(() => Boolean(window.__TEST_API__)).catch(() => false);
  if (!alreadyLoaded) {
    await page.goto("/?e2e=1");
    await page.waitForFunction(() => Boolean(window.__TEST_API__));
  }
  await page.evaluate(() => window.__TEST_API__.setupDeterministicScene());
  await page.evaluate(() => window.__TEST_API__.nextFrame(3));
  await expect(page.locator("canvas")).toBeVisible();
}

export async function activateTool(page: Page, tool: "Move" | "Rotate" | "Push/Pull" | "Line Draw" | "Select") {
  await page.getByRole("button", { name: tool }).click();
  await page.evaluate(() => window.__TEST_API__.nextFrame(2));
}

export async function selectObject(page: Page, objectName: string) {
  await activateTool(page, "Select");
  await page.getByRole("button", { name: "Object" }).click();
  const point = await page.evaluate((name) => window.__TEST_API__.getCanvasPointForObject(name), objectName);
  expect(point).toBeTruthy();
  await clickCanvasAtClientPoint(page, point);
  await expect.poll(async () => page.evaluate(() => window.__TEST_API__.getSelected())).toMatchObject({
    mode: "object",
    objectIds: ["cube"],
  });
}

export async function selectFace(page: Page, objectName: string, faceIndex: number) {
  await activateTool(page, "Select");
  await page.getByRole("button", { name: "Face" }).click();
  const point = await page.evaluate(
    ({ name, index }) => window.__TEST_API__.getCanvasPointForFace(name, index),
    { name: objectName, index: faceIndex },
  );
  expect(point).toBeTruthy();
  await clickCanvasAtClientPoint(page, point);
  await expect.poll(async () => page.evaluate(() => window.__TEST_API__.getSelected())).toMatchObject({
    mode: "face",
    objectIds: ["cube"],
  });
}

export async function selectEdge(page: Page, objectName: string, edgeIndex: number) {
  await activateTool(page, "Select");
  await page.getByRole("button", { name: "Edge" }).click();
  const point = await page.evaluate(
    ({ name, index }) => window.__TEST_API__.getCanvasPointForEdge(name, index),
    { name: objectName, index: edgeIndex },
  );
  expect(point).toBeTruthy();
  await clickCanvasAtClientPoint(page, point);
  await expect.poll(async () => page.evaluate(() => window.__TEST_API__.getSelected())).toMatchObject({
    mode: "edge",
    objectIds: ["cube"],
  });
}

export async function selectVertex(page: Page, objectName: string, vertexIndex: number) {
  await activateTool(page, "Select");
  await page.getByRole("button", { name: "Vertex" }).click();
  const point = await page.evaluate(
    ({ name, index }) => window.__TEST_API__.getCanvasPointForVertex(name, index),
    { name: objectName, index: vertexIndex },
  );
  expect(point).toBeTruthy();
  await clickCanvasAtClientPoint(page, point);
  await expect.poll(async () => page.evaluate(() => window.__TEST_API__.getSelected())).toMatchObject({
    mode: "vertex",
    objectIds: ["cube"],
  });
}

async function clickCanvasAtClientPoint(page: Page, point: Point) {
  const box = await page.locator("canvas").boundingBox();
  expect(box).toBeTruthy();
  await page.locator("canvas").click({
    position: {
      x: point.x - box!.x,
      y: point.y - box!.y,
    },
  });
}
