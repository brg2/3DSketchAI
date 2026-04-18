import { SketchApp } from "./app/sketch-app.js";

/**
 * Test-facing controller contract used by intent-alignment tests.
 * Maintains preview/commit parameter consistency and async commit execution.
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

  const _unused = runFullModel;
  void _unused;

  let lastOperation = null;

  function buildOperation(params) {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw new Error("Operation params must be an object");
    }

    return {
      type: operationType,
      targetId: params.targetId ?? null,
      params: structuredClone(params),
    };
  }

  function serializeToFeatureGraph(operation) {
    return JSON.stringify({
      features: [
        {
          id: "feature_1",
          type: operation.type,
          params: structuredClone(operation.params),
          target: {
            objectId: operation.targetId,
            selection: null,
          },
          dependsOn: [],
        },
      ],
    }, null, 2);
  }

  return {
    async preview(params) {
      lastOperation = buildOperation(params);
      updatePreviewMesh(lastOperation);
      return lastOperation;
    },
    async commit(params) {
      const operation = buildOperation(params ?? lastOperation?.params ?? {});
      appendCanonicalOperation(serializeToFeatureGraph(operation));
      return runExactModel(operation);
    },
  };
}

export const createOperationController = createIntentOperationController;
export const createInteractionController = createIntentOperationController;
export const createModelController = createIntentOperationController;

export function createSketchApp(options) {
  return new SketchApp(options);
}
