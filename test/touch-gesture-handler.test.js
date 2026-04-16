import test from "node:test";
import assert from "node:assert/strict";
import { TouchGestureHandler } from "../src/interaction/touch-gesture-handler.js";

function createMockViewport() {
  return {
    calls: [],
    beginTouchGesture() {
      this.calls.push({ method: "beginTouchGesture" });
    },
    applyTouchPinchScale({ scale, clientX, clientY }) {
      this.calls.push({ method: "applyTouchPinchScale", scale, clientX, clientY });
    },
    applyTouchOrbitDelta({ dx, dy }) {
      this.calls.push({ method: "applyTouchOrbitDelta", dx, dy });
    },
    endTouchGesture() {
      this.calls.push({ method: "endTouchGesture" });
    },
    cancelCursorNavigation() {
      this.calls.push({ method: "cancelCursorNavigation" });
    },
  };
}

function makeTouchList(touches) {
  const list = touches.slice();
  list.item = (i) => list[i];
  list.identifiedTouch = (id) => list.find((t) => t.identifier === id);
  return list;
}

function makeTouchEvent(type, touches) {
  let defaultPrevented = false;
  const touchList = makeTouchList(touches);
  return {
    type,
    touches: touchList,
    changedTouches: touchList,
    preventDefault() {
      defaultPrevented = true;
    },
    get defaultPrevented() {
      return defaultPrevented;
    },
  };
}

test("TouchGestureHandler does not start gesture for single touch", () => {
  const viewport = createMockViewport();
  const handler = new TouchGestureHandler({ viewport });

  const event = makeTouchEvent("touchstart", [
    { identifier: 0, clientX: 100, clientY: 100 },
  ]);
  handler._onTouchStart(event);

  assert.equal(handler._gestureActive, false);
  assert.equal(viewport.calls.length, 0);
  assert.equal(event.defaultPrevented, false);
});

test("TouchGestureHandler starts gesture on two-finger touchstart", () => {
  const viewport = createMockViewport();
  const handler = new TouchGestureHandler({ viewport });

  const event = makeTouchEvent("touchstart", [
    { identifier: 0, clientX: 100, clientY: 200 },
    { identifier: 1, clientX: 200, clientY: 200 },
  ]);
  handler._onTouchStart(event);

  assert.equal(handler._gestureActive, true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(viewport.calls[0].method, "beginTouchGesture");
  assert.ok(handler._lastPinchDistance !== null);
  assert.equal(handler._lastMidpointX, 150);
  assert.equal(handler._lastMidpointY, 200);
});

test("TouchGestureHandler does not call beginTouchGesture twice if already active", () => {
  const viewport = createMockViewport();
  const handler = new TouchGestureHandler({ viewport });

  const start1 = makeTouchEvent("touchstart", [
    { identifier: 0, clientX: 100, clientY: 200 },
    { identifier: 1, clientX: 200, clientY: 200 },
  ]);
  handler._onTouchStart(start1);
  const callsAfterFirst = viewport.calls.length;

  // A second touchstart while gesture is already active (e.g., third finger added)
  const start2 = makeTouchEvent("touchstart", [
    { identifier: 0, clientX: 100, clientY: 200 },
    { identifier: 1, clientX: 200, clientY: 200 },
    { identifier: 2, clientX: 150, clientY: 100 },
  ]);
  handler._onTouchStart(start2);

  // beginTouchGesture should only have been called once
  assert.equal(viewport.calls.filter((c) => c.method === "beginTouchGesture").length, 1);
  assert.ok(viewport.calls.length >= callsAfterFirst);
});

test("TouchGestureHandler applies zoom on pinch touchmove", () => {
  const viewport = createMockViewport();
  const handler = new TouchGestureHandler({ viewport });

  // Start with fingers 100px apart
  handler._onTouchStart(makeTouchEvent("touchstart", [
    { identifier: 0, clientX: 100, clientY: 200 },
    { identifier: 1, clientX: 200, clientY: 200 },
  ]));
  viewport.calls.length = 0;

  // Spread to 200px apart (zoom in, scale = 2)
  const moveEvent = makeTouchEvent("touchmove", [
    { identifier: 0, clientX: 50, clientY: 200 },
    { identifier: 1, clientX: 250, clientY: 200 },
  ]);
  handler._onTouchMove(moveEvent);

  assert.equal(moveEvent.defaultPrevented, true);
  const zoomCall = viewport.calls.find((c) => c.method === "applyTouchPinchScale");
  assert.ok(zoomCall, "applyTouchPinchScale should have been called");
  assert.ok(Math.abs(zoomCall.scale - 2) < 0.001, `Expected scale ~2, got ${zoomCall.scale}`);
  assert.equal(zoomCall.clientX, 150);
  assert.equal(zoomCall.clientY, 200);
});

test("TouchGestureHandler applies orbit on midpoint drag", () => {
  const viewport = createMockViewport();
  const handler = new TouchGestureHandler({ viewport });

  // Start with fingers at known positions
  handler._onTouchStart(makeTouchEvent("touchstart", [
    { identifier: 0, clientX: 100, clientY: 100 },
    { identifier: 1, clientX: 200, clientY: 100 },
  ]));
  viewport.calls.length = 0;

  // Drag both fingers 30px right, 20px down (midpoint moves +30, +20)
  const moveEvent = makeTouchEvent("touchmove", [
    { identifier: 0, clientX: 130, clientY: 120 },
    { identifier: 1, clientX: 230, clientY: 120 },
  ]);
  handler._onTouchMove(moveEvent);

  const orbitCall = viewport.calls.find((c) => c.method === "applyTouchOrbitDelta");
  assert.ok(orbitCall, "applyTouchOrbitDelta should have been called");
  assert.ok(Math.abs(orbitCall.dx - 30) < 0.001, `Expected dx=30, got ${orbitCall.dx}`);
  assert.ok(Math.abs(orbitCall.dy - 20) < 0.001, `Expected dy=20, got ${orbitCall.dy}`);
});

test("TouchGestureHandler ends gesture when fewer than 2 touches remain", () => {
  const viewport = createMockViewport();
  const handler = new TouchGestureHandler({ viewport });

  handler._onTouchStart(makeTouchEvent("touchstart", [
    { identifier: 0, clientX: 100, clientY: 100 },
    { identifier: 1, clientX: 200, clientY: 100 },
  ]));
  viewport.calls.length = 0;

  // One finger lifts
  const endEvent = makeTouchEvent("touchend", [
    { identifier: 0, clientX: 100, clientY: 100 },
  ]);
  // Simulate browser: touches still has the remaining finger
  endEvent.touches = makeTouchList([{ identifier: 1, clientX: 200, clientY: 100 }]);
  handler._onTouchEnd(endEvent);

  assert.equal(handler._gestureActive, false);
  assert.equal(handler._lastPinchDistance, null);
  const endCall = viewport.calls.find((c) => c.method === "endTouchGesture");
  assert.ok(endCall, "endTouchGesture should have been called");
});

test("TouchGestureHandler does not intercept touchmove for single touch", () => {
  const viewport = createMockViewport();
  const handler = new TouchGestureHandler({ viewport });

  // No gesture active, single touch move
  const moveEvent = makeTouchEvent("touchmove", [
    { identifier: 0, clientX: 150, clientY: 150 },
  ]);
  handler._onTouchMove(moveEvent);

  assert.equal(moveEvent.defaultPrevented, false);
  assert.equal(viewport.calls.length, 0);
});

test("TouchGestureHandler computes correct distance between touches", () => {
  const viewport = createMockViewport();
  const handler = new TouchGestureHandler({ viewport });

  const t0 = { clientX: 0, clientY: 0 };
  const t1 = { clientX: 3, clientY: 4 };
  assert.equal(handler._touchDistance(t0, t1), 5);
});

test("TouchGestureHandler computes correct midpoint between touches", () => {
  const viewport = createMockViewport();
  const handler = new TouchGestureHandler({ viewport });

  const t0 = { clientX: 100, clientY: 200 };
  const t1 = { clientX: 300, clientY: 400 };
  const mid = handler._touchMidpoint(t0, t1);
  assert.equal(mid.clientX, 200);
  assert.equal(mid.clientY, 300);
});

test("TouchGestureHandler detach removes listeners and ends gesture", () => {
  const viewport = createMockViewport();
  const handler = new TouchGestureHandler({ viewport });

  let removedEvents = [];
  const mockElement = {
    listeners: {},
    addEventListener(type, fn, opts) {
      this.listeners[type] = fn;
    },
    removeEventListener(type, fn) {
      removedEvents.push(type);
    },
  };

  handler.attach(mockElement);

  // Manually mark gesture as active
  handler._gestureActive = true;

  handler.detach();

  assert.ok(removedEvents.includes("touchstart"), "touchstart listener should be removed");
  assert.ok(removedEvents.includes("touchmove"), "touchmove listener should be removed");
  assert.ok(removedEvents.includes("touchend"), "touchend listener should be removed");
  assert.ok(removedEvents.includes("touchcancel"), "touchcancel listener should be removed");
  assert.equal(handler._gestureActive, false);
  assert.equal(handler._element, null);
});
