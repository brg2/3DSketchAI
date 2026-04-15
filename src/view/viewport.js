import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export class Viewport {
  constructor({ canvas }) {
    this.canvas = canvas;
    this._viewportWidth = 0;
    this._viewportHeight = 0;
    this._zoomTargetDistance = null;
    this._zoomFocusPoint = null;
    this._zoomRaycaster = new THREE.Raycaster();
    this._zoomPointer = new THREE.Vector2();
    this.gridHelper = null;

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

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshStandardMaterial({ color: 0xf3f6fa, roughness: 1.0, metalness: 0.0 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.001;
    plane.receiveShadow = true;
    this.scene.add(plane);

    this.setGridVisible(false);
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

    this._zoomFocusPoint = this._pickZoomFocusPoint(event, currentDistance);
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

  _pickZoomFocusPoint(event, currentDistance) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    this._zoomPointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
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
    this._applySmoothZoomStep();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
