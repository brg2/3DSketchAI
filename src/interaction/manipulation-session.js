import { createOperation, normalizeOperationParams } from "../operation/operation-types.js";
import { validateOperation } from "../operation/operation-validator.js";

export class ManipulationSession {
  constructor({ type, targetId = null, selection = null, params }) {
    this._operation = validateOperation(
      createOperation({
        type,
        targetId,
        selection,
        params,
      }),
    );
    this._active = true;
  }

  updateParams(nextParams) {
    this._ensureActive();
    this._operation.params = normalizeOperationParams(nextParams);
    validateOperation(this._operation);
  }

  getPreviewOperation() {
    this._ensureActive();
    return structuredClone(this._operation);
  }

  commitOperation() {
    this._ensureActive();
    this._active = false;
    return structuredClone(this._operation);
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
