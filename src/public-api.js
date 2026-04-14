/**
 * Minimal public API surface for intent-alignment contract tests.
 * Preview keeps work transient; commit serializes and executes exact model asynchronously.
 */
export function createIntentOperationController({
  operationType = "push_pull",
  appendCanonicalOperation,
  runExactModel,
  runFullModel,
  updatePreviewMesh,
} = {}) {
  if (typeof appendCanonicalOperation !== "function") {
    throw new Error("appendCanonicalOperation callback is required");
  }
  if (typeof runExactModel !== "function") {
    throw new Error("runExactModel callback is required");
  }
  if (typeof updatePreviewMesh !== "function") {
    throw new Error("updatePreviewMesh callback is required");
  }

  let lastOperation = null;
  const _unusedRunFullModel = runFullModel;
  void _unusedRunFullModel;

  function buildOperation(params) {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw new Error("Operation params must be an object");
    }

    return {
      type: operationType,
      targetId: params.targetId ?? null,
      params: { ...params },
    };
  }

  function serializeToExecutableTypeScript(operation) {
    return `applyOperation(model, ${JSON.stringify(operation, null, 2)})`;
  }

  return {
    async preview(params) {
      lastOperation = buildOperation(params);
      updatePreviewMesh(lastOperation);
      return lastOperation;
    },
    async commit(params) {
      const operation = buildOperation(params ?? lastOperation?.params ?? {});
      const code = serializeToExecutableTypeScript(operation);
      appendCanonicalOperation(code);
      return runExactModel(operation);
    },
  };
}

export const createOperationController = createIntentOperationController;
export const createInteractionController = createIntentOperationController;
export const createModelController = createIntentOperationController;
