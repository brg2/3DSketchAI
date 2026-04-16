import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Viewport } from "../src/view/viewport.js";

function createViewportHarness({ focusPoint = new THREE.Vector3(0, 0, 0) } = {}) {
  const camera = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 2000);
  camera.position.set(0, 4, 8);
  camera.lookAt(focusPoint);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const focusCalls = [];
  const viewport = Object.create(Viewport.prototype);
  viewport.camera = camera;
  viewport.controls = {
    target: focusPoint.clone(),
    rotateSpeed: 1,
    minDistance: 0.1,
    maxDistance: 2000,
    enabled: true,
    update: () => undefined,
  };
  viewport.renderer = {
    domElement: {
      clientHeight: 600,
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
      }),
    },
  };
  viewport._cursorOrbit = null;
  viewport._cursorPan = null;
  viewport._cursorPanOrbit = null;
  viewport._zoomTargetDistance = null;
  viewport._zoomFocusPoint = null;
  viewport._pickFocusPointAtClient = (clientPoint) => {
    focusCalls.push(clientPoint);
    return focusPoint.clone();
  };
  viewport._pointOnHorizontalPlaneAtClient = () => null;
  viewport._pointAtClientDepth = () => null;

  return { viewport, focusCalls, focusPoint };
}

function createTouchPointer({ pointerId, clientX, clientY }) {
  return {
    pointerId,
    pointerType: "touch",
    clientX,
    clientY,
    pageX: clientX,
    pageY: clientY,
    preventDefault: () => undefined,
  };
}

function withMockWindow(callback) {
  const originalWindow = globalThis.window;
  globalThis.window = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  try {
    return callback();
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
}

function screenPointOf(camera, point) {
  const projected = point.clone().project(camera);
  return {
    x: ((projected.x + 1) / 2) * 800,
    y: ((1 - projected.y) / 2) * 600,
  };
}

function pointAtScreenDistance(camera, { x, y }, distance) {
  const rayDirection = new THREE.Vector3(
    (x / 800) * 2 - 1,
    -(y / 600) * 2 + 1,
    0.5,
  )
    .applyMatrix4(camera.projectionMatrixInverse)
    .normalize()
    .applyQuaternion(camera.quaternion)
    .normalize();
  return camera.position.clone().add(rayDirection.multiplyScalar(distance));
}

function cameraAlignmentWithPoint(camera, point) {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const toPoint = point.clone().sub(camera.position).normalize();
  return forward.dot(toPoint);
}

test("left-right chord orbits and dollies toward the fixed drag-start point", () => {
  const { viewport, focusCalls, focusPoint } = createViewportHarness();
  const startScreen = { x: 400, y: 300 };

  assert.equal(viewport._startCursorPanOrbitState({ clientX: startScreen.x, clientY: startScreen.y }), true);
  const startDistance = viewport.camera.position.distanceTo(focusPoint);

  viewport._updateCursorPanOrbit({ clientX: 560, clientY: 360 });

  const endDistance = viewport.camera.position.distanceTo(focusPoint);
  const projectedFocus = screenPointOf(viewport.camera, focusPoint);

  assert.equal(focusCalls.length, 1, "drag updates must not pick a new zoom target from the current cursor");
  assert.ok(endDistance < startDistance, "chord drag should dolly closer to the drag-start point");
  assert.ok(Math.abs(projectedFocus.x - startScreen.x) < 0.001);
  assert.ok(Math.abs(projectedFocus.y - startScreen.y) < 0.001);
  assert.ok(cameraAlignmentWithPoint(viewport.camera, focusPoint) > 0.999999);
  assert.ok(Math.abs(viewport._cursorPanOrbit.currentTargetDistance - endDistance) < 0.001);
});

test("left-right chord keeps an off-center drag-start point locked to its original screen position", () => {
  const { viewport, focusCalls } = createViewportHarness();
  const startScreen = { x: 520, y: 240 };
  const focusPoint = pointAtScreenDistance(viewport.camera, startScreen, 9);
  viewport._pickFocusPointAtClient = (clientPoint) => {
    focusCalls.push(clientPoint);
    return focusPoint.clone();
  };

  assert.equal(viewport._startCursorPanOrbitState({ clientX: startScreen.x, clientY: startScreen.y }), true);
  const startDistance = viewport.camera.position.distanceTo(focusPoint);

  viewport._updateCursorPanOrbit({ clientX: 650, clientY: 315 });

  const endDistance = viewport.camera.position.distanceTo(focusPoint);
  const projectedFocus = screenPointOf(viewport.camera, focusPoint);

  assert.equal(focusCalls.length, 1, "drag updates must not pick a new zoom target from the current cursor");
  assert.ok(endDistance < startDistance, "chord drag should dolly closer to the drag-start point");
  assert.ok(Math.abs(projectedFocus.x - startScreen.x) < 0.001);
  assert.ok(Math.abs(projectedFocus.y - startScreen.y) < 0.001);
});

test("left-right chord started during ground pan uses the current ground point under the cursor", () => {
  withMockWindow(() => {
    const panAnchor = new THREE.Vector3(2, 0, -3);
    const currentGroundPoint = new THREE.Vector3(5, 0, -6);
    const currentPick = new THREE.Vector3(-8, 0, 5);
    const { viewport, focusCalls } = createViewportHarness({ focusPoint: currentPick });
    viewport._pointOnPlaneAtClient = () => currentGroundPoint.clone();
    viewport._cursorNavigation = {
      mode: "pan",
      allowShiftToggle: true,
    };
    viewport._cursorPan = {
      anchorPoint: panAnchor.clone(),
      panPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      velocity: new THREE.Vector3(),
      dragging: true,
    };

    const started = viewport.beginCursorPanOrbit({ clientX: 520, clientY: 340, pointerId: 1 });

    assert.equal(started, true);
    assert.equal(focusCalls.length, 0, "transitioning from pan must not pick a new chord start point");
    assert.ok(viewport._cursorPanOrbit.pivot.distanceTo(currentGroundPoint) < 1e-8);
    assert.ok(viewport._cursorPanOrbit.zoomPivot.distanceTo(currentGroundPoint) < 1e-8);
    assert.ok(viewport._cursorPanOrbit.pivot.distanceTo(panAnchor) > 1);
  });
});

test("left-right chord started during orbit keeps the original orbit pivot", () => {
  withMockWindow(() => {
    const orbitPivot = new THREE.Vector3(1, 0, -2);
    const currentPick = new THREE.Vector3(-7, 0, 4);
    const { viewport, focusCalls } = createViewportHarness({ focusPoint: currentPick });
    viewport._cursorNavigation = {
      mode: "orbit",
      allowShiftToggle: true,
    };
    viewport._cursorOrbit = {
      pivot: orbitPivot.clone(),
      startTargetDistance: 8,
    };

    const started = viewport.beginCursorPanOrbit({ clientX: 540, clientY: 350, pointerId: 2 });

    assert.equal(started, true);
    assert.equal(focusCalls.length, 0, "transitioning from orbit must not pick a new chord start point");
    assert.ok(viewport._cursorPanOrbit.pivot.distanceTo(orbitPivot) < 1e-8);
    assert.ok(viewport._cursorPanOrbit.zoomPivot.distanceTo(orbitPivot) < 1e-8);
    assert.ok(viewport._cursorPanOrbit.pivot.distanceTo(currentPick) > 1);
  });
});

test("native two-finger navigation keeps damped orbit and zoom inertia after release", () => {
  withMockWindow(() => {
    const { viewport } = createViewportHarness();
    viewport.pointOnGroundSurface = () => null;
    viewport._pointOnHorizontalPlaneAtClient = () => null;

    const started = viewport.beginNativeTouchNavigation([
      createTouchPointer({ pointerId: 1, clientX: 300, clientY: 260 }),
      createTouchPointer({ pointerId: 2, clientX: 500, clientY: 260 }),
    ]);
    assert.equal(started, true);

    viewport._handleNativeTouchPointerMove(createTouchPointer({ pointerId: 1, clientX: 270, clientY: 250 }));
    viewport._handleNativeTouchPointerMove(createTouchPointer({ pointerId: 2, clientX: 560, clientY: 285 }));
    const positionAtRelease = viewport.camera.position.clone();
    const yawVelocityAtRelease = viewport._nativeTouchNavigation.velocityYaw;
    const zoomVelocityAtRelease = viewport._nativeTouchNavigation.velocityLogZoom;

    viewport._handleNativeTouchPointerEnd(createTouchPointer({ pointerId: 2, clientX: 560, clientY: 285 }));

    assert.equal(viewport._nativeTouchNavigation.dragging, false);
    assert.notEqual(viewport._nativeTouchNavigation, null);
    viewport._applyNativeTouchNavigationStep();

    assert.ok(Math.abs(yawVelocityAtRelease) > 0.0005);
    assert.ok(Math.abs(zoomVelocityAtRelease) > 0.0005);
    assert.ok(viewport.camera.position.distanceTo(positionAtRelease) > 0.0001);
    assert.ok(Math.abs(viewport._nativeTouchNavigation.velocityYaw) < Math.abs(yawVelocityAtRelease));
    assert.ok(Math.abs(viewport._nativeTouchNavigation.velocityLogZoom) < Math.abs(zoomVelocityAtRelease));
  });
});
