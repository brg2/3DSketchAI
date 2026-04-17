import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { Viewport } from "../view/viewport.js";
import { Overlay } from "../view/overlay.js";
import { SelectionPipeline } from "../interaction/selection-pipeline.js";
import { ToolStateMachine } from "../interaction/tool-state-machine.js";
import { TouchGestureHandler } from "../interaction/touch-gesture-handler.js";
import { RuntimeController } from "./runtime-controller.js";
import { RepresentationStore } from "../representation/representation-store.js";
import { CanonicalModel } from "../modeling/canonical-model.js";
import { ModelExecutor } from "../modeling/model-executor.js";
import { ModelScriptHistory } from "../modeling/model-script-history.js";
import { AppSessionStore } from "../persistence/app-session-store.js";
import { ModelScriptHistoryStore } from "../persistence/model-script-history-store.js";
import { createGroupingOperation, createPrimitiveOperation, mapToolGestureToOperation } from "../operation/operation-mapper.js";
import { OPERATION_TYPES, SELECTION_MODES } from "../operation/operation-types.js";
import {
  GROUND_THEMES,
  normalizeGroundTheme,
  normalizeElevationVariation,
  normalizeTerrainDensity,
  normalizeTerrainSeed,
  normalizeTerrainVariation,
} from "../environment/ground-theme.js";

const TOOL_CONFIG = [
  { id: "select", label: "Select", icon: "cursor" },
  { id: "move", label: "Move", icon: "move" },
  { id: "rotate", label: "Rotate", icon: "rotate" },
  { id: "pushPull", label: "Push/Pull", icon: "pushPull" },
];

const DEFAULT_GROUND_THEME = GROUND_THEMES.FOREST;
const DEFAULT_ELEVATION_VARIATION = 1;
const DEFAULT_TERRAIN_VARIATION = 0.5;
const DEFAULT_TERRAIN_DENSITY = 0.5;
const DEFAULT_TERRAIN_SEED = 0;
const DEFAULT_MODEL_NAME = "Untitled";
const TOUCH_PICK_OFFSETS = Object.freeze([
  [0, 0],
  [0, -14],
  [14, 0],
  [0, 14],
  [-14, 0],
  [10, -10],
  [10, 10],
  [-10, 10],
  [-10, -10],
]);

const STATIC_BUTTON_ICONS = Object.freeze({
  undo: "undo",
  redo: "redo",
  reset: "plus",
  export: "export",
  primitive: "cube",
  zoomExtents: "zoomExtents",
  group: "group",
  component: "component",
  object: "cube",
  face: "face",
  edge: "edge",
  vertex: "vertex",
});

export class SketchApp {
  constructor({
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
    groundThemeSelect,
    elevationVariationInput,
    elevationVariationValue,
    terrainVariationInput,
    terrainVariationValue,
    terrainDensityInput,
    terrainDensityValue,
    sidebarElement,
    sidebarScrollElement,
    toolGrid,
  }) {
    this.canvas = canvas;
    this.codeElement = codeElement;
    this.codePanel = codePanel;
    this.codeToggle = codeToggle;
    this.codeCopyButton = codeCopyButton;
    this.codeCompressButton = codeCompressButton;
    this.docNameElement = docNameElement;
    this.modelOpenButton = modelOpenButton;
    this.modelOpenInput = modelOpenInput;
    this.modelSaveButton = modelSaveButton;
    this.exportToggleButton = exportToggleButton;
    this.exportMenu = exportMenu;
    this.panelTabButtons = Array.isArray(panelTabButtons) ? panelTabButtons : [];
    this.gridToggleButton = gridToggleButton;
    this.groundEffectsToggleButton = groundEffectsToggleButton;
    this.devConsoleToggleButton = devConsoleToggleButton;
    this.groundRegenerateButton = groundRegenerateButton;
    this.groundThemeSelect = groundThemeSelect;
    this.elevationVariationInput = elevationVariationInput;
    this.elevationVariationValue = elevationVariationValue;
    this.terrainVariationInput = terrainVariationInput;
    this.terrainVariationValue = terrainVariationValue;
    this.terrainDensityInput = terrainDensityInput;
    this.terrainDensityValue = terrainDensityValue;
    this.sidebarElement = sidebarElement;
    this.sidebarScrollElement = sidebarScrollElement;
    this.codeCopyResetTimer = null;
    this.codeCollapsed = false;
    this.panelPage = "script";
    this.devConsoleVisible = false;
    this.modelName = DEFAULT_MODEL_NAME;
    this.exportMenuOpen = false;
    this.appSessionStore = new AppSessionStore();
    this.modelHistoryStore = new ModelScriptHistoryStore();
    this.modelHistory = new ModelScriptHistory();
    this.actionButtons = new Map();
    this.sessionPersistTimer = null;
    this.lastPersistedSessionSignature = "";
    this.isRestoringSession = false;

    this.viewport = new Viewport({ canvas });
    this.overlay = new Overlay({ element: overlayElement });

    this.representationStore = new RepresentationStore();
    this.selectionPipeline = new SelectionPipeline({
      camera: this.viewport.camera,
      domElement: this.viewport.renderer.domElement,
    });
    this.tools = new ToolStateMachine();
    this.hoveredObjectId = null;
    this.hoveredHit = null;
    this.activeTouchPointers = new Map();
    this.activeTouchMode = null;
    this.activeTouchToolPointerId = null;
    this.suppressMouseInteractionUntil = 0;
    this.touchDebugEnabled = new URLSearchParams(window.location.search).has("touchDebug")
      || window.localStorage?.getItem?.("3dsai.touchDebug") === "1";
    this.touchDebugElement = null;

    this.objectCounter = 1;

    this.runtimeController = new RuntimeController({
      canonicalModel: new CanonicalModel(),
      modelExecutor: new ModelExecutor(),
      representationStore: this.representationStore,
      onCanonicalCodeChanged: (code) => {
        this.codeElement.textContent = code;
      },
    });

    this.runtimeController.initialize({ scene: this.viewport.scene, seedSceneState: {} });
    this._initPreselectionOverlays();
    this.viewport.controls.addEventListener("change", () => {
      this._scheduleSessionPersist();
    });

    this._buildToolButtons(toolGrid);
    this._attachInputHandlers();
    this._attachUiHandlers();
    this._attachCodePanelHandlers();
    this._attachSidebarScrollHandlers();

    this.canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (event.pointerType === "touch" && !event.isPrimary) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    this.touchGestureHandler = new TouchGestureHandler({ viewport: this.viewport });
    this.touchGestureHandler.attach(this.canvas);
  }

  async start() {
    let loadedOperations = await this.runtimeController.loadCanonicalModelFromStorage({
      reload: true,
      cleanSlate: true,
    });
    if (loadedOperations.length === 0) {
      const defaultResult = await this.runtimeController.ensureDefaultModel();
      loadedOperations = defaultResult.operations;
      this.modelHistory.reset(defaultResult.canonicalCode ?? this.runtimeController.getSnapshot().canonicalCode, {
        label: "Initial Cube",
      });
      await this._persistModelHistory();
    }
    this._syncObjectCounterFromOperations(loadedOperations);

    const sessionState = await this._loadSessionState();
    this._applySessionState(sessionState);
    if (!sessionState) {
      this._setActiveTool("pushPull", { render: false });
      this._setSelectionMode(SELECTION_MODES.FACE, { render: false });
    }
    await this._persistSessionState();
    await this._restoreModelHistory();
    this._syncHistoryButtons();

    this._tick();
  }

  _buildToolButtons(toolGrid) {
    for (const tool of TOOL_CONFIG) {
      const button = document.createElement("button");
      button.type = "button";
      button.classList.add("icon-btn", "tool-btn");
      button.dataset.tool = tool.id;
      this._setButtonIcon(button, tool.icon, tool.label);
      if (tool.id === this.tools.activeTool) {
        button.classList.add("active");
      }
      button.addEventListener("click", () => {
        this._setActiveTool(tool.id);
        void this._persistSessionState();
      });
      toolGrid.appendChild(button);
    }
  }

  _syncToolButtons() {
    for (const button of document.querySelectorAll("[data-tool]")) {
      button.classList.toggle("active", button.dataset.tool === this.tools.activeTool);
    }
  }

  _attachInputHandlers() {
    this.canvas.addEventListener("pointerdown", async (event) => {
      if (event.pointerType === "touch") {
        if (this._beginTouchNavigation(event)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }

      if (this._shouldSuppressPointerInteraction(event)) {
        return;
      }

      if ((event.buttons & 3) === 3) {
        this._cancelActiveToolInteraction();
        this.viewport.beginCursorPanOrbit({
          clientX: event.clientX,
          clientY: event.clientY,
          pointerId: event.pointerId,
        });
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (event.button === 2) {
        this.viewport.beginCursorNavigation({
          clientX: event.clientX,
          clientY: event.clientY,
          orbitMode: !event.shiftKey,
          allowShiftOrbit: true,
          baseMode: "orbit",
          shiftMode: "pan",
        });
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (event.button !== 0) {
        this.viewport.cancelCursorOrbit();
        return;
      }

      this.viewport.cancelCursorOrbit();
      this.viewport.cancelCursorPan();

      const selectionResult = this.selectionPipeline.pick({
        clientX: event.clientX,
        clientY: event.clientY,
        selectableMeshes: this.representationStore.getSelectableMeshes(),
        multiSelect: event.shiftKey,
      });
      this.hoveredObjectId = selectionResult?.selection?.objectId ?? null;
      this.hoveredHit = selectionResult?.hit ?? null;

      this._applySelectionHighlights();
      this._renderOverlay();
      this._scheduleSessionPersist();

      if (!selectionResult.selection || !this.tools.canStartDrag()) {
        this.viewport.beginCursorNavigation({
          clientX: event.clientX,
          clientY: event.clientY,
          orbitMode: event.shiftKey,
          allowShiftOrbit: true,
          baseMode: "pan",
          shiftMode: "orbit",
        });
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      const selectedObjectId = selectionResult.selection.objectId;
      if (!selectedObjectId) {
        return;
      }

      this._startToolDrag(event, selectionResult);
      event.preventDefault();
      event.stopImmediatePropagation();
      this._renderOverlay();
    }, { capture: true });

    this.canvas.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") {
        if (this._handleTouchPointerMove(event)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }

      if (this._shouldSuppressPointerInteraction(event)) {
        return;
      }

      if (event.buttons && (event.buttons & 1) === 0) {
        return;
      }

      if (!this.tools.dragState) {
        const hover = this.selectionPipeline.hover({
          clientX: event.clientX,
          clientY: event.clientY,
          selectableMeshes: this.representationStore.getSelectableMeshes(),
        });
        this.hoveredObjectId = hover.objectId;
        this.hoveredHit = hover.hit;
        this._applySelectionHighlights();
        this._renderOverlay();
        return;
      }
      this._updateToolDrag(event);
    });

    window.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "touch" || !this.activeTouchPointers.has(event.pointerId)) {
        return;
      }

      this.activeTouchPointers.set(event.pointerId, this._touchPointerSnapshot(event));
      if (this._handleTouchPointerMove(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { capture: true, passive: false });

    this.canvas.addEventListener("pointerleave", () => {
      this._clearHoverState();
    });

    this.canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    }, { capture: true });

    window.addEventListener("pointerup", async (event) => {
      if (event.pointerType === "touch") {
        await this._endTouchNavigation(event);
        return;
      }

      if (this._shouldSuppressPointerInteraction(event)) {
        this._cancelActiveToolInteraction();
        return;
      }

      await this._commitToolDrag();
    });

    window.addEventListener("pointercancel", (event) => {
      if (event.pointerType === "touch") {
        this._cancelTouchNavigation(event);
      }
    });

    this.canvas.addEventListener("touchmove", (event) => {
      if (this._handleNativeTouchMove(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { capture: true, passive: false });

    this.canvas.addEventListener("touchend", (event) => {
      if (this._handleNativeTouchEnd(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { capture: true, passive: false });

    this.canvas.addEventListener("touchcancel", (event) => {
      if (this._handleNativeTouchCancel(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { capture: true, passive: false });

    window.addEventListener("keydown", (event) => {
      if (this._isEditableEventTarget(event.target)) {
        return;
      }

      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        void this.redoModel();
      } else if (key === "z") {
        event.preventDefault();
        void this.undoModel();
      } else if (key === "y") {
        event.preventDefault();
        void this.redoModel();
      }
    });
  }

  _attachUiHandlers() {
    for (const button of document.querySelectorAll("[data-selection-mode]")) {
      button.classList.add("icon-btn");
      this._setButtonIcon(button, STATIC_BUTTON_ICONS[button.dataset.selectionMode], button.textContent.trim());

      button.addEventListener("click", () => {
        this._setSelectionMode(button.dataset.selectionMode);
        void this._persistSessionState();
      });
    }
    this._syncSelectionModeButtons();

    for (const button of document.querySelectorAll("[data-action]")) {
      button.classList.add("icon-btn");
      this._setButtonIcon(button, STATIC_BUTTON_ICONS[button.dataset.action], button.textContent.trim());
      this.actionButtons.set(button.dataset.action, button);
      button.addEventListener("click", async () => {
        const action = button.dataset.action;
        if (action === "undo") {
          await this.undoModel();
          return;
        }

        if (action === "redo") {
          await this.redoModel();
          return;
        }

        if (action === "reset") {
          await this.runtimeController.clearCanonicalModel();
          await this.appSessionStore.clear().catch(() => {});
          this.representationStore.setInitialSceneState({});
          this.selectionPipeline.selectedObjectIds = [];
          this.hoveredObjectId = null;
          this.hoveredHit = null;
          this.objectCounter = 1;
          this._setModelName(DEFAULT_MODEL_NAME);
          this._setPanelPage("script");
          this._setGridVisible(false);
          const result = await this.runtimeController.ensureDefaultModel();
          this.modelHistory.reset(result?.canonicalCode ?? this.runtimeController.getSnapshot().canonicalCode, {
            label: "New",
          });
          await this._persistModelHistory();
          this.objectCounter = 2;
          this.selectionPipeline.selectedObjectIds = ["obj_1"];
          this._applySelectionHighlights();
          this._renderOverlay();
          await this._persistSessionState();
          return;
        }

        if (action === "primitive") {
          await this.createPrimitive();
          this._renderOverlay();
          this._scheduleSessionPersist();
          return;
        }

        if (action === "zoomExtents") {
          this.viewport.zoomToObjectsExtents(this.representationStore.getSelectableMeshes());
          this._renderOverlay();
          this._scheduleSessionPersist();
          return;
        }

        if (action === "group") {
          await this.groupSelected();
          this._renderOverlay();
          this._scheduleSessionPersist();
          return;
        }

        if (action === "component") {
          await this.componentSelected();
          this._renderOverlay();
          this._scheduleSessionPersist();
          return;
        }
      });
    }

    this._attachDocumentNameHandlers();
    this._attachModelFileHandlers();
    this._attachExportHandlers();
  }

  _attachDocumentNameHandlers() {
    if (!this.docNameElement) {
      return;
    }

    this.docNameElement.addEventListener("focus", () => {
      this._selectDocumentNameText();
    });
    this.docNameElement.addEventListener("pointerup", (event) => {
      if (document.activeElement === this.docNameElement) {
        event.preventDefault();
        this._selectDocumentNameText();
      }
    });
    this.docNameElement.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.docNameElement.blur();
      }
    });
    this.docNameElement.addEventListener("input", () => {
      this.modelName = this._normalizeModelName(this.docNameElement.textContent);
      this._scheduleSessionPersist();
    });
    this.docNameElement.addEventListener("blur", () => {
      this._setModelName(this.modelName);
      void this._persistSessionState();
    });
  }

  _selectDocumentNameText() {
    if (!this.docNameElement) {
      return;
    }

    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(this.docNameElement);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  _attachModelFileHandlers() {
    this.modelSaveButton?.addEventListener("click", () => {
      this._saveModelScriptToFile();
    });
    this.modelOpenButton?.addEventListener("click", () => {
      this.modelOpenInput?.click();
    });
    this.modelOpenInput?.addEventListener("change", () => {
      const file = this.modelOpenInput.files?.[0] ?? null;
      this.modelOpenInput.value = "";
      if (file) {
        void this._openModelScriptFile(file);
      }
    });
  }

  _attachExportHandlers() {
    if (!this.exportToggleButton || !this.exportMenu) {
      return;
    }

    this.exportToggleButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this._setExportMenuOpen(!this.exportMenuOpen);
    });
    this.exportMenu.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-export-format]") : null;
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      this._setExportMenuOpen(false);
      void this._exportModel(button.dataset.exportFormat);
    });
    document.addEventListener("pointerdown", (event) => {
      if (!this.exportMenuOpen) {
        return;
      }
      const target = event.target;
      if (target instanceof Node && (this.exportMenu.contains(target) || this.exportToggleButton.contains(target))) {
        return;
      }
      this._setExportMenuOpen(false);
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.exportMenuOpen) {
        this._setExportMenuOpen(false);
        this.exportToggleButton.focus();
      }
    });
  }

  async createPrimitive() {
    const objectId = `obj_${this.objectCounter++}`;
    const position = {
      x: (Math.random() - 0.5) * 4,
      y: 0.6,
      z: (Math.random() - 0.5) * 4,
    };

    const operation = createPrimitiveOperation({
      primitive: "box",
      position,
      size: { x: 1, y: 1, z: 1 },
      objectId,
    });

    const result = await this.runtimeController.commitOperation(operation);
    await this._recordModelHistory(result?.canonicalCode, "Create Primitive");
    this.selectionPipeline.selectedObjectIds = [objectId];
    this._applySelectionHighlights();
    this._scheduleSessionPersist();
  }

  async groupSelected() {
    if (this.selectionPipeline.selectedObjectIds.length < 2) {
      return;
    }

    const operation = createGroupingOperation({
      type: OPERATION_TYPES.GROUP,
      objectIds: this.selectionPipeline.selectedObjectIds,
      groupId: `group_${Date.now()}`,
    });

    const result = await this.runtimeController.commitOperation(operation);
    await this._recordModelHistory(result?.canonicalCode, "Group");
    this._scheduleSessionPersist();
  }

  async componentSelected() {
    if (this.selectionPipeline.selectedObjectIds.length < 1) {
      return;
    }

    const operation = createGroupingOperation({
      type: OPERATION_TYPES.COMPONENT,
      objectIds: this.selectionPipeline.selectedObjectIds,
      componentId: `component_${Date.now()}`,
    });

    const result = await this.runtimeController.commitOperation(operation);
    await this._recordModelHistory(result?.canonicalCode, "Component");
    this._scheduleSessionPersist();
  }

  _setExportMenuOpen(open) {
    this.exportMenuOpen = Boolean(open);
    if (!this.exportMenu || !this.exportToggleButton) {
      return;
    }

    this.exportMenu.hidden = !this.exportMenuOpen;
    this.exportToggleButton.setAttribute("aria-expanded", String(this.exportMenuOpen));
  }

  _saveModelScriptToFile() {
    this._downloadTextFile(this._modelFileName("ts"), this.codeElement?.textContent ?? "", "text/typescript;charset=utf-8");
  }

  async _openModelScriptFile(file) {
    if (!file || typeof file.text !== "function") {
      return;
    }

    try {
      const scriptText = await file.text();
      await this.runtimeController.reloadFromCanonicalCode(scriptText, { cleanSlate: true });
      const canonicalCode = await this.runtimeController.persistCanonicalModel();
      this.modelHistory.reset(canonicalCode, { label: "Open" });
      await this._persistModelHistory();
      this.objectCounter = 1;
      this._syncObjectCounterFromOperations(this.runtimeController.canonicalModel.getOperations());
      this.selectionPipeline.selectedObjectIds = [];
      this.hoveredObjectId = null;
      this.hoveredHit = null;
      this._setModelName(this._modelNameFromFileName(file.name));
      this._setPanelPage("script");
      this._applySelectionHighlights();
      this._renderOverlay();
      await this._persistSessionState();
    } catch (error) {
      console.warn("Failed to open model script", error);
    }
  }

  async _exportModel(format) {
    const normalizedFormat = format === "glb" || format === "obj" || format === "stl" ? format : null;
    if (!normalizedFormat) {
      return;
    }

    try {
      const exportGroup = this._createModelExportGroup();
      if (!exportGroup) {
        return;
      }

      try {
        if (normalizedFormat === "obj") {
          const objText = new OBJExporter().parse(exportGroup);
          this._downloadTextFile(this._modelFileName("obj"), objText, "model/obj;charset=utf-8");
          return;
        }

        if (normalizedFormat === "stl") {
          const stlText = new STLExporter().parse(exportGroup, { binary: false });
          this._downloadTextFile(this._modelFileName("stl"), stlText, "model/stl;charset=utf-8");
          return;
        }

        const glb = await this._exportGlb(exportGroup);
        this._downloadBlob(this._modelFileName("glb"), new Blob([glb], { type: "model/gltf-binary" }));
      } finally {
        disposeExportGroup(exportGroup);
      }
    } catch (error) {
      console.warn("Failed to export model", error);
    }
  }

  _createModelExportGroup() {
    const meshes = this.representationStore.getSelectableMeshes().filter((mesh) => mesh.visible !== false);
    if (meshes.length === 0) {
      return null;
    }

    const group = new THREE.Group();
    group.name = this._safeModelFileStem();
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const clone = new THREE.Mesh(mesh.geometry.clone(), cloneMaterialForExport(mesh.material));
      clone.name = mesh.userData.objectId || mesh.name || "model_part";
      clone.castShadow = false;
      clone.receiveShadow = false;
      mesh.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
      group.add(clone);
    }
    return group;
  }

  _exportGlb(exportGroup) {
    return new Promise((resolve, reject) => {
      new GLTFExporter().parse(
        exportGroup,
        (result) => resolve(result),
        (error) => reject(error),
        { binary: true, onlyVisible: true, trs: true },
      );
    });
  }

  _downloadTextFile(filename, contents, type) {
    const blob = new Blob([contents], { type });
    this._downloadBlob(filename, blob);
  }

  _downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  _modelFileName(extension) {
    return `${this._safeModelFileStem()}.${extension}`;
  }

  _safeModelFileStem() {
    const normalizedName = this._normalizeModelName(this.modelName);
    return normalizedName
      .trim()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "untitled";
  }

  _modelNameFromFileName(filename) {
    const baseName = String(filename ?? "").replace(/\.[^.]+$/, "");
    return this._normalizeModelName(baseName);
  }

  _setModelName(name) {
    this.modelName = this._normalizeModelName(name);
    if (this.docNameElement && this.docNameElement.textContent !== this.modelName) {
      this.docNameElement.textContent = this.modelName;
    }
  }

  _normalizeModelName(name) {
    const normalized = String(name ?? "")
      .replace(/\s+/g, " ")
      .trim();
    return normalized || DEFAULT_MODEL_NAME;
  }

  _applySelectionHighlights() {
    const selected = new Set(this.selectionPipeline.selectedObjectIds);
    const objectHoverEnabled = this.selectionPipeline.selectionMode === SELECTION_MODES.OBJECT;
    const objectSelectionEnabled = this.selectionPipeline.selectionMode === SELECTION_MODES.OBJECT;
    for (const mesh of this.representationStore.getSelectableMeshes()) {
      const objectId = mesh.userData.objectId;
      if (objectSelectionEnabled && selected.has(objectId)) {
        mesh.material.emissive?.setHex(0x183a5b);
        mesh.material.color.setHex(0x7dc8ff);
      } else if (objectHoverEnabled && objectId === this.hoveredObjectId) {
        mesh.material.emissive?.setHex(0x1d4468);
        mesh.material.color.setHex(0x7dc8ff);
      } else {
        mesh.material.emissive?.setHex(0x000000);
        mesh.material.color.setHex(0x7aa2f7);
      }
    }

    this._updatePreselectionOverlays();
  }

  _renderOverlay() {
    if (!this.devConsoleVisible) {
      this.overlay.setVisible(false);
      return;
    }

    const snapshot = this.runtimeController.getSnapshot();
    this.overlay.render({
      tool: this.tools.activeTool,
      selectionMode: this.selectionPipeline.selectionMode,
      selectedIds: this.selectionPipeline.selectedObjectIds,
      hoveredId: this.hoveredObjectId,
      previewing: snapshot.hasActiveSession,
      exactBackend: snapshot.exactBackend,
      operationCount: snapshot.operationCount,
    });
  }

  _tick() {
    this._applySelectionHighlights();
    this.viewport.frame();
    this._renderOverlay();
    requestAnimationFrame(() => this._tick());
  }

  _buildDragContext(event, selectionResult, { shiftKey = false } = {}) {
    const hit = selectionResult?.hit;
    if (!hit?.point || !hit?.object) {
      return null;
    }

    if (this.tools.activeTool === "pushPull") {
      const axisObj = selectionResult?.selection?.faceNormalWorld ?? { x: 0, y: 0, z: 1 };
      const axis = new THREE.Vector3(axisObj.x ?? 0, axisObj.y ?? 0, axisObj.z ?? 1);
      if (axis.lengthSq() < 1e-8) {
        axis.set(0, 0, 1);
      } else {
        axis.normalize();
      }

      const origin = hit.point.clone();
      const startDistance = this._axisDistanceFromPointer(event, origin, axis);

      return {
        mode: "pushPull",
        axis,
        origin,
        startDistance: startDistance ?? 0,
      };
    }

    if (this.tools.activeTool === "rotate" && selectionResult?.selection?.mode === SELECTION_MODES.FACE) {
      return {
        mode: "face-rotate",
        activeShift: Boolean(shiftKey),
        startDx: 0,
        baseAngles: { normal: 0, alternate: 0 },
      };
    }

    if (selectionResult?.selection?.mode === SELECTION_MODES.VERTEX && !shiftKey) {
      const vertexWorld = selectionResult.selection.vertex?.world;
      const anchor = vertexWorld
        ? new THREE.Vector3(vertexWorld.x ?? 0, vertexWorld.y ?? 0, vertexWorld.z ?? 0)
        : hit.point.clone();
      const movePlane = this._screenMovePlaneFromPoint(anchor);
      const startPoint =
        this.selectionPipeline.pointOnPlane({
          clientX: event.clientX,
          clientY: event.clientY,
          plane: movePlane,
        }) ?? anchor.clone();

      return {
        mode: "move",
        projector: "screen",
        movePlane,
        startPoint,
      };
    }

    if (shiftKey) {
      const axis = new THREE.Vector3(0, 1, 0);

      const origin = hit.point.clone();
      const movePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y);

      return {
        mode: "move-axis",
        axis,
        origin,
        movePlane,
        projector: "surface",
        baseWorldDelta: new THREE.Vector3(0, 0, 0),
        startDy: event.clientY,
      };
    }

    // SketchUp-like move: drag tracks the cursor over the visible ground surface, with a plane fallback.
    const movePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y);
    const startPoint =
      this._moveSurfacePointFromEvent(event, movePlane) ?? hit.point.clone();

    return {
      mode: "move",
      projector: "surface",
      movePlane,
      startPoint,
    };
  }

  _startToolDrag(event, selectionResult) {
    const selectedObjectId = selectionResult?.selection?.objectId;
    if (!selectedObjectId) {
      this._debugTouch("tool start blocked", { reason: "missing object id" });
      return false;
    }

    const context = this._buildDragContext(event, selectionResult, { shiftKey: event.shiftKey });
    this.tools.startDrag({
      pointerDown: { x: event.clientX, y: event.clientY },
      selection: selectionResult.selection,
      context,
    });
    this.viewport.controls.enabled = false;

    const beginToolManipulation = () => {
      const op = mapToolGestureToOperation({
        tool: this.tools.activeTool,
        targetId: selectedObjectId,
        selection: selectionResult.selection,
        gesture: { dx: 0, dy: 0 },
      });

      return this.runtimeController.beginManipulation({
        type: op.type,
        targetId: op.targetId,
        selection: op.selection,
        params: op.params,
      });
    };

    try {
      beginToolManipulation();
    } catch (error) {
      if (error?.message === "Another manipulation session is already active") {
        this.runtimeController.cancelManipulation();
        try {
          beginToolManipulation();
        } catch (retryError) {
          this.tools.clearDrag();
          this.viewport.controls.enabled = true;
          this._debugTouch("tool start failed", { reason: retryError?.message ?? String(retryError) });
          return false;
        }
      } else {
        this.tools.clearDrag();
        this.viewport.controls.enabled = true;
        this.runtimeController.cancelManipulation();
        this._debugTouch("tool start failed", { reason: error?.message ?? String(error) });
        return false;
      }
    }

    this._debugTouch("tool start ok", {
      tool: this.tools.activeTool,
      target: selectedObjectId,
      mode: context?.mode ?? null,
    });
    return true;
  }

  _updateToolDrag(event) {
    const drag = this.tools.updateDrag({ x: event.clientX, y: event.clientY });
    if (!drag) {
      return false;
    }

    const gesture = this._buildGestureFromDrag(event, drag);
    const op = mapToolGestureToOperation({
      tool: this.tools.activeTool,
      targetId: drag.selection.objectId,
      selection: drag.selection,
      gesture,
    });
    this.runtimeController.updateManipulation(op.params);
    this._renderOverlay();
    return true;
  }

  async _commitToolDrag() {
    if (!this.tools.dragState) {
      return false;
    }

    this.tools.endDrag();
    this.viewport.controls.enabled = true;
    const result = await this.runtimeController.commitManipulation();
    await this._recordModelHistory(result?.canonicalCode, "Manipulation");
    this._applySelectionHighlights();
    this._renderOverlay();
    this._scheduleSessionPersist();
    return true;
  }

  _buildGestureFromDrag(event, drag) {
    const gesture = { dx: drag.dx, dy: drag.dy, shiftKey: event.shiftKey };

    if (this.tools.activeTool === "pushPull" && drag.context?.mode === "pushPull") {
      const currentDistance = this._axisDistanceFromPointer(event, drag.context.origin, drag.context.axis);
      if (typeof currentDistance === "number") {
        return {
          ...gesture,
          pushPullDistance: currentDistance - drag.context.startDistance,
        };
      }
      return gesture;
    }

    if (this.tools.activeTool === "rotate" && drag.context?.mode === "face-rotate") {
      const wantsAlternateAxis = Boolean(event.shiftKey);
      if (wantsAlternateAxis !== drag.context.activeShift) {
        const previousKey = drag.context.activeShift ? "alternate" : "normal";
        const previousDelta = Math.round(((drag.dx - drag.context.startDx) * 0.01) * 1000) / 1000;
        drag.context.baseAngles[previousKey] += previousDelta;
        drag.context.activeShift = wantsAlternateAxis;
        drag.context.startDx = drag.dx;
        if (this.tools.dragState) {
          this.tools.dragState.context = drag.context;
        }
      }

      const activeKey = drag.context.activeShift ? "alternate" : "normal";
      const activeDelta = Math.round(((drag.dx - drag.context.startDx) * 0.01) * 1000) / 1000;
      return {
        ...gesture,
        faceTiltAngles: {
          normal: drag.context.baseAngles.normal + (activeKey === "normal" ? activeDelta : 0),
          alternate: drag.context.baseAngles.alternate + (activeKey === "alternate" ? activeDelta : 0),
        },
      };
    }

    if (this.tools.activeTool !== "move") {
      return gesture;
    }

    const wantsAxisLock = Boolean(event.shiftKey);
    if (wantsAxisLock && drag.context?.mode !== "move-axis") {
      const axis = new THREE.Vector3(0, 1, 0);
      const movePlane = drag.context?.movePlane ?? new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const currentPoint = this._movePointFromEvent(event, { ...drag.context, movePlane });
      const startPoint = drag.context?.startPoint?.clone?.() ?? currentPoint?.clone?.() ?? drag.context?.origin?.clone?.() ?? new THREE.Vector3();
      const origin = startPoint.clone();
      const currentFreeDelta = drag.context?.baseWorldDelta?.clone?.() ?? new THREE.Vector3();
      if (currentPoint) {
        currentFreeDelta.add(currentPoint.clone().sub(startPoint));
      }
      drag.context = {
        mode: "move-axis",
        axis,
        origin,
        movePlane,
        projector: drag.context?.projector ?? "surface",
        startPoint,
        baseWorldDelta: currentFreeDelta,
        startDy: event.clientY,
      };
      if (this.tools.dragState) {
        this.tools.dragState.context = drag.context;
      }
    } else if (!wantsAxisLock && drag.context?.mode === "move-axis") {
      const movePlane = drag.context.movePlane ?? new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const projector = drag.context.projector ?? "surface";
      const currentPoint = this._movePointFromEvent(event, { ...drag.context, movePlane, projector });
      const dyFromToggle = event.clientY - (drag.context.startDy ?? event.clientY);
      const baseWorldDelta = drag.context.baseWorldDelta?.clone?.() ?? new THREE.Vector3();
      baseWorldDelta.y += Math.round((-dyFromToggle * 0.02) * 1000) / 1000;
      drag.context = {
        mode: "move",
        projector,
        movePlane,
        startPoint: currentPoint ?? drag.context.startPoint?.clone?.() ?? drag.context.origin?.clone?.() ?? new THREE.Vector3(),
        baseWorldDelta,
      };
      if (this.tools.dragState) {
        this.tools.dragState.context = drag.context;
      }
    }

    if (drag.context?.mode === "move-axis") {
      const dyFromToggle = event.clientY - (drag.context.startDy ?? event.clientY);
      const deltaY = (drag.context.baseWorldDelta?.y ?? 0) + Math.round((-dyFromToggle * 0.02) * 1000) / 1000;
      return {
        ...gesture,
        worldDelta: {
          x: drag.context.baseWorldDelta?.x ?? 0,
          y: deltaY,
          z: drag.context.baseWorldDelta?.z ?? 0,
        },
      };
    }

    const movePlane = drag.context?.movePlane;
    if (!movePlane) {
      return gesture;
    }

    const currentPoint = this._movePointFromEvent(event, drag.context);
    if (!currentPoint) {
      return gesture;
    }

    const worldDelta = currentPoint.sub(drag.context.startPoint);
    worldDelta.add(drag.context.baseWorldDelta ?? new THREE.Vector3());
    return {
      ...gesture,
      worldDelta: {
        x: worldDelta.x,
        y: worldDelta.y,
        z: worldDelta.z,
      },
    };
  }

  _moveSurfacePointFromEvent(event, fallbackPlane) {
    return (
      this.viewport.pointOnGroundSurface({
        clientX: event.clientX,
        clientY: event.clientY,
      }) ??
      this.selectionPipeline.pointOnPlane({
        clientX: event.clientX,
        clientY: event.clientY,
        plane: fallbackPlane,
      })
    );
  }

  _movePointFromEvent(event, context) {
    const movePlane = context?.movePlane;
    if (!movePlane) {
      return null;
    }
    if (context?.projector === "screen") {
      return this.selectionPipeline.pointOnPlane({
        clientX: event.clientX,
        clientY: event.clientY,
        plane: movePlane,
      });
    }
    return this._moveSurfacePointFromEvent(event, movePlane);
  }

  _screenMovePlaneFromPoint(point) {
    const normal = this.viewport.camera.getWorldDirection(new THREE.Vector3()).normalize();
    if (normal.lengthSq() < 1e-8) {
      normal.set(0, 0, -1);
    }
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
  }

  _axisDistanceFromPointer(event, origin, axis) {
    const ray = this.selectionPipeline.rayFromClient(event.clientX, event.clientY);
    const rayDir = ray.direction.clone().normalize();
    const axisDir = axis.clone().normalize();
    const w0 = ray.origin.clone().sub(origin);

    const b = rayDir.dot(axisDir);
    const denom = 1 - b * b;
    if (Math.abs(denom) < 1e-5) {
      return null;
    }

    const d = rayDir.dot(w0);
    const e = axisDir.dot(w0);
    return (e - b * d) / denom;
  }

  _initPreselectionOverlays() {
    this.preselectionFaceOverlay = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x7dc8ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.35,
        depthTest: false,
      }),
    );
    this.preselectionFaceOverlay.visible = false;
    this.preselectionFaceOverlay.renderOrder = 40;
    this.preselectionFaceOverlay.frustumCulled = false;
    this.viewport.scene.add(this.preselectionFaceOverlay);

    this.preselectionEdgeOverlay = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x7dc8ff,
        depthTest: false,
      }),
    );
    this.preselectionEdgeOverlay.visible = false;
    this.preselectionEdgeOverlay.renderOrder = 41;
    this.preselectionEdgeOverlay.frustumCulled = false;
    this.viewport.scene.add(this.preselectionEdgeOverlay);

    this.preselectionVertexOverlay = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color: 0x7dc8ff,
        size: 12,
        sizeAttenuation: false,
        depthTest: false,
      }),
    );
    this.preselectionVertexOverlay.visible = false;
    this.preselectionVertexOverlay.renderOrder = 42;
    this.preselectionVertexOverlay.frustumCulled = false;
    this.viewport.scene.add(this.preselectionVertexOverlay);
  }

  _updatePreselectionOverlays() {
    if (!this.preselectionFaceOverlay || !this.preselectionEdgeOverlay || !this.preselectionVertexOverlay) {
      return;
    }

    this.preselectionFaceOverlay.visible = false;
    this.preselectionEdgeOverlay.visible = false;
    this.preselectionVertexOverlay.visible = false;

    if (!this.hoveredHit || this.tools.dragState) {
      return;
    }

    const mode = this.selectionPipeline.selectionMode;
    if (mode === SELECTION_MODES.FACE) {
      const facePatch = this._facePatchFromHit(this.hoveredHit);
      if (!facePatch || facePatch.length < 3) {
        return;
      }
      this._setOverlayGeometry(this.preselectionFaceOverlay, facePatch);
      this.preselectionFaceOverlay.visible = true;
      return;
    }

    if (mode === SELECTION_MODES.EDGE) {
      const edge = this._edgeFromHit(this.hoveredHit);
      if (!edge) {
        return;
      }
      const [a, b] = edge;
      this._setOverlayGeometry(this.preselectionEdgeOverlay, [a, b]);
      this.preselectionEdgeOverlay.visible = true;
      return;
    }

    if (mode === SELECTION_MODES.VERTEX) {
      const vertex = this._vertexFromHit(this.hoveredHit);
      if (!vertex) {
        return;
      }
      this._setOverlayGeometry(this.preselectionVertexOverlay, [vertex]);
      this.preselectionVertexOverlay.visible = true;
    }
  }

  _triangleFromHit(hit) {
    if (!hit?.face || !hit?.object?.geometry?.attributes?.position) {
      return null;
    }
    const pos = hit.object.geometry.attributes.position;
    const a = hit.object.localToWorld(new THREE.Vector3().fromBufferAttribute(pos, hit.face.a));
    const b = hit.object.localToWorld(new THREE.Vector3().fromBufferAttribute(pos, hit.face.b));
    const c = hit.object.localToWorld(new THREE.Vector3().fromBufferAttribute(pos, hit.face.c));
    return [a, b, c];
  }

  _facePatchFromHit(hit) {
    if (!hit?.object?.geometry?.attributes?.position) {
      return null;
    }

    const geometry = hit.object.geometry;
    const position = geometry.attributes.position;
    const index = geometry.index;
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
    const seedTri = hit.faceIndex ?? -1;
    if (seedTri < 0 || seedTri >= triCount) {
      return this._triangleFromHit(hit);
    }

    const triVerts = new Array(triCount);
    const triNormals = new Array(triCount);
    const edgeMap = new Map();

    const getIndexAt = (idx) => (index ? index.getX(idx) : idx);
    const vertexKeyCache = new Map();
    const vertexKey = (idx) => {
      const cached = vertexKeyCache.get(idx);
      if (cached) {
        return cached;
      }
      const point = new THREE.Vector3().fromBufferAttribute(position, idx);
      const key = [
        Math.round(point.x * 10000),
        Math.round(point.y * 10000),
        Math.round(point.z * 10000),
      ].join(":");
      vertexKeyCache.set(idx, key);
      return key;
    };
    const edgeKey = (v0, v1) => {
      const k0 = vertexKey(v0);
      const k1 = vertexKey(v1);
      return k0 < k1 ? `${k0}|${k1}` : `${k1}|${k0}`;
    };

    for (let tri = 0; tri < triCount; tri += 1) {
      const base = tri * 3;
      const a = getIndexAt(base + 0);
      const b = getIndexAt(base + 1);
      const c = getIndexAt(base + 2);
      triVerts[tri] = [a, b, c];

      const va = new THREE.Vector3().fromBufferAttribute(position, a);
      const vb = new THREE.Vector3().fromBufferAttribute(position, b);
      const vc = new THREE.Vector3().fromBufferAttribute(position, c);
      triNormals[tri] = vb.clone().sub(va).cross(vc.clone().sub(va)).normalize();

      const edges = [
        [a, b],
        [b, c],
        [c, a],
      ];
      for (const [v0, v1] of edges) {
        const key = edgeKey(v0, v1);
        const list = edgeMap.get(key);
        if (list) {
          list.push(tri);
        } else {
          edgeMap.set(key, [tri]);
        }
      }
    }

    const adjacency = new Array(triCount);
    for (let tri = 0; tri < triCount; tri += 1) {
      adjacency[tri] = [];
    }
    for (const triList of edgeMap.values()) {
      if (triList.length < 2) {
        continue;
      }
      for (let i = 0; i < triList.length; i += 1) {
        for (let j = i + 1; j < triList.length; j += 1) {
          const a = triList[i];
          const b = triList[j];
          adjacency[a].push(b);
          adjacency[b].push(a);
        }
      }
    }

    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const toWorldNormal = (n) => n.clone().applyMatrix3(normalMatrix).normalize();
    const targetNormal = toWorldNormal(triNormals[seedTri]);
    const worldVertexCache = new Map();
    const worldVertex = (idx) => {
      const cached = worldVertexCache.get(idx);
      if (cached) {
        return cached;
      }
      const point = hit.object.localToWorld(new THREE.Vector3().fromBufferAttribute(position, idx));
      worldVertexCache.set(idx, point);
      return point;
    };

    const seedA = worldVertex(triVerts[seedTri][0]);
    const planeD = -targetNormal.dot(seedA);
    const normalDotTolerance = 0.999;
    const planeTolerance = 1e-4;
    const isCoplanar = (tri) => {
      const triNormal = toWorldNormal(triNormals[tri]);
      if (triNormal.dot(targetNormal) < normalDotTolerance) {
        return false;
      }
      const [a, b, c] = triVerts[tri];
      const da = Math.abs(targetNormal.dot(worldVertex(a)) + planeD);
      const db = Math.abs(targetNormal.dot(worldVertex(b)) + planeD);
      const dc = Math.abs(targetNormal.dot(worldVertex(c)) + planeD);
      return da <= planeTolerance && db <= planeTolerance && dc <= planeTolerance;
    };

    const queue = [seedTri];
    const seen = new Set([seedTri]);
    const patchTris = [];
    while (queue.length > 0) {
      const tri = queue.shift();
      if (!isCoplanar(tri)) {
        continue;
      }
      patchTris.push(tri);
      for (const next of adjacency[tri]) {
        if (seen.has(next)) {
          continue;
        }
        seen.add(next);
        queue.push(next);
      }
    }

    if (patchTris.length === 0) {
      return this._triangleFromHit(hit);
    }

    const points = [];
    for (const tri of patchTris) {
      const [a, b, c] = triVerts[tri];
      points.push(worldVertex(a), worldVertex(b), worldVertex(c));
    }
    return points;
  }

  _edgeFromHit(hit) {
    const tri = this._triangleFromHit(hit);
    if (!tri || !hit?.point) {
      return null;
    }
    const [a, b, c] = tri;
    const edges = [
      [a, b],
      [b, c],
      [c, a],
    ];
    let best = edges[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const [p0, p1] of edges) {
      const dist = this._distancePointToSegmentSquared(hit.point, p0, p1);
      if (dist < bestDist) {
        bestDist = dist;
        best = [p0, p1];
      }
    }
    return best;
  }

  _vertexFromHit(hit) {
    const tri = this._triangleFromHit(hit);
    if (!tri || !hit?.point) {
      return null;
    }
    let best = tri[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const point of tri) {
      const dist = point.distanceToSquared(hit.point);
      if (dist < bestDist) {
        bestDist = dist;
        best = point;
      }
    }
    return best;
  }

  _distancePointToSegmentSquared(point, a, b) {
    const ab = b.clone().sub(a);
    const ap = point.clone().sub(a);
    const denom = ab.lengthSq();
    if (denom <= 1e-10) {
      return point.distanceToSquared(a);
    }
    const t = THREE.MathUtils.clamp(ap.dot(ab) / denom, 0, 1);
    const closest = a.clone().add(ab.multiplyScalar(t));
    return point.distanceToSquared(closest);
  }

  _setOverlayGeometry(overlay, points) {
    const flat = new Float32Array(points.length * 3);
    points.forEach((p, index) => {
      flat[index * 3 + 0] = p.x;
      flat[index * 3 + 1] = p.y;
      flat[index * 3 + 2] = p.z;
    });
    overlay.geometry.dispose();
    overlay.geometry = new THREE.BufferGeometry();
    overlay.geometry.setAttribute("position", new THREE.BufferAttribute(flat, 3));
  }

  _syncObjectCounterFromOperations(operations) {
    let max = 0;
    for (const operation of operations) {
      const objectId = operation?.params?.objectId;
      if (!objectId || !objectId.startsWith("obj_")) {
        continue;
      }

      const serial = Number.parseInt(objectId.slice(4), 10);
      if (Number.isFinite(serial) && serial > max) {
        max = serial;
      }
    }

    this.objectCounter = Math.max(this.objectCounter, max + 1);
  }

  async _restoreModelHistory() {
    const currentCode = this.runtimeController.getSnapshot().canonicalCode;
    try {
      const snapshot = await this.modelHistoryStore.loadHistory();
      if (snapshot) {
        this.modelHistory.restore(snapshot);
      }
    } catch (error) {
      console.warn("Failed to load model history", error);
    }

    const currentEntry = this.modelHistory.current();
    if (!currentEntry || currentEntry.script !== currentCode) {
      this.modelHistory.push(currentCode, { label: "Loaded Model" });
      await this._persistModelHistory();
      return;
    }

    this._syncHistoryButtons();
  }

  async _recordModelHistory(canonicalCode, label) {
    const code = typeof canonicalCode === "string" ? canonicalCode : this.runtimeController.getSnapshot().canonicalCode;
    this.modelHistory.push(code, { label });
    await this._persistModelHistory();
  }

  async _persistModelHistory() {
    this._syncHistoryButtons();
    try {
      await this.modelHistoryStore.saveHistory(this.modelHistory.snapshot());
    } catch (error) {
      console.warn("Failed to persist model history", error);
    }
  }

  async undoModel() {
    const entry = this.modelHistory.undo();
    if (!entry) {
      this._syncHistoryButtons();
      return;
    }
    await this._applyModelHistoryEntry(entry);
  }

  async redoModel() {
    const entry = this.modelHistory.redo();
    if (!entry) {
      this._syncHistoryButtons();
      return;
    }
    await this._applyModelHistoryEntry(entry);
  }

  async _applyModelHistoryEntry(entry) {
    if (!entry?.script) {
      this._syncHistoryButtons();
      return;
    }

    await this.runtimeController.reloadFromCanonicalCode(entry.script, { cleanSlate: true });
    this._syncObjectCounterFromOperations(this.runtimeController.canonicalModel.getOperations());
    this._dropInvalidSelections();
    const canonicalCode = await this.runtimeController.persistCanonicalModel();
    this.modelHistory.replaceCurrent(canonicalCode, { label: entry.label });
    await this._persistModelHistory();
    this._applySelectionHighlights();
    this._renderOverlay();
  }

  _dropInvalidSelections() {
    const selectable = new Set(
      this.representationStore.getSelectableMeshes().map((mesh) => mesh.userData.objectId).filter(Boolean),
    );
    this.selectionPipeline.selectedObjectIds = this.selectionPipeline.selectedObjectIds.filter((id) => selectable.has(id));
    if (this.hoveredObjectId && !selectable.has(this.hoveredObjectId)) {
      this.hoveredObjectId = null;
      this.hoveredHit = null;
    }
  }

  _beginTouchNavigation(event) {
    this._debugTouch("down", {
      id: event.pointerId,
      primary: event.isPrimary,
      active: this.activeTouchPointers.size,
      tool: this.tools.activeTool,
      drag: Boolean(this.tools.dragState),
    });

    if (event.isPrimary !== false && this.activeTouchPointers.size > 0) {
      this._cancelActiveToolInteraction();
      this._resetTouchNavigationState();
      this._debugTouch("reset stale touch state");
    }

    this.activeTouchPointers.set(event.pointerId, this._touchPointerSnapshot(event));
    this._markTouchInteraction();

    if (this.activeTouchPointers.size === 1) {
      this.viewport.cancelCursorOrbit();
      this.viewport.cancelCursorPan();

      const selectionResult = this._pickTouchSelection(event);
      this._debugTouch("pick", {
        hit: Boolean(selectionResult?.hit),
        selection: selectionResult?.selection?.objectId ?? null,
        mode: selectionResult?.selection?.mode ?? null,
        canDrag: this.tools.canStartDrag(),
      });
      this.hoveredObjectId = selectionResult?.selection?.objectId ?? null;
      this.hoveredHit = selectionResult?.hit ?? null;

      this._applySelectionHighlights();
      this._renderOverlay();
      this._scheduleSessionPersist();

      if (selectionResult.selection && this.tools.canStartDrag() && this._startToolDrag(event, selectionResult)) {
        this.activeTouchMode = "tool";
        this.activeTouchToolPointerId = event.pointerId;
        this._captureTouchPointer(event);
        this._debugTouch("started tool", { id: event.pointerId, target: selectionResult.selection.objectId });
        return true;
      }

      const startedPan = this.viewport.beginCursorNavigation({
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: event.pointerId,
        orbitMode: false,
        allowShiftOrbit: false,
        baseMode: "pan",
        shiftMode: "orbit",
      });
      this.activeTouchMode = startedPan ? "pan" : null;
      this._captureTouchPointer(event);
      this._debugTouch("started pan", { id: event.pointerId, ok: startedPan });
      return true;
    }

    this.activeTouchMode = "native";
    this.activeTouchToolPointerId = null;
    this._cancelActiveToolInteraction();
    this._clearHoverState();
    this.viewport.beginNativeTouchNavigation([...this.activeTouchPointers.values()]);
    this._debugTouch("started native multitouch", { count: this.activeTouchPointers.size });
    return true;
  }

  async _endTouchNavigation(event) {
    const endedToolPointer = this.activeTouchMode === "tool" && event.pointerId === this.activeTouchToolPointerId;
    this.activeTouchPointers.delete(event.pointerId);
    this._markTouchInteraction();
    if (endedToolPointer) {
      await this._commitToolDrag();
      this._debugTouch("committed tool", { id: event.pointerId });
    }
    if (this.activeTouchPointers.size === 0) {
      this.activeTouchMode = null;
      this.activeTouchToolPointerId = null;
    }
    this._clearHoverState();
    this._debugTouch("up", { id: event.pointerId, remaining: this.activeTouchPointers.size });
  }

  _cancelTouchNavigation(event) {
    const canceledToolPointer = this.activeTouchMode === "tool" && event.pointerId === this.activeTouchToolPointerId;
    this.activeTouchPointers.delete(event.pointerId);
    this._markTouchInteraction();
    if (canceledToolPointer) {
      this._cancelActiveToolInteraction();
    }
    if (this.activeTouchPointers.size === 0) {
      this.activeTouchMode = null;
      this.activeTouchToolPointerId = null;
    }
    this._clearHoverState();
    this._debugTouch("cancel", { id: event.pointerId, tool: canceledToolPointer, remaining: this.activeTouchPointers.size });
  }

  _touchPointerSnapshot(event) {
    return {
      pointerId: event.pointerId,
      pointerType: "touch",
      clientX: event.clientX,
      clientY: event.clientY,
      pageX: event.pageX,
      pageY: event.pageY,
    };
  }

  _captureTouchPointer(event) {
    try {
      event.currentTarget?.setPointerCapture?.(event.pointerId);
    } catch {
      // Some mobile browsers reject pointer capture for touch identifiers; window-level
      // touch move/up listeners still keep the interaction alive.
    }
  }

  _pickTouchSelection(event) {
    const selectableMeshes = this.representationStore.getSelectableMeshes();
    const pickAt = ([offsetX, offsetY]) => this.selectionPipeline.pick({
      clientX: event.clientX + offsetX,
      clientY: event.clientY + offsetY,
      selectableMeshes,
      multiSelect: false,
    });

    if (!this.tools.canStartDrag()) {
      return pickAt([0, 0]);
    }

    let fallback = null;
    for (const offset of TOUCH_PICK_OFFSETS) {
      const result = pickAt(offset);
      fallback ??= result;
      if (result.selection) {
        return result;
      }
    }

    return fallback ?? { hit: null, selection: null };
  }

  _handleTouchPointerMove(event) {
    if (event.pointerType !== "touch") {
      return false;
    }

    if (this.activeTouchPointers.has(event.pointerId)) {
      this.activeTouchPointers.set(event.pointerId, this._touchPointerSnapshot(event));
    }
    this._markTouchInteraction();

    if (
      this.activeTouchMode === "tool"
      && event.pointerId === this.activeTouchToolPointerId
      && this.activeTouchPointers.size === 1
      && this.tools.dragState
    ) {
      this._updateToolDrag(event);
      this._debugTouch("move tool", { id: event.pointerId, x: Math.round(event.clientX), y: Math.round(event.clientY) });
      return true;
    }

    if (this.activeTouchPointers.size > 1) {
      this._clearHoverState();
    }

    return false;
  }

  _handleNativeTouchMove(event) {
    if (this.activeTouchMode !== "tool" || !this.tools.dragState || this.activeTouchPointers.size !== 1) {
      return false;
    }

    const touch = this._activeNativeTouch(event.touches);
    if (!touch) {
      return false;
    }

    this._debugTouch("native move", { x: Math.round(touch.clientX), y: Math.round(touch.clientY) });
    return this._handleTouchPointerMove(this._eventFromNativeTouch(touch));
  }

  _handleNativeTouchEnd(event) {
    if (this.activeTouchMode !== "tool" || this.activeTouchPointers.size !== 1 || event.touches.length > 0) {
      return false;
    }

    const pointerId = this.activeTouchToolPointerId;
    const endedTouch = this._activeNativeTouch(event.changedTouches) ?? event.changedTouches?.[0] ?? null;
    const endEvent = this._eventFromNativeTouch(endedTouch, { pointerId });
    void this._endTouchNavigation(endEvent);
    return true;
  }

  _handleNativeTouchCancel(event) {
    if (this.activeTouchMode !== "tool" || this.activeTouchPointers.size !== 1) {
      return false;
    }

    const pointerId = this.activeTouchToolPointerId;
    const canceledTouch = this._activeNativeTouch(event.changedTouches) ?? event.changedTouches?.[0] ?? null;
    this._cancelTouchNavigation(this._eventFromNativeTouch(canceledTouch, { pointerId }));
    return true;
  }

  _activeNativeTouch(touchList) {
    if (!touchList || touchList.length === 0) {
      return null;
    }

    if (touchList.length === 1) {
      return touchList[0];
    }

    const activePointer = this.activeTouchPointers.get(this.activeTouchToolPointerId);
    if (!activePointer) {
      return touchList[0];
    }

    let bestTouch = touchList[0];
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (let i = 0; i < touchList.length; i += 1) {
      const touch = touchList[i];
      const dx = touch.clientX - activePointer.clientX;
      const dy = touch.clientY - activePointer.clientY;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestTouch = touch;
      }
    }
    return bestTouch;
  }

  _eventFromNativeTouch(touch, { pointerId = this.activeTouchToolPointerId } = {}) {
    const fallback = this.activeTouchPointers.get(pointerId) ?? {
      clientX: 0,
      clientY: 0,
      pageX: 0,
      pageY: 0,
    };
    return {
      pointerId,
      pointerType: "touch",
      isPrimary: true,
      clientX: touch?.clientX ?? fallback.clientX,
      clientY: touch?.clientY ?? fallback.clientY,
      pageX: touch?.pageX ?? fallback.pageX,
      pageY: touch?.pageY ?? fallback.pageY,
    };
  }

  _markTouchInteraction() {
    this.suppressMouseInteractionUntil = performance.now() + 700;
  }

  _shouldSuppressPointerInteraction(event) {
    if (this.activeTouchPointers.size > 0) {
      return true;
    }

    if (event.pointerType === "mouse" || !event.pointerType) {
      return performance.now() < this.suppressMouseInteractionUntil;
    }

    return false;
  }

  _resetTouchNavigationState() {
    this.activeTouchPointers.clear();
    this.activeTouchMode = null;
    this.activeTouchToolPointerId = null;
    this.viewport.cancelCursorNavigation?.();
  }

  _debugTouch(message, details = null) {
    if (!this.touchDebugEnabled) {
      return;
    }

    if (!this.touchDebugElement) {
      const element = document.createElement("div");
      element.style.position = "fixed";
      element.style.left = "8px";
      element.style.right = "8px";
      element.style.bottom = "8px";
      element.style.zIndex = "10000";
      element.style.padding = "8px";
      element.style.border = "1px solid rgba(0,0,0,0.25)";
      element.style.borderRadius = "6px";
      element.style.background = "rgba(255,255,255,0.94)";
      element.style.color = "#102030";
      element.style.font = "12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace";
      element.style.pointerEvents = "none";
      element.style.whiteSpace = "pre-wrap";
      document.body.appendChild(element);
      this.touchDebugElement = element;
    }

    const suffix = details ? ` ${JSON.stringify(details)}` : "";
    const previous = this.touchDebugElement.textContent.split("\n").slice(-7);
    previous.push(`${message}${suffix}`);
    this.touchDebugElement.textContent = previous.join("\n");
  }

  _cancelActiveToolInteraction() {
    if (!this.tools.dragState) {
      this.viewport.controls.enabled = true;
      return;
    }

    this.tools.clearDrag();
    this.runtimeController.cancelManipulation();
    this.viewport.controls.enabled = true;
    this.activeTouchToolPointerId = null;
    this._applySelectionHighlights();
    this._renderOverlay();
  }

  _clearHoverState() {
    if (!this.hoveredObjectId && !this.hoveredHit) {
      return;
    }

    this.hoveredObjectId = null;
    this.hoveredHit = null;
    this._applySelectionHighlights();
    this._renderOverlay();
  }

  _syncHistoryButtons() {
    const undoButton = this.actionButtons.get("undo");
    if (undoButton) {
      undoButton.disabled = !this.modelHistory.canUndo();
      undoButton.setAttribute("aria-disabled", String(undoButton.disabled));
    }

    const redoButton = this.actionButtons.get("redo");
    if (redoButton) {
      redoButton.disabled = !this.modelHistory.canRedo();
      redoButton.setAttribute("aria-disabled", String(redoButton.disabled));
    }
  }

  _isEditableEventTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    const tagName = target.tagName.toLowerCase();
    return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
  }

  _attachCodePanelHandlers() {
    if (!this.codeToggle || !this.codePanel) {
      return;
    }

    for (const tab of this.panelTabButtons) {
      tab.addEventListener("click", () => {
        const page = tab.dataset.panelPage;
        if (!page) {
          return;
        }
        this._setPanelPage(page);
        void this._persistSessionState();
      });
    }

    if (this.codeCopyButton) {
      this.codeCopyButton.classList.add("icon-btn");
      this._setButtonIcon(this.codeCopyButton, "copy", "Copy Model Script");
      this.codeCopyButton.addEventListener("click", () => {
        void this._copyModelScriptToClipboard();
      });
    }

    if (this.codeCompressButton) {
      this.codeCompressButton.classList.add("icon-btn");
      this._setButtonIcon(this.codeCompressButton, "compress", "Compress Model Script");
      this.codeCompressButton.addEventListener("click", () => {
        void this._compressModelScript();
      });
    }

    if (this.gridToggleButton) {
      this.gridToggleButton.addEventListener("click", () => {
        this._setGridVisible(!this.viewport.isGridVisible());
        void this._persistSessionState();
      });
    }

    if (this.groundEffectsToggleButton) {
      this.groundEffectsToggleButton.addEventListener("click", () => {
        this._setGroundEffectsVisible(!this.viewport.areGroundEffectsVisible());
        void this._persistSessionState();
      });
    }

    if (this.devConsoleToggleButton) {
      this.devConsoleToggleButton.addEventListener("click", () => {
        this._setDevConsoleVisible(!this.devConsoleVisible);
        void this._persistSessionState();
      });
    }

    if (this.groundRegenerateButton) {
      this.groundRegenerateButton.addEventListener("click", () => {
        this._regenerateGroundTheme();
        void this._persistSessionState();
      });
    }

    if (this.groundThemeSelect) {
      this.groundThemeSelect.addEventListener("change", () => {
        this._setGroundTheme({
          theme: this.groundThemeSelect.value,
          elevationVariation: this.elevationVariationInput?.value,
          terrainVariation: this.terrainVariationInput?.value,
          terrainDensity: this.terrainDensityInput?.value,
        });
        void this._persistSessionState();
      });
    }

    if (this.elevationVariationInput) {
      this.elevationVariationInput.addEventListener("input", () => {
        this._setGroundTheme({
          theme: this.groundThemeSelect?.value,
          elevationVariation: this.elevationVariationInput.value,
          terrainVariation: this.terrainVariationInput?.value,
          terrainDensity: this.terrainDensityInput?.value,
        });
      });
      this.elevationVariationInput.addEventListener("change", () => {
        void this._persistSessionState();
      });
    }

    if (this.terrainVariationInput) {
      this.terrainVariationInput.addEventListener("input", () => {
        this._setGroundTheme({
          theme: this.groundThemeSelect?.value,
          elevationVariation: this.elevationVariationInput?.value,
          terrainVariation: this.terrainVariationInput.value,
          terrainDensity: this.terrainDensityInput?.value,
        });
      });
      this.terrainVariationInput.addEventListener("change", () => {
        void this._persistSessionState();
      });
    }

    if (this.terrainDensityInput) {
      this.terrainDensityInput.addEventListener("input", () => {
        this._setGroundTheme({
          theme: this.groundThemeSelect?.value,
          elevationVariation: this.elevationVariationInput?.value,
          terrainVariation: this.terrainVariationInput?.value,
          terrainDensity: this.terrainDensityInput.value,
        });
      });
      this.terrainDensityInput.addEventListener("change", () => {
        void this._persistSessionState();
      });
    }

    this.codeToggle.addEventListener("click", () => {
      this._setCodePanelCollapsed(!this.codeCollapsed);
      void this._persistSessionState();
    });

    this._setCodePanelCollapsed(false);
    this._setPanelPage("script");
    this._setDevConsoleVisible(false);
    this._setGridVisible(false);
    this._setGroundEffectsVisible(true);
    this._setGroundTheme({
      theme: DEFAULT_GROUND_THEME,
      elevationVariation: DEFAULT_ELEVATION_VARIATION,
      terrainVariation: DEFAULT_TERRAIN_VARIATION,
      terrainDensity: DEFAULT_TERRAIN_DENSITY,
      terrainSeed: DEFAULT_TERRAIN_SEED,
    });
  }

  _attachSidebarScrollHandlers() {
    if (!this.sidebarElement || !this.sidebarScrollElement) {
      return;
    }

    this.sidebarScrollElement.addEventListener("scroll", () => this._syncSidebarScrollAffordance(), { passive: true });
    this.sidebarElement.addEventListener("click", (event) => this._handleSidebarScrollAffordanceClick(event));
    window.addEventListener("resize", () => this._syncSidebarScrollAffordance());
    this._syncSidebarScrollAffordance();
  }

  _handleSidebarScrollAffordanceClick(event) {
    const control = event.target?.closest?.("[data-sidebar-scroll]");
    if (!control) {
      return;
    }

    const direction = Number(control.dataset.sidebarScroll);
    if (!Number.isFinite(direction) || direction === 0) {
      return;
    }

    event.preventDefault();
    this._scrollSidebarByPage(Math.sign(direction));
  }

  _scrollSidebarByPage(direction) {
    if (!this.sidebarScrollElement) {
      return;
    }

    const pageDistance = Math.max(32, this.sidebarScrollElement.clientHeight - 32);
    this.sidebarScrollElement.scrollBy({
      top: direction * pageDistance,
      behavior: "smooth",
    });
  }

  _syncSidebarScrollAffordance() {
    if (!this.sidebarElement || !this.sidebarScrollElement) {
      return;
    }

    const maxScrollTop = Math.max(0, this.sidebarScrollElement.scrollHeight - this.sidebarScrollElement.clientHeight);
    const hasOverflow = maxScrollTop > 1;
    const canScrollUp = hasOverflow && this.sidebarScrollElement.scrollTop > 1;
    const canScrollDown = hasOverflow && this.sidebarScrollElement.scrollTop < maxScrollTop - 1;

    this.sidebarElement.classList.toggle("can-scroll-up", canScrollUp);
    this.sidebarElement.classList.toggle("can-scroll-down", canScrollDown);
  }

  _setCodePanelCollapsed(collapsed) {
    this.codeCollapsed = collapsed;
    document.body.classList.toggle("code-collapsed", collapsed);
    const label = collapsed ? "Show Side Panel" : "Hide Side Panel";
    this._setButtonIcon(this.codeToggle, "menu", label);
    this.codeToggle.setAttribute("aria-expanded", String(!collapsed));
    this._scheduleSidebarScrollAffordanceSync();
  }

  _scheduleSidebarScrollAffordanceSync() {
    this._syncSidebarScrollAffordance();

    requestAnimationFrame(() => this._syncSidebarScrollAffordance());
    window.setTimeout(() => this._syncSidebarScrollAffordance(), 220);
  }

  _setPanelPage(page) {
    const nextPage = page === "settings" ? "settings" : "script";
    this.panelPage = nextPage;

    for (const tab of this.panelTabButtons) {
      const isActive = tab.dataset.panelPage === nextPage;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    }

    for (const panel of this.codePanel.querySelectorAll("[data-panel-page-content]")) {
      const isActive = panel.dataset.panelPageContent === nextPage;
      panel.classList.toggle("active", isActive);
    }
  }

  _setGridVisible(visible) {
    const isVisible = Boolean(visible);
    this.viewport.setGridVisible(isVisible);
    if (this.gridToggleButton) {
      this.gridToggleButton.textContent = `Ground Grid: ${isVisible ? "On" : "Off"}`;
      this.gridToggleButton.setAttribute("aria-pressed", String(isVisible));
      this.gridToggleButton.classList.toggle("active", isVisible);
    }
  }

  _setGroundEffectsVisible(visible) {
    const isVisible = Boolean(visible);
    this.viewport.setGroundEffectsVisible(isVisible);
    if (this.groundEffectsToggleButton) {
      this.groundEffectsToggleButton.textContent = `Ground: ${isVisible ? "On" : "Off"}`;
      this.groundEffectsToggleButton.setAttribute("aria-pressed", String(isVisible));
      this.groundEffectsToggleButton.classList.toggle("active", isVisible);
    }
  }

  _setDevConsoleVisible(visible) {
    const isVisible = Boolean(visible);
    this.devConsoleVisible = isVisible;
    if (this.devConsoleToggleButton) {
      this.devConsoleToggleButton.textContent = `Dev Console: ${isVisible ? "On" : "Off"}`;
      this.devConsoleToggleButton.setAttribute("aria-pressed", String(isVisible));
      this.devConsoleToggleButton.classList.toggle("active", isVisible);
    }
    if (isVisible) {
      this._renderOverlay();
    } else {
      this.overlay.setVisible(false);
    }
  }

  _setGroundTheme({
    theme = DEFAULT_GROUND_THEME,
    elevationVariation = DEFAULT_ELEVATION_VARIATION,
    terrainVariation = DEFAULT_TERRAIN_VARIATION,
    terrainDensity = DEFAULT_TERRAIN_DENSITY,
    terrainSeed,
  } = {}) {
    const normalizedTheme = normalizeGroundTheme(theme);
    const normalizedElevationVariation = normalizeElevationVariation(elevationVariation);
    const normalizedTerrainVariation = normalizeTerrainVariation(terrainVariation);
    const normalizedDensity = normalizeTerrainDensity(terrainDensity);
    const currentTerrainSeed = this.viewport?.getGroundThemeState?.().terrainSeed ?? DEFAULT_TERRAIN_SEED;
    const normalizedSeed = normalizeTerrainSeed(terrainSeed ?? currentTerrainSeed);
    this.viewport.setGroundTheme({
      theme: normalizedTheme,
      elevationVariation: normalizedElevationVariation,
      terrainVariation: normalizedTerrainVariation,
      terrainDensity: normalizedDensity,
      terrainSeed: normalizedSeed,
    });

    if (this.groundThemeSelect) {
      this.groundThemeSelect.value = normalizedTheme;
    }
    if (this.elevationVariationInput) {
      this.elevationVariationInput.value = String(normalizedElevationVariation);
    }
    if (this.elevationVariationValue) {
      this.elevationVariationValue.textContent = `${Math.round(normalizedElevationVariation * 100)}%`;
    }
    if (this.terrainVariationInput) {
      this.terrainVariationInput.value = String(normalizedTerrainVariation);
    }
    if (this.terrainVariationValue) {
      this.terrainVariationValue.textContent = `${Math.round(normalizedTerrainVariation * 100)}%`;
    }
    if (this.terrainDensityInput) {
      this.terrainDensityInput.value = String(normalizedDensity);
    }
    if (this.terrainDensityValue) {
      this.terrainDensityValue.textContent = `${Math.round(normalizedDensity * 100)}%`;
    }
  }

  _regenerateGroundTheme() {
    const state = this.viewport.getGroundThemeState();
    let nextSeed = generateTerrainSeed();
    if (nextSeed === state.terrainSeed) {
      nextSeed += 1;
    }
    this._setGroundTheme({
      ...state,
      terrainSeed: nextSeed,
    });
  }

  _setActiveTool(tool, { render = true } = {}) {
    if (!TOOL_CONFIG.some((entry) => entry.id === tool)) {
      return;
    }
    this.tools.setActiveTool(tool);
    this._syncToolButtons();
    if (render) {
      this._renderOverlay();
    }
  }

  _setSelectionMode(mode, { render = true } = {}) {
    if (!Object.values(SELECTION_MODES).includes(mode)) {
      return;
    }
    this.selectionPipeline.setSelectionMode(mode);
    this._syncSelectionModeButtons();
    this._applySelectionHighlights();
    if (render) {
      this._renderOverlay();
    }
  }

  _syncSelectionModeButtons() {
    for (const button of document.querySelectorAll("[data-selection-mode]")) {
      button.classList.toggle("active", button.dataset.selectionMode === this.selectionPipeline.selectionMode);
    }
  }

  _captureSessionState() {
    return {
      version: 1,
      camera: {
        position: {
          x: this.viewport.camera.position.x,
          y: this.viewport.camera.position.y,
          z: this.viewport.camera.position.z,
        },
        target: {
          x: this.viewport.controls.target.x,
          y: this.viewport.controls.target.y,
          z: this.viewport.controls.target.z,
        },
        zoom: this.viewport.camera.zoom,
      },
      ui: {
        activeTool: this.tools.activeTool,
        selectionMode: this.selectionPipeline.selectionMode,
        codeCollapsed: this.codeCollapsed,
        panelPage: this.panelPage,
        devConsoleVisible: this.devConsoleVisible,
        modelName: this.modelName,
      },
      selection: {
        selectedObjectIds: [...this.selectionPipeline.selectedObjectIds],
      },
      scene: {
        objectCounter: this.objectCounter,
        gridVisible: this.viewport.isGridVisible(),
        groundTheme: this.viewport.getGroundThemeState(),
      },
    };
  }

  _applySessionState(state) {
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return;
    }

    this.isRestoringSession = true;
    try {
      this._applyCameraState(state.camera);

      if (typeof state?.scene?.objectCounter === "number" && Number.isFinite(state.scene.objectCounter)) {
        this.objectCounter = Math.max(this.objectCounter, Math.floor(state.scene.objectCounter));
      }

      this._setActiveTool(state?.ui?.activeTool ?? "select", { render: false });
      this._setSelectionMode(state?.ui?.selectionMode ?? SELECTION_MODES.OBJECT, { render: false });
      this._setCodePanelCollapsed(Boolean(state?.ui?.codeCollapsed));
      this._setPanelPage(state?.ui?.panelPage ?? "script");
      this._setDevConsoleVisible(Boolean(state?.ui?.devConsoleVisible));
      this._setModelName(state?.ui?.modelName ?? DEFAULT_MODEL_NAME);
      this._setGridVisible(Boolean(state?.scene?.gridVisible));
      this._setGroundEffectsVisible(state?.scene?.groundTheme?.groundEffectsVisible !== false);
      const savedGroundTheme = state?.scene?.groundTheme;
      this._setGroundTheme(savedGroundTheme ? migrateGroundThemeState(savedGroundTheme) : defaultGroundThemeState());

      const selectable = new Set(
        this.representationStore.getSelectableMeshes().map((mesh) => mesh.userData.objectId).filter(Boolean),
      );
      const nextSelected = Array.isArray(state?.selection?.selectedObjectIds) ? state.selection.selectedObjectIds : [];
      this.selectionPipeline.selectedObjectIds = nextSelected.filter((id) => selectable.has(id));

      this._applySelectionHighlights();
      this._renderOverlay();
    } finally {
      this.isRestoringSession = false;
    }
  }

  _applyCameraState(cameraState) {
    if (!cameraState || typeof cameraState !== "object") {
      return;
    }

    const pos = cameraState.position;
    const target = cameraState.target;
    const zoom = cameraState.zoom;

    if (this._isFiniteVec3(pos)) {
      this.viewport.camera.position.set(pos.x, pos.y, pos.z);
    }
    if (this._isFiniteVec3(target)) {
      this.viewport.controls.target.set(target.x, target.y, target.z);
    }
    if (typeof zoom === "number" && Number.isFinite(zoom) && zoom > 0) {
      this.viewport.camera.zoom = zoom;
      this.viewport.camera.updateProjectionMatrix();
    }
    this.viewport.controls.update();
  }

  _isFiniteVec3(value) {
    return Boolean(
      value &&
        typeof value === "object" &&
        Number.isFinite(value.x) &&
        Number.isFinite(value.y) &&
        Number.isFinite(value.z),
    );
  }

  _scheduleSessionPersist(delayMs = 140) {
    if (this.isRestoringSession) {
      return;
    }
    if (this.sessionPersistTimer) {
      window.clearTimeout(this.sessionPersistTimer);
      this.sessionPersistTimer = null;
    }

    this.sessionPersistTimer = window.setTimeout(() => {
      this.sessionPersistTimer = null;
      void this._persistSessionState();
    }, delayMs);
  }

  async _persistSessionState() {
    if (this.isRestoringSession) {
      return;
    }

    const snapshot = this._captureSessionState();
    const signature = JSON.stringify(snapshot);
    if (signature === this.lastPersistedSessionSignature) {
      return;
    }

    try {
      await this.appSessionStore.saveState(snapshot);
      this.lastPersistedSessionSignature = signature;
    } catch (error) {
      console.warn("Failed to persist app session state", error);
    }
  }

  async _loadSessionState() {
    try {
      return await this.appSessionStore.loadState();
    } catch (error) {
      console.warn("Failed to load app session state", error);
      return null;
    }
  }

  async _copyModelScriptToClipboard() {
    const scriptText = this.codeElement?.textContent ?? "";
    if (scriptText.trim().length === 0) {
      this._setCodeCopyButtonState("copy-empty", "No Script To Copy");
      return;
    }

    let copied = false;
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(scriptText);
        copied = true;
      } catch {
        copied = false;
      }
    }

    if (!copied) {
      copied = this._copyTextFallback(scriptText);
    }

    if (copied) {
      this._setCodeCopyButtonState("copied", "Copied");
    } else {
      this._setCodeCopyButtonState("copy-failed", "Copy Failed");
    }
  }

  async _compressModelScript() {
    if (!this.codeCompressButton) {
      return;
    }

    try {
      const result = await this.runtimeController.compressCanonicalModel();
      await this._recordModelHistory(result?.canonicalCode, "Compress");
      this._setCodeToolButtonState(this.codeCompressButton, "compressed", "Compressed");
      this._applySelectionHighlights();
      this._renderOverlay();
      await this._persistSessionState();
    } catch (error) {
      console.warn("Failed to compress model script", error);
      this._setCodeToolButtonState(this.codeCompressButton, "copy-failed", "Compress Failed");
    }
  }

  _copyTextFallback(text) {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      return success;
    } catch {
      return false;
    }
  }

  _setCodeCopyButtonState(stateClass, title) {
    if (!this.codeCopyButton) {
      return;
    }

    this._setCodeToolButtonState(this.codeCopyButton, stateClass, title);
  }

  _setCodeToolButtonState(button, stateClass, title) {
    if (!button) {
      return;
    }

    button.classList.remove("copied", "compressed", "copy-failed", "copy-empty");
    if (stateClass) {
      button.classList.add(stateClass);
    }
    button.title = title;
    button.setAttribute("aria-label", title);

    if (this.codeCopyResetTimer) {
      window.clearTimeout(this.codeCopyResetTimer);
      this.codeCopyResetTimer = null;
    }

    this.codeCopyResetTimer = window.setTimeout(() => {
      if (!button) {
        return;
      }
      button.classList.remove("copied", "compressed", "copy-failed", "copy-empty");
      const defaultTitle = button === this.codeCompressButton ? "Compress Model Script" : "Copy Model Script";
      button.title = defaultTitle;
      button.setAttribute("aria-label", defaultTitle);
      this.codeCopyResetTimer = null;
    }, 1200);
  }

  _setButtonIcon(button, iconName, label) {
    if (!iconName) {
      return;
    }

    button.innerHTML = `
      <span class="btn-icon" aria-hidden="true">${iconSvg(iconName)}</span>
      <span class="btn-label">${label}</span>
    `;
    button.title = label;
    button.setAttribute("aria-label", label);
  }
}

function cloneMaterialForExport(material) {
  if (Array.isArray(material)) {
    return material.map((entry) => entry.clone());
  }
  return material?.clone?.() ?? new THREE.MeshStandardMaterial({ color: 0x7aa2f7 });
}

function disposeExportGroup(group) {
  group.traverse((object) => {
    if (object.geometry) {
      object.geometry.dispose();
    }
    if (Array.isArray(object.material)) {
      for (const material of object.material) {
        material.dispose?.();
      }
    } else if (object.material) {
      object.material.dispose?.();
    }
  });
}

function generateTerrainSeed() {
  return Math.floor(Math.random() * 1_000_000_000) + 1;
}

function defaultGroundThemeState() {
  return {
    theme: DEFAULT_GROUND_THEME,
    elevationVariation: DEFAULT_ELEVATION_VARIATION,
    terrainVariation: DEFAULT_TERRAIN_VARIATION,
    terrainDensity: DEFAULT_TERRAIN_DENSITY,
    terrainSeed: DEFAULT_TERRAIN_SEED,
  };
}

function migrateGroundThemeState(state) {
  const legacyElevationVariation = state.elevationVariation ?? state.terrainVariation ?? DEFAULT_ELEVATION_VARIATION;
  const terrainVariation = state.elevationVariation == null ? DEFAULT_TERRAIN_VARIATION : state.terrainVariation;
  return {
    ...state,
    elevationVariation: legacyElevationVariation,
    terrainVariation,
  };
}

function iconSvg(name) {
  const svg = (body) =>
    `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

  switch (name) {
    case "cursor":
      return svg('<path d="M5 3l12 9-6 1 2.5 7-2.8 1-2.6-7-3.1 3z"/>');
    case "move":
      return svg('<path d="M12 3v18M3 12h18"/><path d="M12 3l-2 2M12 3l2 2M21 12l-2-2M21 12l-2 2M12 21l-2-2M12 21l2-2M3 12l2-2M3 12l2 2"/>');
    case "rotate":
      return svg('<path d="M20 12a8 8 0 10-2.3 5.7"/><path d="M20 6v6h-6"/>');
    case "scale":
      return svg('<rect x="4" y="4" width="8" height="8"/><rect x="12" y="12" width="8" height="8"/><path d="M11 13l2-2"/>');
    case "pushPull":
      return svg('<rect x="4" y="13" width="16" height="7"/><path d="M12 4v10"/><path d="M9 7l3-3 3 3"/>');
    case "undo":
      return svg('<path d="M9 7l-5 5 5 5"/><path d="M20 18v-2a4 4 0 00-4-4H4"/>');
    case "redo":
      return svg('<path d="M15 7l5 5-5 5"/><path d="M4 18v-2a4 4 0 014-4h12"/>');
    case "menu":
      return svg('<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>');
    case "plus":
      return svg('<path d="M12 5v14"/><path d="M5 12h14"/>');
    case "reset":
      return svg('<path d="M4 12a8 8 0 111.9 5.2"/><path d="M4 4v5h5"/>');
    case "export":
      return svg('<path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 15v4h14v-4"/>');
    case "cube":
      return svg('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 3v18"/><path d="M4 7.5l8 4.5 8-4.5"/>');
    case "zoomExtents":
      return svg('<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/><path d="M8 12h8"/><path d="M12 8v8"/>');
    case "group":
      return svg('<rect x="3" y="4" width="8" height="8"/><rect x="13" y="4" width="8" height="8"/><rect x="8" y="13" width="8" height="8"/>');
    case "component":
      return svg('<path d="M6 7h12v12H6z"/><path d="M3 4h12v12"/><path d="M9 10h6v6H9z"/>');
    case "face":
      return svg('<polygon points="4,6 20,6 16,18 8,18"/><path d="M8 18l4-6 4 6"/>');
    case "edge":
      return svg('<path d="M4 16l16-8"/><circle cx="4" cy="16" r="2"/><circle cx="20" cy="8" r="2"/>');
    case "vertex":
      return svg('<circle cx="12" cy="12" r="4"/><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/>');
    case "copy":
      return svg('<rect x="9" y="9" width="10" height="11" rx="2"/><rect x="5" y="4" width="10" height="11" rx="2"/>');
    case "compress":
      return svg('<path d="M4 7h16"/><path d="M7 12h10"/><path d="M10 17h4"/><path d="M8 4l-4 3 4 3"/><path d="M16 14l4 3-4 3"/>');
    default:
      return svg('<circle cx="12" cy="12" r="7"/>');
  }
}
