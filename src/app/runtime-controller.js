import { CanonicalModel } from "../modeling/canonical-model.js";
import { ModelExecutor } from "../modeling/model-executor.js";
import { RepresentationStore } from "../representation/representation-store.js";
import { ManipulationSession } from "../interaction/manipulation-session.js";
import { validateOperation } from "../operation/operation-validator.js";
import { ModelScriptStore } from "../persistence/model-script-store.js";

export class RuntimeController {
  constructor({ canonicalModel, modelExecutor, representationStore, modelScriptStore, onCanonicalCodeChanged } = {}) {
    this.canonicalModel = canonicalModel || new CanonicalModel();
    this.modelExecutor = modelExecutor || new ModelExecutor();
    this.representationStore = representationStore || new RepresentationStore();
    this.modelScriptStore = modelScriptStore || new ModelScriptStore();
    this.onCanonicalCodeChanged = onCanonicalCodeChanged || (() => {});
    this._activeSession = null;
    this._lastExactBackend = "fallback";
  }

  initialize({ scene, seedSceneState }) {
    this.representationStore.bindScene(scene);
    this.representationStore.setInitialSceneState(seedSceneState);
  }

  beginManipulation({ type, targetId, selection, params }) {
    if (this._activeSession?.isActive()) {
      throw new Error("Another manipulation session is already active");
    }

    this._activeSession = new ManipulationSession({ type, targetId, selection, params });
    const previewOperation = this._activeSession.getPreviewOperation();
    this.representationStore.setPreviewOperation(previewOperation);
    return previewOperation;
  }

  updateManipulation(params) {
    const session = this._requireActiveSession();
    session.updateParams(params);
    const previewOperation = session.getPreviewOperation();
    this.representationStore.setPreviewOperation(previewOperation);
    return previewOperation;
  }

  async commitManipulation() {
    const session = this._requireActiveSession();
    const operation = session.commitOperation();
    this._activeSession = null;
    return this.commitOperation(operation);
  }

  cancelManipulation() {
    if (this._activeSession) {
      this._activeSession.cancel();
      this._activeSession = null;
    }
    this.representationStore.clearPreview();
  }

  async commitOperation(operation) {
    const validOperation = validateOperation(structuredClone(operation));
    this.canonicalModel.appendCommittedOperation(validOperation);
    const canonicalCode = this.canonicalModel.toTypeScriptModule();
    this.onCanonicalCodeChanged(canonicalCode);

    const exactRepresentation = await this.modelExecutor.executeCanonicalModel({
      operations: this.canonicalModel.getOperations(),
      sceneState: this.representationStore.getExactSceneState(),
    });

    this._lastExactBackend = exactRepresentation.exactBackend;
    this.representationStore.replaceWithExact(exactRepresentation);
    await this.modelScriptStore.saveScript(canonicalCode);

    return {
      operation: validOperation,
      exactRepresentation,
      canonicalCode,
    };
  }

  async reloadFromCanonicalCode(code, { cleanSlate = false } = {}) {
    this.cancelManipulation();
    this.canonicalModel.fromTypeScriptModule(code);
    const sceneState = cleanSlate ? {} : this.representationStore.getExactSceneState();
    const exactRepresentation = await this.modelExecutor.executeCanonicalModel({
      operations: this.canonicalModel.getOperations(),
      sceneState,
    });

    this._lastExactBackend = exactRepresentation.exactBackend;
    this.representationStore.replaceWithExact(exactRepresentation);
    this.onCanonicalCodeChanged(this.canonicalModel.toTypeScriptModule());
    return exactRepresentation;
  }

  async persistCanonicalModel() {
    const code = this.canonicalModel.toTypeScriptModule();
    await this.modelScriptStore.saveScript(code);
    this.onCanonicalCodeChanged(code);
    return code;
  }

  async compressCanonicalModel() {
    this.cancelManipulation();
    const compressedOperations = compressAdjacentTransforms(this.canonicalModel.getOperations());
    this.canonicalModel.replaceCommittedOperations(compressedOperations);
    const canonicalCode = this.canonicalModel.toTypeScriptModule();

    const exactRepresentation = await this.modelExecutor.executeCanonicalModel({
      operations: this.canonicalModel.getOperations(),
      sceneState: {},
    });

    this._lastExactBackend = exactRepresentation.exactBackend;
    this.representationStore.replaceWithExact(exactRepresentation);
    await this.modelScriptStore.saveScript(canonicalCode);
    this.onCanonicalCodeChanged(canonicalCode);

    return {
      canonicalCode,
      operationCount: compressedOperations.length,
    };
  }

  async loadCanonicalModelFromStorage({ reload = true, cleanSlate = true } = {}) {
    const code = await this.modelScriptStore.loadScript();
    if (!code) {
      this.onCanonicalCodeChanged(this.canonicalModel.toTypeScriptModule());
      return [];
    }

    if (reload) {
      await this.reloadFromCanonicalCode(code, { cleanSlate });
    } else {
      this.canonicalModel.fromTypeScriptModule(code);
      this.onCanonicalCodeChanged(this.canonicalModel.toTypeScriptModule());
    }

    return this.canonicalModel.getOperations();
  }

  async ensureDefaultModel() {
    if (this.canonicalModel.getOperations().length > 0) {
      return {
        canonicalCode: this.canonicalModel.toTypeScriptModule(),
        operations: this.canonicalModel.getOperations(),
      };
    }

    const result = await this.commitOperation(createDefaultBoxOperation());
    return {
      ...result,
      operations: this.canonicalModel.getOperations(),
    };
  }

  async clearCanonicalModel() {
    this.cancelManipulation();
    this.canonicalModel.clear();
    await this.modelScriptStore.clear();
    this.onCanonicalCodeChanged(this.canonicalModel.toTypeScriptModule());
  }

  getSnapshot() {
    return {
      hasActiveSession: Boolean(this._activeSession?.isActive()),
      operationCount: this.canonicalModel.getOperations().length,
      canonicalCode: this.canonicalModel.toTypeScriptModule(),
      representation: this.representationStore.snapshot(),
      exactBackend: this._lastExactBackend,
    };
  }

  _requireActiveSession() {
    if (!this._activeSession?.isActive()) {
      throw new Error("No active manipulation session");
    }
    return this._activeSession;
  }
}

function createDefaultBoxOperation() {
  return {
    type: "create_primitive",
    targetId: null,
    selection: null,
    params: {
      primitive: "box",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
      objectId: "obj_1",
    },
  };
}

function compressAdjacentTransforms(operations) {
  const compressed = [];
  let run = null;
  const objectScales = new Map();

  for (const operation of operations) {
    if (isCompressibleTransform(operation)) {
      if (!run || run.targetId !== operation.targetId) {
        flushTransformRun(compressed, run);
        run = createTransformRun(operation);
      }
      addToTransformRun(run, operation, objectScales);
      continue;
    }

    flushTransformRun(compressed, run);
    run = null;
    compressed.push(structuredClone(operation));
    if (operation.type === "create_primitive" && operation.params.objectId) {
      objectScales.set(operation.params.objectId, { ...operation.params.size });
    }
  }

  flushTransformRun(compressed, run);
  return compressed;
}

function isCompressibleTransform(operation) {
  return (
    operation?.type === "move" ||
    operation?.type === "scale" ||
    (operation?.type === "push_pull" && operation.params.mode !== "extend" && isAxisAligned(operation.params.axis))
  );
}

function createTransformRun(operation) {
  return {
    targetId: operation.targetId,
    selection: structuredClone(operation.selection ?? null),
    scaleFactor: { x: 1, y: 1, z: 1 },
    delta: { x: 0, y: 0, z: 0 },
    hasScale: false,
    hasMove: false,
    operationCount: 0,
  };
}

function addToTransformRun(run, operation, objectScales) {
  run.operationCount += 1;
  if (operation.type === "move") {
    run.delta.x = roundMillimeters(run.delta.x + operation.params.delta.x);
    run.delta.y = roundMillimeters(run.delta.y + operation.params.delta.y);
    run.delta.z = roundMillimeters(run.delta.z + operation.params.delta.z);
    run.hasMove = true;
    return;
  }

  if (operation.type === "scale") {
    const scale = {
      x: effectiveScaleFactor(operation.params.scaleFactor.x),
      y: effectiveScaleFactor(operation.params.scaleFactor.y),
      z: effectiveScaleFactor(operation.params.scaleFactor.z),
    };
    addScaleToTransformRun(run, scale);
    multiplyObjectScale(objectScales, operation.targetId, scale);
    return;
  }

  const pushPullTransform = pushPullToTransform(operation, objectScales);
  addScaleToTransformRun(run, pushPullTransform.scaleFactor);
  run.delta.x = roundMillimeters(run.delta.x + pushPullTransform.delta.x);
  run.delta.y = roundMillimeters(run.delta.y + pushPullTransform.delta.y);
  run.delta.z = roundMillimeters(run.delta.z + pushPullTransform.delta.z);
  objectScales.set(operation.targetId, pushPullTransform.nextScale);
  run.hasMove = run.hasMove || !isZeroDelta(pushPullTransform.delta);
}

function addScaleToTransformRun(run, scaleFactor) {
  run.scaleFactor.x = roundMillimeters(run.scaleFactor.x * scaleFactor.x);
  run.scaleFactor.y = roundMillimeters(run.scaleFactor.y * scaleFactor.y);
  run.scaleFactor.z = roundMillimeters(run.scaleFactor.z * scaleFactor.z);
  run.hasScale = true;
}

function multiplyObjectScale(objectScales, targetId, scaleFactor) {
  const current = objectScales.get(targetId) ?? { x: 1, y: 1, z: 1 };
  objectScales.set(targetId, {
    x: roundMillimeters(current.x * scaleFactor.x),
    y: roundMillimeters(current.y * scaleFactor.y),
    z: roundMillimeters(current.z * scaleFactor.z),
  });
}

function pushPullToTransform(operation, objectScales) {
  const axis = operation.params.axis ?? { x: 0, y: 0, z: 1 };
  const dominant = dominantAxis(axis);
  const currentScale = objectScales.get(operation.targetId) ?? { x: 1, y: 1, z: 1 };
  const previousScale = Math.max(0.1, currentScale[dominant] ?? 1);
  const nextAxisScale = Math.max(0.1, previousScale + (operation.params.distance ?? 0));
  const appliedDelta = nextAxisScale - previousScale;
  const axisSign = Math.sign(axis[dominant] ?? 0) || 1;
  const scaleFactor = { x: 1, y: 1, z: 1 };
  const delta = { x: 0, y: 0, z: 0 };
  const nextScale = { ...currentScale };

  scaleFactor[dominant] = roundMillimeters(nextAxisScale / previousScale);
  delta[dominant] = roundMillimeters(axisSign * (appliedDelta * 0.5));
  nextScale[dominant] = roundMillimeters(nextAxisScale);

  return { scaleFactor, delta, nextScale };
}

function dominantAxis(axis) {
  const entries = [
    ["x", axis.x ?? 0],
    ["y", axis.y ?? 0],
    ["z", axis.z ?? 0],
  ];
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return entries[0][0];
}

function isAxisAligned(axis) {
  const normalized = normalizeAxis(axis ?? { x: 0, y: 0, z: 1 });
  return [Math.abs(normalized.x), Math.abs(normalized.y), Math.abs(normalized.z)].filter((value) => value > 1e-4).length <= 1;
}

function normalizeAxis(axis) {
  const length = Math.hypot(axis.x ?? 0, axis.y ?? 0, axis.z ?? 0);
  if (length < 1e-8) {
    return { x: 0, y: 0, z: 1 };
  }
  return { x: (axis.x ?? 0) / length, y: (axis.y ?? 0) / length, z: (axis.z ?? 0) / length };
}

function flushTransformRun(compressed, run) {
  if (!run) {
    return;
  }

  if (run.hasScale && !isIdentityScale(run.scaleFactor)) {
    compressed.push({
      type: "scale",
      targetId: run.targetId,
      selection: run.selection,
      params: { scaleFactor: { ...run.scaleFactor } },
    });
  }

  if (run.hasMove && !isZeroDelta(run.delta)) {
    compressed.push({
      type: "move",
      targetId: run.targetId,
      selection: run.selection,
      params: { delta: { ...run.delta } },
    });
  }
}

function effectiveScaleFactor(value) {
  return Math.max(0.1, value);
}

function isIdentityScale(scale) {
  return scale.x === 1 && scale.y === 1 && scale.z === 1;
}

function isZeroDelta(delta) {
  return delta.x === 0 && delta.y === 0 && delta.z === 0;
}

function roundMillimeters(value) {
  return Math.round(value * 1000) / 1000;
}
