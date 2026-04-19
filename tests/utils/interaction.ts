import type { Page } from "@playwright/test";

type Point = { x: number; y: number };

export async function performDrag(
  page: Page,
  {
    start,
    end,
    modifiers = [],
    steps = 10,
  }: {
    start: Point;
    end: Point;
    modifiers?: string[];
    steps?: number;
  },
) {
  for (const modifier of modifiers) {
    await page.keyboard.down(modifier);
  }

  try {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps });
    await page.mouse.up();
  } finally {
    for (const modifier of [...modifiers].reverse()) {
      await page.keyboard.up(modifier);
    }
  }
}

export async function getDragPath(
  page: Page,
  options: {
    objectName?: string;
    faceIndex?: number;
    edgeIndex?: number;
    vertexIndex?: number;
    worldDelta?: { x: number; y: number; z: number };
    screenDelta?: Point;
  },
) {
  return page.evaluate((args) => window.__TEST_API__.getDragPath(args), options);
}

export async function waitForRenderCompletion(page: Page, frameCount = 3) {
  await page.evaluate((count) => window.__TEST_API__.nextFrame(count), frameCount);
}
