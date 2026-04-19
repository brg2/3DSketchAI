import test from "node:test";
import assert from "node:assert/strict";
import { SketchApp } from "../src/app/sketch-app.js";

test("idle app tick renders once without scheduling a continuous frame loop", () => {
  const app = Object.create(SketchApp.prototype);
  let frameCount = 0;
  let overlayCount = 0;
  let requested = 0;

  app.frameRequestId = 1;
  app.viewport = {
    frame() {
      frameCount += 1;
      return false;
    },
  };
  app.tools = { dragState: null };
  app._renderOverlay = () => {
    overlayCount += 1;
  };
  app._requestFrame = () => {
    requested += 1;
  };

  app._tick();

  assert.equal(app.frameRequestId, null);
  assert.equal(frameCount, 1);
  assert.equal(overlayCount, 1);
  assert.equal(requested, 0);
});

test("active viewport tick schedules the next animation frame", () => {
  const app = Object.create(SketchApp.prototype);
  let requested = 0;

  app.frameRequestId = 1;
  app.viewport = {
    frame() {
      return true;
    },
  };
  app.tools = { dragState: null };
  app._renderOverlay = () => {};
  app._requestFrame = () => {
    requested += 1;
  };

  app._tick();

  assert.equal(requested, 1);
});
