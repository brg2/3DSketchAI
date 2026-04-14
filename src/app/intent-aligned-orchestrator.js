import { serializeOperationToTypeScript } from "../operation/operation-serializer.js";
import { CanonicalModel } from "../modeling/canonical-model.js";
import { ModelExecutor } from "../modeling/model-executor.js";
import { RepresentationStore } from "../representation/representation-store.js";
import { ManipulationSession } from "../interaction/manipulation-session.js";

export class IntentAlignedOrchestrator {
  constructor({ canonicalModel, modelExecutor, representationStore } = {}) {
    this.canonicalModel = canonicalModel || new CanonicalModel();
    this.modelExecutor = modelExecutor || new ModelExecutor();
    this.representationStore = representationStore || new RepresentationStore();
    this._activeSession = null;
  }

  beginManipulation({ type, targetId = null, params }) {
    if (this._activeSession?.isActive()) {
      throw new Error("Another manipulation session is already active");
    }

    this._activeSession = new ManipulationSession({ type, targetId, params });
    const operation = this._activeSession.getPreviewOperation();

    // Preview path updates transient representation only.
    this.representationStore.setPreviewFromOperation(operation);

    return this.getState();
  }

  updateManipulation(params) {
    const session = this._requireActiveSession();
    session.updateParams(params);
    const operation = session.getPreviewOperation();

    // Preview and commit are driven by this same operation payload.
    this.representationStore.setPreviewFromOperation(operation);

    return this.getState();
  }

  async commitManipulation() {
    const session = this._requireActiveSession();
    const operation = session.commitOperation();
    const operationCode = serializeOperationToTypeScript(operation);

    this.canonicalModel.appendCommittedOperation(operation, operationCode);
    this._activeSession = null;

    const exactRepresentation = await this.modelExecutor.executeCanonicalModel(this.canonicalModel);
    this.representationStore.replaceWithExact(exactRepresentation);

    return {
      committedOperation: operation,
      operationCode,
      exactRepresentation,
      state: this.getState(),
    };
  }

  cancelManipulation() {
    const session = this._requireActiveSession();
    session.cancel();
    this._activeSession = null;
    this.representationStore.clearPreview();
    return this.getState();
  }

  getState() {
    return {
      hasActiveSession: Boolean(this._activeSession?.isActive()),
      canonicalEntries: this.canonicalModel.getEntries(),
      representation: this.representationStore.snapshot(),
    };
  }

  _requireActiveSession() {
    if (!this._activeSession || !this._activeSession.isActive()) {
      throw new Error("No active manipulation session");
    }

    return this._activeSession;
  }
}
