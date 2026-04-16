import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  GROUND_THEMES,
  createGroundThemeGroup,
  normalizeGroundTheme,
  normalizeTerrainVariation,
} from "../environment/ground-theme.js";

export class Viewport {
  constructor({ canvas }) {
    this.canvas = canvas;
    this._viewportWidth = 0;
    this._viewportHeight = 0;
    this._zoomTargetDistance = null;
    this._zoomFocusPoint = null;
    this._zoomRaycaster = new THREE.Raycaster();
    this._zoomPointer = new THREE.Vector2();
    this._cursorNavigation = null;
    this._cursorOrbit = null;
    this._cursorPan = null;
    this.gridHelper = null;
    this.groundThemeGroup = null;
    this.groundTheme = GROUND_THEMES.FOREST;
    this.terrainVariation = 1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xeef3f8);
    this.scene.fog = new THREE.Fog(0xeef3f8, 38, 160);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    this.camera.position.set(6, 6, 8);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.panSpeed = 2.75;
    // OrbitControls wheel zoom is discrete; we apply our own eased zoom.
    this.controls.enableZoom = false;
    this._attachSmoothZoomHandlers();

    this._setupLights();
    this._setupGround();
    this.resize();

    window.addEventListener("resize", () => this.resize());
  }

  _setupLights() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0xdbe7f4, 0.78);
    this.scene.add(hemi);

    const ambient = new THREE.AmbientLight(0xffffff, 0.22);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(18, 28, 14);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -36;
    key.shadow.camera.right = 36;
    key.shadow.camera.top = 36;
    key.shadow.camera.bottom = -36;
    key.shadow.normalBias = 0.015;
    this.scene.add(key);
  }

  _setupGround() {
    this.gridHelper = new THREE.GridHelper(100, 100, 0x90a4ba, 0xc9d5e1);
    this.scene.add(this.gridHelper);

    this.setGroundTheme({ theme: GROUND_THEMES.FOREST, terrainVariation: 1 });
    this.setGridVisible(false);
  }

  setGroundTheme({ theme = this.groundTheme, terrainVariation = this.terrainVariation } = {}) {
    this.groundTheme = normalizeGroundTheme(theme);
    this.terrainVariation = normalizeTerrainVariation(terrainVariation);

    if (this.groundThemeGroup) {
      this.scene.remove(this.groundThemeGroup);
      disposeObject3D(this.groundThemeGroup);
    }

    this.groundThemeGroup = createGroundThemeGroup({
      theme: this.groundTheme,
      terrainVariation: this.terrainVariation,
    });
    this.scene.add(this.groundThemeGroup);
  }

  getGroundThemeState() {
    return {
      theme: this.groundTheme,
      terrainVariation: this.terrainVariation,
    };
  }

  setGridVisible(visible) {
    if (!this.gridHelper) {
      return;
    }
    this.gridHelper.visible = Boolean(visible);
  }

  isGridVisible() {
    return Boolean(this.gridHelper?.visible);
  }

  pointOnGroundSurface({ clientX, clientY } = {}) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    this._zoomPointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._zoomRaycaster.setFromCamera(this._zoomPointer, this.camera);

    const groundSurfaces = [];
    this.groundThemeGroup?.traverse((child) => {
      if (child.visible !== false && child.userData?.groundSurface === true) {
        groundSurfaces.push(child);
      }
    });

    const hit = this._zoomRaycaster.intersectObjects(groundSurfaces, false)[0] ?? null;
    return hit?.point?.clone?.() ?? null;
  }

  zoomToObjectsExtents(objects) {
    const bounds = new THREE.Box3();
    const objectList = Array.isArray(objects) ? objects : [];
    for (const object of objectList) {
      if (!object || object.visible === false || object.userData?.environment === true) {
        continue;
      }
      bounds.expandByObject(object);
    }

    if (bounds.isEmpty()) {
      return false;
    }

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    bounds.getCenter(center);
    bounds.getSize(size);

    const radius = Math.max(size.length() * 0.5, 0.75);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fitHeightDistance = radius / Math.sin(fov / 2);
    const fitWidthDistance = fitHeightDistance / Math.max(this.camera.aspect, 0.001);
    const defaultViewDistance = Math.hypot(6, 6, 8);
    const distance = Math.max(fitHeightDistance, fitWidthDistance, defaultViewDistance);

    const viewDirection = this.camera.position.clone().sub(this.controls.target);
    if (viewDirection.lengthSq() < 1e-8) {
      viewDirection.set(1, 1, 1);
    }
    viewDirection.normalize();

    this.controls.target.copy(center);
    this.camera.position.copy(center).add(viewDirection.multiplyScalar(distance));
    this._zoomTargetDistance = null;
    this._zoomFocusPoint = null;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    return true;
  }

  beginCursorNavigation({
    clientX,
    clientY,
    orbitMode = false,
    allowShiftOrbit = true,
    baseMode = "pan",
    shiftMode = "orbit",
  } = {}) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return false;
    }

    const normalizedBaseMode = baseMode === "orbit" ? "orbit" : "pan";
    const normalizedShiftMode = shiftMode === "pan" ? "pan" : "orbit";

    this.cancelCursorNavigation();
    this._cursorNavigation = {
      mode: null,
      allowShiftToggle: Boolean(allowShiftOrbit),
      baseMode: normalizedBaseMode,
      shiftMode: normalizedShiftMode,
      lastClientX: clientX,
      lastClientY: clientY,
      move: null,
      keydown: null,
      keyup: null,
      end: null,
    };

    const initialMode = orbitMode ? "orbit" : "pan";
    if (!this._setCursorNavigationMode(initialMode, { clientX, clientY })) {
      this._cursorNavigation = null;
      return false;
    }

    const move = (event) => {
      event.preventDefault();
      this._updateCursorNavigation(event);
    };
    const end = () => {
      this._releaseCursorNavigation();
    };
    const keydown = (event) => {
      if (event.key === "Shift") {
        this._syncCursorNavigationMode(event.shiftKey);
      }
    };
    const keyup = (event) => {
      if (event.key === "Shift") {
        this._syncCursorNavigationMode(event.shiftKey);
      }
    };

    this._cursorNavigation.move = move;
    this._cursorNavigation.end = end;
    this._cursorNavigation.keydown = keydown;
    this._cursorNavigation.keyup = keyup;

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", end, { once: true });
    if (this._cursorNavigation.allowShiftToggle) {
      window.addEventListener("keydown", keydown);
      window.addEventListener("keyup", keyup);
    }
    return true;
  }

  beginCursorOrbit({ clientX, clientY } = {}) {
    return this.beginCursorNavigation({ clientX, clientY, orbitMode: true, allowShiftOrbit: false });
  }

  cancelCursorOrbit() {
    if (!this._cursorOrbit) {
      return false;
    }

    return this.cancelCursorNavigation();
  }

  beginCursorPan({ clientX, clientY } = {}) {
    return this.beginCursorNavigation({ clientX, clientY, orbitMode: false, allowShiftOrbit: false });
  }

  cancelCursorPan() {
    if (!this._cursorPan) {
      return false;
    }

    return this.cancelCursorNavigation();
  }

  cancelCursorNavigation() {
    if (!this._cursorNavigation && !this._cursorOrbit && !this._cursorPan) {
      return false;
    }

    this._removeCursorNavigationListeners();
    if (this._cursorOrbit) {
      this._finishCursorOrbitState({ updateControls: false });
    } else if (this._cursorPan) {
      this._syncControlsTargetToCameraForward();
    }
    this._cursorNavigation = null;
    this._cursorOrbit = null;
    this._cursorPan = null;
    this.controls.enabled = true;
    this.controls.update();
    return true;
  }

  _setCursorNavigationMode(mode, { clientX, clientY } = {}) {
    const navigation = this._cursorNavigation;
    if (!navigation || navigation.mode === mode) {
      return true;
    }

    const previousMode = navigation.mode;
    if (previousMode === "orbit") {
      this._finishCursorOrbitState({ updateControls: false });
    } else if (previousMode === "pan") {
      this._cursorPan = null;
    }

    const started = mode === "orbit"
      ? this._startCursorOrbitState({ clientX, clientY })
      : this._startCursorPanState({ clientX, clientY });
    if (!started) {
      if (previousMode === "orbit") {
        this._startCursorOrbitState({ clientX, clientY });
      } else if (previousMode === "pan") {
        this._startCursorPanState({ clientX, clientY });
      }
      return false;
    }

    navigation.mode = mode;
    return true;
  }

  _updateCursorNavigation({ clientX, clientY, shiftKey = false } = {}) {
    const navigation = this._cursorNavigation;
    if (!navigation || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return;
    }

    navigation.lastClientX = clientX;
    navigation.lastClientY = clientY;
    if (navigation.allowShiftToggle) {
      const nextMode = shiftKey ? navigation.shiftMode : navigation.baseMode;
      this._setCursorNavigationMode(nextMode, { clientX, clientY });
    }

    if (navigation.mode === "orbit") {
      this._updateCursorOrbit({ clientX, clientY });
    } else if (navigation.mode === "pan") {
      this._updateCursorPan({ clientX, clientY });
    }
  }

  _syncCursorNavigationMode(shiftKey = false) {
    const navigation = this._cursorNavigation;
    if (!navigation?.allowShiftToggle) {
      return;
    }

    const nextMode = shiftKey ? navigation.shiftMode : navigation.baseMode;
    this._setCursorNavigationMode(nextMode, {
      clientX: navigation.lastClientX,
      clientY: navigation.lastClientY,
    });
  }

  _releaseCursorNavigation() {
    const navigation = this._cursorNavigation;
    if (!navigation) {
      return;
    }

    this._removeCursorNavigationListeners();
    this._cursorNavigation = null;
    if (navigation.mode === "orbit") {
      this._releaseCursorOrbit();
    } else if (navigation.mode === "pan") {
      this._releaseCursorPan();
    }
  }

  _removeCursorNavigationListeners() {
    const navigation = this._cursorNavigation;
    if (!navigation) {
      return;
    }

    if (navigation.move) {
      window.removeEventListener("pointermove", navigation.move);
    }
    if (navigation.end) {
      window.removeEventListener("pointerup", navigation.end);
      window.removeEventListener("pointercancel", navigation.end);
    }
    if (navigation.allowShiftToggle) {
      if (navigation.keydown) {
        window.removeEventListener("keydown", navigation.keydown);
      }
      if (navigation.keyup) {
        window.removeEventListener("keyup", navigation.keyup);
      }
    }
  }

  _startCursorOrbitState({ clientX, clientY } = {}) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return false;
    }

    const offset = this.camera.position.clone().sub(this.controls.target);
    const currentDistance = offset.length();
    if (!Number.isFinite(currentDistance) || currentDistance <= 1e-6) {
      return false;
    }

    const focusPoint = this._pickFocusPointAtClient({ clientX, clientY }, currentDistance);
    if (!focusPoint) {
      return false;
    }

    this._cursorPan = null;
    this._cursorOrbit = {
      pivot: focusPoint,
      startX: clientX,
      startY: clientY,
      startPosition: this.camera.position.clone(),
      startQuaternion: this.camera.quaternion.clone(),
      startTargetDistance: Math.max(currentDistance, 0.1),
      targetYaw: 0,
      targetPitch: 0,
      currentYaw: 0,
      currentPitch: 0,
      velocityYaw: 0,
      velocityPitch: 0,
      dragging: true,
    };
    this.controls.enabled = false;
    this._zoomTargetDistance = null;
    this._zoomFocusPoint = null;
    return true;
  }

  _startCursorPanState({ clientX, clientY } = {}) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return false;
    }

    const offset = this.camera.position.clone().sub(this.controls.target);
    const currentDistance = offset.length();
    if (!Number.isFinite(currentDistance) || currentDistance <= 1e-6) {
      return false;
    }

    const anchorPoint = this._pickFocusPointAtClient({ clientX, clientY }, currentDistance)
      ?? this._pointOnHorizontalPlaneAtClient({ clientX, clientY }, this.controls.target.y)
      ?? this._pointAtClientDepth({ clientX, clientY }, currentDistance);
    if (!anchorPoint || !Number.isFinite(anchorPoint.y)) {
      return false;
    }

    const panPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -anchorPoint.y);
    const planeAnchor = this._pointOnPlaneAtClient({ clientX, clientY }, panPlane) ?? anchorPoint;
    this._cursorOrbit = null;
    this._cursorPan = {
      anchorPoint: planeAnchor,
      panPlane,
      velocity: new THREE.Vector3(),
      dragging: true,
    };
    this.controls.enabled = false;
    this._zoomTargetDistance = null;
    this._zoomFocusPoint = null;
    return true;
  }

  _updateCursorPan({ clientX, clientY } = {}) {
    const pan = this._cursorPan;
    if (!pan || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return;
    }

    const pointAtCursor = this._pointOnPlaneAtClient({ clientX, clientY }, pan.panPlane);
    if (!pointAtCursor) {
      return;
    }

    const delta = pan.anchorPoint.clone().sub(pointAtCursor);
    if (delta.lengthSq() < 1e-12) {
      return;
    }

    this.camera.position.add(delta);
    this.controls.target.add(delta);
    pan.velocity.copy(delta);
    this.camera.updateMatrixWorld();
  }

  _releaseCursorPan() {
    if (!this._cursorPan) {
      return;
    }

    this._cursorPan.dragging = false;
    if (this._cursorPan.velocity.lengthSq() < 1e-10) {
      this._endCursorPan();
    }
  }

  _applyCursorPanStep() {
    const pan = this._cursorPan;
    if (!pan || pan.dragging) {
      return;
    }

    this.camera.position.add(pan.velocity);
    this.controls.target.add(pan.velocity);
    this.camera.updateMatrixWorld();

    pan.velocity.multiplyScalar(0.88);
    if (pan.velocity.lengthSq() < 1e-8) {
      this._endCursorPan();
    }
  }

  _endCursorPan() {
    if (!this._cursorPan) {
      return;
    }

    this._cursorPan = null;
    this._syncControlsTargetToCameraForward();
    this.controls.enabled = true;
    this.controls.update();
  }

  _updateCursorOrbit({ clientX, clientY } = {}) {
    const orbit = this._cursorOrbit;
    if (!orbit || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return;
    }

    const element = this.renderer.domElement;
    const height = Math.max(element.clientHeight, 1);
    const rotateSpeed = this.controls.rotateSpeed ?? 1;
    const yaw = ((clientX - orbit.startX) * rotateSpeed * Math.PI * 2) / height;
    const pitch = ((clientY - orbit.startY) * rotateSpeed * Math.PI * 2) / height;

    orbit.velocityYaw = yaw - orbit.targetYaw;
    orbit.velocityPitch = pitch - orbit.targetPitch;
    orbit.targetYaw = yaw;
    orbit.targetPitch = pitch;
  }

  _applyCursorOrbitStep() {
    const orbit = this._cursorOrbit;
    if (!orbit) {
      return;
    }

    if (!orbit.dragging) {
      orbit.targetYaw += orbit.velocityYaw;
      orbit.targetPitch += orbit.velocityPitch;
      orbit.velocityYaw *= 0.88;
      orbit.velocityPitch *= 0.88;
    }

    const damping = orbit.dragging ? 0.28 : 0.16;
    orbit.currentYaw += (orbit.targetYaw - orbit.currentYaw) * damping;
    orbit.currentPitch += (orbit.targetPitch - orbit.currentPitch) * damping;

    this._applyCursorOrbitAngles(orbit, orbit.currentYaw, orbit.currentPitch);

    const yawRemaining = Math.abs(orbit.targetYaw - orbit.currentYaw);
    const pitchRemaining = Math.abs(orbit.targetPitch - orbit.currentPitch);
    const yawVelocity = Math.abs(orbit.velocityYaw);
    const pitchVelocity = Math.abs(orbit.velocityPitch);
    if (!orbit.dragging && yawRemaining < 0.0005 && pitchRemaining < 0.0005 && yawVelocity < 0.0005 && pitchVelocity < 0.0005) {
      this._endCursorOrbit();
    }
  }

  _applyCursorOrbitAngles(orbit, yaw, pitch) {
    const startOffset = orbit.startPosition.clone().sub(orbit.pivot);
    const worldUp = this.camera.up.clone().normalize();
    const yawRotation = new THREE.Quaternion().setFromAxisAngle(worldUp, -yaw);
    const startRight = new THREE.Vector3(1, 0, 0).applyQuaternion(orbit.startQuaternion).normalize();
    const pitchAxis = startRight.applyQuaternion(yawRotation).normalize();
    const pitchRotation = new THREE.Quaternion().setFromAxisAngle(pitchAxis, -pitch);
    const rotation = pitchRotation.multiply(yawRotation);

    this.camera.position.copy(orbit.pivot).add(startOffset.applyQuaternion(rotation));
    this.camera.quaternion.copy(orbit.startQuaternion).premultiply(rotation);
    this.camera.updateMatrixWorld();
  }

  _releaseCursorOrbit() {
    if (!this._cursorOrbit) {
      return;
    }
    this._cursorOrbit.dragging = false;
  }

  _endCursorOrbit() {
    this._finishCursorOrbitState({ updateControls: false });
    this.controls.enabled = true;
    this.controls.update();
  }

  _finishCursorOrbitState({ updateControls = true } = {}) {
    const orbit = this._cursorOrbit;
    this._cursorOrbit = null;

    this._syncControlsTargetToCameraForward(orbit?.startTargetDistance);
    if (updateControls) {
      this.controls.update();
    }
  }

  _syncControlsTargetToCameraForward(distance = null) {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    if (forward.lengthSq() < 1e-8) {
      return;
    }

    const targetDistance = Number.isFinite(distance)
      ? distance
      : this.camera.position.distanceTo(this.controls.target);
    this.controls.target.copy(this.camera.position).add(forward.multiplyScalar(Math.max(targetDistance, 0.1)));
  }

  _attachSmoothZoomHandlers() {
    this.renderer.domElement.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this._queueSmoothZoom(event);
      },
      { passive: false },
    );
  }

  _queueSmoothZoom(event) {
    const deltaMode = event.deltaMode ?? 0;
    const unitScale = deltaMode === 1 ? 16 : deltaMode === 2 ? window.innerHeight : 1;
    const normalizedDeltaY = event.deltaY * unitScale;
    if (!Number.isFinite(normalizedDeltaY) || normalizedDeltaY === 0) {
      return;
    }

    const offset = this.camera.position.clone().sub(this.controls.target);
    const currentDistance = offset.length();
    if (!Number.isFinite(currentDistance) || currentDistance <= 1e-6) {
      return;
    }

    const minDistance = Math.max(0.1, this.controls.minDistance || 0.1);
    const maxDistance = this.controls.maxDistance || 1e6;
    if (!Number.isFinite(this._zoomTargetDistance)) {
      this._zoomTargetDistance = currentDistance;
    }

    this._zoomFocusPoint = this._pickFocusPointAtClient(event, currentDistance);
    const wheelSensitivity = 0.0012;
    const factor = Math.exp(normalizedDeltaY * wheelSensitivity);
    this._zoomTargetDistance = THREE.MathUtils.clamp(this._zoomTargetDistance * factor, minDistance, maxDistance);
  }

  _applySmoothZoomStep() {
    if (!Number.isFinite(this._zoomTargetDistance)) {
      return;
    }

    const offset = this.camera.position.clone().sub(this.controls.target);
    const currentDistance = offset.length();
    if (!Number.isFinite(currentDistance) || currentDistance <= 1e-6) {
      this._zoomTargetDistance = null;
      return;
    }

    const minDistance = Math.max(0.1, this.controls.minDistance || 0.1);
    const maxDistance = this.controls.maxDistance || 1e6;
    const targetDistance = THREE.MathUtils.clamp(this._zoomTargetDistance, minDistance, maxDistance);
    const lerpAlpha = 0.18;
    const nextDistance = THREE.MathUtils.lerp(currentDistance, targetDistance, lerpAlpha);

    if (Math.abs(nextDistance - targetDistance) < 1e-3) {
      this._applyZoomDistance(currentDistance, targetDistance, offset);
      this._zoomTargetDistance = null;
      this._zoomFocusPoint = null;
      return;
    }

    this._applyZoomDistance(currentDistance, nextDistance, offset);
  }

  _applyZoomDistance(currentDistance, nextDistance, offset) {
    const focusPoint = this._zoomFocusPoint;
    if (focusPoint) {
      const scale = nextDistance / currentDistance;
      this.camera.position.sub(focusPoint).multiplyScalar(scale).add(focusPoint);
      this.controls.target.sub(focusPoint).multiplyScalar(scale).add(focusPoint);
      return;
    }

    offset.setLength(nextDistance);
    this.camera.position.copy(this.controls.target).add(offset);
  }

  _pickFocusPointAtClient({ clientX, clientY } = {}, currentDistance) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return null;
    }

    if (!this._setRaycasterFromClient({ clientX, clientY })) {
      return null;
    }

    const hits = this._zoomRaycaster.intersectObjects(this.scene.children, true);
    const nearestHit = hits.find((hit) => hit.object?.visible !== false && hit.object?.isMesh);
    if (!nearestHit) {
      return null;
    }

    const maxFocusDistance = Math.max(80, currentDistance * 8);
    if (!Number.isFinite(nearestHit.distance) || nearestHit.distance > maxFocusDistance) {
      return null;
    }

    return nearestHit.point.clone();
  }

  _pointAtClientDepth({ clientX, clientY } = {}, distance) {
    if (!Number.isFinite(distance) || distance <= 0 || !this._setRaycasterFromClient({ clientX, clientY })) {
      return null;
    }

    return this._zoomRaycaster.ray.at(distance, new THREE.Vector3());
  }

  _pointOnPlaneAtClient({ clientX, clientY } = {}, plane) {
    if (!plane || !this._setRaycasterFromClient({ clientX, clientY })) {
      return null;
    }

    const point = new THREE.Vector3();
    return this._zoomRaycaster.ray.intersectPlane(plane, point) ? point : null;
  }

  _pointOnHorizontalPlaneAtClient({ clientX, clientY } = {}, y = 0) {
    const planeY = Number.isFinite(y) ? y : 0;
    return this._pointOnPlaneAtClient(
      { clientX, clientY },
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY),
    );
  }

  _setRaycasterFromClient({ clientX, clientY } = {}) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return false;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    this._zoomPointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._zoomRaycaster.setFromCamera(this._zoomPointer, this.camera);
    return true;
  }

  resize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width <= 0 || height <= 0) {
      return false;
    }

    if (width === this._viewportWidth && height === this._viewportHeight) {
      return false;
    }

    this._viewportWidth = width;
    this._viewportHeight = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    return true;
  }

  frame() {
    this.resize();
    if (this._cursorOrbit) {
      this._applyCursorOrbitStep();
    } else if (this._cursorPan) {
      this._applyCursorPanStep();
    } else {
      this._applySmoothZoomStep();
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
  }
}

function disposeObject3D(object) {
  object.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
    }
    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        material.dispose();
      }
    } else if (child.material) {
      child.material.dispose();
    }
  });
}
