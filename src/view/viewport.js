import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  GROUND_THEMES,
  createGroundThemeGroup,
  normalizeGroundTheme,
  normalizeElevationVariation,
  normalizeTerrainDensity,
  normalizeTerrainSeed,
  normalizeTerrainVariation,
} from "../environment/ground-theme.js";
import { SKY_THEMES, normalizeSkyColor, normalizeSkyTheme, skyThemePreset } from "../theme/sky-theme.js";

export const ZOOM_EXTENTS_ANIMATION_MS = 250;

export class Viewport {
  constructor({ canvas, onFrameNeeded = null }) {
    this.canvas = canvas;
    this.onFrameNeeded = typeof onFrameNeeded === "function" ? onFrameNeeded : null;
    this._viewportWidth = 0;
    this._viewportHeight = 0;
    this._cameraTransition = null;
    this._zoomTargetDistance = null;
    this._zoomFocusPoint = null;
    this._zoomRaycaster = new THREE.Raycaster();
    this._zoomPointer = new THREE.Vector2();
    this._cursorNavigation = null;
    this._nativeTouchNavigation = null;
    this._cursorPanOrbit = null;
    this._cursorOrbit = null;
    this._cursorPan = null;
    this._touchGestureActive = false;
    this._touchGestureInertia = null;
    this.gridHelper = null;
    this.groundThemeGroup = null;
    this.groundTheme = GROUND_THEMES.FOREST;
    this.elevationVariation = 1;
    this.terrainVariation = 0.5;
    this.terrainDensity = 0.5;
    this.terrainSeed = 0;
    this.groundEffectsVisible = true;
    this.skyTheme = normalizeSkyTheme(null);
    this._skyMotionYawDeg = null;
    this._skyMotionPitchDeg = null;
    this._skyMotionHorizonPct = null;
    this._skyMotionLightXPct = null;
    this._skyMotionLightYPct = null;
    this._skyMotionDir = new THREE.Vector3();
    this._skyCssTarget = canvas?.parentElement ?? null;
    if (this._skyCssTarget instanceof Element) {
      // Provide safe defaults; values are updated each frame.
      this._skyCssTarget.style.setProperty("--sky-horizon", "58%");
      this._skyCssTarget.style.setProperty("--sky-light-x", "50%");
      this._skyCssTarget.style.setProperty("--sky-light-y", "38%");
    }

    this.scene = new THREE.Scene();
    // Sky is rendered via CSS behind the canvas. Keep the renderer transparent.
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(0xeef3f8, 38, 160);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    this.camera.position.set(6, 6, 8);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.panSpeed = 2.75;
    this.controls.enableZoom = true;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    // OrbitControls wheel zoom is discrete; we intercept wheel and apply our own eased zoom.
    this._attachSmoothZoomHandlers();

    this._setupLights();
    this._setupGround();
    this.setSkyTheme(this.skyTheme);
    this.resize();

    window.addEventListener("resize", () => {
      if (this.resize()) {
        this._requestFrame();
      }
    });
  }

  _requestFrame() {
    this.onFrameNeeded?.();
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

    this.lights = { hemi, ambient, key };
  }

  setSkyTheme(theme, { solidColor = null } = {}) {
    const normalized = normalizeSkyTheme(theme);
    const normalizedSolidColor = normalized === SKY_THEMES.SOLID_COLOR ? normalizeSkyColor(solidColor) : null;
    if (normalized === this.skyTheme && this._skyThemeApplied && normalizedSolidColor === this.skySolidColor) {
      return;
    }
    this.skyTheme = normalized;
    this.skySolidColor = normalizedSolidColor;
    const preset = skyThemePreset(normalized, { solidColor: normalizedSolidColor ?? undefined });

    if (this.scene?.fog) {
      this.scene.fog.color.setHex(preset.fog.color);
      this.scene.fog.near = preset.fog.near;
      this.scene.fog.far = preset.fog.far;
    }

    if (this.gridHelper?.material) {
      const materials = Array.isArray(this.gridHelper.material) ? this.gridHelper.material : [this.gridHelper.material];
      if (materials[0]?.color) {
        materials[0].color.setHex(preset.grid.major);
      }
      if (materials[1]?.color) {
        materials[1].color.setHex(preset.grid.minor);
      } else if (materials[0]?.color) {
        materials[0].color.setHex(preset.grid.minor);
      }
    }

    if (this.lights) {
      this.lights.hemi.color.setHex(preset.lights.hemiSky);
      this.lights.hemi.groundColor.setHex(preset.lights.hemiGround);
      this.lights.hemi.intensity = preset.lights.hemiIntensity;

      this.lights.ambient.color.setHex(preset.lights.ambient);
      this.lights.ambient.intensity = preset.lights.ambientIntensity;

      this.lights.key.color.setHex(preset.lights.key);
      this.lights.key.intensity = preset.lights.keyIntensity;
      const pos = preset.lights.keyPos;
      if (Array.isArray(pos) && pos.length === 3) {
        this.lights.key.position.set(pos[0], pos[1], pos[2]);
      }
    }

    if (this._skyCssTarget instanceof Element) {
      if (normalizedSolidColor) {
        this._skyCssTarget.style.setProperty("--sky-solid", normalizedSolidColor);
      } else {
        this._skyCssTarget.style.removeProperty("--sky-solid");
      }
    }

    this._skyThemeApplied = true;
    this._requestFrame();
  }

  _setupGround() {
    this.gridHelper = new THREE.GridHelper(100, 100, 0x90a4ba, 0xc9d5e1);
    this.scene.add(this.gridHelper);

    this.setGroundTheme({
      theme: GROUND_THEMES.FOREST,
      elevationVariation: 1,
      terrainVariation: 0.5,
      terrainDensity: 0.5,
      terrainSeed: 0,
    });
    this.setGridVisible(false);
  }

  setGroundTheme({
    theme = this.groundTheme,
    elevationVariation = this.elevationVariation,
    terrainVariation = this.terrainVariation,
    terrainDensity = this.terrainDensity,
    terrainSeed = this.terrainSeed,
  } = {}) {
    this.groundTheme = normalizeGroundTheme(theme);
    this.elevationVariation = normalizeElevationVariation(elevationVariation);
    this.terrainVariation = normalizeTerrainVariation(terrainVariation);
    this.terrainDensity = normalizeTerrainDensity(terrainDensity);
    this.terrainSeed = normalizeTerrainSeed(terrainSeed);

    if (this.groundThemeGroup) {
      this.scene.remove(this.groundThemeGroup);
      disposeObject3D(this.groundThemeGroup);
    }

    this.groundThemeGroup = createGroundThemeGroup({
      theme: this.groundTheme,
      elevationVariation: this.elevationVariation,
      terrainVariation: this.terrainVariation,
      terrainDensity: this.terrainDensity,
      terrainSeed: this.terrainSeed,
    });
    this.groundThemeGroup.visible = this.groundEffectsVisible;
    this.scene.add(this.groundThemeGroup);
    this._requestFrame();
  }

  getGroundThemeState() {
    return {
      theme: this.groundTheme,
      elevationVariation: this.elevationVariation,
      terrainVariation: this.terrainVariation,
      terrainDensity: this.terrainDensity,
      terrainSeed: this.terrainSeed,
      groundEffectsVisible: this.groundEffectsVisible,
    };
  }

  setGroundEffectsVisible(visible) {
    this.groundEffectsVisible = Boolean(visible);
    if (this.groundThemeGroup) {
      this.groundThemeGroup.visible = this.groundEffectsVisible;
    }
    this._requestFrame();
  }

  areGroundEffectsVisible() {
    return this.groundEffectsVisible;
  }

  setGridVisible(visible) {
    if (!this.gridHelper) {
      return;
    }
    this.gridHelper.visible = Boolean(visible);
    this._requestFrame();
  }

  isGridVisible() {
    return Boolean(this.gridHelper?.visible);
  }

  pointOnGroundSurface({ clientX, clientY } = {}) {
    if (!this.groundEffectsVisible) {
      return null;
    }

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

  zoomToObjectsExtents(objects, { animate = true, durationMs = ZOOM_EXTENTS_ANIMATION_MS } = {}) {
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

    const targetPosition = center.clone().add(viewDirection.multiplyScalar(distance));
    this._zoomTargetDistance = null;
    this._zoomFocusPoint = null;
    const transitionDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : ZOOM_EXTENTS_ANIMATION_MS;

    if (!animate || transitionDurationMs <= 0) {
      this._cameraTransition = null;
      this.controls.target.copy(center);
      this.camera.position.copy(targetPosition);
      this.camera.updateProjectionMatrix();
      this.controls.update();
      this._requestFrame();
      return true;
    }

    this._cameraTransition = {
      startTime: this._now(),
      durationMs: transitionDurationMs,
      startPosition: this.camera.position.clone(),
      startTarget: this.controls.target.clone(),
      endPosition: targetPosition,
      endTarget: center,
    };
    this._requestFrame();
    return true;
  }

  _now() {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  _cancelCameraTransition() {
    this._cameraTransition = null;
  }

  _applyCameraTransitionStep(now = this._now()) {
    const transition = this._cameraTransition;
    if (!transition) {
      return false;
    }

    const durationMs = Math.max(transition.durationMs, 1);
    const elapsedMs = Math.max(0, now - transition.startTime);
    const progress = THREE.MathUtils.clamp(elapsedMs / durationMs, 0, 1);
    const eased = progress * progress * (3 - (2 * progress));

    this.camera.position.copy(transition.startPosition).lerp(transition.endPosition, eased);
    this.controls.target.copy(transition.startTarget).lerp(transition.endTarget, eased);
    this.camera.updateMatrixWorld();

    if (progress >= 1) {
      this.camera.position.copy(transition.endPosition);
      this.controls.target.copy(transition.endTarget);
      this._cameraTransition = null;
    }

    this.controls.update();
    return true;
  }

  beginCursorNavigation({
    clientX,
    clientY,
    pointerId = null,
    orbitMode = false,
    initialMode = null,
    initialFocusPoint = null,
    allowShiftOrbit = true,
    baseMode = "pan",
    shiftMode = "orbit",
  } = {}) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return false;
    }

    const normalizedBaseMode = this._normalizeCursorNavigationMode(baseMode);
    const normalizedShiftMode = this._normalizeCursorNavigationMode(shiftMode);
    const normalizedInitialMode = initialMode
      ? this._normalizeCursorNavigationMode(initialMode)
      : orbitMode ? "orbit" : "pan";

    this.cancelCursorNavigation();
    this._cancelCameraTransition();
    this._cursorNavigation = {
      mode: null,
      allowShiftToggle: Boolean(allowShiftOrbit),
      baseMode: normalizedBaseMode,
      shiftMode: normalizedShiftMode,
      pointerId,
      lastClientX: clientX,
      lastClientY: clientY,
      move: null,
      keydown: null,
      keyup: null,
      end: null,
      mouseup: null,
    };

    if (!this._setCursorNavigationMode(normalizedInitialMode, { clientX, clientY, focusPoint: initialFocusPoint })) {
      this._cursorNavigation = null;
      return false;
    }

    const move = (event) => {
      if (this._cursorNavigation?.pointerId != null && event.pointerId !== this._cursorNavigation.pointerId) {
        return;
      }
      event.preventDefault();
      this._updateCursorNavigation(event);
    };
    const end = (event) => {
      if (this._cursorNavigation?.pointerId != null && event.pointerId !== this._cursorNavigation.pointerId) {
        return;
      }
      this._releaseCursorNavigation();
    };
    const mouseup = (event) => {
      if (!this._cursorNavigation) {
        return;
      }
      if (event.buttons === 0) {
        this._releaseCursorNavigation();
        return;
      }
      this._updateCursorNavigation(event);
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
    this._cursorNavigation.mouseup = mouseup;

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("mouseup", mouseup);
    if (this._cursorNavigation.allowShiftToggle) {
      window.addEventListener("keydown", keydown);
      window.addEventListener("keyup", keyup);
    }
    this._requestFrame();
    return true;
  }

  beginCursorPanOrbit({ clientX, clientY, pointerId = null } = {}) {
    const initialFocusPoint = this._cursorNavigation?.mode === "pan"
      ? this._currentCursorPanPointAtClient({ clientX, clientY })
      : this._cursorNavigation?.mode === "orbit" && this._cursorOrbit?.pivot
        ? this._cursorOrbit.pivot.clone()
        : null;
    return this.beginCursorNavigation({
      clientX,
      clientY,
      pointerId,
      initialMode: "pan-orbit",
      initialFocusPoint,
      allowShiftOrbit: false,
    });
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
    if (!this._cursorNavigation && !this._nativeTouchNavigation && !this._cursorPanOrbit && !this._cursorOrbit && !this._cursorPan) {
      return false;
    }

    this._removeCursorNavigationListeners();
    this._removeNativeTouchNavigationListeners();
    this._removeCursorPanOrbitListeners();
    if (this._cursorOrbit) {
      this._finishCursorOrbitState({ updateControls: false });
    } else if (this._cursorPan) {
      this._syncControlsTargetToCameraForward();
    } else if (this._nativeTouchNavigation) {
      this._syncControlsTargetToCameraForward();
    } else if (this._cursorPanOrbit) {
      this._syncControlsTargetToCameraForward(this._cursorPanOrbit.startTargetDistance);
    }
    this._cursorNavigation = null;
    this._nativeTouchNavigation = null;
    this._cursorPanOrbit = null;
    this._cursorOrbit = null;
    this._cursorPan = null;
    this.controls.enabled = true;
    this.controls.update();
    this._requestFrame();
    return true;
  }

  beginNativeTouchNavigation(pointerEvents = []) {
    const events = pointerEvents.filter((event) => event?.pointerType === "touch");
    if (events.length < 2) {
      return false;
    }

    this.cancelCursorNavigation();
    this._cancelCameraTransition();
    const positions = new Map();
    for (const event of events) {
      positions.set(event.pointerId, this._touchPositionFromEvent(event));
    }

    const points = [...positions.values()];
    const startCentroid = this._touchCentroid(points);
    const startTouchDistance = this._touchDistance(points);
    const pivot = this._groundPivotFromTouchCentroid(startCentroid);
    const startOffset = this.camera.position.clone().sub(pivot);
    if (!pivot || startOffset.lengthSq() < 1e-8 || !Number.isFinite(startTouchDistance) || startTouchDistance <= 1) {
      return false;
    }

    const move = (event) => this._handleNativeTouchPointerMove(event);
    const end = (event) => this._handleNativeTouchPointerEnd(event);
    this._nativeTouchNavigation = {
      positions,
      pivot,
      startCentroid,
      startTouchDistance,
      startPosition: this.camera.position.clone(),
      startQuaternion: this.camera.quaternion.clone(),
      targetYaw: 0,
      targetPitch: 0,
      targetLogZoom: 0,
      velocityYaw: 0,
      velocityPitch: 0,
      velocityLogZoom: 0,
      dragging: true,
      move,
      end,
    };
    this.controls.enabled = false;
    this._zoomTargetDistance = null;
    this._zoomFocusPoint = null;

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    this._requestFrame();
    return true;
  }

  _removeNativeTouchNavigationListeners() {
    const navigation = this._nativeTouchNavigation;
    if (!navigation) {
      return;
    }
    window.removeEventListener("pointermove", navigation.move);
    window.removeEventListener("pointerup", navigation.end);
    window.removeEventListener("pointercancel", navigation.end);
  }

  _removeCursorPanOrbitListeners() {
    const navigation = this._cursorPanOrbit;
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
  }

  _currentCursorPanPointAtClient({ clientX, clientY } = {}) {
    if (!this._cursorPan) {
      return null;
    }

    const pointAtCursor = this._pointOnPlaneAtClient({ clientX, clientY }, this._cursorPan.panPlane);
    if (pointAtCursor) {
      return pointAtCursor;
    }

    return this._cursorPan.anchorPoint?.clone?.() ?? null;
  }

  _startCursorPanOrbitState({ clientX, clientY, focusPoint = null } = {}) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return false;
    }

    const offset = this.camera.position.clone().sub(this.controls.target);
    const currentDistance = offset.length();
    if (!Number.isFinite(currentDistance) || currentDistance <= 1e-6) {
      return false;
    }

    const inheritedFocusPoint = focusPoint
      && Number.isFinite(focusPoint.x)
      && Number.isFinite(focusPoint.y)
      && Number.isFinite(focusPoint.z)
      ? focusPoint.clone()
      : null;
    const anchorPoint = inheritedFocusPoint
      ?? this._pickFocusPointAtClient({ clientX, clientY }, currentDistance)
      ?? this._pointOnHorizontalPlaneAtClient({ clientX, clientY }, this.controls.target.y)
      ?? this._pointAtClientDepth({ clientX, clientY }, currentDistance);
    if (!anchorPoint || !Number.isFinite(anchorPoint.y)) {
      return false;
    }

    this._cursorOrbit = null;
    this._cursorPan = null;
    this._cursorPanOrbit = {
      startX: clientX,
      startY: clientY,
      pivot: anchorPoint.clone(),
      zoomPivot: anchorPoint.clone(),
      startPosition: this.camera.position.clone(),
      startQuaternion: this.camera.quaternion.clone(),
      startTargetDistance: currentDistance,
      startPivotDistance: this.camera.position.distanceTo(anchorPoint),
      currentTargetDistance: currentDistance,
    };
    this.controls.enabled = false;
    this._zoomTargetDistance = null;
    this._zoomFocusPoint = null;
    return true;
  }

  _updateCursorPanOrbit({ clientX, clientY } = {}) {
    const navigation = this._cursorPanOrbit;
    if (!navigation || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return;
    }

    const element = this.renderer.domElement;
    const height = Math.max(element.clientHeight, 1);
    const rotateSpeed = this.controls.rotateSpeed ?? 1;
    const dragX = clientX - navigation.startX;
    const dragY = clientY - navigation.startY;
    const yaw = (dragX * rotateSpeed * Math.PI * 2) / height;
    const pitch = (dragY * rotateSpeed * Math.PI * 2) / height;
    const minDistance = Math.max(0.1, this.controls.minDistance || 0.1);
    const maxDistance = this.controls.maxDistance || 1e6;
    const dragDistance = Math.hypot(dragX, dragY);
    const dollyScale = THREE.MathUtils.clamp(Math.exp((-dragDistance / height) * 2.2), 0.08, 1);

    this._applyCursorOrbitAngles(navigation, yaw, pitch);
    const orbitDistance = this.camera.position.distanceTo(navigation.zoomPivot);
    if (!Number.isFinite(orbitDistance) || orbitDistance <= 1e-6) {
      return;
    }

    const nextPivotDistance = THREE.MathUtils.clamp(orbitDistance * dollyScale, minDistance, maxDistance);
    const previousZoomFocusPoint = this._zoomFocusPoint;
    this._zoomFocusPoint = navigation.zoomPivot;
    this._applyZoomDistance(
      orbitDistance,
      nextPivotDistance,
      this.camera.position.clone().sub(this.controls.target),
    );
    this._zoomFocusPoint = previousZoomFocusPoint;
    this.camera.updateMatrixWorld();
    const currentPivotDistance = this.camera.position.distanceTo(navigation.zoomPivot);
    navigation.currentTargetDistance = Number.isFinite(currentPivotDistance)
      ? THREE.MathUtils.clamp(currentPivotDistance, minDistance, maxDistance)
      : nextPivotDistance;
    this._requestFrame();
  }

  _releaseCursorPanOrbit() {
    if (!this._cursorPanOrbit) {
      return;
    }

    const targetDistance = this._cursorPanOrbit.currentTargetDistance ?? this._cursorPanOrbit.startTargetDistance;
    this._removeCursorPanOrbitListeners();
    this._cursorPanOrbit = null;
    this._syncControlsTargetToCameraForward(targetDistance);
    this.controls.enabled = true;
    this.controls.update();
    this._requestFrame();
  }

  _handleNativeTouchPointerMove(event) {
    const navigation = this._nativeTouchNavigation;
    if (!navigation || !navigation.positions.has(event.pointerId)) {
      return;
    }

    event.preventDefault();
    navigation.positions.set(event.pointerId, this._touchPositionFromEvent(event));
    this._updateNativeTouchNavigation();
  }

  _handleNativeTouchPointerEnd(event) {
    const navigation = this._nativeTouchNavigation;
    if (!navigation || !navigation.positions.has(event.pointerId)) {
      return;
    }

    navigation.positions.delete(event.pointerId);
    if (navigation.positions.size < 2) {
      this._removeNativeTouchNavigationListeners();
      navigation.dragging = false;
      navigation.positions.clear();
      if (!this._hasNativeTouchInertia(navigation)) {
        this._endNativeTouchNavigation();
      }
    }
  }

  _updateNativeTouchNavigation() {
    const navigation = this._nativeTouchNavigation;
    if (!navigation || navigation.positions.size < 2) {
      return;
    }

    const points = [...navigation.positions.values()];
    const centroid = this._touchCentroid(points);
    const touchDistance = this._touchDistance(points);
    if (!centroid || !Number.isFinite(touchDistance) || touchDistance <= 1) {
      return;
    }

    const element = this.renderer.domElement;
    const height = Math.max(element.clientHeight, 1);
    const rotateSpeed = this.controls.rotateSpeed ?? 1;
    const yaw = ((centroid.clientX - navigation.startCentroid.clientX) * rotateSpeed * Math.PI * 2) / height;
    const pitch = ((centroid.clientY - navigation.startCentroid.clientY) * rotateSpeed * Math.PI * 2) / height;
    const zoomScale = THREE.MathUtils.clamp(navigation.startTouchDistance / touchDistance, 0.08, 12);
    const logZoom = Math.log(zoomScale);

    navigation.velocityYaw = yaw - navigation.targetYaw;
    navigation.velocityPitch = pitch - navigation.targetPitch;
    navigation.velocityLogZoom = logZoom - navigation.targetLogZoom;
    navigation.targetYaw = yaw;
    navigation.targetPitch = pitch;
    navigation.targetLogZoom = logZoom;

    this._applyNativeTouchTransform(navigation, yaw, pitch, zoomScale);
    this._requestFrame();
  }

  _applyNativeTouchTransform(navigation, yaw, pitch, zoomScale) {
    const worldUp = this.camera.up.clone().normalize();
    const yawRotation = new THREE.Quaternion().setFromAxisAngle(worldUp, -yaw);
    const startRight = new THREE.Vector3(1, 0, 0).applyQuaternion(navigation.startQuaternion).normalize();
    const pitchAxis = startRight.applyQuaternion(yawRotation).normalize();
    const pitchRotation = new THREE.Quaternion().setFromAxisAngle(pitchAxis, -pitch);
    const rotation = pitchRotation.multiply(yawRotation);
    const startOffset = navigation.startPosition.clone().sub(navigation.pivot).multiplyScalar(zoomScale);

    this.camera.position.copy(navigation.pivot).add(startOffset.applyQuaternion(rotation));
    this.camera.quaternion.copy(navigation.startQuaternion).premultiply(rotation);
    this.camera.updateMatrixWorld();
  }

  _applyNativeTouchNavigationStep() {
    const navigation = this._nativeTouchNavigation;
    if (!navigation || navigation.dragging) {
      return;
    }

    navigation.targetYaw += navigation.velocityYaw;
    navigation.targetPitch += navigation.velocityPitch;
    navigation.targetLogZoom += navigation.velocityLogZoom;
    navigation.velocityYaw *= 0.88;
    navigation.velocityPitch *= 0.88;
    navigation.velocityLogZoom *= 0.88;

    const zoomScale = THREE.MathUtils.clamp(Math.exp(navigation.targetLogZoom), 0.08, 12);
    this._applyNativeTouchTransform(navigation, navigation.targetYaw, navigation.targetPitch, zoomScale);

    if (!this._hasNativeTouchInertia(navigation)) {
      this._endNativeTouchNavigation();
    }
  }

  _hasNativeTouchInertia(navigation) {
    return Boolean(
      navigation
      && (
        Math.abs(navigation.velocityYaw) >= 0.0005
        || Math.abs(navigation.velocityPitch) >= 0.0005
        || Math.abs(navigation.velocityLogZoom) >= 0.0005
      ),
    );
  }

  _endNativeTouchNavigation() {
    if (!this._nativeTouchNavigation) {
      return;
    }

    this._nativeTouchNavigation = null;
    this._syncControlsTargetToCameraForward();
    this.controls.enabled = true;
    this.controls.update();
    this._requestFrame();
  }

  _touchPositionFromEvent(event) {
    return {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      pageX: event.pageX,
      pageY: event.pageY,
    };
  }

  _touchCentroid(points) {
    const validPoints = points.filter((point) => Number.isFinite(point?.clientX) && Number.isFinite(point?.clientY));
    if (!validPoints.length) {
      return null;
    }

    const sum = validPoints.reduce((acc, point) => {
      acc.clientX += point.clientX;
      acc.clientY += point.clientY;
      return acc;
    }, { clientX: 0, clientY: 0 });
    return {
      clientX: sum.clientX / validPoints.length,
      clientY: sum.clientY / validPoints.length,
    };
  }

  _touchDistance(points) {
    if (!Array.isArray(points) || points.length < 2) {
      return 0;
    }

    const [a, b] = points;
    const dx = b.clientX - a.clientX;
    const dy = b.clientY - a.clientY;
    return Math.hypot(dx, dy);
  }

  _groundPivotFromTouchCentroid(centroid) {
    if (!centroid) {
      return this.controls.target.clone();
    }

    const groundSurfacePoint = this.pointOnGroundSurface(centroid);
    if (groundSurfacePoint && this._isReasonableTouchPivot(groundSurfacePoint)) {
      return groundSurfacePoint;
    }

    const flatGroundPoint = this._pointOnHorizontalPlaneAtClient(centroid, 0);
    if (flatGroundPoint && this._isReasonableTouchPivot(flatGroundPoint)) {
      return flatGroundPoint;
    }

    const fallback = this.controls.target.clone();
    fallback.y = 0;
    return fallback;
  }

  _isReasonableTouchPivot(point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
      return false;
    }

    const viewDistance = Math.max(0.1, this.camera.position.distanceTo(this.controls.target));
    const maxPivotDistance = Math.max(80, viewDistance * 6);
    return this.camera.position.distanceTo(point) <= maxPivotDistance;
  }

  _setCursorNavigationMode(mode, { clientX, clientY, focusPoint = null } = {}) {
    const navigation = this._cursorNavigation;
    if (!navigation || navigation.mode === mode) {
      return true;
    }

    const previousMode = navigation.mode;
    const inheritedFocusPoint = mode === "pan-orbit" && previousMode === "pan"
      ? this._currentCursorPanPointAtClient({ clientX, clientY })
      : mode === "pan-orbit" && previousMode === "orbit" && this._cursorOrbit?.pivot
        ? this._cursorOrbit.pivot.clone()
        : focusPoint;
    if (previousMode === "orbit") {
      this._finishCursorOrbitState({ updateControls: false });
    } else if (previousMode === "pan") {
      this._cursorPan = null;
    } else if (previousMode === "pan-orbit") {
      this._cursorPanOrbit = null;
    }

    const started = mode === "orbit"
      ? this._startCursorOrbitState({ clientX, clientY })
      : mode === "pan-orbit"
        ? this._startCursorPanOrbitState({ clientX, clientY, focusPoint: inheritedFocusPoint })
        : this._startCursorPanState({ clientX, clientY });
    if (!started) {
      if (previousMode === "orbit") {
        this._startCursorOrbitState({ clientX, clientY });
      } else if (previousMode === "pan") {
        this._startCursorPanState({ clientX, clientY });
      } else if (previousMode === "pan-orbit") {
        this._startCursorPanOrbitState({ clientX, clientY });
      }
      return false;
    }

    navigation.mode = mode;
    return true;
  }

  _updateCursorNavigation({ clientX, clientY, shiftKey = false, buttons = null } = {}) {
    const navigation = this._cursorNavigation;
    if (!navigation || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return;
    }

    navigation.lastClientX = clientX;
    navigation.lastClientY = clientY;
    const buttonMode = this._cursorNavigationModeFromMouseButtons({ buttons, shiftKey });
    if (buttonMode) {
      this._setCursorNavigationMode(buttonMode, { clientX, clientY });
    } else if (navigation.allowShiftToggle) {
      const nextMode = shiftKey ? navigation.shiftMode : navigation.baseMode;
      this._setCursorNavigationMode(nextMode, { clientX, clientY });
    }

    if (navigation.mode === "orbit") {
      this._updateCursorOrbit({ clientX, clientY });
    } else if (navigation.mode === "pan") {
      this._updateCursorPan({ clientX, clientY });
    } else if (navigation.mode === "pan-orbit") {
      this._updateCursorPanOrbit({ clientX, clientY });
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
    } else if (navigation.mode === "pan-orbit") {
      this._releaseCursorPanOrbit();
    }
  }

  _normalizeCursorNavigationMode(mode) {
    if (mode === "orbit" || mode === "pan-orbit") {
      return mode;
    }
    return "pan";
  }

  _cursorNavigationModeFromMouseButtons({ buttons, shiftKey = false } = {}) {
    if (!Number.isInteger(buttons) || buttons <= 0) {
      return null;
    }

    const hasLeft = (buttons & 1) !== 0;
    const hasRight = (buttons & 2) !== 0;
    if (hasLeft && hasRight) {
      return "pan-orbit";
    }
    if (hasLeft) {
      return shiftKey ? "orbit" : "pan";
    }
    if (hasRight) {
      return shiftKey ? "pan" : "orbit";
    }
    return null;
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
    if (navigation.mouseup) {
      window.removeEventListener("mouseup", navigation.mouseup);
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
    this._requestFrame();
  }

  _releaseCursorPan() {
    if (!this._cursorPan) {
      return;
    }

    this._cursorPan.dragging = false;
    if (this._cursorPan.velocity.lengthSq() < 1e-10) {
      this._endCursorPan();
      return;
    }
    this._requestFrame();
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
    this._requestFrame();
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
    this._requestFrame();
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

  // --- Touch gesture API (multi-touch pinch + orbit) ---

  beginTouchGesture() {
    this.cancelCursorNavigation();
    this._cancelCameraTransition();
    this.controls.enabled = false;
    this._zoomTargetDistance = null;
    this._zoomFocusPoint = null;
    this._touchGestureActive = true;
    this._touchGestureInertia = {
      velocityDx: 0,
      velocityDy: 0,
      velocityLogScale: 0,
      clientX: null,
      clientY: null,
    };
    this._requestFrame();
  }

  applyTouchPinchScale({ scale, clientX, clientY } = {}) {
    if (!this._touchGestureActive || !Number.isFinite(scale) || scale <= 0) {
      return;
    }

    this._applyTouchPinchScale({ scale, clientX, clientY });
    if (this._touchGestureInertia) {
      this._touchGestureInertia.velocityLogScale = Math.log(scale);
      this._touchGestureInertia.clientX = Number.isFinite(clientX) ? clientX : null;
      this._touchGestureInertia.clientY = Number.isFinite(clientY) ? clientY : null;
    }
    this._requestFrame();
  }

  _applyTouchPinchScale({ scale, clientX, clientY } = {}) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const currentDistance = offset.length();
    if (!Number.isFinite(currentDistance) || currentDistance <= 1e-6) {
      return;
    }

    const minDistance = Math.max(0.1, this.controls.minDistance || 0.1);
    const maxDistance = this.controls.maxDistance || 1e6;
    const newDistance = THREE.MathUtils.clamp(currentDistance / scale, minDistance, maxDistance);

    const focusPoint = (Number.isFinite(clientX) && Number.isFinite(clientY))
      ? this._pickFocusPointAtClient({ clientX, clientY }, currentDistance)
      : null;

    if (focusPoint) {
      const distScale = newDistance / currentDistance;
      this.camera.position.sub(focusPoint).multiplyScalar(distScale).add(focusPoint);
      this.controls.target.sub(focusPoint).multiplyScalar(distScale).add(focusPoint);
    } else {
      offset.setLength(newDistance);
      this.camera.position.copy(this.controls.target).add(offset);
    }
    this.camera.updateMatrixWorld();
  }

  applyTouchOrbitDelta({ dx, dy } = {}) {
    if (!this._touchGestureActive || !Number.isFinite(dx) || !Number.isFinite(dy)) {
      return;
    }

    this._applyTouchOrbitDelta({ dx, dy });
    if (this._touchGestureInertia) {
      this._touchGestureInertia.velocityDx = dx;
      this._touchGestureInertia.velocityDy = dy;
    }
    this._requestFrame();
  }

  _applyTouchOrbitDelta({ dx, dy } = {}) {
    const element = this.renderer.domElement;
    const height = Math.max(element.clientHeight, 1);
    // Tuned for touch responsiveness: 1.5× matches finger travel to camera rotation.
    const rotateSpeed = 1.5;

    const yawAngle = -(dx * rotateSpeed * Math.PI) / height;
    const pitchAngle = -(dy * rotateSpeed * Math.PI) / height;

    const pivot = this.controls.target.clone();
    const offset = this.camera.position.clone().sub(pivot);

    const worldUp = this.camera.up.clone().normalize();
    const yawQ = new THREE.Quaternion().setFromAxisAngle(worldUp, yawAngle);

    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(right, pitchAngle);

    const combinedQ = pitchQ.premultiply(yawQ);

    offset.applyQuaternion(combinedQ);
    this.camera.position.copy(pivot).add(offset);
    this.camera.quaternion.premultiply(combinedQ);
    this.camera.updateMatrixWorld();
  }

  endTouchGesture() {
    if (!this._touchGestureActive) {
      return;
    }
    this._touchGestureActive = false;
    if (this._hasTouchGestureInertia(this._touchGestureInertia)) {
      this._requestFrame();
      return;
    }

    this._endTouchGestureInertia();
  }

  _applyTouchGestureInertiaStep() {
    const inertia = this._touchGestureInertia;
    if (!inertia || this._touchGestureActive) {
      return;
    }

    if (!this._hasTouchGestureInertia(inertia)) {
      this._endTouchGestureInertia();
      return;
    }

    if (Math.abs(inertia.velocityLogScale) >= 0.0005) {
      this._applyTouchPinchScale({
        scale: Math.exp(inertia.velocityLogScale),
        clientX: inertia.clientX,
        clientY: inertia.clientY,
      });
    }
    if (Math.abs(inertia.velocityDx) >= 0.0005 || Math.abs(inertia.velocityDy) >= 0.0005) {
      this._applyTouchOrbitDelta({
        dx: inertia.velocityDx,
        dy: inertia.velocityDy,
      });
    }

    inertia.velocityDx *= 0.88;
    inertia.velocityDy *= 0.88;
    inertia.velocityLogScale *= 0.88;
  }

  _hasTouchGestureInertia(inertia) {
    return Boolean(
      inertia
      && (
        Math.abs(inertia.velocityDx) >= 0.0005
        || Math.abs(inertia.velocityDy) >= 0.0005
        || Math.abs(inertia.velocityLogScale) >= 0.0005
      ),
    );
  }

  _endTouchGestureInertia() {
    this._touchGestureInertia = null;
    this._touchGestureActive = false;
    this._syncControlsTargetToCameraForward();
    this.controls.enabled = true;
    this.controls.update();
  }

  // --- End touch gesture API ---

  _attachSmoothZoomHandlers() {
    this.renderer.domElement.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        this._queueSmoothZoom(event);
      },
      { passive: false, capture: true },
    );
  }

  _queueSmoothZoom(event) {
    this._cancelCameraTransition();
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
    this._requestFrame();
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

  _updateSkyCssFromCamera() {
    if (!(this._skyCssTarget instanceof Element)) {
      return;
    }

    if (this.skyTheme === SKY_THEMES.SOLID_COLOR) {
      return;
    }

    const preset = skyThemePreset(this.skyTheme);
    const motion = preset.skyMotion;

    this.camera.getWorldDirection(this._skyMotionDir);
    const dir = this._skyMotionDir;
    const yaw = Math.atan2(dir.x, dir.z) * (180 / Math.PI);
    const pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) * (180 / Math.PI);

    const horizonBase = motion?.horizonBasePct ?? 58;
    const horizonScale = motion?.horizonPitchScale ?? 12;
    const horizonPct = THREE.MathUtils.clamp(horizonBase + (pitch / 90) * horizonScale, 28, 78);

    // Keep the zenith-to-horizon gradient stable; use yaw to shift a soft highlight
    // left/right so the "sun side" changes with view without rotating the sky sideways.
    const yawRad = (yaw + (motion?.angleYawOffsetDeg ?? 0)) * (Math.PI / 180);
    const lightX = THREE.MathUtils.clamp(50 + Math.sin(yawRad) * 18, 20, 80);
    const lightY = THREE.MathUtils.clamp(horizonPct - 18 + (pitch / 90) * 6, 16, 70);

    const roundedYaw = Math.round(yaw * 10) / 10;
    const roundedPitch = Math.round(pitch * 10) / 10;
    const roundedHorizon = Math.round(horizonPct * 10) / 10;
    const roundedLightX = Math.round(lightX * 10) / 10;
    const roundedLightY = Math.round(lightY * 10) / 10;

    if (
      this._skyMotionYawDeg === roundedYaw &&
      this._skyMotionPitchDeg === roundedPitch &&
      this._skyMotionHorizonPct === roundedHorizon &&
      this._skyMotionLightXPct === roundedLightX &&
      this._skyMotionLightYPct === roundedLightY
    ) {
      return;
    }

    this._skyMotionYawDeg = roundedYaw;
    this._skyMotionPitchDeg = roundedPitch;
    this._skyMotionHorizonPct = roundedHorizon;
    this._skyMotionLightXPct = roundedLightX;
    this._skyMotionLightYPct = roundedLightY;

    this._skyCssTarget.style.setProperty("--sky-horizon", `${roundedHorizon}%`);
    this._skyCssTarget.style.setProperty("--sky-light-x", `${roundedLightX}%`);
    this._skyCssTarget.style.setProperty("--sky-light-y", `${roundedLightY}%`);
  }

  frame() {
    this.resize();
    let needsNextFrame = false;
    if (this._nativeTouchNavigation) {
      this._applyNativeTouchNavigationStep();
      needsNextFrame = Boolean(this._nativeTouchNavigation);
    } else if (this._touchGestureInertia) {
      this._applyTouchGestureInertiaStep();
      needsNextFrame = Boolean(this._touchGestureInertia);
    } else if (this._cursorOrbit) {
      this._applyCursorOrbitStep();
      needsNextFrame = Boolean(this._cursorOrbit);
    } else if (this._cursorPan) {
      this._applyCursorPanStep();
      needsNextFrame = Boolean(this._cursorPan);
    } else if (this._touchGestureActive) {
      // Touch gesture drives camera directly; skip smooth zoom step and controls update
      needsNextFrame = true;
    } else {
      if (this._applyCameraTransitionStep()) {
        needsNextFrame = Boolean(this._cameraTransition);
      } else {
        this._applySmoothZoomStep();
        needsNextFrame = Number.isFinite(this._zoomTargetDistance);
        if (this.controls.update()) {
          needsNextFrame = true;
        }
      }
    }

    this._updateSkyCssFromCamera();
    this.renderer.render(this.scene, this.camera);
    return needsNextFrame;
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
