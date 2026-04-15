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
    this._cursorOrbit = null;
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

  beginCursorOrbit({ clientX, clientY } = {}) {
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

    const move = (event) => this._updateCursorOrbit(event);
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      this._releaseCursorOrbit();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", end, { once: true });
    return true;
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
    const orbit = this._cursorOrbit;
    this._cursorOrbit = null;

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const distance = orbit?.startTargetDistance ?? this.camera.position.distanceTo(this.controls.target);
    this.controls.target.copy(this.camera.position).add(forward.multiplyScalar(Math.max(distance, 0.1)));
    this.controls.enabled = true;
    this.controls.update();
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

    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    this._zoomPointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._zoomRaycaster.setFromCamera(this._zoomPointer, this.camera);

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
