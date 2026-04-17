export const OPERATION_TYPES = Object.freeze({
  CREATE_PRIMITIVE: "create_primitive",
  MOVE: "move",
  ROTATE: "rotate",
  PUSH_PULL: "push_pull",
  GROUP: "group",
  COMPONENT: "component",
});

export const SELECTION_MODES = Object.freeze({
  OBJECT: "object",
  FACE: "face",
  EDGE: "edge",
  VERTEX: "vertex",
});

const TOOL_TO_OPERATION = Object.freeze({
  primitive: OPERATION_TYPES.CREATE_PRIMITIVE,
  move: OPERATION_TYPES.MOVE,
  rotate: OPERATION_TYPES.ROTATE,
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

export function createOperationId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createOperation({ type, targetId = null, selection = null, params }) {
  assertValidOperationType(type);
  return {
    id: createOperationId(),
    type,
    targetId,
    selection,
    params: normalizeOperationParams(params),
    timestamp: Date.now(),
  };
}
