import { CanonicalModel } from "../modeling/canonical-model.js";
import { ModelExecutor } from "../modeling/model-executor.js";
import { RepresentationStore } from "../representation/representation-store.js";
import { ManipulationSession } from "../interaction/manipulation-session.js";
import { validateOperation } from "../operation/operation-validator.js";
import { ModelScriptStore } from "../persistence/model-script-store.js";
import { applyOperationToFeatureGraph } from "../feature/feature-resolution.js";
import { operationFromFeature } from "../feature/feature-store.js";
import { OPERATION_TYPES } from "../operation/operation-types.js";

export class RuntimeController {
  constructor({ canonicalModel, modelExecutor, representationStore, modelScriptStore, onCanonicalCodeChanged, onPreviewChanged } = {}) {
    this.canonicalModel = canonicalModel || new CanonicalModel();
    this.modelExecutor = modelExecutor || new ModelExecutor();
    this.representationStore = representationStore || new RepresentationStore();
    this.modelScriptStore = modelScriptStore || new ModelScriptStore();
    this.onCanonicalCodeChanged = onCanonicalCodeChanged || (() => {});
    this.onPreviewChanged = onPreviewChanged || (() => {});
    this._activeSession = null;
    this._lastExactBackend = "not-run";
    this._lastPreviewFeatureGraphUpdate = null;
    this._previewReplayRevision = 0;
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
    if (this._usesExactPreview(previewOperation)) {
      void this._updateExactPreview(previewOperation);
      return previewOperation;
    }
    this.representationStore.setPreviewOperation(this._operationForDisplayPreview(previewOperation));
    return previewOperation;
  }

  updateManipulation(params) {
    const session = this._requireActiveSession();
    session.updateParams(params);
    const previewOperation = session.getPreviewOperation();
    if (this._usesExactPreview(previewOperation)) {
      void this._updateExactPreview(previewOperation);
      return previewOperation;
    }
    this.representationStore.setPreviewOperation(this._operationForDisplayPreview(previewOperation));
    return previewOperation;
  }

  async commitManipulation() {
    const session = this._requireActiveSession();
    const operation = session.commitOperation();
    this._activeSession = null;
    this._lastPreviewFeatureGraphUpdate = null;
    this._previewReplayRevision += 1;
    return this.commitOperation(operation);
  }

  cancelManipulation() {
    if (this._activeSession) {
      this._activeSession.cancel();
      this._activeSession = null;
    }
    this._lastPreviewFeatureGraphUpdate = null;
    this._previewReplayRevision += 1;
    this.representationStore.clearPreview();
  }

  async commitOperation(operation) {
    const validOperation = validateOperation(structuredClone(operation));
    const featureGraphUpdate = applyOperationToFeatureGraph(this.canonicalModel.getFeatures(), validOperation);
    const nextFeatures = featureGraphUpdate.features;

    const exactRepresentation = await this._executeModelForDisplay({
      features: nextFeatures,
      operations: nextFeatures.map((feature) => operationFromFeature(feature)),
      sceneState: this.representationStore.getExactSceneState(),
    });

    this.canonicalModel.replaceFeatures(nextFeatures);
    const featureGraphJson = this.canonicalModel.toFeatureGraphJSON();
    this._lastExactBackend = exactRepresentation.exactBackend;
    this.representationStore.replaceWithExact(exactRepresentation);
    await this.modelScriptStore.saveScript(featureGraphJson);
    this.onCanonicalCodeChanged(featureGraphJson);

    return {
      operation: validOperation,
      exactRepresentation,
      canonicalGraphJson: featureGraphJson,
      canonicalCode: featureGraphJson,
      featureGraphUpdate,
    };
  }

  async reloadFromFeatureGraphJson(graphJson, { cleanSlate = false } = {}) {
    this.cancelManipulation();
    this.canonicalModel.fromFeatureGraphJSON(graphJson);
    const sceneState = cleanSlate ? {} : this.representationStore.getExactSceneState();
    const exactRepresentation = await this._executeModelForDisplay({
      features: this.canonicalModel.getFeatures(),
      operations: this.canonicalModel.getOperations(),
      sceneState,
    });

    this._lastExactBackend = exactRepresentation.exactBackend;
    this.representationStore.replaceWithExact(exactRepresentation);
    this.onCanonicalCodeChanged(this.canonicalModel.toFeatureGraphJSON());
    return exactRepresentation;
  }

  async persistCanonicalModel() {
    const graphJson = this.canonicalModel.toFeatureGraphJSON();
    await this.modelScriptStore.saveScript(graphJson);
    this.onCanonicalCodeChanged(graphJson);
    return graphJson;
  }

  async compressCanonicalModel() {
    this.cancelManipulation();
    const compressedOperations = compressAdjacentTransforms(this.canonicalModel.getOperations());
    this.canonicalModel.replaceCommittedOperations(compressedOperations);
    const featureGraphJson = this.canonicalModel.toFeatureGraphJSON();

    const exactRepresentation = await this._executeModelForDisplay({
      features: this.canonicalModel.getFeatures(),
      operations: this.canonicalModel.getOperations(),
      sceneState: {},
    });

    this._lastExactBackend = exactRepresentation.exactBackend;
    this.representationStore.replaceWithExact(exactRepresentation);
    await this.modelScriptStore.saveScript(featureGraphJson);
    this.onCanonicalCodeChanged(featureGraphJson);

    return {
      canonicalGraphJson: featureGraphJson,
      canonicalCode: featureGraphJson,
      operationCount: compressedOperations.length,
    };
  }

  async loadCanonicalModelFromStorage({ reload = true, cleanSlate = true } = {}) {
    const code = await this.modelScriptStore.loadScript();
    if (!code) {
      this.onCanonicalCodeChanged(this.canonicalModel.toFeatureGraphJSON());
      return [];
    }

    try {
      if (reload) {
        await this.reloadFromFeatureGraphJson(code, { cleanSlate });
      } else {
        this.canonicalModel.fromFeatureGraphJSON(code);
        this.onCanonicalCodeChanged(this.canonicalModel.toFeatureGraphJSON());
      }
    } catch (error) {
      await this.modelScriptStore.clear();
      this.canonicalModel.clear();
      this.onCanonicalCodeChanged(this.canonicalModel.toFeatureGraphJSON());
      return [];
    }

    return this.canonicalModel.getOperations();
  }

  async ensureDefaultModel() {
    if (this.canonicalModel.getOperations().length > 0) {
      return {
        canonicalGraphJson: this.canonicalModel.toFeatureGraphJSON(),
        canonicalCode: this.canonicalModel.toFeatureGraphJSON(),
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
    this.onCanonicalCodeChanged(this.canonicalModel.toFeatureGraphJSON());
  }

  getSnapshot() {
    return {
      hasActiveSession: Boolean(this._activeSession?.isActive()),
      operationCount: this.canonicalModel.getFeatures().length,
      canonicalGraphJson: this.canonicalModel.toFeatureGraphJSON(),
      canonicalCode: this.canonicalModel.toFeatureGraphJSON(),
      typescriptExport: this.canonicalModel.toTypeScriptModule(),
      featureGraph: this.canonicalModel.getFeatures(),
      representation: this.representationStore.snapshot(),
      exactBackend: this._lastExactBackend,
      previewFeatureGraphUpdate: this._lastPreviewFeatureGraphUpdate ? structuredClone(this._lastPreviewFeatureGraphUpdate) : null,
    };
  }

  _requireActiveSession() {
    if (!this._activeSession?.isActive()) {
      throw new Error("No active manipulation session");
    }
    return this._activeSession;
  }

  async _executeModelForDisplay(input) {
    return await this.modelExecutor.executeCanonicalModel(input);
  }

  _operationForDisplayPreview(operation) {
    const rawOperation = structuredClone(operation);
    let featureGraphUpdate;
    try {
      featureGraphUpdate = applyOperationToFeatureGraph(this.canonicalModel.getFeatures(), operation);
    } catch {
      this._lastPreviewFeatureGraphUpdate = null;
      return rawOperation;
    }
    this._lastPreviewFeatureGraphUpdate = previewFeatureGraphUpdateSummary(featureGraphUpdate);

    if (!featureGraphUpdate.modified) {
      return rawOperation;
    }

    const currentFeature = this.canonicalModel.getFeatures().find((feature) => feature.id === featureGraphUpdate.featureId);
    const nextFeature = featureGraphUpdate.features.find((feature) => feature.id === featureGraphUpdate.featureId);
    const incrementalOperation = incrementalPreviewOperation(rawOperation, currentFeature, nextFeature, featureGraphUpdate.reason);
    return incrementalOperation ?? rawOperation;
  }

  _usesExactPreview(operation) {
    return operation?.type === OPERATION_TYPES.PUSH_PULL;
  }

  async _updateExactPreview(operation) {
    const revision = ++this._previewReplayRevision;
    let featureGraphUpdate;
    try {
      featureGraphUpdate = applyOperationToFeatureGraph(this.canonicalModel.getFeatures(), operation);
    } catch {
      if (revision === this._previewReplayRevision) {
        this._lastPreviewFeatureGraphUpdate = null;
        this.representationStore.clearPreview();
      }
      return null;
    }

    this._lastPreviewFeatureGraphUpdate = previewFeatureGraphUpdateSummary(featureGraphUpdate);
    const nextFeatures = featureGraphUpdate.features;
    const exactRepresentation = await this._executeModelForDisplay({
      features: nextFeatures,
      operations: nextFeatures.map((feature) => operationFromFeature(feature)),
      sceneState: this.representationStore.getExactSceneState(),
    });

    if (revision !== this._previewReplayRevision || !this._activeSession?.isActive()) {
      return null;
    }

    this._lastExactBackend = exactRepresentation.exactBackend;
    this.representationStore.setPreviewExactRepresentation(exactRepresentation);
    this.onPreviewChanged();
    return exactRepresentation;
  }
}

function previewFeatureGraphUpdateSummary(update) {
  if (!update) {
    return null;
  }
  return {
    modified: Boolean(update.modified),
    created: Boolean(update.created),
    reason: update.reason ?? null,
    featureId: update.featureId ?? null,
  };
}

function incrementalPreviewOperation(operation, currentFeature, nextFeature, reason) {
  if (!currentFeature || !nextFeature) {
    return null;
  }

  if (reason === "modified_existing_face_rotate") {
    return incrementalFaceRotatePreviewOperation(operation, currentFeature, nextFeature);
  }

  if (reason === "modified_existing_object_rotate") {
    const currentEuler = vectorWithDefaults(currentFeature.params?.deltaEuler, { x: 0, y: 0, z: 0 });
    const nextEuler = vectorWithDefaults(nextFeature.params?.deltaEuler, { x: 0, y: 0, z: 0 });
    return {
      ...structuredClone(operation),
      params: {
        ...structuredClone(operation.params ?? {}),
        deltaEuler: subtractVectors(nextEuler, currentEuler),
      },
    };
  }

  if (reason === "modified_existing_face_move") {
    const currentDelta = vectorWithDefaults(currentFeature.params?.delta, { x: 0, y: 0, z: 0 });
    const nextDelta = vectorWithDefaults(nextFeature.params?.delta, { x: 0, y: 0, z: 0 });
    const delta = subtractVectors(nextDelta, currentDelta);
    const previewOperation = structuredClone(operation);
    previewOperation.params = {
      ...previewOperation.params,
      delta,
      subshapeMove: {
        ...previewOperation.params.subshapeMove,
        delta,
      },
    };
    return previewOperation;
  }

  if (reason === "modified_existing_push_pull") {
    const previewOperation = structuredClone(operation);
    previewOperation.params = {
      ...previewOperation.params,
      distance: roundMillimeters((nextFeature.params?.distance ?? 0) - (currentFeature.params?.distance ?? 0)),
    };
    return previewOperation;
  }

  if (reason === "modified_originating_primitive_position") {
    const currentPosition = vectorWithDefaults(currentFeature.params?.position, { x: 0, y: 0, z: 0 });
    const nextPosition = vectorWithDefaults(nextFeature.params?.position, { x: 0, y: 0, z: 0 });
    const previewOperation = structuredClone(operation);
    previewOperation.params = {
      ...previewOperation.params,
      delta: subtractVectors(nextPosition, currentPosition),
    };
    delete previewOperation.params.subshapeMove;
    return previewOperation;
  }

  if (reason === "modified_originating_primitive") {
    const previewOperation = structuredClone(operation);
    if (previewOperation.type === OPERATION_TYPES.PUSH_PULL) {
      const faceAxis = dominantAxis(previewOperation.params?.axis ?? { x: 0, y: 0, z: 1 });
      const currentSize = vectorWithDefaults(currentFeature.params?.size, { x: 1, y: 1, z: 1 });
      const nextSize = vectorWithDefaults(nextFeature.params?.size, { x: 1, y: 1, z: 1 });
      previewOperation.params = {
        ...previewOperation.params,
        distance: roundMillimeters((nextSize[faceAxis] ?? 0) - (currentSize[faceAxis] ?? 0)),
        previewPrimitiveState: primitivePreviewState(nextFeature),
      };
    }
    return previewOperation;
  }

  return null;
}

function incrementalFaceRotatePreviewOperation(operation, currentFeature, nextFeature) {
  if (operation?.type !== OPERATION_TYPES.ROTATE || operation.selection?.mode !== "face") {
    return null;
  }

  const currentTilts = faceTiltsFromParams(currentFeature?.params);
  const nextTilts = faceTiltsFromParams(nextFeature?.params);
  if (nextTilts.length === 0) {
    return null;
  }

  const incrementalTilts = [];
  for (const nextTilt of nextTilts) {
    const currentTilt = currentTilts.find((tilt) => faceTiltMergeKey(tilt) === faceTiltMergeKey(nextTilt));
    const angle = currentTilt
      ? incrementalTiltAngle(currentTilt.angle ?? 0, nextTilt.angle ?? 0)
      : nextTilt.angle ?? 0;
    if (Math.abs(angle) < 1e-8) {
      continue;
    }
    incrementalTilts.push({
      ...structuredClone(nextTilt),
      angle: roundMillimeters(angle),
    });
  }

  const displayOperation = structuredClone(operation);
  displayOperation.params = {
    ...displayOperation.params,
    deltaEuler: { x: 0, y: 0, z: 0 },
    faceTilts: incrementalTilts,
  };
  delete displayOperation.params.faceTilt;
  return displayOperation;
}

function vectorWithDefaults(value, defaults) {
  return {
    x: Number.isFinite(value?.x) ? value.x : defaults.x,
    y: Number.isFinite(value?.y) ? value.y : defaults.y,
    z: Number.isFinite(value?.z) ? value.z : defaults.z,
  };
}

function subtractVectors(next, current) {
  return {
    x: roundMillimeters(next.x - current.x),
    y: roundMillimeters(next.y - current.y),
    z: roundMillimeters(next.z - current.z),
  };
}

function dominantAxis(vector) {
  const axes = ["x", "y", "z"];
  let best = "x";
  for (const axis of axes) {
    if (Math.abs(vector?.[axis] ?? 0) > Math.abs(vector?.[best] ?? 0)) {
      best = axis;
    }
  }
  return best;
}

function primitivePreviewState(feature) {
  if (feature?.type !== OPERATION_TYPES.CREATE_PRIMITIVE) {
    return null;
  }
  return {
    primitive: feature.params?.primitive ?? "box",
    position: vectorWithDefaults(feature.params?.position, { x: 0, y: 0, z: 0 }),
    size: vectorWithDefaults(feature.params?.size, { x: 1, y: 1, z: 1 }),
  };
}

function faceTiltsFromParams(params) {
  return Array.isArray(params?.faceTilts) && params.faceTilts.length > 0
    ? params.faceTilts
    : [params?.faceTilt].filter(Boolean);
}

function faceTiltMergeKey(tilt) {
  return [
    tilt?.faceAxis,
    Math.sign(tilt?.faceSign ?? 1) || 1,
    tilt?.hingeSideAxis,
  ].join(":");
}

function incrementalTiltAngle(currentAngle, nextAngle) {
  return Math.atan(Math.tan(nextAngle) - Math.tan(currentAngle));
}

function roundMillimeters(value) {
  return Math.round(value * 1000) / 1000;
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

  for (const operation of operations) {
    if (isCompressibleTransform(operation)) {
      if (!run || !canContinueRun(run, operation)) {
        flushTransformRun(compressed, run);
        run = createTransformRun(operation);
      }
      addToTransformRun(run, operation);
      continue;
    }

    flushTransformRun(compressed, run);
    run = null;
    compressed.push(structuredClone(operation));
  }

  flushTransformRun(compressed, run);
  return compressed;
}

function isCompressibleTransform(operation) {
  if (operation?.type === "move" && !operation.params?.subshapeMove) return true;
  if (operation?.type === "scale") return true;
  if (operation?.type === "push_pull") return true;
  return false;
}

function canContinueRun(run, operation) {
  if (run.targetId !== operation.targetId) return false;
  if (run.type === "transform") {
    return operation.type === "move" || operation.type === "scale";
  }
  if (run.type !== operation.type) return false;
  if (operation.type === "push_pull") {
    const p = operation.params;
    return (
      run.mode === (p.mode ?? "move") &&
      sameAxisDirection(run.axis, p.axis)
    );
  }
  return true;
}

function sameAxisDirection(a, b) {
  if (!a || !b) return false;
  const axes = ["x", "y", "z"];
  const dominant = (v) => {
    let best = "x";
    for (const k of axes) {
      if (Math.abs(v[k] ?? 0) > Math.abs(v[best] ?? 0)) best = k;
    }
    return best;
  };
  const da = dominant(a);
  const db = dominant(b);
  return da === db && Math.sign(a[da] ?? 0) === Math.sign(b[db] ?? 0);
}

function createTransformRun(operation) {
  if (operation.type === "push_pull") {
    return {
      type: "push_pull",
      targetId: operation.targetId,
      selection: structuredClone(operation.selection ?? null),
      axis: structuredClone(operation.params.axis ?? { x: 0, y: 0, z: 1 }),
      faceIndex: operation.params.faceIndex ?? null,
      mode: operation.params.mode ?? "move",
      totalDistance: 0,
      operationCount: 0,
    };
  }
  return {
    type: "transform",
    targetId: operation.targetId,
    selection: structuredClone(operation.selection ?? null),
    scaleFactor: { x: 1, y: 1, z: 1 },
    delta: { x: 0, y: 0, z: 0 },
    hasScale: false,
    hasMove: false,
    operationCount: 0,
  };
}

function addToTransformRun(run, operation) {
  run.operationCount += 1;
  if (operation.type === "push_pull") {
    run.totalDistance = roundMillimeters(run.totalDistance + (operation.params.distance ?? 0));
    return;
  }
  if (operation.type === "move") {
    run.delta.x = roundMillimeters(run.delta.x + operation.params.delta.x);
    run.delta.y = roundMillimeters(run.delta.y + operation.params.delta.y);
    run.delta.z = roundMillimeters(run.delta.z + operation.params.delta.z);
    run.hasMove = true;
    return;
  }
  if (operation.type === "scale") {
    run.scaleFactor.x = roundMillimeters(run.scaleFactor.x * effectiveScaleFactor(operation.params.scaleFactor.x));
    run.scaleFactor.y = roundMillimeters(run.scaleFactor.y * effectiveScaleFactor(operation.params.scaleFactor.y));
    run.scaleFactor.z = roundMillimeters(run.scaleFactor.z * effectiveScaleFactor(operation.params.scaleFactor.z));
    run.hasScale = true;
  }
}

function flushTransformRun(compressed, run) {
  if (!run) {
    return;
  }

  if (run.type === "push_pull") {
    // Drop ops that net to zero (push then pull same face).
    if (Math.abs(run.totalDistance) < 1e-6) return;
    // Only compress if multiple ops were accumulated; a single op passes through unchanged.
    compressed.push({
      type: "push_pull",
      targetId: run.targetId,
      selection: run.selection,
      params: {
        axis: run.axis,
        faceIndex: run.faceIndex,
        mode: run.mode,
        distance: run.totalDistance,
      },
    });
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
  return Math.max(0.1, Number.isFinite(value) ? value : 1);
}

function isIdentityScale(scale) {
  return scale.x === 1 && scale.y === 1 && scale.z === 1;
}

function isZeroDelta(delta) {
  return delta.x === 0 && delta.y === 0 && delta.z === 0;
}
