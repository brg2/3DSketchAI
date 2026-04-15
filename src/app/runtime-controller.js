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
    const compressedOperations = compressAdjacentMoves(this.canonicalModel.getOperations());
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

function compressAdjacentMoves(operations) {
  const compressed = [];

  for (const operation of operations) {
    const previous = compressed.at(-1);
    if (operation.type === "move" && previous?.type === "move" && previous.targetId === operation.targetId) {
      previous.params.delta.x = roundMillimeters(previous.params.delta.x + operation.params.delta.x);
      previous.params.delta.y = roundMillimeters(previous.params.delta.y + operation.params.delta.y);
      previous.params.delta.z = roundMillimeters(previous.params.delta.z + operation.params.delta.z);
      continue;
    }

    compressed.push(structuredClone(operation));
  }

  return compressed;
}

function roundMillimeters(value) {
  return Math.round(value * 1000) / 1000;
}
