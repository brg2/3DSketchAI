import { createOperation, normalizeOperationParams } from "../operation/operation-types.js";

export class ManipulationSession {
  constructor({ type, targetId = null, params }) {
    this._operation = createOperation({ type, targetId, params });
    this._active = true;
  }

  updateParams(partialParams) {
    this._ensureActive();
    const nextParams = {
      ...this._operation.params,
      ...normalizeOperationParams(partialParams),
    };
    this._operation = {
      ...this._operation,
      params: nextParams,
    };
  }

  getPreviewOperation() {
    this._ensureActive();
    return cloneOperation(this._operation);
  }

  commitOperation() {
    this._ensureActive();
    this._active = false;
    return cloneOperation(this._operation);
  }

  cancel() {
    this._active = false;
  }

  isActive() {
    return this._active;
  }

  _ensureActive() {
    if (!this._active) {
      throw new Error("Manipulation session is no longer active");
    }
  }
}

function cloneOperation(operation) {
  return {
    type: operation.type,
    targetId: operation.targetId,
    params: { ...operation.params },
  };
}
