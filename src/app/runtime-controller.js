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
    this._lastExactBackend = "not-run";
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

    const exactRepresentation = await this._executeModelForDisplay({
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
    const exactRepresentation = await this._executeModelForDisplay({
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

    const exactRepresentation = await this._executeModelForDisplay({
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

  async _executeModelForDisplay(input) {
    return await this.modelExecutor.executeCanonicalModel(input);
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
  if (operation?.type === "push_pull") return true;
  return false;
}

function canContinueRun(run, operation) {
  if (run.type !== operation.type) return false;
  if (run.targetId !== operation.targetId) return false;
  if (operation.type === "push_pull") {
    const p = operation.params;
    return (
      run.faceIndex === (p.faceIndex ?? null) &&
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
    type: "move",
    targetId: operation.targetId,
    selection: structuredClone(operation.selection ?? null),
    delta: { x: 0, y: 0, z: 0 },
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

  if (run.hasMove && !isZeroDelta(run.delta)) {
    compressed.push({
      type: "move",
      targetId: run.targetId,
      selection: run.selection,
      params: { delta: { ...run.delta } },
    });
  }
}

function isZeroDelta(delta) {
  return delta.x === 0 && delta.y === 0 && delta.z === 0;
}

function roundMillimeters(value) {
  return Math.round(value * 1000) / 1000;
}
