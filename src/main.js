import * as THREE from "three";
import { SketchApp } from "./app/sketch-app.js";

const canvas = document.getElementById("viewport");
const overlayElement = document.getElementById("overlay");
const codeElement = document.getElementById("code-view");
const codePanel = document.getElementById("code-panel");
const codeToggle = document.getElementById("code-toggle");
const codeCopyButton = document.getElementById("code-copy");
const codeCompressButton = document.getElementById("code-compress");
const docNameElement = document.getElementById("doc-name");
const modelOpenButton = document.getElementById("model-open");
const modelOpenInput = document.getElementById("model-open-input");
const modelSaveButton = document.getElementById("model-save");
const exportToggleButton = document.getElementById("export-toggle");
const exportMenu = document.getElementById("export-menu");
const panelTabButtons = Array.from(document.querySelectorAll("[data-panel-page]"));
const gridToggleButton = document.getElementById("grid-toggle");
const groundEffectsToggleButton = document.getElementById("ground-effects-toggle");
const devConsoleToggleButton = document.getElementById("dev-console-toggle");
const groundRegenerateButton = document.getElementById("ground-regenerate");
const groundResetButton = document.getElementById("ground-reset");
const groundThemeSelect = document.getElementById("ground-theme");
const groundSolidField = document.getElementById("ground-solid-field");
const groundSolidToggleButton = document.getElementById("ground-solid-toggle");
const groundSolidPopover = document.getElementById("ground-solid-popover");
const groundSolidColorInput = document.getElementById("ground-solid-color-input");
const groundSolidHexInput = document.getElementById("ground-solid-hex-input");
const uiThemeSelect = document.getElementById("ui-theme");
const skyThemeSelect = document.getElementById("sky-theme");
const skySolidField = document.getElementById("sky-solid-field");
const skySolidToggleButton = document.getElementById("sky-solid-toggle");
const skySolidPopover = document.getElementById("sky-solid-popover");
const skySolidColorInput = document.getElementById("sky-solid-color-input");
const skySolidHexInput = document.getElementById("sky-solid-hex-input");
const elevationVariationInput = document.getElementById("elevation-variation");
const elevationVariationValue = document.getElementById("elevation-variation-value");
const terrainVariationInput = document.getElementById("terrain-variation");
const terrainVariationValue = document.getElementById("terrain-variation-value");
const terrainDensityInput = document.getElementById("terrain-density");
const terrainDensityValue = document.getElementById("terrain-density-value");
const sidebarElement = document.querySelector(".sidebar");
const sidebarScrollElement = document.querySelector(".sidebar-scroll-content");
const toolGrid = document.getElementById("tool-grid");
const welcomeDialog = document.getElementById("welcome-dialog");
const welcomeContinueButton = document.getElementById("welcome-continue");
const welcomeCloseButton = document.getElementById("welcome-close");

const WELCOME_STORAGE_KEY = "3dsai.welcomeAcknowledged.v1";

if (
  !canvas ||
  !overlayElement ||
  !codeElement ||
  !codePanel ||
  !codeToggle ||
  !codeCopyButton ||
  !codeCompressButton ||
  !docNameElement ||
  !modelOpenButton ||
  !modelOpenInput ||
  !modelSaveButton ||
  !exportToggleButton ||
  !exportMenu ||
  !gridToggleButton ||
  !groundEffectsToggleButton ||
  !devConsoleToggleButton ||
  !groundRegenerateButton ||
  !groundResetButton ||
  !groundThemeSelect ||
  !groundSolidField ||
  !groundSolidToggleButton ||
  !groundSolidPopover ||
  !groundSolidColorInput ||
  !groundSolidHexInput ||
  !uiThemeSelect ||
  !skyThemeSelect ||
  !skySolidField ||
  !skySolidToggleButton ||
  !skySolidPopover ||
  !skySolidColorInput ||
  !skySolidHexInput ||
  !elevationVariationInput ||
  !elevationVariationValue ||
  !terrainVariationInput ||
  !terrainVariationValue ||
  !terrainDensityInput ||
  !terrainDensityValue ||
  !sidebarElement ||
  !sidebarScrollElement ||
  panelTabButtons.length === 0 ||
  !toolGrid ||
  !welcomeDialog ||
  !welcomeContinueButton ||
  !welcomeCloseButton
) {
  throw new Error("Missing required DOM nodes for app bootstrap");
}

function hasSeenWelcomeDialog() {
  try {
    return window.localStorage?.getItem(WELCOME_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistWelcomeDialogAcknowledgement() {
  try {
    window.localStorage?.setItem(WELCOME_STORAGE_KEY, "1");
  } catch {
    // If browser storage is unavailable, closing the dialog should still unblock the app.
  }
}

function closeWelcomeDialog() {
  persistWelcomeDialogAcknowledgement();
  if (welcomeDialog.open) {
    welcomeDialog.close();
  }
  document.body.classList.remove("welcome-modal-open");
}

function maybeShowWelcomeDialog() {
  if (hasSeenWelcomeDialog()) {
    return;
  }

  document.body.classList.add("welcome-modal-open");
  if (typeof welcomeDialog.showModal === "function") {
    welcomeDialog.showModal();
  } else {
    welcomeDialog.setAttribute("open", "");
  }
  welcomeContinueButton.focus();
}

welcomeContinueButton.addEventListener("click", closeWelcomeDialog);
welcomeCloseButton.addEventListener("click", closeWelcomeDialog);
welcomeDialog.addEventListener("cancel", () => {
  persistWelcomeDialogAcknowledgement();
  document.body.classList.remove("welcome-modal-open");
});
welcomeDialog.addEventListener("close", () => {
  document.body.classList.remove("welcome-modal-open");
});

const app = new SketchApp({
  canvas,
  overlayElement,
  codeElement,
  codePanel,
  codeToggle,
  codeCopyButton,
  codeCompressButton,
  docNameElement,
  modelOpenButton,
  modelOpenInput,
  modelSaveButton,
  exportToggleButton,
  exportMenu,
  panelTabButtons,
  gridToggleButton,
  groundEffectsToggleButton,
  devConsoleToggleButton,
  groundRegenerateButton,
  groundResetButton,
  groundThemeSelect,
  groundSolidField,
  groundSolidToggleButton,
  groundSolidPopover,
  groundSolidColorInput,
  groundSolidHexInput,
  uiThemeSelect,
  skyThemeSelect,
  skySolidField,
  skySolidToggleButton,
  skySolidPopover,
  skySolidColorInput,
  skySolidHexInput,
  elevationVariationInput,
  elevationVariationValue,
  terrainVariationInput,
  terrainVariationValue,
  terrainDensityInput,
  terrainDensityValue,
  sidebarElement,
  sidebarScrollElement,
  toolGrid,
});

app.start()
  .then(() => {
    requestAnimationFrame(() => {
      document.body.classList.remove("app-loading");
      maybeShowWelcomeDialog();
      exposeTestApiIfRequested(app);
    });
  })
  .catch((error) => {
    console.error("Failed to start app", error);
    const loadingStatus = document.querySelector("[data-loading-status]");
    if (loadingStatus) {
      loadingStatus.textContent = "Unable to load";
    }
  });

function exposeTestApiIfRequested(app) {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("e2e")) {
    return;
  }

  window.__TEST_API__ = createTestApi(app);
}

function createTestApi(app) {
  const round = (value) => Math.round((value ?? 0) * 1000000) / 1000000;
  const vector = (value) => ({
    x: round(value?.x),
    y: round(value?.y),
    z: round(value?.z),
  });
  const euler = (value) => ({
    x: round(value?.x),
    y: round(value?.y),
    z: round(value?.z),
  });
  const clientPointForWorldPoint = (point) => {
    const projected = point.clone().project(app.viewport.camera);
    const rect = app.canvas.getBoundingClientRect();
    return {
      x: round(rect.left + ((projected.x + 1) / 2) * rect.width),
      y: round(rect.top + ((1 - projected.y) / 2) * rect.height),
    };
  };
  const meshForObject = (objectId) =>
    app.representationStore.getSelectableMeshes().find((mesh) => mesh.userData.objectId === objectId) ?? null;
  const objectIdForName = (name) => String(name ?? "") === "cube" ? "cube" : String(name ?? "");

  return {
    async setupDeterministicScene() {
      window.localStorage?.setItem?.("3dsai.welcomeAcknowledged.v1", "1");
      const welcomeDialog = document.getElementById("welcome-dialog");
      if (welcomeDialog?.open && typeof welcomeDialog.close === "function") {
        welcomeDialog.close();
      } else {
        welcomeDialog?.removeAttribute?.("open");
      }
      document.body.classList.remove("welcome-modal-open");
      app.runtimeController.cancelManipulation();
      app.tools.clearDrag();
      app.viewport.controls.enabled = true;
      app.viewport.controls.enableDamping = false;
      app.viewport.controls.autoRotate = false;
      app.viewport.setGroundEffectsVisible(false);
      app.viewport.setGridVisible(false);
      await app.runtimeController.clearCanonicalModel();
      await app.appSessionStore.clear().catch(() => {});
      await app.modelHistoryStore.clear().catch(() => {});
      app._setUiThemeMode?.("light", { persist: false, force: true });
      app._setSkyTheme?.("solidColor", { solidColor: "#fff", persist: false });
      app.selectionPipeline.selectedObjectIds = [];
      app.hoveredObjectId = null;
      app.hoveredHit = null;
      app.objectCounter = 2;
      app.polylineCounter = 1;
      app._setModelName("E2E Deterministic Scene");
      app._setActiveTool("select", { render: false });
      app._setSelectionMode("object", { render: false });
      this.setCamera({
        position: { x: 4, y: 3, z: 5 },
        target: { x: 0, y: 0, z: 0 },
      });

      const result = await app.runtimeController.commitOperation({
        type: "create_primitive",
        targetId: null,
        selection: null,
        params: {
          primitive: "box",
          objectId: "cube",
          position: { x: 0, y: 0, z: 0 },
          size: { x: 1, y: 1, z: 1 },
        },
      });
      app.modelHistory.reset(result?.canonicalGraphJson ?? app.runtimeController.getSnapshot().canonicalGraphJson, {
        label: "E2E deterministic cube",
      });
      app._applySelectionHighlights();
      app.viewport.frame();
      return this.getSceneState();
    },
    setCamera({ position, target }) {
      app.viewport._cameraTransition = null;
      app.viewport._zoomTargetDistance = null;
      app.viewport._zoomFocusPoint = null;
      app.viewport.camera.position.set(position?.x ?? 4, position?.y ?? 3, position?.z ?? 5);
      app.viewport.controls.target.set(target?.x ?? 0, target?.y ?? 0, target?.z ?? 0);
      app.viewport.camera.lookAt(app.viewport.controls.target);
      app.viewport.camera.updateMatrixWorld(true);
      app.viewport.camera.updateProjectionMatrix();
      app.viewport.controls.update();
      app.viewport.frame();
    },
    getSceneState() {
      const snapshot = app.runtimeController.getSnapshot();
      return {
        operationCount: snapshot.operationCount,
        exactBackend: snapshot.exactBackend,
        hasActiveSession: snapshot.hasActiveSession,
        previewFeatureGraphUpdate: snapshot.previewFeatureGraphUpdate ? structuredClone(snapshot.previewFeatureGraphUpdate) : null,
        featureGraph: structuredClone(snapshot.featureGraph),
        objects: objectTransformState(snapshot.representation.exactSceneState),
        meshes: meshSummaries(app.representationStore.getSelectableMeshes(), vector),
        selection: {
          mode: app.selectionPipeline.selectionMode,
          selectedObjectIds: [...app.selectionPipeline.selectedObjectIds],
          hoveredObjectId: app.hoveredObjectId,
        },
        tool: {
          activeTool: app.tools.activeTool,
          dragging: Boolean(app.tools.dragState),
        },
        camera: {
          position: vector(app.viewport.camera.position),
          target: vector(app.viewport.controls.target),
          zoom: round(app.viewport.camera.zoom),
        },
      };
    },
    getFeatureGraph() {
      return normalizedFeatureGraphSnapshot(app.runtimeController.getSnapshot().featureGraph);
    },
    getSelected() {
      return {
        mode: app.selectionPipeline.selectionMode,
        objectIds: [...app.selectionPipeline.selectedObjectIds],
        hoveredObjectId: app.hoveredObjectId,
      };
    },
    getPreselectionState() {
      return {
        faceVisible: Boolean(app.preselectionFaceOverlay?.visible),
        edgeVisible: Boolean(app.preselectionEdgeOverlay?.visible),
        vertexVisible: Boolean(app.preselectionVertexOverlay?.visible),
        dragging: Boolean(app.tools.dragState),
      };
    },
    getLineDrawOverlayState() {
      const snapPosition = app.lineDrawSnapPreview?.geometry?.attributes?.position;
      const snapPoint = snapPosition?.count
        ? new THREE.Vector3().fromBufferAttribute(snapPosition, 0)
        : null;
      return {
        active: Boolean(app.lineDrawState),
        points: (app.lineDrawState?.points ?? []).map((point) => vector(point)),
        snapVisible: Boolean(app.lineDrawSnapPreview?.visible),
        snapPoint: snapPoint ? vector(snapPoint) : null,
      };
    },
    getCamera() {
      return {
        position: vector(app.viewport.camera.position),
        target: vector(app.viewport.controls.target),
        zoom: round(app.viewport.camera.zoom),
        fov: round(app.viewport.camera.fov),
      };
    },
    getObjectByName(name) {
      const objectId = objectIdForName(name);
      const snapshot = app.runtimeController.getSnapshot();
      const state = snapshot.representation.exactSceneState?.[objectId] ?? null;
      const mesh = meshForObject(objectId);
      const canonicalPrimitive = snapshot.featureGraph.find(
        (feature) => feature.type === "create_primitive" && feature.params?.objectId === objectId,
      ) ?? null;
      if (!state || !mesh) {
        return null;
      }
      return {
        name: String(name ?? objectId),
        objectId,
        position: vector(canonicalPrimitive?.params?.position ?? state.position),
        rotation: euler(state.rotation),
        scale: vector(canonicalPrimitive?.params?.size ?? state.scale),
        canonicalPrimitive: structuredClone(canonicalPrimitive),
        state: objectTransformState({ [objectId]: state })[objectId],
        mesh: meshSummaryFor(mesh, vector),
      };
    },
    getFaceData(objectName) {
      const objectId = objectIdForName(objectName);
      const mesh = meshForObject(objectId);
      if (!mesh) {
        return [];
      }
      mesh.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(mesh);
      return deterministicBoxFaces(bounds, mesh).map((face) => ({
        ...face,
        center: vector(face.center),
        normal: vector(face.normal),
        click: clientPointForWorldPoint(face.center),
      }));
    },
    getEdgeData(objectName) {
      const objectId = objectIdForName(objectName);
      const mesh = meshForObject(objectId);
      if (!mesh) {
        return [];
      }
      mesh.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(mesh);
      return deterministicBoxEdges(bounds).map((edge) => ({
        ...edge,
        a: vector(edge.a),
        b: vector(edge.b),
        center: vector(edge.center),
        clickWorld: vector(edge.clickWorld),
        click: clientPointForWorldPoint(edge.clickWorld),
      }));
    },
    getVertexData(objectName) {
      const objectId = objectIdForName(objectName);
      const mesh = meshForObject(objectId);
      if (!mesh) {
        return [];
      }
      mesh.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(mesh);
      return deterministicBoxVertices(bounds).map((vertex) => ({
        ...vertex,
        world: vector(vertex.world),
        clickWorld: vector(vertex.clickWorld),
        click: clientPointForWorldPoint(vertex.clickWorld),
      }));
    },
    getTransformState(objectId) {
      const state = app.runtimeController.getSnapshot().representation.exactSceneState?.[objectId];
      if (!state) {
        return null;
      }
      return {
        position: vector(state.position),
        rotation: euler(state.rotation),
        scale: vector(state.scale),
      };
    },
    getObjectClientPoint(objectId) {
      const mesh = meshForObject(objectId);
      if (!mesh) {
        return null;
      }
      mesh.updateMatrixWorld(true);
      const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      return clientPointForWorldPoint(center);
    },
    getCanvasPointForObject(objectName) {
      const objectId = objectIdForName(objectName);
      return this.getObjectClientPoint(objectId);
    },
    getCanvasPointForFace(objectName, faceIndex) {
      const face = this.getFaceData(objectName).find((entry) => entry.faceIndex === faceIndex);
      return face?.click ?? null;
    },
    getCanvasPointForEdge(objectName, edgeIndex) {
      const edge = this.getEdgeData(objectName).find((entry) => entry.edgeIndex === edgeIndex);
      return edge?.click ?? null;
    },
    getCanvasPointForVertex(objectName, vertexIndex) {
      const vertex = this.getVertexData(objectName).find((entry) => entry.vertexIndex === vertexIndex);
      return vertex?.click ?? null;
    },
    getCanvasPointForWorldPoint(point) {
      return clientPointForWorldPoint(new THREE.Vector3(point?.x ?? 0, point?.y ?? 0, point?.z ?? 0));
    },
    getPolylineDrawPath({ objectName = "cube", faceIndex = 0, points = [] } = {}) {
      const face = this.getFaceData(objectName).find((entry) => entry.faceIndex === faceIndex);
      if (!face) {
        return null;
      }
      const center = new THREE.Vector3(face.center.x, face.center.y, face.center.z);
      const normal = new THREE.Vector3(face.normal.x, face.normal.y, face.normal.z).normalize();
      const tangentA = Math.abs(normal.y) > 0.9
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0).cross(normal).normalize();
      const tangentB = normal.clone().cross(tangentA).normalize();
      return points.map((point) => {
        const world = center.clone()
          .add(tangentA.clone().multiplyScalar(point?.x ?? 0))
          .add(tangentB.clone().multiplyScalar(point?.y ?? 0));
        return {
          world: vector(world),
          client: clientPointForWorldPoint(world),
        };
      });
    },
    getMoveDragPoints(objectId, delta) {
      const mesh = meshForObject(objectId);
      if (!mesh) {
        return null;
      }
      mesh.updateMatrixWorld(true);
      const start = this.getObjectClientPoint(objectId);
      if (!start) {
        return null;
      }

      app.selectionPipeline.rayFromClient(start.x, start.y);
      const hit = app.selectionPipeline.raycaster.intersectObject(mesh, false)[0] ?? null;
      if (!hit?.point) {
        return null;
      }

      const endWorldPoint = hit.point.clone().add(new THREE.Vector3(delta?.x ?? 0, delta?.y ?? 0, delta?.z ?? 0));
      return {
        start,
        end: clientPointForWorldPoint(endWorldPoint),
        hit: vector(hit.point),
        delta: vector(delta),
      };
    },
    getDragPath({ objectName = "cube", faceIndex = null, edgeIndex = null, vertexIndex = null, worldDelta = null, screenDelta = null } = {}) {
      const objectId = objectIdForName(objectName);
      let start = null;
      if (Number.isInteger(faceIndex)) {
        start = this.getCanvasPointForFace(objectName, faceIndex);
      } else if (Number.isInteger(edgeIndex)) {
        start = this.getCanvasPointForEdge(objectName, edgeIndex);
      } else if (Number.isInteger(vertexIndex)) {
        start = this.getCanvasPointForVertex(objectName, vertexIndex);
      } else {
        start = this.getObjectClientPoint(objectId);
      }
      if (!start) {
        return null;
      }

      if (screenDelta) {
        return {
          start,
          end: {
            x: round(start.x + (screenDelta.x ?? 0)),
            y: round(start.y + (screenDelta.y ?? 0)),
          },
        };
      }

      const face = Number.isInteger(faceIndex)
        ? this.getFaceData(objectName).find((entry) => entry.faceIndex === faceIndex)
        : null;
      const vertex = Number.isInteger(vertexIndex)
        ? this.getVertexData(objectName).find((entry) => entry.vertexIndex === vertexIndex)
        : null;
      let worldPoint = null;
      if (face) {
        worldPoint = new THREE.Vector3(face.center.x, face.center.y, face.center.z);
      } else if (vertex) {
        const anchor = new THREE.Vector3(vertex.world.x, vertex.world.y, vertex.world.z);
        const movePlane = screenMovePlaneFromPoint(anchor, app.viewport.camera);
        worldPoint = app.selectionPipeline.pointOnPlane({
          clientX: start.x,
          clientY: start.y,
          plane: movePlane,
        }) ?? anchor;
      } else {
        worldPoint = hitPointAtClient(meshForObject(objectId), start, app);
      }
      if (!worldPoint || !worldDelta) {
        return null;
      }
      const endWorldPoint = worldPoint.clone().add(
        new THREE.Vector3(worldDelta.x ?? 0, worldDelta.y ?? 0, worldDelta.z ?? 0),
      );
      return {
        start,
        end: clientPointForWorldPoint(endWorldPoint),
      };
    },
    nextFrame(count = 2) {
      const frames = Math.max(1, Math.floor(count));
      return new Promise((resolve) => {
        const step = (remaining) => {
          if (remaining <= 0) {
            resolve();
            return;
          }
          requestAnimationFrame(() => step(remaining - 1));
        };
        step(frames);
      });
    },
  };
}

function objectTransformState(sceneState = {}) {
  return Object.fromEntries(
    Object.entries(sceneState).map(([objectId, state]) => [
      objectId,
      {
        primitive: state.primitive,
        position: {
          x: Math.round((state.position?.x ?? 0) * 1000000) / 1000000,
          y: Math.round((state.position?.y ?? 0) * 1000000) / 1000000,
          z: Math.round((state.position?.z ?? 0) * 1000000) / 1000000,
        },
        rotation: {
          x: Math.round((state.rotation?.x ?? 0) * 1000000) / 1000000,
          y: Math.round((state.rotation?.y ?? 0) * 1000000) / 1000000,
          z: Math.round((state.rotation?.z ?? 0) * 1000000) / 1000000,
        },
        scale: {
          x: Math.round((state.scale?.x ?? 0) * 1000000) / 1000000,
          y: Math.round((state.scale?.y ?? 0) * 1000000) / 1000000,
          z: Math.round((state.scale?.z ?? 0) * 1000000) / 1000000,
        },
      },
    ]),
  );
}

function meshSummaries(meshes, vector) {
  return meshes.map((mesh) => meshSummaryFor(mesh, vector));
}

function meshSummaryFor(mesh, vector) {
  mesh.updateMatrixWorld(true);
  const geometry = mesh.geometry;
  const position = geometry?.attributes?.position;
  const index = geometry?.index;
  const worldBounds = new THREE.Box3().setFromObject(mesh);
  return {
    objectId: mesh.userData.objectId ?? null,
    geometrySignature: mesh.userData.geometrySignature ?? null,
    vertexCount: position?.count ?? 0,
    triangleCount: index ? Math.floor(index.count / 3) : Math.floor((position?.count ?? 0) / 3),
    worldBounds: {
      min: vector(worldBounds.min),
      max: vector(worldBounds.max),
    },
  };
}

function deterministicBoxFaces(bounds, mesh = null) {
  const center = bounds.getCenter(new THREE.Vector3());
  const faces = [
    {
      faceIndex: 0,
      role: "top",
      provenanceRole: "face.py",
      normal: new THREE.Vector3(0, 1, 0),
      center: new THREE.Vector3(center.x, bounds.max.y, center.z),
    },
    {
      faceIndex: 1,
      role: "right",
      provenanceRole: "face.px",
      normal: new THREE.Vector3(1, 0, 0),
      center: new THREE.Vector3(bounds.max.x, center.y, center.z),
    },
    {
      faceIndex: 2,
      role: "front",
      provenanceRole: "face.pz",
      normal: new THREE.Vector3(0, 0, 1),
      center: new THREE.Vector3(center.x, center.y, bounds.max.z),
    },
    {
      faceIndex: 3,
      role: "left",
      provenanceRole: "face.nx",
      normal: new THREE.Vector3(-1, 0, 0),
      center: new THREE.Vector3(bounds.min.x, center.y, center.z),
    },
    {
      faceIndex: 4,
      role: "back",
      provenanceRole: "face.nz",
      normal: new THREE.Vector3(0, 0, -1),
      center: new THREE.Vector3(center.x, center.y, bounds.min.z),
    },
    {
      faceIndex: 5,
      role: "bottom",
      provenanceRole: "face.ny",
      normal: new THREE.Vector3(0, -1, 0),
      center: new THREE.Vector3(center.x, bounds.min.y, center.z),
    },
  ];

  const provenanceCenters = mesh ? provenanceFaceCenters(mesh) : new Map();
  return faces.map((face) => ({
    ...face,
    center: provenanceCenters.get(face.provenanceRole) ?? face.center,
  }));
}

function deterministicBoxEdges(bounds) {
  const center = bounds.getCenter(new THREE.Vector3());
  const inset = Math.max(0.01, Math.min(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z) * 0.02);
  return [
    {
      edgeIndex: 0,
      role: "top-right",
      keys: ["px_py_nz", "px_py_pz"],
      a: new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
      b: new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
      center: new THREE.Vector3(bounds.max.x, bounds.max.y, center.z),
      clickWorld: new THREE.Vector3(bounds.max.x - inset, bounds.max.y, center.z),
    },
    {
      edgeIndex: 1,
      role: "top-front",
      keys: ["nx_py_pz", "px_py_pz"],
      a: new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
      b: new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
      center: new THREE.Vector3(center.x, bounds.max.y, bounds.max.z),
      clickWorld: new THREE.Vector3(center.x, bounds.max.y, bounds.max.z - inset),
    },
    {
      edgeIndex: 2,
      role: "front-right",
      keys: ["px_ny_pz", "px_py_pz"],
      a: new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
      b: new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
      center: new THREE.Vector3(bounds.max.x, center.y, bounds.max.z),
      clickWorld: new THREE.Vector3(bounds.max.x, center.y, bounds.max.z - inset),
    },
  ];
}

function deterministicBoxVertices(bounds) {
  const inset = Math.max(0.01, Math.min(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z) * 0.02);
  return [
    {
      vertexIndex: 0,
      role: "top-right-front",
      key: "px_py_pz",
      world: new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
      clickWorld: new THREE.Vector3(bounds.max.x - inset, bounds.max.y, bounds.max.z - inset),
    },
    {
      vertexIndex: 1,
      role: "top-left-front",
      key: "nx_py_pz",
      world: new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
      clickWorld: new THREE.Vector3(bounds.min.x + inset, bounds.max.y, bounds.max.z - inset),
    },
  ];
}

function provenanceFaceCenters(mesh) {
  const centers = new Map();
  const geometry = mesh.geometry;
  const position = geometry?.attributes?.position;
  const index = geometry?.index;
  const provenance = geometry?.userData?.faceProvenance;
  if (!position || !index || !Array.isArray(provenance)) {
    return centers;
  }

  const accumulators = new Map();
  const local = new THREE.Vector3();
  for (let triangle = 0; triangle < Math.floor(index.count / 3); triangle += 1) {
    const role = provenance[triangle]?.role;
    if (!role) {
      continue;
    }
    const accumulator = accumulators.get(role) ?? { sum: new THREE.Vector3(), count: 0 };
    for (let corner = 0; corner < 3; corner += 1) {
      const vertexIndex = index.getX(triangle * 3 + corner);
      local.fromBufferAttribute(position, vertexIndex);
      accumulator.sum.add(mesh.localToWorld(local.clone()));
      accumulator.count += 1;
    }
    accumulators.set(role, accumulator);
  }

  for (const [role, accumulator] of accumulators.entries()) {
    if (accumulator.count > 0) {
      centers.set(role, accumulator.sum.multiplyScalar(1 / accumulator.count));
    }
  }
  return centers;
}

function worldCenterForObject(mesh) {
  if (!mesh) {
    return null;
  }
  mesh.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
}

function hitPointAtClient(mesh, point, app) {
  if (!mesh || !point) {
    return null;
  }
  app.selectionPipeline.rayFromClient(point.x, point.y);
  const hit = app.selectionPipeline.raycaster.intersectObject(mesh, false)[0] ?? null;
  return hit?.point?.clone?.() ?? worldCenterForObject(mesh);
}

function screenMovePlaneFromPoint(point, camera) {
  const normal = camera.getWorldDirection(new THREE.Vector3()).normalize();
  if (normal.lengthSq() < 1e-8) {
    normal.set(0, 0, -1);
  }
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
}

function normalizedFeatureGraphSnapshot(features = []) {
  const childrenById = new Map();
  for (const feature of features) {
    for (const parentId of feature.dependsOn ?? []) {
      const children = childrenById.get(parentId) ?? [];
      children.push(feature.id);
      childrenById.set(parentId, children);
    }
  }

  return {
    featureCount: features.length,
    features: features.map((feature) => ({
      id: feature.id,
      type: feature.type,
      dependsOn: [...(feature.dependsOn ?? [])],
      children: childrenById.get(feature.id) ?? [],
      target: {
        objectId: feature.target?.objectId ?? null,
        selection: feature.target?.selection ? structuredClone(feature.target.selection) : null,
      },
      params: structuredClone(feature.params ?? {}),
    })),
  };
}
