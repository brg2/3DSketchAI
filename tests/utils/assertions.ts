import { inflateSync } from "node:zlib";
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

export function expectPngImagesClose(
  actualPng: Buffer,
  expectedPng: Buffer,
  {
    maxDiffPixels = 0,
    channelTolerance = 0,
  }: {
    maxDiffPixels?: number;
    channelTolerance?: number;
  } = {},
) {
  const actual = decodePng(actualPng);
  const expected = decodePng(expectedPng);
  expect(actual.width).toBe(expected.width);
  expect(actual.height).toBe(expected.height);

  let diffPixels = 0;
  for (let index = 0; index < actual.rgba.length; index += 4) {
    const differs = (
      Math.abs(actual.rgba[index] - expected.rgba[index]) > channelTolerance ||
      Math.abs(actual.rgba[index + 1] - expected.rgba[index + 1]) > channelTolerance ||
      Math.abs(actual.rgba[index + 2] - expected.rgba[index + 2]) > channelTolerance ||
      Math.abs(actual.rgba[index + 3] - expected.rgba[index + 3]) > channelTolerance
    );
    if (differs) {
      diffPixels += 1;
    }
  }

  expect(diffPixels).toBeLessThanOrEqual(maxDiffPixels);
}

function decodePng(buffer: Buffer) {
  const signature = buffer.subarray(0, 8);
  if (!signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Expected PNG image data");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      const compression = data[10];
      const filter = data[11];
      const interlace = data[12];
      if (bitDepth !== 8 || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error("Unsupported PNG format");
      }
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!width || !height || !channels) {
    throw new Error(`Unsupported PNG color type ${colorType}`);
  }

  const bytesPerPixel = channels;
  const rowLength = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const raw = Buffer.alloc(height * rowLength);
  const rgba = Buffer.alloc(width * height * 4);

  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const rowStart = y * rowLength;
    const previousRowStart = (y - 1) * rowLength;

    for (let x = 0; x < rowLength; x += 1) {
      const value = inflated[sourceOffset + x];
      const left = x >= bytesPerPixel ? raw[rowStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? raw[previousRowStart + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? raw[previousRowStart + x - bytesPerPixel] : 0;
      raw[rowStart + x] = (value + pngFilterValue(filter, left, up, upLeft)) & 0xff;
    }

    sourceOffset += rowLength;
  }

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const rawOffset = pixel * channels;
    const rgbaOffset = pixel * 4;
    rgba[rgbaOffset] = raw[rawOffset];
    rgba[rgbaOffset + 1] = raw[rawOffset + 1];
    rgba[rgbaOffset + 2] = raw[rawOffset + 2];
    rgba[rgbaOffset + 3] = channels === 4 ? raw[rawOffset + 3] : 255;
  }

  return { width, height, rgba };
}

function pngFilterValue(filter: number, left: number, up: number, upLeft: number) {
  if (filter === 0) {
    return 0;
  }
  if (filter === 1) {
    return left;
  }
  if (filter === 2) {
    return up;
  }
  if (filter === 3) {
    return Math.floor((left + up) / 2);
  }
  if (filter === 4) {
    return paeth(left, up, upLeft);
  }
  throw new Error(`Unsupported PNG filter ${filter}`);
}

function paeth(left: number, up: number, upLeft: number) {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upLeftDistance = Math.abs(prediction - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  if (upDistance <= upLeftDistance) {
    return up;
  }
  return upLeft;
}
