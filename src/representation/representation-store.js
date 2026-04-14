export class RepresentationStore {
  constructor() {
    this._previewRepresentation = null;
    this._exactRepresentation = null;
    this._displayRepresentation = null;
  }

  setPreviewFromOperation(operation) {
    this._previewRepresentation = {
      kind: "preview_mesh",
      operation: {
        type: operation.type,
        targetId: operation.targetId,
        params: { ...operation.params },
      },
    };
    this._displayRepresentation = this._previewRepresentation;
  }

  replaceWithExact(exactRepresentation) {
    this._exactRepresentation = exactRepresentation;
    this._previewRepresentation = null;
    this._displayRepresentation = exactRepresentation;
  }

  clearPreview() {
    this._previewRepresentation = null;
    this._displayRepresentation = this._exactRepresentation;
  }

  snapshot() {
    return {
      previewRepresentation: this._previewRepresentation,
      exactRepresentation: this._exactRepresentation,
      displayRepresentation: this._displayRepresentation,
    };
  }
}
