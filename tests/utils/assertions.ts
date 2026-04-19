import { expect, type Page } from "@playwright/test";

export const TOLERANCE = 0.001;

type Vector3 = { x: number; y: number; z: number };
type Bounds = { min: Vector3; max: Vector3 };

export function expectClose(actual: number, expected: number, tolerance = TOLERANCE) {
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);
}

export function expectVectorClose(actual: Vector3, expected: Vector3, tolerance = TOLERANCE) {
  expectClose(actual.x, expected.x, tolerance);
  expectClose(actual.y, expected.y, tolerance);
  expectClose(actual.z, expected.z, tolerance);
}

export function expectBoundsClose(actual: Bounds, expected: Bounds, tolerance = TOLERANCE) {
  expectVectorClose(actual.min, expected.min, tolerance);
  expectVectorClose(actual.max, expected.max, tolerance);
}

export function expectBoundsExpanded(before: Bounds, after: Bounds, axis: keyof Vector3, expectedDelta: number) {
  const actualDelta = after.max[axis] - before.max[axis];
  expect(actualDelta).toBeGreaterThan(expectedDelta - TOLERANCE);
}

export function expectGeometryChanged(before: { mesh: { geometrySignature: string } }, after: { mesh: { geometrySignature: string } }) {
  expect(after.mesh.geometrySignature).not.toBe(before.mesh.geometrySignature);
}

export async function expectCanvasSnapshot(page: Page, name: string) {
  await page.evaluate(() => window.__TEST_API__.nextFrame(3));
  await expect(page.locator("canvas")).toHaveScreenshot(name, {
    maxDiffPixels: 20,
    threshold: 0.02,
  });
}
