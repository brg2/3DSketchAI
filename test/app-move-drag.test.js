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
