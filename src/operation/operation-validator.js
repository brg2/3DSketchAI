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
      if (params.subshapeRotate !== undefined && params.subshapeRotate !== null) {
        assertSubshapeRotate(params.subshapeRotate);
      }
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
      if (params.profile !== undefined && params.profile !== null) {
        assertProfile(params.profile, "params.profile");
      }
      break;
    case OPERATION_TYPES.SKETCH_SPLIT:
      assertSketchSplitParams(params);
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

function assertSketchSplitParams(params) {
  if (!params.sketchId || typeof params.sketchId !== "string") {
    throw new Error("sketch_split requires params.sketchId");
  }
  if (!params.targetSelector || typeof params.targetSelector !== "object" || Array.isArray(params.targetSelector)) {
    throw new Error("sketch_split requires params.targetSelector");
  }
  if (typeof params.targetSelector.featureId !== "string" || typeof params.targetSelector.role !== "string") {
    throw new Error("sketch_split targetSelector requires featureId and role");
  }
  if (!params.plane || typeof params.plane !== "object" || Array.isArray(params.plane)) {
    throw new Error("sketch_split requires params.plane");
  }
  assertVector3(params.plane.origin, "params.plane.origin");
  assertVector3(params.plane.normal, "params.plane.normal");
  const normalLength = vectorLength(params.plane.normal);
  if (normalLength < 1e-8) {
    throw new Error("sketch_split params.plane.normal must be non-zero");
  }
  if (!Array.isArray(params.segments) || params.segments.length === 0) {
    throw new Error("sketch_split requires at least one segment");
  }
  for (let index = 0; index < params.segments.length; index += 1) {
    const segment = params.segments[index];
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
      throw new Error(`params.segments[${index}] must be an object`);
    }
    if (segment.id !== undefined && typeof segment.id !== "string") {
      throw new Error(`params.segments[${index}].id must be a string`);
    }
    if (!Array.isArray(segment.points) || segment.points.length !== 2) {
      throw new Error(`params.segments[${index}].points must contain exactly two points`);
    }
    assertVector3(segment.points[0], `params.segments[${index}].points[0]`);
    assertVector3(segment.points[1], `params.segments[${index}].points[1]`);
    assertPointOnPlane(segment.points[0], params.plane, normalLength, `params.segments[${index}].points[0]`);
    assertPointOnPlane(segment.points[1], params.plane, normalLength, `params.segments[${index}].points[1]`);
  }
}

function assertPointOnPlane(point, plane, normalLength, label) {
  const distance = Math.abs(dotVector(subtractVector(point, plane.origin), plane.normal) / normalLength);
  if (distance > 1e-4) {
    throw new Error(`${label} must be coplanar with params.plane`);
  }
}

function vectorLength(vector) {
  return Math.hypot(vector?.x ?? 0, vector?.y ?? 0, vector?.z ?? 0);
}

function subtractVector(a, b) {
  return {
    x: (a?.x ?? 0) - (b?.x ?? 0),
    y: (a?.y ?? 0) - (b?.y ?? 0),
    z: (a?.z ?? 0) - (b?.z ?? 0),
  };
}

function dotVector(a, b) {
  return (a?.x ?? 0) * (b?.x ?? 0) + (a?.y ?? 0) * (b?.y ?? 0) + (a?.z ?? 0) * (b?.z ?? 0);
}

function assertProfile(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  if (!value.objectId || typeof value.objectId !== "string") {
    throw new Error(`${label}.objectId must be a string`);
  }
  if (value.targetId !== undefined && value.targetId !== null && typeof value.targetId !== "string") {
    throw new Error(`${label}.targetId must be a string`);
  }
  if (!Array.isArray(value.points) || value.points.length < 3) {
    throw new Error(`${label}.points requires at least three points`);
  }
  for (let index = 0; index < value.points.length; index += 1) {
    assertVector3(value.points[index], `${label}.points[${index}]`);
  }
  if (value.closed !== undefined && value.closed !== true) {
    throw new Error(`${label}.closed must be true`);
  }
  if (value.plane !== undefined && value.plane !== null) {
    if (!value.plane || typeof value.plane !== "object") {
      throw new Error(`${label}.plane must be an object`);
    }
    assertVector3(value.plane.origin, `${label}.plane.origin`);
    assertVector3(value.plane.normal, `${label}.plane.normal`);
  }
}

function assertSubshapeRotate(value) {
  if (!value || typeof value !== "object") {
    throw new Error("params.subshapeRotate must be an object");
  }
  if (value.mode !== "edge") {
    throw new Error("params.subshapeRotate.mode must be edge");
  }
  assertNumber(value.angle, "params.subshapeRotate.angle");
  assertVector3(value.axis, "params.subshapeRotate.axis");
  assertVector3(value.origin, "params.subshapeRotate.origin");
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
