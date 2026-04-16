import test from "node:test";
import assert from "node:assert/strict";
import { SketchApp } from "../src/app/sketch-app.js";

const FACE_SELECTION = {
  mode: "face",
  objectId: "obj_1",
  objectIds: ["obj_1"],
  faceIndex: 2,
  faceNormalWorld: { x: 0, y: 1, z: 0 },
};

function createSpy(impl = () => undefined) {
  const calls = [];
  const spy = (...args) => {
    calls.push(args);
    return impl(...args);
  };
  spy.calls = calls;
  return spy;
}

function createTouchEvent({ pointerId = 1, clientX = 100, clientY = 120, isPrimary = true } = {}) {
  const capturedPointers = [];
  return {
    pointerId,
    pointerType: "touch",
    isPrimary,
    clientX,
    clientY,
    pageX: clientX,
    pageY: clientY,
    currentTarget: {
      setPointerCapture(id) {
        capturedPointers.push(id);
      },
    },
    capturedPointers,
  };
}

function createNativeTouchEvent({ touches = [], changedTouches = touches } = {}) {
  return {
    touches,
    changedTouches,
  };
}

function createNativeTouch({ clientX = 100, clientY = 120 } = {}) {
  return {
    clientX,
    clientY,
    pageX: clientX,
    pageY: clientY,
  };
}

function createTouchHarness({ pickImpl, canStartDrag = true, dragState = null } = {}) {
  const calls = {
    beginCursorNavigation: [],
    beginNativeTouchNavigation: [],
    startToolDrag: [],
    updateToolDrag: [],
    cancelToolInteraction: [],
    clearHover: [],
    picks: [],
  };
  const selectableMeshes = [{ userData: { objectId: "obj_1" } }];
  const app = Object.create(SketchApp.prototype);

  app.activeTouchPointers = new Map();
  app.activeTouchMode = null;
  app.activeTouchToolPointerId = null;
  app.hoveredObjectId = null;
  app.hoveredHit = null;
  app.suppressMouseInteractionUntil = 0;
  app.representationStore = {
    getSelectableMeshes: () => selectableMeshes,
  };
  app.selectionPipeline = {
    pick(args) {
      calls.picks.push(args);
      return pickImpl?.(args) ?? { hit: null, selection: null };
    },
  };
  app.tools = {
    activeTool: "pushPull",
    dragState,
    canStartDrag: () => canStartDrag,
  };
  app.viewport = {
    cancelCursorOrbit: createSpy(),
    cancelCursorPan: createSpy(),
    cancelCursorNavigation: createSpy(),
    beginCursorNavigation(options) {
      calls.beginCursorNavigation.push(options);
      return true;
    },
    beginNativeTouchNavigation(events) {
      calls.beginNativeTouchNavigation.push(events);
      return true;
    },
    controls: { enabled: true },
  };
  app._applySelectionHighlights = createSpy();
  app._renderOverlay = createSpy();
  app._scheduleSessionPersist = createSpy();
  app._startToolDrag = createSpy((event, selectionResult) => {
    calls.startToolDrag.push([event, selectionResult]);
    app.tools.dragState = { selection: selectionResult.selection };
    return true;
  });
  app._updateToolDrag = createSpy((event) => {
    calls.updateToolDrag.push(event);
    return true;
  });
  app._cancelActiveToolInteraction = createSpy(() => {
    calls.cancelToolInteraction.push([]);
    app.tools.dragState = null;
  });
  app._clearHoverState = createSpy(() => {
    calls.clearHover.push([]);
    app.hoveredObjectId = null;
    app.hoveredHit = null;
  });

  return { app, calls };
}

test("mobile single-touch on draggable geometry starts push/pull drag instead of camera pan", () => {
  const selectionResult = { hit: { point: { x: 0, y: 1, z: 0 } }, selection: FACE_SELECTION };
  const { app, calls } = createTouchHarness({ pickImpl: () => selectionResult });
  const event = createTouchEvent({ pointerId: 7 });

  const handled = app._beginTouchNavigation(event);

  assert.equal(handled, true);
  assert.equal(calls.startToolDrag.length, 1);
  assert.equal(calls.beginCursorNavigation.length, 0);
  assert.deepEqual(event.capturedPointers, [7]);
  assert.equal(app.activeTouchPointers.has(7), true);
});

test("mobile touch picking uses a small drag-tool tolerance under the finger", () => {
  const selectionResult = { hit: { point: { x: 0, y: 1, z: 0 } }, selection: FACE_SELECTION };
  const { app, calls } = createTouchHarness({
    pickImpl: ({ clientX }) => (clientX === 114 ? selectionResult : { hit: null, selection: null }),
  });

  app._beginTouchNavigation(createTouchEvent({ clientX: 100, clientY: 100 }));

  assert.equal(calls.startToolDrag.length, 1);
  assert.ok(calls.picks.length > 1, "touch drag pick should retry nearby points before falling back to pan");
  assert.equal(calls.beginCursorNavigation.length, 0);
});

test("mobile single-touch on empty space starts ground-plane camera pan", () => {
  const { app, calls } = createTouchHarness();
  const event = createTouchEvent({ pointerId: 3 });

  app._beginTouchNavigation(event);

  assert.equal(calls.startToolDrag.length, 0);
  assert.equal(calls.beginCursorNavigation.length, 1);
  assert.equal(calls.beginCursorNavigation[0].baseMode, "pan");
  assert.equal(calls.beginCursorNavigation[0].pointerId, 3);
});

test("mobile single-touch move updates the active tool drag", () => {
  const { app, calls } = createTouchHarness({ dragState: { selection: FACE_SELECTION } });
  app.activeTouchMode = "tool";
  app.activeTouchToolPointerId = 5;
  app.activeTouchPointers.set(5, {
    pointerId: 5,
    pointerType: "touch",
    clientX: 100,
    clientY: 100,
    pageX: 100,
    pageY: 100,
  });

  const handled = app._handleTouchPointerMove(createTouchEvent({ pointerId: 5, clientX: 115, clientY: 130 }));

  assert.equal(handled, true);
  assert.equal(calls.updateToolDrag.length, 1);
});

test("second touch cancels active tool drag and delegates to native pinch/orbit", () => {
  const { app, calls } = createTouchHarness({ dragState: { selection: FACE_SELECTION } });
  app.activeTouchMode = "tool";
  app.activeTouchToolPointerId = 1;
  app.activeTouchPointers.set(1, {
    pointerId: 1,
    pointerType: "touch",
    clientX: 100,
    clientY: 100,
    pageX: 100,
    pageY: 100,
  });

  app._beginTouchNavigation(createTouchEvent({ pointerId: 2, clientX: 150, clientY: 140, isPrimary: false }));

  assert.equal(calls.cancelToolInteraction.length, 1);
  assert.equal(calls.beginNativeTouchNavigation.length, 1);
  assert.equal(calls.beginNativeTouchNavigation[0].length, 2);
  assert.equal(calls.beginCursorNavigation.length, 0);
});

test("new primary touch clears stale touch bookkeeping before selecting geometry", () => {
  const selectionResult = { hit: { point: { x: 0, y: 1, z: 0 } }, selection: FACE_SELECTION };
  const { app, calls } = createTouchHarness({
    dragState: { selection: FACE_SELECTION },
    pickImpl: () => selectionResult,
  });
  app.activeTouchToolPointerId = 99;
  app.activeTouchMode = "native";
  app.activeTouchPointers.set(99, {
    pointerId: 99,
    pointerType: "touch",
    clientX: 20,
    clientY: 20,
    pageX: 20,
    pageY: 20,
  });

  app._beginTouchNavigation(createTouchEvent({ pointerId: 6, isPrimary: true }));

  assert.equal(calls.cancelToolInteraction.length, 1);
  assert.equal(calls.startToolDrag.length, 1);
  assert.equal(calls.beginNativeTouchNavigation.length, 0);
  assert.deepEqual([...app.activeTouchPointers.keys()], [6]);
});

test("failed touch drag start falls back to ground-plane camera pan", () => {
  const selectionResult = { hit: { point: { x: 0, y: 1, z: 0 } }, selection: FACE_SELECTION };
  const { app, calls } = createTouchHarness({ pickImpl: () => selectionResult });
  app._startToolDrag = createSpy((event, result) => {
    calls.startToolDrag.push([event, result]);
    return false;
  });

  app._beginTouchNavigation(createTouchEvent({ pointerId: 8 }));

  assert.equal(calls.startToolDrag.length, 1);
  assert.equal(calls.beginCursorNavigation.length, 1);
  assert.equal(calls.beginCursorNavigation[0].baseMode, "pan");
});

test("mobile touch drag does not depend on pointer capture support", () => {
  const selectionResult = { hit: { point: { x: 0, y: 1, z: 0 } }, selection: FACE_SELECTION };
  const { app, calls } = createTouchHarness({ pickImpl: () => selectionResult });
  const event = createTouchEvent({ pointerId: 10 });
  event.currentTarget.setPointerCapture = () => {
    throw new Error("Pointer capture unsupported");
  };

  const handled = app._beginTouchNavigation(event);

  assert.equal(handled, true);
  assert.equal(calls.startToolDrag.length, 1);
  assert.equal(app.activeTouchMode, "tool");
  assert.equal(app.activeTouchToolPointerId, 10);
});

test("touch tool start recovers from a stale active manipulation session", () => {
  const app = Object.create(SketchApp.prototype);
  const calls = {
    beginManipulation: 0,
    cancelManipulation: 0,
    debug: [],
  };
  app.tools = {
    activeTool: "move",
    dragState: null,
    startDrag({ pointerDown, selection, context }) {
      this.dragState = { pointerDown, pointerCurrent: pointerDown, selection, context };
    },
    clearDrag() {
      this.dragState = null;
    },
  };
  app.viewport = { controls: { enabled: true } };
  app.runtimeController = {
    beginManipulation() {
      calls.beginManipulation += 1;
      if (calls.beginManipulation === 1) {
        throw new Error("Another manipulation session is already active");
      }
      return {};
    },
    cancelManipulation() {
      calls.cancelManipulation += 1;
    },
  };
  app._buildDragContext = () => ({ mode: "move" });
  app._debugTouch = (message, details) => {
    calls.debug.push([message, details]);
  };

  const started = app._startToolDrag(
    createTouchEvent({ pointerId: 17 }),
    { hit: { point: { x: 0, y: 1, z: 0 } }, selection: FACE_SELECTION },
  );

  assert.equal(started, true);
  assert.equal(calls.beginManipulation, 2);
  assert.equal(calls.cancelManipulation, 1);
  assert.equal(app.tools.dragState.selection.objectId, "obj_1");
  assert.equal(app.viewport.controls.enabled, false);
  assert.equal(calls.debug.at(-1)[0], "tool start ok");
});

test("mobile pointercancel cancels active tool drag instead of committing it", () => {
  const { app, calls } = createTouchHarness({ dragState: { selection: FACE_SELECTION } });
  app.activeTouchMode = "tool";
  app.activeTouchToolPointerId = 12;
  app.activeTouchPointers.set(12, {
    pointerId: 12,
    pointerType: "touch",
    clientX: 100,
    clientY: 100,
    pageX: 100,
    pageY: 100,
  });

  app._cancelTouchNavigation(createTouchEvent({ pointerId: 12 }));

  assert.equal(calls.cancelToolInteraction.length, 1);
  assert.equal(app.activeTouchPointers.size, 0);
  assert.equal(app.activeTouchMode, null);
  assert.equal(app.activeTouchToolPointerId, null);
});

test("native touchmove fallback updates an active pointer-started tool drag", () => {
  const { app, calls } = createTouchHarness({ dragState: { selection: FACE_SELECTION } });
  app.activeTouchMode = "tool";
  app.activeTouchToolPointerId = 15;
  app.activeTouchPointers.set(15, {
    pointerId: 15,
    pointerType: "touch",
    clientX: 100,
    clientY: 100,
    pageX: 100,
    pageY: 100,
  });

  const handled = app._handleNativeTouchMove(createNativeTouchEvent({
    touches: [createNativeTouch({ clientX: 130, clientY: 160 })],
  }));

  assert.equal(handled, true);
  assert.equal(calls.updateToolDrag.length, 1);
  assert.equal(calls.updateToolDrag[0].clientX, 130);
  assert.equal(calls.updateToolDrag[0].clientY, 160);
});

test("native touchend fallback commits an active pointer-started tool drag", async () => {
  const { app } = createTouchHarness({ dragState: { selection: FACE_SELECTION } });
  let committed = 0;
  app._commitToolDrag = async () => {
    committed += 1;
    app.tools.dragState = null;
    return true;
  };
  app.activeTouchMode = "tool";
  app.activeTouchToolPointerId = 16;
  app.activeTouchPointers.set(16, {
    pointerId: 16,
    pointerType: "touch",
    clientX: 100,
    clientY: 100,
    pageX: 100,
    pageY: 100,
  });

  const handled = app._handleNativeTouchEnd(createNativeTouchEvent({
    touches: [],
    changedTouches: [createNativeTouch({ clientX: 140, clientY: 170 })],
  }));
  await Promise.resolve();

  assert.equal(handled, true);
  assert.equal(committed, 1);
});
