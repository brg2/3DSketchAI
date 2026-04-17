import { OPERATION_TYPES } from "./operation-types.js";

function assertNumber(value, label) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function assertVector3(value, label) {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  assertNumber(value.x, `${label}.x`);
  assertNumber(value.y, `${label}.y`);
  assertNumber(value.z, `${label}.z`);
}

export function validateOperation(operation) {
  if (!operation || typeof operation !== "object") {
    throw new Error("Operation is required");
  }

  const { type, params } = operation;
  if (!type || typeof type !== "string") {
    throw new Error("Operation type is required");
  }

  switch (type) {
    case OPERATION_TYPES.CREATE_PRIMITIVE:
      if (!["box", "sphere", "cylinder"].includes(params.primitive)) {
        throw new Error("create_primitive requires primitive=box|sphere|cylinder");
      }
      if (!params.objectId || typeof params.objectId !== "string") {
        throw new Error("create_primitive requires params.objectId");
      }
      assertVector3(params.position ?? { x: 0, y: 0, z: 0 }, "params.position");
      assertVector3(params.size ?? { x: 1, y: 1, z: 1 }, "params.size");
      break;
    case OPERATION_TYPES.MOVE:
      assertVector3(params.delta, "params.delta");
      if (params.subshapeMove !== undefined && params.subshapeMove !== null) {
        assertSubshapeMove(params.subshapeMove);
      }
      break;
    case OPERATION_TYPES.ROTATE:
      assertVector3(params.deltaEuler, "params.deltaEuler");
      break;
    case OPERATION_TYPES.SCALE:
      assertVector3(params.scaleFactor, "params.scaleFactor");
      break;
    case OPERATION_TYPES.PUSH_PULL:
      assertNumber(params.distance, "params.distance");
      assertVector3(params.axis, "params.axis");
      if (params.faceIndex !== undefined && params.faceIndex !== null) {
        assertNumber(params.faceIndex, "params.faceIndex");
      }
      if (params.mode !== undefined && params.mode !== "move" && params.mode !== "extend") {
        throw new Error("push_pull params.mode must be move|extend");
      }
      break;
    case OPERATION_TYPES.GROUP:
      if (!params.groupId || typeof params.groupId !== "string") {
        throw new Error("group requires params.groupId");
      }
      if (!Array.isArray(params.objectIds) || params.objectIds.length === 0) {
        throw new Error(`${type} requires params.objectIds`);
      }
      break;
    case OPERATION_TYPES.COMPONENT:
      if (!params.componentId || typeof params.componentId !== "string") {
        throw new Error("component requires params.componentId");
      }
      if (!Array.isArray(params.objectIds) || params.objectIds.length === 0) {
        throw new Error(`${type} requires params.objectIds`);
      }
      break;
    default:
      throw new Error(`Unsupported operation type: ${type}`);
  }

  return operation;
}

function assertSubshapeMove(value) {
  if (!value || typeof value !== "object") {
    throw new Error("params.subshapeMove must be an object");
  }
  if (!["face", "edge", "vertex"].includes(value.mode)) {
    throw new Error("params.subshapeMove.mode must be face|edge|vertex");
  }
  assertVector3(value.delta, "params.subshapeMove.delta");

  if (value.mode === "face") {
    if (value.faceIndex !== undefined && value.faceIndex !== null) {
      assertNumber(value.faceIndex, "params.subshapeMove.faceIndex");
    }
    if (value.faceAxis !== undefined && !["x", "y", "z"].includes(value.faceAxis)) {
      throw new Error("params.subshapeMove.faceAxis must be x|y|z");
    }
    if (value.faceSign !== undefined) {
      assertNumber(value.faceSign, "params.subshapeMove.faceSign");
    }
    return;
  }

  if (value.mode === "edge") {
    if (!value.edge || typeof value.edge !== "object") {
      throw new Error("params.subshapeMove.edge must be an object");
    }
    assertVector3(value.edge.a, "params.subshapeMove.edge.a");
    assertVector3(value.edge.b, "params.subshapeMove.edge.b");
    return;
  }

  assertVector3(value.vertex, "params.subshapeMove.vertex");
}
