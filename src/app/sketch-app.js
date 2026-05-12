import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { Viewport, ZOOM_EXTENTS_ANIMATION_MS } from "../view/viewport.js";
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
import { createGroupingOperation, createPrimitiveOperation, createSketchSplitOperation, mapToolGestureToOperation } from "../operation/operation-mapper.js";
import { OPERATION_TYPES, SELECTION_MODES } from "../operation/operation-types.js";
import { SKY_THEMES, DEFAULT_SOLID_SKY_COLOR, normalizeSkyColor, normalizeSkyTheme, skyThemePreset } from "../theme/sky-theme.js";
import { UI_THEME_MODES, normalizeUiThemeMode, resolveUiThemeMode } from "../theme/ui-theme.js";
import {
  DEFAULT_SOLID_GROUND_COLOR,
  GROUND_THEMES,
  normalizeGroundColor,
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
  { id: "lineDraw", label: "Line Draw", icon: "lineDraw" },
];

const DEFAULT_GROUND_THEME = GROUND_THEMES.AUTO;
const DEFAULT_ELEVATION_VARIATION = 0.5;
const DEFAULT_TERRAIN_VARIATION = 0.5;
const DEFAULT_TERRAIN_DENSITY = 0.5;
const DEFAULT_TERRAIN_SEED = 0;
const DEFAULT_MODEL_NAME = "Untitled";
const AI_PROMPT_HISTORY_LIMIT = 50;
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
    aiProviderSelect,
    aiApiKeyInput,
    aiKeySaveButton,
    aiKeyRemoveButton,
    aiPromptInput,
    aiSubmitButton,
    aiKeyStatusElement,
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
  }) {
    this.canvas = canvas;
    this.codeElement = codeElement;
    this.codePanel = codePanel;
    this.codeToggle = codeToggle;
    this.codeCopyButton = codeCopyButton;
    this.codeCompressButton = codeCompressButton;
    this.aiProviderSelect = aiProviderSelect;
    this.aiApiKeyInput = aiApiKeyInput;
    this.aiKeySaveButton = aiKeySaveButton;
    this.aiKeyRemoveButton = aiKeyRemoveButton;
    this.aiPromptInput = aiPromptInput;
    this.aiSubmitButton = aiSubmitButton;
    this.aiKeyStatusElement = aiKeyStatusElement;
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
    this.groundResetButton = groundResetButton;
    this.groundThemeSelect = groundThemeSelect;
    this.groundSolidField = groundSolidField;
    this.groundSolidToggleButton = groundSolidToggleButton;
    this.groundSolidPopover = groundSolidPopover;
    this.groundSolidColorInput = groundSolidColorInput;
    this.groundSolidHexInput = groundSolidHexInput;
    this.uiThemeSelect = uiThemeSelect;
    this.skyThemeSelect = skyThemeSelect;
    this.skySolidField = skySolidField;
    this.skySolidToggleButton = skySolidToggleButton;
    this.skySolidPopover = skySolidPopover;
    this.skySolidColorInput = skySolidColorInput;
    this.skySolidHexInput = skySolidHexInput;
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
    this.uiThemeMode = normalizeUiThemeMode(UI_THEME_MODES.AUTO);
    this.uiTheme = resolveUiThemeMode(this.uiThemeMode, this._prefersDarkColorScheme());
    this._uiThemeApplied = false;
    this._uiThemeMediaQuery = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
    this.skyTheme = normalizeSkyTheme(SKY_THEMES.AUTO);
    this.skySolidColor = normalizeSkyColor(DEFAULT_SOLID_SKY_COLOR);
    this.skySolidPopoverOpen = false;
    this._skyThemeApplied = false;
    this.groundThemeSelection = normalizeGroundTheme(DEFAULT_GROUND_THEME);
    this.groundSolidColor = normalizeGroundColor(DEFAULT_SOLID_GROUND_COLOR);
    this.groundSolidPopoverOpen = false;
    this.appSessionStore = new AppSessionStore();
    this.modelHistoryStore = new ModelScriptHistoryStore();
    this.modelHistory = new ModelScriptHistory();
    this.actionButtons = new Map();
    this.sessionPersistTimer = null;
    this.lastPersistedSessionSignature = "";
    this.isRestoringSession = false;
    this.frameRequestId = null;
    this.aiPromptHistory = [];
    this.aiPromptHistoryCursor = null;
    this.aiPromptDraft = "";

    this.viewport = new Viewport({
      canvas,
      onFrameNeeded: () => this._requestFrame(),
    });
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
    this.sketchCounter = 1;

    this.runtimeController = new RuntimeController({
      canonicalModel: new CanonicalModel(),
      modelExecutor: new ModelExecutor(),
      representationStore: this.representationStore,
      onCanonicalCodeChanged: (projection) => {
        this._renderFeatureGraphProjection(projection);
      },
      onPreviewChanged: () => this._requestFrame(),
    });

    this.runtimeController.initialize({ scene: this.viewport.scene, seedSceneState: {} });
    this._initPreselectionOverlays();
    this._initLineDrawOverlay();
    this._setUiThemeMode(this.uiThemeMode, { persist: false, force: true });
    this._setSkyTheme(this.skyTheme, { solidColor: this.skySolidColor, persist: false });
    this.viewport.controls.addEventListener("change", () => {
      this._scheduleSessionPersist();
      this._requestFrame();
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
      this.modelHistory.reset(defaultResult.canonicalGraphJson ?? this.runtimeController.getSnapshot().canonicalGraphJson, {
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

    this._requestFrame();
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

      if (this.tools.activeTool === "lineDraw") {
        await this._handleLineDrawPointerDown(event);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

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

      if (this.tools.activeTool === "lineDraw" && this.lineDrawState) {
        this._updateLineDrawPreviewFromEvent(event);
        this._renderOverlay();
        this._requestFrame();
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
        if (this.tools.activeTool === "lineDraw") {
          this._updateLineDrawStartSnapPreview(event, hover);
        }
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

    this.canvas.addEventListener("dblclick", async (event) => {
      if (this.tools.activeTool !== "lineDraw" || !this.lineDrawState) {
        return;
      }
      const point = this._lineDrawPointFromEvent(event);
      if (point) {
        const rounded = this._roundedVector(point);
        const last = this.lineDrawState.points.at(-1);
        if (!last || !this._pointsCloseForCommit(last, rounded)) {
          this._appendLineDrawPoint(point);
        }
      }
      await this._commitLineDraw({ closed: false });
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });

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

      await this._commitToolDrag(event);
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

      if (event.key === "Escape" && this.lineDrawState) {
        event.preventDefault();
        this._cancelLineDraw();
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
          this.sketchCounter = 1;
          this._setModelName(DEFAULT_MODEL_NAME);
          this._setPanelPage("script");
          this._setGridVisible(false);
          const result = await this.runtimeController.ensureDefaultModel();
          this.modelHistory.reset(result?.canonicalGraphJson ?? this.runtimeController.getSnapshot().canonicalGraphJson, {
            label: "New",
          });
          await this._persistModelHistory();
          this.objectCounter = 2;
          this.sketchCounter = 1;
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
          const didZoom = this.viewport.zoomToObjectsExtents(this.representationStore.getSelectableMeshes());
          this._renderOverlay();
          this._scheduleSessionPersist(didZoom ? ZOOM_EXTENTS_ANIMATION_MS + 80 : undefined);
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
    this._attachGroundThemeHandlers();
    this._attachUiThemeHandlers();
    this._attachSkyThemeHandlers();
  }

  _attachGroundThemeHandlers() {
    if (this.groundThemeSelect) {
      this.groundThemeSelect.addEventListener("change", () => {
        this._setGroundTheme({
          theme: this.groundThemeSelect.value,
          elevationVariation: this.elevationVariationInput?.value,
          terrainVariation: this.terrainVariationInput?.value,
          terrainDensity: this.terrainDensityInput?.value,
          solidColor: this.groundSolidColor,
        });
        void this._persistSessionState();
      });
    }

    if (this.groundSolidToggleButton && this.groundSolidPopover) {
      this.groundSolidToggleButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this._setGroundSolidPopoverOpen(!this.groundSolidPopoverOpen);
      });

      document.addEventListener("pointerdown", (event) => {
        if (!this.groundSolidPopoverOpen) {
          return;
        }
        const target = event.target;
        if (
          target instanceof Node &&
          (this.groundSolidPopover.contains(target) || this.groundSolidToggleButton.contains(target))
        ) {
          return;
        }
        this._setGroundSolidPopoverOpen(false);
      });

      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && this.groundSolidPopoverOpen) {
          this._setGroundSolidPopoverOpen(false);
          this.groundSolidToggleButton.focus();
        }
      });
    }

    if (this.groundSolidColorInput) {
      const onColorInput = () => {
        this._setGroundSolidColor(this.groundSolidColorInput.value);
      };
      this.groundSolidColorInput.addEventListener("input", onColorInput);
      this.groundSolidColorInput.addEventListener("change", onColorInput);
    }

    if (this.groundSolidHexInput) {
      const onHexInput = () => {
        this._setGroundSolidColor(this.groundSolidHexInput.value);
      };
      this.groundSolidHexInput.addEventListener("input", onHexInput);
      this.groundSolidHexInput.addEventListener("change", onHexInput);
      this.groundSolidHexInput.addEventListener("blur", () => {
        this.groundSolidHexInput.value = this.groundSolidColor.toUpperCase();
      });
    }

    this._syncGroundThemeControls();
  }

  _attachUiThemeHandlers() {
    if (this.uiThemeSelect) {
      this.uiThemeSelect.addEventListener("change", () => {
        this._setUiThemeMode(this.uiThemeSelect.value);
      });
    }

    if (this._uiThemeMediaQuery && typeof this._uiThemeMediaQuery.addEventListener === "function") {
      this._uiThemeMediaQuery.addEventListener("change", () => {
        if (this.uiThemeMode === UI_THEME_MODES.AUTO) {
          this._setUiThemeMode(this.uiThemeMode, { persist: false, force: true });
        }
      });
    } else if (this._uiThemeMediaQuery && typeof this._uiThemeMediaQuery.addListener === "function") {
      this._uiThemeMediaQuery.addListener(() => {
        if (this.uiThemeMode === UI_THEME_MODES.AUTO) {
          this._setUiThemeMode(this.uiThemeMode, { persist: false, force: true });
        }
      });
    }

    this._syncUiThemeControls();
  }

  _attachSkyThemeHandlers() {
    if (this.skyThemeSelect) {
      this.skyThemeSelect.addEventListener("change", () => {
        this._setSkyTheme(this.skyThemeSelect.value);
        void this._persistSessionState();
      });
    }

    if (this.skySolidToggleButton && this.skySolidPopover) {
      this.skySolidToggleButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this._setSkySolidPopoverOpen(!this.skySolidPopoverOpen);
      });

      document.addEventListener("pointerdown", (event) => {
        if (!this.skySolidPopoverOpen) {
          return;
        }
        const target = event.target;
        if (
          target instanceof Node &&
          (this.skySolidPopover.contains(target) || this.skySolidToggleButton.contains(target))
        ) {
          return;
        }
        this._setSkySolidPopoverOpen(false);
      });

      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && this.skySolidPopoverOpen) {
          this._setSkySolidPopoverOpen(false);
          this.skySolidToggleButton.focus();
        }
      });
    }

    if (this.skySolidColorInput) {
      const onColorInput = () => {
        this._setSkySolidColor(this.skySolidColorInput.value);
      };
      this.skySolidColorInput.addEventListener("input", onColorInput);
      this.skySolidColorInput.addEventListener("change", onColorInput);
    }

    if (this.skySolidHexInput) {
      const onHexInput = () => {
        this._setSkySolidColor(this.skySolidHexInput.value);
      };
      this.skySolidHexInput.addEventListener("input", onHexInput);
      this.skySolidHexInput.addEventListener("change", onHexInput);
      this.skySolidHexInput.addEventListener("blur", () => {
        this.skySolidHexInput.value = this.skySolidColor.toUpperCase();
      });
    }

    this._syncSkyThemeControls();
  }

  _prefersDarkColorScheme() {
    return Boolean(this._uiThemeMediaQuery?.matches);
  }

  _setUiThemeMode(mode, { persist = true, force = false } = {}) {
    const normalized = normalizeUiThemeMode(mode);
    const resolved = resolveUiThemeMode(normalized, this._prefersDarkColorScheme());
    if (!force && normalized === this.uiThemeMode && resolved === this.uiTheme && this._uiThemeApplied) {
      return;
    }

    this.uiThemeMode = normalized;
    this.uiTheme = resolved;

    if (document.body?.dataset) {
      document.body.dataset.uiThemeMode = normalized;
      document.body.dataset.uiTheme = resolved;
    }

    this._syncUiThemeControls();
    this._applyAutoEnvironmentThemes();
    this._uiThemeApplied = true;
    this._requestFrame();

    if (persist) {
      this._scheduleSessionPersist();
    }
  }

  _syncUiThemeControls() {
    if (this.uiThemeSelect) {
      this.uiThemeSelect.value = this.uiThemeMode;
    }
  }

  _setSkyTheme(theme, { solidColor = this.skySolidColor, persist = true } = {}) {
    const normalized = normalizeSkyTheme(theme);
    const normalizedSolidColor = normalizeSkyColor(solidColor, this.skySolidColor);
    const resolvedTheme = this._resolveSkyTheme(normalized);
    if (
      normalized === this.skyTheme &&
      this._skyThemeApplied &&
      this.viewport?.skyTheme === resolvedTheme &&
      (normalized !== SKY_THEMES.SOLID_COLOR || normalizedSolidColor === this.skySolidColor)
    ) {
      return;
    }
    this.skyTheme = normalized;
    this.skySolidColor = normalizedSolidColor;

    document.body.dataset.skyTheme = resolvedTheme;
    this._applySkyThemeDocumentTokens(resolvedTheme, this.skySolidColor);

    this.viewport?.setSkyTheme?.(resolvedTheme, { solidColor: this.skySolidColor });
    this._syncSkyThemeControls();
    this._applySelectionHighlights();
    this._requestFrame();
    this._skyThemeApplied = true;

    if (persist) {
      this._scheduleSessionPersist();
    }
  }

  _syncSkyThemeControls() {
    if (this.skyThemeSelect) {
      this.skyThemeSelect.value = this.skyTheme;
    }
    const solidThemeActive = this.skyTheme === SKY_THEMES.SOLID_COLOR;
    if (this.skySolidField) {
      this.skySolidField.hidden = !solidThemeActive;
    }
    if (this.skySolidToggleButton) {
      this.skySolidToggleButton.disabled = !solidThemeActive;
      this.skySolidToggleButton.setAttribute("aria-expanded", String(solidThemeActive && this.skySolidPopoverOpen));
    }
    if (this.skySolidPopover && !solidThemeActive) {
      this._setSkySolidPopoverOpen(false);
    }
    if (this.skySolidColorInput) {
      this.skySolidColorInput.value = this.skySolidColor;
    }
    if (this.skySolidHexInput) {
      this.skySolidHexInput.value = this.skySolidColor.toUpperCase();
    }
  }

  _setSkySolidPopoverOpen(open) {
    const shouldOpen = this.skyTheme === SKY_THEMES.SOLID_COLOR && Boolean(open);
    this.skySolidPopoverOpen = shouldOpen;
    if (this.skySolidPopover) {
      this.skySolidPopover.hidden = !shouldOpen;
    }
    if (this.skySolidToggleButton) {
      this.skySolidToggleButton.setAttribute("aria-expanded", String(shouldOpen));
    }
    if (shouldOpen && this.skySolidColorInput) {
      window.setTimeout(() => this.skySolidColorInput?.focus(), 0);
    }
  }

  _setSkySolidColor(value, { persist = true } = {}) {
    const normalized = normalizeSkyColor(value, this.skySolidColor);
    if (this.skyTheme !== SKY_THEMES.SOLID_COLOR) {
      this.skySolidColor = normalized;
      this._syncSkyThemeControls();
      if (persist) {
        this._scheduleSessionPersist();
      }
      return;
    }

    if (normalized === this.skySolidColor) {
      return;
    }

    this.skySolidColor = normalized;
    this._applySkyThemeDocumentTokens(this.skyTheme, normalized);
    this.viewport?.setSkyTheme?.(this.skyTheme, { solidColor: normalized });
    this._syncSkyThemeControls();
    this._applySelectionHighlights();
    this._requestFrame();

    if (persist) {
      this._scheduleSessionPersist();
    }
  }

  _applySkyThemeDocumentTokens(theme, solidColor) {
    const bodyStyle = document.body?.style;
    if (!bodyStyle) {
      return;
    }

    if (theme === SKY_THEMES.SOLID_COLOR) {
      bodyStyle.setProperty("--sky-solid", normalizeSkyColor(solidColor));
      return;
    }

    bodyStyle.removeProperty("--sky-solid");
  }

  _syncGroundThemeControls() {
    const activeTheme = this.groundThemeSelection;
    if (this.groundThemeSelect) {
      this.groundThemeSelect.value = activeTheme;
    }
    const solidThemeActive = activeTheme === GROUND_THEMES.SOLID_COLOR;
    if (this.groundSolidField) {
      this.groundSolidField.hidden = !solidThemeActive;
    }
    if (this.groundSolidToggleButton) {
      this.groundSolidToggleButton.disabled = !solidThemeActive;
      this.groundSolidToggleButton.setAttribute("aria-expanded", String(solidThemeActive && this.groundSolidPopoverOpen));
    }
    if (this.groundSolidPopover && !solidThemeActive) {
      this._setGroundSolidPopoverOpen(false);
    }
    if (this.groundSolidColorInput) {
      this.groundSolidColorInput.value = this.groundSolidColor;
    }
    if (this.groundSolidHexInput) {
      this.groundSolidHexInput.value = this.groundSolidColor.toUpperCase();
    }
  }

  _setGroundSolidPopoverOpen(open) {
    const activeTheme = this.groundThemeSelection;
    const shouldOpen = activeTheme === GROUND_THEMES.SOLID_COLOR && Boolean(open);
    this.groundSolidPopoverOpen = shouldOpen;
    if (this.groundSolidPopover) {
      this.groundSolidPopover.hidden = !shouldOpen;
    }
    if (this.groundSolidToggleButton) {
      this.groundSolidToggleButton.setAttribute("aria-expanded", String(shouldOpen));
    }
    if (shouldOpen && this.groundSolidColorInput) {
      window.setTimeout(() => this.groundSolidColorInput?.focus(), 0);
    }
  }

  _setGroundSolidColor(value, { persist = true } = {}) {
    const normalized = normalizeGroundColor(value, this.groundSolidColor);
    const groundState = this.viewport?.getGroundThemeState?.() ?? defaultGroundThemeState();
    this.groundSolidColor = normalized;

    if (normalizeGroundTheme(groundState.theme) !== GROUND_THEMES.SOLID_COLOR) {
      this._syncGroundThemeControls();
      if (persist) {
        this._scheduleSessionPersist();
      }
      return;
    }

    if (normalized === groundState.solidColor) {
      return;
    }

    this._setGroundTheme({
      ...groundState,
      solidColor: normalized,
    });

    if (persist) {
      this._scheduleSessionPersist();
    }
  }

  _resolveSkyTheme(theme = this.skyTheme) {
    const normalized = normalizeSkyTheme(theme);
    if (normalized !== SKY_THEMES.AUTO) {
      return normalized;
    }
    return this.uiTheme === "dark" ? SKY_THEMES.NIGHT_SKY : SKY_THEMES.CLEAR_NOON;
  }

  _resolveGroundTheme(theme = this.groundThemeSelection) {
    const normalized = normalizeGroundTheme(theme);
    if (normalized !== GROUND_THEMES.AUTO) {
      return normalized;
    }
    return this.uiTheme === "dark" ? GROUND_THEMES.DARK_FOREST : GROUND_THEMES.FOREST;
  }

  _applyAutoEnvironmentThemes() {
    if (this.skyTheme === SKY_THEMES.AUTO) {
      this._setSkyTheme(this.skyTheme, { solidColor: this.skySolidColor, persist: false });
    }
    if (this.groundThemeSelection === GROUND_THEMES.AUTO) {
      const state = this.viewport?.getGroundThemeState?.() ?? defaultGroundThemeState();
      this._setGroundTheme({
        ...state,
        theme: this.groundThemeSelection,
        solidColor: this.groundSolidColor,
      });
    }
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
      this._saveFeatureGraphToFile();
    });
    this.modelOpenButton?.addEventListener("click", () => {
      this.modelOpenInput?.click();
    });
    this.modelOpenInput?.addEventListener("change", () => {
      const file = this.modelOpenInput.files?.[0] ?? null;
      this.modelOpenInput.value = "";
      if (file) {
        void this._openFeatureGraphFile(file);
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
    await this._recordModelHistory(result?.canonicalGraphJson, "Create Primitive");
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
    await this._recordModelHistory(result?.canonicalGraphJson, "Group");
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
    await this._recordModelHistory(result?.canonicalGraphJson, "Component");
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

  _saveFeatureGraphToFile() {
    this._downloadTextFile(this._modelFileName("3dsai.json"), this._currentFeatureGraphProjection(), "application/json;charset=utf-8");
  }

  async _openFeatureGraphFile(file) {
    if (!file || typeof file.text !== "function") {
      return;
    }

    try {
      const graphText = await file.text();
      await this.runtimeController.reloadFromFeatureGraphJson(graphText, { cleanSlate: true });
      const graphJson = await this.runtimeController.persistCanonicalModel();
      this.modelHistory.reset(graphJson, { label: "Open" });
      await this._persistModelHistory();
      this.objectCounter = 1;
      this.sketchCounter = 1;
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
      console.warn("Failed to open feature graph", error);
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
    const preset = skyThemePreset(this.skyTheme, { solidColor: this.skySolidColor });
    const colors = preset.objects;
    const selected = new Set(this.selectionPipeline.selectedObjectIds);
    const objectHoverEnabled = this.selectionPipeline.selectionMode === SELECTION_MODES.OBJECT;
    const objectSelectionEnabled = this.selectionPipeline.selectionMode === SELECTION_MODES.OBJECT;
    for (const mesh of this.representationStore.getSelectableMeshes()) {
      const objectId = mesh.userData.objectId;
      if (objectSelectionEnabled && selected.has(objectId)) {
        mesh.material.emissive?.setHex(colors.selected.emissive);
        mesh.material.color.setHex(colors.selected.color);
      } else if (objectHoverEnabled && objectId === this.hoveredObjectId) {
        mesh.material.emissive?.setHex(colors.hover.emissive);
        mesh.material.color.setHex(colors.hover.color);
      } else {
        mesh.material.emissive?.setHex(colors.idle.emissive);
        mesh.material.color.setHex(mesh.userData.baseColor ?? colors.idle.color);
      }
    }

    if (this.preselectionFaceOverlay?.material?.color) {
      this.preselectionFaceOverlay.material.color.setHex(colors.preselect);
    }
    if (this.preselectionEdgeOverlay?.material?.color) {
      this.preselectionEdgeOverlay.material.color.setHex(colors.preselect);
    }
    if (this.preselectionVertexOverlay?.material?.color) {
      this.preselectionVertexOverlay.material.color.setHex(colors.preselect);
    }

    this._updatePreselectionOverlays();
    this._requestFrame();
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

  _requestFrame() {
    if (this.frameRequestId != null || typeof requestAnimationFrame !== "function") {
      return;
    }

    this.frameRequestId = requestAnimationFrame(() => this._tick());
  }

  _tick() {
    this.frameRequestId = null;
    const needsNextFrame = this.viewport.frame();
    this._renderOverlay();
    if (needsNextFrame || this.tools.dragState) {
      this._requestFrame();
    }
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
        lastDx: 0,
        baseAngles: { normal: 0, alternate: 0 },
      };
    }

    if (this.tools.activeTool === "rotate") {
      return {
        mode: "object-rotate",
        activeShift: Boolean(shiftKey),
        startDx: 0,
        lastDx: 0,
        baseEuler: { x: 0, y: 0, z: 0 },
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
      if (!op) {
        return null;
      }

      return this.runtimeController.beginManipulation({
        type: op.type,
        targetId: op.targetId,
        selection: op.selection,
        params: op.params,
      });
    };

    try {
      if (!beginToolManipulation()) {
        this.tools.clearDrag();
        this.viewport.controls.enabled = true;
        this.runtimeController.cancelManipulation();
        this._requestFrame();
        return false;
      }
    } catch (error) {
      if (error?.message === "Another manipulation session is already active") {
        this.runtimeController.cancelManipulation();
        try {
          if (!beginToolManipulation()) {
            this.tools.clearDrag();
            this.viewport.controls.enabled = true;
            this._requestFrame();
            return false;
          }
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
    this._hidePreselectionOverlays();
    this._requestFrame();
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
    if (!op) {
      this.runtimeController.cancelManipulation();
      this.tools.clearDrag();
      this.viewport.controls.enabled = true;
      this._requestFrame();
      return false;
    }
    this.runtimeController.updateManipulation(op.params);
    this._renderOverlay();
    this._requestFrame();
    return true;
  }

  async _commitToolDrag(event = null) {
    if (!this.tools.dragState) {
      return false;
    }

    if (event) {
      if (!this._updateToolDrag(event) || !this.tools.dragState) {
        return false;
      }
    }
    this.tools.endDrag();
    this.viewport.controls.enabled = true;
    const result = await this.runtimeController.commitManipulation();
    await this._recordModelHistory(result?.canonicalGraphJson, "Manipulation");
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
        const splitDx = Number.isFinite(drag.context.lastDx) ? drag.context.lastDx : drag.dx;
        const previousDelta = Math.round(((splitDx - drag.context.startDx) * 0.01) * 1000) / 1000;
        drag.context.baseAngles[previousKey] += previousDelta;
        drag.context.activeShift = wantsAlternateAxis;
        drag.context.startDx = splitDx;
        if (this.tools.dragState) {
          this.tools.dragState.context = drag.context;
        }
      }

      const activeKey = drag.context.activeShift ? "alternate" : "normal";
      const activeDelta = Math.round(((drag.dx - drag.context.startDx) * 0.01) * 1000) / 1000;
      drag.context.lastDx = drag.dx;
      return {
        ...gesture,
        faceTiltAngles: {
          normal: drag.context.baseAngles.normal + (activeKey === "normal" ? activeDelta : 0),
          alternate: drag.context.baseAngles.alternate + (activeKey === "alternate" ? activeDelta : 0),
        },
      };
    }

    if (this.tools.activeTool === "rotate" && drag.context?.mode === "object-rotate") {
      const wantsAlternateAxis = Boolean(event.shiftKey);
      if (wantsAlternateAxis !== drag.context.activeShift) {
        const previousAxis = drag.context.activeShift ? "x" : "y";
        const splitDx = Number.isFinite(drag.context.lastDx) ? drag.context.lastDx : drag.dx;
        const previousDelta = Math.round(((splitDx - drag.context.startDx) * 0.01) * 1000) / 1000;
        drag.context.baseEuler[previousAxis] += previousDelta;
        drag.context.activeShift = wantsAlternateAxis;
        drag.context.startDx = splitDx;
        if (this.tools.dragState) {
          this.tools.dragState.context = drag.context;
        }
      }

      const activeAxis = drag.context.activeShift ? "x" : "y";
      const activeDelta = Math.round(((drag.dx - drag.context.startDx) * 0.01) * 1000) / 1000;
      drag.context.lastDx = drag.dx;
      return {
        ...gesture,
        objectRotationEuler: {
          x: drag.context.baseEuler.x + (activeAxis === "x" ? activeDelta : 0),
          y: drag.context.baseEuler.y + (activeAxis === "y" ? activeDelta : 0),
          z: drag.context.baseEuler.z,
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

  _initLineDrawOverlay() {
    this.lineDrawState = null;
    this.lineDrawPreview = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x24a148,
        depthTest: false,
      }),
    );
    this.lineDrawPreview.visible = false;
    this.lineDrawPreview.renderOrder = 45;
    this.lineDrawPreview.frustumCulled = false;
    this.viewport.scene.add(this.lineDrawPreview);

    this.lineDrawSnapPreview = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color: 0xf4d35e,
        size: 8,
        sizeAttenuation: false,
        depthTest: false,
      }),
    );
    this.lineDrawSnapPreview.visible = false;
    this.lineDrawSnapPreview.renderOrder = 46;
    this.lineDrawSnapPreview.frustumCulled = false;
    this.viewport.scene.add(this.lineDrawSnapPreview);
  }

  async _handleLineDrawPointerDown(event) {
    const selectionResult = this.selectionPipeline.pick({
      clientX: event.clientX,
      clientY: event.clientY,
      selectableMeshes: this.representationStore.getSelectableMeshes(),
      multiSelect: event.shiftKey,
    });
    this.hoveredObjectId = selectionResult?.selection?.objectId ?? null;
    this.hoveredHit = selectionResult?.hit ?? null;

    if (!this.lineDrawState) {
      const started = this._startLineDraw(event, selectionResult);
      this._applySelectionHighlights();
      this._scheduleSessionPersist();
      return started;
    }

    const point = this._lineDrawPointFromEvent(event);
    if (!point) {
      return false;
    }

    if (this._lineDrawClosesLoop(point, event)) {
      await this._commitLineDraw({ closed: true });
      return true;
    }

    if (event.detail >= 2 && this.lineDrawState.points.length >= 2) {
      const rounded = this._roundedVector(point);
      const last = this.lineDrawState.points.at(-1);
      if (!last || !this._pointsCloseForCommit(last, rounded)) {
        this._appendLineDrawPoint(point);
      }
      await this._commitLineDraw({ closed: false });
      return true;
    }

    this._appendLineDrawPoint(point);
    this._updateLineDrawPreview(point);
    return true;
  }

  _startLineDraw(event, selectionResult) {
    const hit = selectionResult?.hit ?? null;
    const hitPoint = hit?.point?.clone?.() ?? null;
    const targetId = selectionResult?.selection?.objectId ?? null;
    const normalObject = selectionResult?.selection?.faceNormalWorld ?? null;
    const normal = new THREE.Vector3(
      normalObject?.x ?? 0,
      normalObject?.y ?? 1,
      normalObject?.z ?? 0,
    );
    if (normal.lengthSq() < 1e-8) {
      normal.set(0, 1, 0);
    }
    normal.normalize();

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const firstPoint = hitPoint ?? this.selectionPipeline.pointOnPlane({
      clientX: event.clientX,
      clientY: event.clientY,
      plane: groundPlane,
    });
    if (!firstPoint) {
      return false;
    }

    const snap = this._snapLineDrawPoint(event, firstPoint, { targetId, includeLinePoints: false });
    if (snap?.point) {
      firstPoint.copy(snap.point);
      this._setLineDrawSnapPreview(snap.point);
    } else {
      this._setLineDrawSnapPreview(null);
    }

    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, firstPoint);
    const sketchContext = this._lineDrawSketchContext(selectionResult?.selection);
    this.lineDrawState = {
      sketchId: sketchContext.sketchId,
      targetSelector: sketchContext.targetSelector,
      targetId,
      selection: selectionResult?.selection ? structuredClone(selectionResult.selection) : null,
      plane,
      planeOrigin: firstPoint.clone(),
      planeNormal: normal.clone(),
      points: [this._roundedVector(firstPoint)],
      previewPoint: this._roundedVector(firstPoint),
    };
    this._hidePreselectionOverlays();
    this._updateLineDrawPreview(firstPoint);
    return true;
  }

  _lineDrawSketchContext(selection) {
    const selectorFeatureId = selection?.selector?.featureId ?? null;
    if (selectorFeatureId) {
      const existing = this.runtimeController.getSnapshot().featureGraph
        .find((feature) => feature.id === selectorFeatureId && feature.type === OPERATION_TYPES.SKETCH_SPLIT);
      if (existing?.params?.sketchId && existing.params?.targetSelector) {
        return {
          sketchId: existing.params.sketchId,
          targetSelector: structuredClone(existing.params.targetSelector),
        };
      }
    }

    return {
      sketchId: `sketch_${this.sketchCounter++}`,
      targetSelector: selection?.selector ? structuredClone(selection.selector) : null,
    };
  }

  _updateLineDrawStartSnapPreview(event, hover) {
    if (this.lineDrawState || this.tools.dragState) {
      return;
    }

    const hitPoint = hover?.hit?.point?.clone?.() ?? null;
    if (!hitPoint || !hover?.objectId) {
      this._setLineDrawSnapPreview(null);
      return;
    }

    const snap = this._snapLineDrawPoint(event, hitPoint, { targetId: hover.objectId, includeLinePoints: false });
    this._setLineDrawSnapPreview(snap?.point ?? hitPoint);
  }

  _appendLineDrawPoint(point) {
    if (!this.lineDrawState) {
      return;
    }
    const rounded = this._roundedVector(point);
    const last = this.lineDrawState.points.at(-1);
    if (last && this._pointsNearlyEqual(last, rounded)) {
      this.lineDrawState.previewPoint = rounded;
      return;
    }
    this.lineDrawState.points.push(rounded);
    this.lineDrawState.previewPoint = rounded;
  }

  _updateLineDrawPreviewFromEvent(event) {
    const point = this._lineDrawPointFromEvent(event);
    if (point) {
      this._updateLineDrawPreview(point);
    }
  }

  _lineDrawPointFromEvent(event) {
    if (!this.lineDrawState?.plane) {
      return null;
    }
    const point = this.selectionPipeline.pointOnPlane({
      clientX: event.clientX,
      clientY: event.clientY,
      plane: this.lineDrawState.plane,
    });
    if (!point) {
      this._setLineDrawSnapPreview(null);
      return null;
    }
    const snap = this._snapLineDrawPoint(event, point);
    this._setLineDrawSnapPreview(snap?.point ?? null);
    return snap?.point ?? point;
  }

  _snapLineDrawPoint(event, planePoint, { targetId = this.lineDrawState?.targetId ?? null, includeLinePoints = true } = {}) {
    const vertexSnap = this._nearestLineDrawVertexSnap(event, planePoint, { targetId, includeLinePoints });
    if (vertexSnap) {
      return vertexSnap;
    }
    return this._nearestLineDrawEdgeSnap(event, planePoint, { targetId });
  }

  _nearestLineDrawVertexSnap(event, planePoint, { targetId = this.lineDrawState?.targetId ?? null, includeLinePoints = true } = {}) {
    const candidates = [
      ...(includeLinePoints ? (this.lineDrawState?.points ?? []).map((point) => new THREE.Vector3(point.x, point.y, point.z)) : []),
      ...this._lineDrawTargetVertices(targetId),
    ];
    return this._nearestScreenSnap(event, candidates, 12, "vertex");
  }

  _nearestLineDrawEdgeSnap(event, planePoint, { targetId = this.lineDrawState?.targetId ?? null } = {}) {
    const edgeCandidates = [];
    for (const [a, b] of this._lineDrawTargetEdges(targetId)) {
      edgeCandidates.push({
        point: a.clone().add(b).multiplyScalar(0.5),
        kind: "edge-midpoint",
      });
      edgeCandidates.push({
        point: closestPointOnSegment(planePoint, a, b),
        kind: "edge",
      });
    }
    return this._nearestScreenSnap(
      event,
      edgeCandidates.map((candidate) => candidate.point),
      10,
      "edge",
    );
  }

  _nearestScreenSnap(event, points, threshold, kind) {
    let best = null;
    for (const point of points) {
      const client = this._clientPointForWorldPoint(point);
      if (!client) {
        continue;
      }
      const distance = Math.hypot(client.x - event.clientX, client.y - event.clientY);
      if (distance > threshold || (best && distance >= best.distance)) {
        continue;
      }
      best = { point: point.clone(), distance, kind };
    }
    return best;
  }

  _lineDrawTargetMeshes(targetId = this.lineDrawState?.targetId ?? null) {
    if (!targetId) {
      return [];
    }
    return this.representationStore.getSelectableMeshes().filter((mesh) => (
      (mesh.userData.sourceObjectId ?? mesh.userData.objectId) === targetId &&
      !mesh.userData.profile
    ));
  }

  _lineDrawTargetVertices(targetId = this.lineDrawState?.targetId ?? null) {
    const vertices = [];
    for (const mesh of this._lineDrawTargetMeshes(targetId)) {
      const position = mesh.geometry?.attributes?.position;
      if (!position) {
        continue;
      }
      const seen = new Set();
      for (let index = 0; index < position.count; index += 1) {
        const local = new THREE.Vector3().fromBufferAttribute(position, index);
        const key = `${local.x.toFixed(4)}:${local.y.toFixed(4)}:${local.z.toFixed(4)}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        vertices.push(mesh.localToWorld(local.clone()));
      }
    }
    return vertices;
  }

  _lineDrawTargetEdges(targetId = this.lineDrawState?.targetId ?? null) {
    const edges = [];
    for (const mesh of this._lineDrawTargetMeshes(targetId)) {
      const position = mesh.geometry?.attributes?.position;
      const index = mesh.geometry?.index;
      if (!position || !index) {
        continue;
      }
      const seen = new Set();
      for (let triangle = 0; triangle < Math.floor(index.count / 3); triangle += 1) {
        const corners = [0, 1, 2].map((corner) => index.getX(triangle * 3 + corner));
        for (const [aIndex, bIndex] of [[corners[0], corners[1]], [corners[1], corners[2]], [corners[2], corners[0]]]) {
          const key = aIndex < bIndex ? `${aIndex}:${bIndex}` : `${bIndex}:${aIndex}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          const a = mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(position, aIndex));
          const b = mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(position, bIndex));
          edges.push([a, b]);
        }
      }
    }
    return edges;
  }

  _lineDrawClosesLoop(point, event) {
    if (!this.lineDrawState || this.lineDrawState.points.length < 3) {
      return false;
    }
    const first = this.lineDrawState.points[0];
    const firstClient = this._clientPointForWorldPoint(new THREE.Vector3(first.x, first.y, first.z));
    if (!firstClient) {
      return false;
    }
    return Math.hypot(firstClient.x - event.clientX, firstClient.y - event.clientY) <= 12;
  }

  async _commitLineDraw({ closed }) {
    if (!this.lineDrawState) {
      return false;
    }
    const state = this.lineDrawState;
    if (state.points.length < 2 || (closed && state.points.length < 3)) {
      this._cancelLineDraw();
      return false;
    }

    const operation = createSketchSplitOperation({
      sketchId: state.sketchId,
      targetId: state.targetId,
      selection: state.selection,
      targetSelector: state.targetSelector,
      points: state.points,
      closed,
      plane: {
        origin: this._roundedVector(state.planeOrigin),
        normal: this._roundedVector(state.planeNormal),
      },
    });

    this.lineDrawState = null;
    this._setLineDrawSnapPreview(null);
    this._updateLineDrawPreview();
    const result = await this.runtimeController.commitOperation(operation);
    await this._recordModelHistory(result?.canonicalGraphJson, "Line Draw");
    this._applySelectionHighlights();
    this._renderOverlay();
    this._scheduleSessionPersist();
    return true;
  }

  _cancelLineDraw() {
    this.lineDrawState = null;
    this._setLineDrawSnapPreview(null);
    this._updateLineDrawPreview();
    this._applySelectionHighlights();
    this._renderOverlay();
    this._requestFrame();
  }

  _updateLineDrawPreview(previewPoint = null) {
    if (!this.lineDrawPreview) {
      return;
    }
    if (!this.lineDrawState) {
      this.lineDrawPreview.visible = false;
      this.lineDrawPreview.geometry.dispose();
      this.lineDrawPreview.geometry = new THREE.BufferGeometry();
      this._setLineDrawSnapPreview(null);
      this._requestFrame();
      return;
    }

    const points = [...this.lineDrawState.points];
    const roundedPreview = previewPoint ? this._roundedVector(previewPoint) : this.lineDrawState.previewPoint;
    const last = points.at(-1);
    if (roundedPreview && (!last || !this._pointsNearlyEqual(last, roundedPreview))) {
      points.push(roundedPreview);
    }
    const flat = new Float32Array(points.length * 3);
    points.forEach((point, index) => {
      flat[index * 3 + 0] = point.x;
      flat[index * 3 + 1] = point.y;
      flat[index * 3 + 2] = point.z;
    });
    this.lineDrawPreview.geometry.dispose();
    this.lineDrawPreview.geometry = new THREE.BufferGeometry();
    this.lineDrawPreview.geometry.setAttribute("position", new THREE.BufferAttribute(flat, 3));
    this.lineDrawPreview.visible = points.length > 1;
    this._requestFrame();
  }

  _setLineDrawSnapPreview(point) {
    if (!this.lineDrawSnapPreview) {
      return;
    }
    if (!point) {
      this.lineDrawSnapPreview.visible = false;
      this.lineDrawSnapPreview.geometry.dispose();
      this.lineDrawSnapPreview.geometry = new THREE.BufferGeometry();
      this._requestFrame();
      return;
    }
    this.lineDrawSnapPreview.geometry.dispose();
    this.lineDrawSnapPreview.geometry = new THREE.BufferGeometry();
    this.lineDrawSnapPreview.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([point.x, point.y, point.z]), 3),
    );
    this.lineDrawSnapPreview.visible = true;
    this._requestFrame();
  }

  _clientPointForWorldPoint(point) {
    if (!point) {
      return null;
    }
    const projected = point.clone().project(this.viewport.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
    };
  }

  _roundedVector(vector) {
    return {
      x: Math.round((vector?.x ?? 0) * 1000) / 1000,
      y: Math.round((vector?.y ?? 0) * 1000) / 1000,
      z: Math.round((vector?.z ?? 0) * 1000) / 1000,
    };
  }

  _pointsNearlyEqual(a, b) {
    return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0), (a?.z ?? 0) - (b?.z ?? 0)) < 1e-5;
  }

  _pointsCloseForCommit(a, b) {
    return Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0), (a?.z ?? 0) - (b?.z ?? 0)) < 0.05;
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

    this._hidePreselectionOverlays();

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

  _hidePreselectionOverlays() {
    if (this.preselectionFaceOverlay) {
      this.preselectionFaceOverlay.visible = false;
    }
    if (this.preselectionEdgeOverlay) {
      this.preselectionEdgeOverlay.visible = false;
    }
    if (this.preselectionVertexOverlay) {
      this.preselectionVertexOverlay.visible = false;
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

    const provenancePatch = this._facePatchTrisFromProvenance(geometry, seedTri, triCount);
    if (provenancePatch.length > 0) {
      return this._worldTrianglePointsFromIndices(hit.object, position, triVerts, provenancePatch);
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

  _facePatchTrisFromProvenance(geometry, seedTri, triCount) {
    const faceProvenance = geometry?.userData?.faceProvenance;
    const seed = Array.isArray(faceProvenance) ? faceProvenance[seedTri] : null;
    if (!seed?.featureId || !seed?.role) {
      return [];
    }

    const matches = [];
    for (let tri = 0; tri < triCount; tri += 1) {
      const candidate = faceProvenance[tri];
      if (
        candidate?.featureId === seed.featureId &&
        candidate?.role === seed.role &&
        (candidate?.sketchId ?? null) === (seed.sketchId ?? null)
      ) {
        matches.push(tri);
      }
    }
    return matches;
  }

  _worldTrianglePointsFromIndices(object, position, triVerts, triangleIndices) {
    const worldVertexCache = new Map();
    const worldVertex = (idx) => {
      const cached = worldVertexCache.get(idx);
      if (cached) {
        return cached;
      }
      const point = object.localToWorld(new THREE.Vector3().fromBufferAttribute(position, idx));
      worldVertexCache.set(idx, point);
      return point;
    };

    const points = [];
    for (const tri of triangleIndices) {
      const [a, b, c] = triVerts[tri] ?? [];
      if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) {
        continue;
      }
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
    let maxSketch = 0;
    for (const operation of operations) {
      const objectId = operation?.params?.objectId;
      if (objectId?.startsWith?.("obj_")) {
        const serial = Number.parseInt(objectId.slice(4), 10);
        if (Number.isFinite(serial) && serial > max) {
          max = serial;
        }
      }
      const sketchId = operation?.params?.sketchId;
      if (sketchId?.startsWith?.("sketch_")) {
        const serial = Number.parseInt(sketchId.slice("sketch_".length), 10);
        if (Number.isFinite(serial) && serial > maxSketch) {
          maxSketch = serial;
        }
      }
    }

    this.objectCounter = Math.max(this.objectCounter, max + 1);
    this.sketchCounter = Math.max(this.sketchCounter, maxSketch + 1);
  }

  async _restoreModelHistory() {
    const currentCode = this.runtimeController.getSnapshot().canonicalGraphJson;
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
    const code = typeof canonicalCode === "string" ? canonicalCode : this.runtimeController.getSnapshot().canonicalGraphJson;
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

    await this.runtimeController.reloadFromFeatureGraphJson(entry.script, { cleanSlate: true });
    this._syncObjectCounterFromOperations(this.runtimeController.canonicalModel.getOperations());
    this._dropInvalidSelections();
    const graphJson = await this.runtimeController.persistCanonicalModel();
    this.modelHistory.replaceCurrent(graphJson, { label: entry.label });
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
    this._requestFrame();
  }

  _clearHoverState() {
    if (!this.hoveredObjectId && !this.hoveredHit) {
      this._setLineDrawSnapPreview(null);
      return;
    }

    this.hoveredObjectId = null;
    this.hoveredHit = null;
    this._setLineDrawSnapPreview(null);
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
      this._setButtonIcon(this.codeCopyButton, "copy", "Copy Feature Graph");
      this.codeCopyButton.addEventListener("click", () => {
        void this._copyModelScriptToClipboard();
      });
    }

    if (this.codeCompressButton) {
      this.codeCompressButton.classList.add("icon-btn");
      this._setButtonIcon(this.codeCompressButton, "compress", "Compact Feature Graph");
      this.codeCompressButton.addEventListener("click", () => {
        void this._compressModelScript();
      });
    }

    if (this.aiKeySaveButton) {
      this.aiKeySaveButton.addEventListener("click", () => {
        void this._saveAiProviderKey();
      });
    }

    if (this.aiKeyRemoveButton) {
      this.aiKeyRemoveButton.addEventListener("click", () => {
        void this._removeAiProviderKey();
      });
    }

    if (this.aiSubmitButton) {
      this.aiSubmitButton.addEventListener("click", () => {
        void this._submitAiPrompt();
      });
    }

    if (this.aiPromptInput) {
      this.aiPromptInput.addEventListener("keydown", (event) => {
        if (event.isComposing) {
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          void this._submitAiPrompt();
          return;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          this._cycleAiPromptHistory(event.key === "ArrowUp" ? -1 : 1);
        }
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

    if (this.groundResetButton) {
      this.groundResetButton.addEventListener("click", () => {
        this._resetGroundThemeDefaults();
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
          solidColor: this.groundSolidColor,
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
          solidColor: this.groundSolidColor,
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
          solidColor: this.groundSolidColor,
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
      solidColor: this.groundSolidColor,
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
    this._requestFrame();
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
    this._requestFrame();
  }

  _setGroundEffectsVisible(visible) {
    const isVisible = Boolean(visible);
    this.viewport.setGroundEffectsVisible(isVisible);
    if (this.groundEffectsToggleButton) {
      this.groundEffectsToggleButton.textContent = `Ground: ${isVisible ? "On" : "Off"}`;
      this.groundEffectsToggleButton.setAttribute("aria-pressed", String(isVisible));
      this.groundEffectsToggleButton.classList.toggle("active", isVisible);
    }
    this._requestFrame();
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
    solidColor = this.groundSolidColor,
  } = {}) {
    const normalizedThemeSelection = normalizeGroundTheme(theme);
    const normalizedTheme = this._resolveGroundTheme(normalizedThemeSelection);
    const normalizedElevationVariation = normalizeElevationVariation(elevationVariation);
    const normalizedTerrainVariation = normalizeTerrainVariation(terrainVariation);
    const normalizedDensity = normalizeTerrainDensity(terrainDensity);
    const currentTerrainSeed = this.viewport?.getGroundThemeState?.().terrainSeed ?? DEFAULT_TERRAIN_SEED;
    const normalizedSeed = normalizeTerrainSeed(terrainSeed ?? currentTerrainSeed);
    const normalizedSolidColor = normalizeGroundColor(solidColor, this.groundSolidColor);
    this.groundThemeSelection = normalizedThemeSelection;
    this.groundSolidColor = normalizedSolidColor;
    this.viewport.setGroundTheme({
      theme: normalizedTheme,
      elevationVariation: normalizedElevationVariation,
      terrainVariation: normalizedTerrainVariation,
      terrainDensity: normalizedDensity,
      terrainSeed: normalizedSeed,
      solidColor: normalizedSolidColor,
    });

    if (this.groundThemeSelect) {
      this.groundThemeSelect.value = normalizedThemeSelection;
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
    this._syncGroundThemeControls();
    this._requestFrame();
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

  _resetGroundThemeDefaults() {
    this._setUiThemeMode(UI_THEME_MODES.AUTO, { persist: false, force: true });
    this._setSkyTheme(SKY_THEMES.AUTO, { persist: false, solidColor: this.skySolidColor });
    this._setGridVisible(false);
    this._setGroundEffectsVisible(true);
    this._setDevConsoleVisible(false);
    this._setGroundTheme(defaultGroundThemeState());
  }

  _setActiveTool(tool, { render = true } = {}) {
    if (!TOOL_CONFIG.some((entry) => entry.id === tool)) {
      return;
    }
    if (tool !== "lineDraw" && this.lineDrawState) {
      this._cancelLineDraw();
    } else if (tool !== "lineDraw") {
      this._setLineDrawSnapPreview(null);
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
        uiThemeMode: this.uiThemeMode,
        skyTheme: this.skyTheme,
        skySolidColor: this.skySolidColor,
        groundThemeSelection: this.groundThemeSelection,
        aiPromptHistory: [...this.aiPromptHistory],
      },
      selection: {
        selectedObjectIds: [...this.selectionPipeline.selectedObjectIds],
      },
      scene: {
        objectCounter: this.objectCounter,
        sketchCounter: this.sketchCounter,
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
      if (typeof state?.scene?.sketchCounter === "number" && Number.isFinite(state.scene.sketchCounter)) {
        this.sketchCounter = Math.max(this.sketchCounter, Math.floor(state.scene.sketchCounter));
      }

      this._setActiveTool(state?.ui?.activeTool ?? "select", { render: false });
      this._setSelectionMode(state?.ui?.selectionMode ?? SELECTION_MODES.OBJECT, { render: false });
      this._setCodePanelCollapsed(Boolean(state?.ui?.codeCollapsed));
      this._setPanelPage(state?.ui?.panelPage ?? "script");
      this._setDevConsoleVisible(Boolean(state?.ui?.devConsoleVisible));
      this._setModelName(state?.ui?.modelName ?? DEFAULT_MODEL_NAME);
      this._setUiThemeMode(state?.ui?.uiThemeMode ?? this.uiThemeMode, {
        persist: false,
        force: true,
      });
      this._setSkyTheme(state?.ui?.skyTheme ?? this.skyTheme, {
        solidColor: state?.ui?.skySolidColor ?? this.skySolidColor,
        persist: false,
      });
      this._setGridVisible(Boolean(state?.scene?.gridVisible));
      this._setGroundEffectsVisible(state?.scene?.groundTheme?.groundEffectsVisible !== false);
      const savedGroundTheme = state?.scene?.groundTheme;
      const restoredGroundTheme = savedGroundTheme ? migrateGroundThemeState(savedGroundTheme) : defaultGroundThemeState();
      this._setGroundTheme({
        ...restoredGroundTheme,
        theme: state?.ui?.groundThemeSelection ?? restoredGroundTheme.theme,
      });
      this.aiPromptHistory = this._normalizeAiPromptHistory(state?.ui?.aiPromptHistory);
      this.aiPromptHistoryCursor = null;
      this.aiPromptDraft = "";

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
    this._requestFrame();
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
    const graphText = this._currentFeatureGraphProjection();
    if (graphText.trim().length === 0) {
      this._setCodeCopyButtonState("copy-empty", "No Graph To Copy");
      return;
    }

    let copied = false;
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(graphText);
        copied = true;
      } catch {
        copied = false;
      }
    }

    if (!copied) {
      copied = this._copyTextFallback(graphText);
    }

    if (copied) {
      this._setCodeCopyButtonState("copied", "Copied");
    } else {
      this._setCodeCopyButtonState("copy-failed", "Copy Failed");
    }
  }

  _renderFeatureGraphProjection(projection = this._currentFeatureGraphProjection()) {
    if (this.codeElement) {
      this.codeElement.textContent = projection;
    }
  }

  _currentFeatureGraphProjection() {
    return this.runtimeController.getSnapshot().canonicalGraphJson;
  }

  async _saveAiProviderKey() {
    const provider = this.aiProviderSelect?.value ?? "openai";
    const apiKey = this.aiApiKeyInput?.value ?? "";
    if (!apiKey.trim()) {
      this._setAiKeyStatus("Enter a key to store locally.");
      return;
    }
    try {
      await this.runtimeController.saveAiProviderKey(provider, apiKey.trim());
      this.aiApiKeyInput.value = "";
      this._setAiKeyStatus("Key stored locally encrypted.");
    } catch (error) {
      console.warn("Failed to save AI provider key", error);
      this._setAiKeyStatus("Key save failed.");
    }
  }

  async _removeAiProviderKey() {
    const provider = this.aiProviderSelect?.value ?? "openai";
    await this.runtimeController.removeAiProviderKey(provider);
    this._setAiKeyStatus("Key removed.");
  }

  async _submitAiPrompt() {
    const prompt = this.aiPromptInput?.value ?? "";
    if (!prompt.trim()) {
      return;
    }
    this._recordAiPrompt(prompt);
    this._setAiSubmitBusy(true);
    try {
      const patch = await this.runtimeController.requestAiPatch({
        provider: this.aiProviderSelect?.value ?? "openai",
        prompt,
        selection: this._currentAiSelectionContext(),
        provenance: this._currentAiProvenanceContext(),
        view: this._currentAiViewContext(),
      });
      const result = await this.runtimeController.applyFeatureGraphPatch(patch);
      await this._recordModelHistory(result?.canonicalGraphJson, "AI Edit");
      this._applySelectionHighlights();
      this._renderOverlay();
      await this._persistSessionState();
    } catch (error) {
      console.warn("Failed to submit AI edit", error);
    } finally {
      this._setAiSubmitBusy(false);
    }
  }

  _recordAiPrompt(prompt) {
    const normalized = String(prompt ?? "").trim();
    if (!normalized) {
      return;
    }
    this.aiPromptHistory = [
      ...this.aiPromptHistory.filter((entry) => entry !== normalized),
      normalized,
    ].slice(-AI_PROMPT_HISTORY_LIMIT);
    this.aiPromptHistoryCursor = null;
    this.aiPromptDraft = "";
    this._scheduleSessionPersist();
  }

  _cycleAiPromptHistory(direction) {
    if (!this.aiPromptInput || this.aiPromptHistory.length === 0) {
      return;
    }
    if (this.aiPromptHistoryCursor === null) {
      this.aiPromptDraft = this.aiPromptInput.value ?? "";
      this.aiPromptHistoryCursor = this.aiPromptHistory.length;
    }

    const nextCursor = Math.max(0, Math.min(
      this.aiPromptHistory.length,
      this.aiPromptHistoryCursor + direction,
    ));
    this.aiPromptHistoryCursor = nextCursor;
    const nextValue = nextCursor === this.aiPromptHistory.length
      ? this.aiPromptDraft
      : this.aiPromptHistory[nextCursor];
    this.aiPromptInput.value = nextValue;
    this.aiPromptInput.setSelectionRange(nextValue.length, nextValue.length);
  }

  _normalizeAiPromptHistory(history) {
    if (!Array.isArray(history)) {
      return [];
    }
    const normalized = [];
    for (const entry of history) {
      const prompt = String(entry ?? "").trim();
      if (prompt && !normalized.includes(prompt)) {
        normalized.push(prompt);
      }
    }
    return normalized.slice(-AI_PROMPT_HISTORY_LIMIT);
  }

  _setAiSubmitBusy(busy) {
    if (this.aiSubmitButton) {
      this.aiSubmitButton.disabled = Boolean(busy);
      this.aiSubmitButton.title = busy ? "Submitting" : "Submit prompt";
      this.aiSubmitButton.setAttribute("aria-label", busy ? "Submitting" : "Submit prompt");
    }
  }

  _setAiKeyStatus(message) {
    if (this.aiKeyStatusElement) {
      this.aiKeyStatusElement.textContent = message;
    }
  }

  _currentAiSelectionContext() {
    return {
      mode: this.selectionPipeline.selectionMode,
      selectedObjectIds: [...this.selectionPipeline.selectedObjectIds],
      hoveredObjectId: this.hoveredObjectId,
      hoveredSelection: this.hoveredHit?.selection ? structuredClone(this.hoveredHit.selection) : null,
    };
  }

  _currentAiProvenanceContext() {
    const selector = this.hoveredHit?.selection?.selector ?? null;
    return selector ? structuredClone(selector) : null;
  }

  _currentAiViewContext() {
    return {
      projection: this.viewport.camera.isOrthographicCamera ? "orthographic" : "perspective",
      position: this._roundedVector(this.viewport.camera.position),
      target: this._roundedVector(this.viewport.controls.target),
      zoom: this.viewport.camera.zoom,
    };
  }

  async _compressModelScript() {
    if (!this.codeCompressButton) {
      return;
    }

    try {
      const result = await this.runtimeController.compressCanonicalModel();
      await this._recordModelHistory(result?.canonicalGraphJson, "Compact");
      this._setCodeToolButtonState(this.codeCompressButton, "compressed", "Compacted");
      this._applySelectionHighlights();
      this._renderOverlay();
      await this._persistSessionState();
    } catch (error) {
      console.warn("Failed to compact feature graph", error);
      this._setCodeToolButtonState(this.codeCompressButton, "copy-failed", "Compact Failed");
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
      const defaultTitle = button === this.codeCompressButton ? "Compact Feature Graph" : "Copy Feature Graph";
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
    solidColor: DEFAULT_SOLID_GROUND_COLOR,
  };
}

function migrateGroundThemeState(state) {
  const normalizedTheme = normalizeGroundTheme(state?.theme);
  const legacyElevationVariation = state.elevationVariation ?? state.terrainVariation ?? DEFAULT_ELEVATION_VARIATION;
  const terrainVariation = state.elevationVariation == null ? DEFAULT_TERRAIN_VARIATION : state.terrainVariation;
  return {
    ...state,
    theme: normalizedTheme,
    elevationVariation: legacyElevationVariation,
    terrainVariation,
    solidColor: normalizeGroundColor(state?.solidColor, DEFAULT_SOLID_GROUND_COLOR),
  };
}

function closestPointOnSegment(point, a, b) {
  const ab = b.clone().sub(a);
  const denom = ab.lengthSq();
  if (denom <= 1e-10) {
    return a.clone();
  }
  const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / denom, 0, 1);
  return a.clone().add(ab.multiplyScalar(t));
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
    case "lineDraw":
      return svg('<path d="M4 17l5-8 5 5 6-8"/><circle cx="4" cy="17" r="1.8"/><circle cx="9" cy="9" r="1.8"/><circle cx="14" cy="14" r="1.8"/><circle cx="20" cy="6" r="1.8"/>');
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
