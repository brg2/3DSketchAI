export const OPERATION_TYPES = Object.freeze({
  PUSH_PULL: "push_pull",
  MOVE: "move",
  ROTATE: "rotate",
  SCALE: "scale",
  CREATE_PRIMITIVE: "create_primitive",
  GROUP: "group",
  COMPONENT: "component",
});

export function assertValidOperationType(type) {
  if (!Object.values(OPERATION_TYPES).includes(type)) {
    throw new Error(`Unsupported operation type: ${type}`);
  }
}

export function normalizeOperationParams(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new Error("Operation params must be an object");
  }

  return { ...params };
}

export function createOperation({ type, targetId = null, params }) {
  assertValidOperationType(type);
  const normalizedParams = normalizeOperationParams(params);

  return {
    type,
    targetId,
    params: normalizedParams,
  };
}
