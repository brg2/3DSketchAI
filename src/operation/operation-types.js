export const OPERATION_TYPES = Object.freeze({
  CREATE_PRIMITIVE: "create_primitive",
  MOVE: "move",
  ROTATE: "rotate",
  SCALE: "scale",
  PUSH_PULL: "push_pull",
  GROUP: "group",
  COMPONENT: "component",
});

export const SELECTION_MODES = Object.freeze({
  OBJECT: "object",
  FACE: "face",
  EDGE: "edge",
});

const TOOL_TO_OPERATION = Object.freeze({
  primitive: OPERATION_TYPES.CREATE_PRIMITIVE,
  move: OPERATION_TYPES.MOVE,
  rotate: OPERATION_TYPES.ROTATE,
  scale: OPERATION_TYPES.SCALE,
  pushPull: OPERATION_TYPES.PUSH_PULL,
  group: OPERATION_TYPES.GROUP,
  component: OPERATION_TYPES.COMPONENT,
});

export function operationForTool(tool) {
  const operationType = TOOL_TO_OPERATION[tool];
  if (!operationType) {
    throw new Error(`Unsupported tool: ${tool}`);
  }
  return operationType;
}

export function assertValidOperationType(type) {
  if (!Object.values(OPERATION_TYPES).includes(type)) {
    throw new Error(`Unsupported operation type: ${type}`);
  }
}

export function normalizeOperationParams(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new Error("Operation params must be an object");
  }
  return structuredClone(params);
}

export function createOperation({ type, targetId = null, selection = null, params }) {
  assertValidOperationType(type);
  return {
    id: crypto.randomUUID(),
    type,
    targetId,
    selection,
    params: normalizeOperationParams(params),
    timestamp: Date.now(),
  };
}
