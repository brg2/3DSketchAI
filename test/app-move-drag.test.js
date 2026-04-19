import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { SketchApp } from "../src/app/sketch-app.js";

test("vertex move drag uses a screen-space plane so the vertex tracks the cursor", () => {
  const app = Object.create(SketchApp.prototype);
  const startPoint = new THREE.Vector3(10, 2, 3);
  const currentPoint = new THREE.Vector3(11, 2.5, 3.25);
  const pointCalls = [];

  app.tools = { activeTool: "move", dragState: null };
  app.viewport = {
    camera: {
      getWorldDirection(target) {
        return target.set(0, 0, -1);
      },
    },
  };
  app.selectionPipeline = {
    pointOnPlane(args) {
      pointCalls.push(args);
      return args.clientX === 100 ? startPoint.clone() : currentPoint.clone();
    },
  };
  app._moveSurfacePointFromEvent = () => {
    throw new Error("vertex move should not use ground-surface projection");
  };

  const selection = {
    mode: "vertex",
    objectId: "obj_1",
    objectIds: ["obj_1"],
    vertex: {
      x: 0.5,
      y: 0.5,
      z: 0.5,
      key: "px_py_pz",
      world: { x: 10, y: 2, z: 3 },
    },
  };
  const context = app._buildDragContext(
    { clientX: 100, clientY: 100, shiftKey: false },
    {
      hit: {
        point: new THREE.Vector3(9, 2, 3),
        object: {},
      },
      selection,
    },
  );

  assert.equal(context.projector, "screen");
  assert.equal(pointCalls.length, 1);

  const gesture = app._buildGestureFromDrag(
    { clientX: 140, clientY: 130, shiftKey: false },
    {
      dx: 40,
      dy: 30,
      selection,
      context,
    },
  );

  assert.deepEqual(gesture.worldDelta, { x: 1, y: 0.5, z: 0.25 });
  assert.equal(pointCalls.length, 2);
});

test("tool drag commit samples the release pointer before committing", async () => {
  const app = Object.create(SketchApp.prototype);
  const calls = [];

  app.tools = {
    dragState: {},
    endDrag() {
      calls.push("end");
    },
  };
  app.viewport = { controls: { enabled: false } };
  app.runtimeController = {
    async commitManipulation() {
      calls.push("commit");
      return { canonicalCode: "export const main = () => null;" };
    },
  };
  app._updateToolDrag = (event) => {
    calls.push(`update:${event.clientX},${event.clientY}`);
    return true;
  };
  app._recordModelHistory = async () => {};
  app._applySelectionHighlights = () => {};
  app._renderOverlay = () => {};
  app._scheduleSessionPersist = () => {};

  const committed = await app._commitToolDrag({ clientX: 240, clientY: 180 });

  assert.equal(committed, true);
  assert.deepEqual(calls, ["update:240,180", "end", "commit"]);
});

test("tool drag start hides stale preselection after drag state is active", () => {
  const app = Object.create(SketchApp.prototype);
  const calls = [];

  app.tools = {
    activeTool: "move",
    dragState: null,
    startDrag({ selection, context }) {
      this.dragState = { selection, context };
    },
  };
  app.viewport = { controls: { enabled: true } };
  app.runtimeController = {
    beginManipulation() {
      calls.push("begin");
      return {};
    },
  };
  app._buildDragContext = () => ({ mode: "move" });
  app._debugTouch = () => {};
  app._requestFrame = () => {
    calls.push("frame");
  };
  app._hidePreselectionOverlays = () => {
    assert.ok(app.tools.dragState, "preselection refresh must happen after drag state starts");
    calls.push("hide-preselection");
  };

  const started = app._startToolDrag(
    { clientX: 100, clientY: 120, shiftKey: false },
    { selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] } },
  );

  assert.equal(started, true);
  assert.deepEqual(calls, ["begin", "hide-preselection", "frame"]);
});

test("object rotate drag can switch to the alternate axis mid-drag", () => {
  const app = Object.create(SketchApp.prototype);
  app.tools = { activeTool: "rotate", dragState: null };

  const context = app._buildDragContext(
    { clientX: 100, clientY: 100, shiftKey: false },
    {
      hit: {
        point: new THREE.Vector3(0, 0, 0),
        object: {},
      },
      selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    },
  );
  app.tools.dragState = { context };

  const first = app._buildGestureFromDrag(
    { clientX: 140, clientY: 100, shiftKey: false },
    { dx: 40, dy: 0, selection: { mode: "object", objectId: "obj_1" }, context },
  );
  const second = app._buildGestureFromDrag(
    { clientX: 170, clientY: 100, shiftKey: true },
    { dx: 70, dy: 0, selection: { mode: "object", objectId: "obj_1" }, context },
  );

  assert.deepEqual(first.objectRotationEuler, { x: 0, y: 0.4, z: 0 });
  assert.deepEqual(second.objectRotationEuler, { x: 0.3, y: 0.4, z: 0 });
});
