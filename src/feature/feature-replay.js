import { OPERATION_TYPES } from "../operation/operation-types.js";
import { operationFromFeature, orderedFeatures } from "./feature-store.js";

const AXES = ["x", "y", "z"];

export function replayFeaturesToSceneState({ features, exactBackend = "feature-replay:no-exact-kernel" } = {}) {
  const sceneState = {};

  for (const feature of orderedFeatures(features)) {
    applyFeatureToSceneState(sceneState, feature);
  }

  return {
    kind: "exact_geometry",
    exactBackend,
    sceneState,
    operationCount: features?.length ?? 0,
  };
}

export function replayFeaturesToShapes({ features, r, sai, bakeObjectRotations = true }) {
  if (!r || !sai) {
    throw new Error("Feature replay requires modeling runtime and 3DSAI library");
  }

  const ordered = orderedFeatures(features);
  const context = createShapeReplayContext({ features: ordered, r, sai, bakeObjectRotations });
  for (const feature of ordered) {
    applyFeature(context, feature);
  }

  const objectShapes = new Map();
  for (const objectId of context.objectOrder) {
    const shape = exactShapeForObject(context.objectValues.get(objectId));
    if (shape) {
      objectShapes.set(objectId, shape);
    }
  }

  return {
    objectShapes,
    shape: firstShape(objectShapes),
    operationCount: ordered.length,
  };
}

export function applyFeature(context, feature) {
  const operation = operationFromFeature(feature);
  const targetId = operation.targetId;
  const current = targetId ? context.objectValues.get(targetId) : null;

  switch (feature.type) {
    case OPERATION_TYPES.CREATE_PRIMITIVE:
      return applyCreatePrimitive(context, operation);

    case OPERATION_TYPES.MOVE:
      if (!current) return null;
      return setObjectValue(context, targetId, applyMoveFeature(context, current, operation));

    case OPERATION_TYPES.ROTATE:
      if (!current) return null;
      return setObjectValue(context, targetId, applyRotateFeature(context, current, operation));

    case OPERATION_TYPES.SCALE:
      if (!current) return null;
      return setObjectValue(context, targetId, current.scale(vectorArray(operation.params.scaleFactor)));

    case OPERATION_TYPES.PUSH_PULL:
      if (!current) return null;
      return setObjectValue(context, targetId, context.sai.pushPullFace(context.r, current, faceOperationFromPushPull(operation.params)));

    case OPERATION_TYPES.POLYLINE:
      applyPolylineMetadata(context, operation);
      return null;

    case OPERATION_TYPES.GROUP:
    case OPERATION_TYPES.COMPONENT:
      applyGroupingMetadata(context, operation);
      return null;

    default:
      return null;
  }
}

function applyFeatureToSceneState(sceneState, feature) {
  const operation = operationFromFeature(feature);
  const target = operation.targetId ? sceneState[operation.targetId] : null;

  switch (operation.type) {
    case OPERATION_TYPES.CREATE_PRIMITIVE: {
      const id = operation.params.objectId;
      if (!id) return;
      sceneState[id] = {
        primitive: operation.params.primitive,
        position: { ...(operation.params.position ?? { x: 0, y: 0, z: 0 }) },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { ...(operation.params.size ?? { x: 1, y: 1, z: 1 }) },
        groupId: null,
        componentId: null,
      };
      return;
    }

    case OPERATION_TYPES.MOVE:
      if (target && !operation.params.subshapeMove) {
        target.position.x += operation.params.delta.x;
        target.position.y += operation.params.delta.y;
        target.position.z += operation.params.delta.z;
      }
      return;

    case OPERATION_TYPES.ROTATE:
      if (target && operation.params.deltaEuler) {
        target.rotation.x += operation.params.deltaEuler.x;
        target.rotation.y += operation.params.deltaEuler.y;
        target.rotation.z += operation.params.deltaEuler.z;
      }
      return;

    case OPERATION_TYPES.SCALE:
      if (target && operation.params.scaleFactor) {
        target.scale.x *= Math.max(0.1, operation.params.scaleFactor.x);
        target.scale.y *= Math.max(0.1, operation.params.scaleFactor.y);
        target.scale.z *= Math.max(0.1, operation.params.scaleFactor.z);
      }
      return;

    case OPERATION_TYPES.POLYLINE: {
      const id = operation.params.objectId;
      if (!id) return;
      sceneState[id] = {
        primitive: "polyline",
        points: operation.params.points.map((point) => ({ ...point })),
        closed: Boolean(operation.params.closed),
        targetId: operation.targetId ?? null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
      return;
    }

    case OPERATION_TYPES.GROUP:
      for (const objectId of operation.params.objectIds ?? []) {
        if (sceneState[objectId]) sceneState[objectId].groupId = operation.params.groupId;
      }
      return;

    case OPERATION_TYPES.COMPONENT:
      for (const objectId of operation.params.objectIds ?? []) {
        if (sceneState[objectId]) sceneState[objectId].componentId = operation.params.componentId;
      }
      return;

    default:
      return;
  }
}

function createShapeReplayContext({ features, r, sai, bakeObjectRotations = true }) {
  return {
    r,
    sai,
    bakeObjectRotations,
    objectOrder: [],
    objectValues: new Map(),
    objectState: new Map(),
    editableTargets: editableTargetIds(features),
  };
}

function applyCreatePrimitive(context, operation) {
  const { objectId, primitive, position, size } = operation.params;
  if (!objectId) {
    return null;
  }

  const state = {
    primitive,
    position: { ...position },
    scale: { ...size },
    rotation: { x: 0, y: 0, z: 0 },
    editable: primitive === "box" && context.editableTargets.has(objectId),
    groupId: null,
    componentId: null,
  };
  context.objectState.set(objectId, state);
  if (!context.objectOrder.includes(objectId)) {
    context.objectOrder.push(objectId);
  }

  if (primitive === "sphere") {
    return setObjectValue(
      context,
      objectId,
      context.r.makeSphere(Math.max(0.1, size.x) / 2).translate(vectorArray(position)),
    );
  }

  if (primitive === "cylinder") {
    return setObjectValue(
      context,
      objectId,
      context.r.makeCylinder(Math.max(0.1, size.x) / 2, Math.max(0.1, size.z), vectorArray(position), [0, 0, 1]),
    );
  }

  const min = [
    position.x - size.x / 2,
    position.y - size.y / 2,
    position.z - size.z / 2,
  ];
  const max = [
    position.x + size.x / 2,
    position.y + size.y / 2,
    position.z + size.z / 2,
  ];
  return setObjectValue(
    context,
    objectId,
    state.editable ? context.sai.makeBox(context.r, min, max) : context.r.makeBox(min, max),
  );
}

function applyPolylineMetadata(context, operation) {
  const { objectId, points, closed } = operation.params;
  if (!objectId) {
    return;
  }
  if (!context.objectOrder.includes(objectId)) {
    context.objectOrder.push(objectId);
  }
  context.objectState.set(objectId, {
    primitive: "polyline",
    points: points.map((point) => ({ ...point })),
    closed: Boolean(closed),
    targetId: operation.targetId ?? null,
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  });
}

function applyMoveFeature(context, current, operation) {
  const state = context.objectState.get(operation.targetId);
  if (operation.params.subshapeMove && state?.primitive === "box") {
    const move = operation.params.subshapeMove;
    if (move.mode === "vertex") {
      return context.sai.moveBoxVertex(context.r, current, move.vertex, operation.params.delta);
    }
    return context.sai.moveBoxSubshape(context.r, current, move);
  }

  const next = state?.editable
    ? context.sai.translateObject(context.r, current, operation.params.delta)
    : current.translate(vectorArray(operation.params.delta));
  if (state) {
    state.position.x += operation.params.delta.x;
    state.position.y += operation.params.delta.y;
    state.position.z += operation.params.delta.z;
  }
  return next;
}

function applyRotateFeature(context, current, operation) {
  const state = context.objectState.get(operation.targetId);
  if (operation.params.subshapeRotate && state?.primitive === "box") {
    return context.sai.rotateBoxSubshape(context.r, current, operation.params.subshapeRotate);
  }

  const faceTilts = faceTiltsFromParams(operation.params);
  if (operation.selection?.mode === "face" && faceTilts.length > 0 && state?.primitive === "box") {
    if (typeof current.applyCenteredTapers === "function") {
      current.applyCenteredTapers(faceTilts);
    } else {
      for (const tilt of faceTilts) {
        if (typeof current.applyCenteredTaper === "function") {
          current.applyCenteredTaper(tilt);
        }
      }
    }
    return current;
  }

  const origin = state
    ? [state.position.x ?? 0, state.position.y ?? 0, state.position.z ?? 0]
    : [0, 0, 0];
  let next = current;
  if (context.bakeObjectRotations) {
    for (const rotation of rotationsFromEuler(operation.params.deltaEuler)) {
      next = next.rotate(rotation.angle, origin, rotation.axis);
    }
  }
  if (state) {
    state.rotation.x += operation.params.deltaEuler.x;
    state.rotation.y += operation.params.deltaEuler.y;
    state.rotation.z += operation.params.deltaEuler.z;
  }
  return next;
}

function applyGroupingMetadata(context, operation) {
  const key = operation.type === OPERATION_TYPES.GROUP ? "groupId" : "componentId";
  const value = operation.type === OPERATION_TYPES.GROUP ? operation.params.groupId : operation.params.componentId;
  for (const objectId of operation.params.objectIds ?? []) {
    const state = context.objectState.get(objectId);
    if (state) {
      state[key] = value;
    }
  }
}

function setObjectValue(context, objectId, value) {
  context.objectValues.set(objectId, value);
  return value;
}

function exactShapeForObject(value) {
  if (!value) {
    return null;
  }
  return typeof value.toShape === "function" ? value.toShape() : value;
}

function firstShape(objectShapes) {
  for (const shape of objectShapes.values()) {
    return shape;
  }
  return null;
}

function editableTargetIds(features) {
  const editableTargets = new Set();
  for (const feature of features) {
    const operation = operationFromFeature(feature);
    if (!operation.targetId) {
      continue;
    }
    const isEditable =
      operation.type === OPERATION_TYPES.PUSH_PULL ||
      Boolean(operation.params?.subshapeMove) ||
      Boolean(operation.params?.subshapeRotate) ||
      (operation.type === OPERATION_TYPES.ROTATE && operation.selection?.mode === "face" && faceTiltsFromParams(operation.params).length > 0);
    if (isEditable) {
      editableTargets.add(operation.targetId);
    }
  }
  return editableTargets;
}

function faceTiltsFromParams(params) {
  return Array.isArray(params?.faceTilts) && params.faceTilts.length > 0
    ? params.faceTilts
    : [params?.faceTilt].filter(Boolean);
}

function rotationsFromEuler(deltaEuler = {}) {
  return [
    { key: "x", axis: [1, 0, 0] },
    { key: "y", axis: [0, 1, 0] },
    { key: "z", axis: [0, 0, 1] },
  ]
    .map((rotation) => ({
      axis: rotation.axis,
      angle: deltaEuler[rotation.key] ?? 0,
    }))
    .filter((rotation) => Number.isFinite(rotation.angle) && Math.abs(rotation.angle) >= 1e-8);
}

function faceOperationFromPushPull(params) {
  const axis = normalizeVector(params.axis ?? { x: 0, y: 0, z: 1 });
  const faceAxis = AXES.includes(params.faceAxis) ? params.faceAxis : dominantAxis(axis);
  return {
    faceIndex: Number.isInteger(params.faceIndex) ? params.faceIndex : null,
    faceNormalWorld: params.faceNormalWorld ?? axis,
    axis,
    distance: params.distance ?? 0,
    faceAxis,
    faceSign: Math.sign(params.faceSign ?? axis[faceAxis] ?? 1) || 1,
    mode: params.mode === "extend" ? "extend" : "move",
  };
}

function normalizeVector(vector) {
  const length = Math.hypot(vector?.x ?? 0, vector?.y ?? 0, vector?.z ?? 0);
  if (length < 1e-8) {
    return { x: 0, y: 0, z: 1 };
  }
  return { x: (vector.x ?? 0) / length, y: (vector.y ?? 0) / length, z: (vector.z ?? 0) / length };
}

function dominantAxis(axis) {
  const entries = [
    ["x", axis.x ?? 0],
    ["y", axis.y ?? 0],
    ["z", axis.z ?? 0],
  ];
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return entries[0][0];
}

function vectorArray(vector) {
  return [vector.x ?? 0, vector.y ?? 0, vector.z ?? 0];
}
