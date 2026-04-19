import { OPERATION_TYPES } from "../operation/operation-types.js";
import { validateOperation } from "../operation/operation-validator.js";
import { FeatureStore, normalizeFeatureGraph } from "./feature-store.js";
import { selectorFaceIdentity } from "./feature-selectors.js";

const AXES = ["x", "y", "z"];
const MIN_PRIMITIVE_DIMENSION = 0.1;
const AXIS_ALIGNED_THRESHOLD = 0.999;

export function applyOperationToFeatureGraph(features, operation) {
  const validOperation = validateOperation(structuredClone(operation));
  const modified = resolveFeatureModification(features, validOperation);
  if (modified) {
    return {
      features: modified.features,
      operation: validOperation,
      modified: true,
      created: false,
      reason: modified.reason,
      featureId: modified.featureId,
    };
  }

  const store = new FeatureStore(features);
  const feature = store.appendOperation(validOperation);
  return {
    features: store.getFeatures(),
    operation: validOperation,
    modified: false,
    created: true,
    reason: "fallback_new_feature",
    featureId: feature.id,
  };
}

export function resolveFeatureModification(features, operation) {
  const validOperation = validateOperation(structuredClone(operation));
  if (validOperation.type === OPERATION_TYPES.MOVE) {
    return (
      modifyExistingFaceMoveFeature(features, validOperation) ??
      modifyOriginatingPrimitivePosition(features, validOperation)
    );
  }
  if (validOperation.type === OPERATION_TYPES.ROTATE) {
    return (
      modifyExistingFaceRotateFeature(features, validOperation) ??
      modifyExistingObjectRotateFeature(features, validOperation)
    );
  }
  if (validOperation.type === OPERATION_TYPES.PUSH_PULL) {
    return (
      modifyOriginatingPrimitiveFeature(features, validOperation) ??
      modifyExistingPushPullFeature(features, validOperation)
    );
  }

  return null;
}

function modifyExistingFaceRotateFeature(features, operation) {
  if (operation.selection?.mode !== "face") {
    return null;
  }

  const operationTilts = normalizeFaceTilts(operation.params);
  if (operationTilts.length === 0) {
    return null;
  }
  const operationFace = selectorFaceIdentity(operation.selection?.selector) ?? faceTiltIdentity(operationTilts[0]);
  if (!operationFace) {
    return null;
  }
  const selectorFeatureId = operation.selection?.selector?.featureId ?? null;

  const normalized = normalizeFeatureGraph(features);
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const feature = normalized[index];
    if (feature.type !== OPERATION_TYPES.ROTATE) {
      continue;
    }
    if (!featureMatchesSelectorFeature(feature, selectorFeatureId)) {
      continue;
    }
    if (feature.target?.objectId !== operation.targetId) {
      continue;
    }
    if (feature.target?.selection?.mode !== "face") {
      continue;
    }
    const featureTilts = normalizeFaceTilts(feature.params);
    if (featureTilts.length === 0) {
      continue;
    }
    const featureFace = selectorFaceIdentity(feature.target?.selection?.selector) ?? faceTiltIdentity(featureTilts[0]);
    if (!sameFaceIdentity(featureFace, operationFace)) {
      continue;
    }
    if (!hasOnlySafeDownstreamFeatures(normalized, index, operation.targetId)) {
      return null;
    }

    const mergedTilts = mergeFaceTilts(featureTilts, operationTilts);
    const next = structuredClone(normalized);
    next[index].params = {
      ...next[index].params,
      deltaEuler: { x: 0, y: 0, z: 0 },
      faceTilts: mergedTilts,
    };
    delete next[index].params.faceTilt;
    return {
      features: normalizeFeatureGraph(next),
      reason: "modified_existing_face_rotate",
      featureId: feature.id,
    };
  }

  return null;
}

function modifyExistingObjectRotateFeature(features, operation) {
  if (operation.selection?.mode === "face" || normalizeFaceTilts(operation.params).length > 0) {
    return null;
  }
  const operationAxes = nonZeroEulerAxes(operation.params?.deltaEuler);
  if (operationAxes.length === 0) {
    return null;
  }

  const normalized = normalizeFeatureGraph(features);
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const feature = normalized[index];
    if (feature.type !== OPERATION_TYPES.ROTATE) {
      continue;
    }
    if (feature.target?.objectId !== operation.targetId) {
      continue;
    }
    if (feature.target?.selection?.mode === "face" || normalizeFaceTilts(feature.params).length > 0) {
      continue;
    }
    if (!hasOnlySafeDownstreamFeatures(normalized, index, operation.targetId)) {
      return null;
    }

    const next = structuredClone(normalized);
    const current = vectorWithDefaults(next[index].params.deltaEuler, { x: 0, y: 0, z: 0 });
    const delta = vectorWithDefaults(operation.params.deltaEuler, { x: 0, y: 0, z: 0 });
    next[index].params = {
      ...next[index].params,
      deltaEuler: {
        x: roundMillimeters(current.x + delta.x),
        y: roundMillimeters(current.y + delta.y),
        z: roundMillimeters(current.z + delta.z),
      },
    };
    return {
      features: normalizeFeatureGraph(next),
      reason: "modified_existing_object_rotate",
      featureId: feature.id,
    };
  }

  return null;
}

function modifyExistingFaceMoveFeature(features, operation) {
  const operationMove = operation.params?.subshapeMove;
  if (operation.selection?.mode !== "face" || operationMove?.mode !== "face") {
    return null;
  }

  const operationFace = selectorFaceIdentity(operation.selection?.selector) ?? faceMoveIdentity(operationMove);
  if (!operationFace) {
    return null;
  }
  const selectorFeatureId = operation.selection?.selector?.featureId ?? null;

  const normalized = normalizeFeatureGraph(features);
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const feature = normalized[index];
    if (feature.type !== OPERATION_TYPES.MOVE) {
      continue;
    }
    if (!featureMatchesSelectorFeature(feature, selectorFeatureId)) {
      continue;
    }
    if (feature.target?.objectId !== operation.targetId) {
      continue;
    }
    if (feature.target?.selection?.mode !== "face" || feature.params?.subshapeMove?.mode !== "face") {
      continue;
    }
    const featureFace = selectorFaceIdentity(feature.target?.selection?.selector) ?? faceMoveIdentity(feature.params.subshapeMove);
    if (!sameFaceIdentity(featureFace, operationFace)) {
      continue;
    }
    if (!hasOnlySafeDownstreamFeatures(normalized, index, operation.targetId)) {
      return null;
    }

    const next = structuredClone(normalized);
    const current = vectorWithDefaults(next[index].params.delta, { x: 0, y: 0, z: 0 });
    const delta = vectorWithDefaults(operation.params.delta, { x: 0, y: 0, z: 0 });
    const mergedDelta = {
      x: roundMillimeters(current.x + delta.x),
      y: roundMillimeters(current.y + delta.y),
      z: roundMillimeters(current.z + delta.z),
    };
    next[index].params = {
      ...next[index].params,
      delta: mergedDelta,
      subshapeMove: {
        ...next[index].params.subshapeMove,
        delta: mergedDelta,
      },
    };
    return {
      features: normalizeFeatureGraph(next),
      reason: "modified_existing_face_move",
      featureId: feature.id,
    };
  }

  return null;
}

function modifyOriginatingPrimitivePosition(features, operation) {
  if (operation.selection && operation.selection.mode !== "object") {
    return null;
  }
  if (operation.params?.subshapeMove) {
    return null;
  }

  const targetId = operation.targetId;
  const normalized = normalizeFeatureGraph(features);
  const originIndexes = normalized
    .map((feature, index) => ({ feature, index }))
    .filter(({ feature }) => (
      feature.type === OPERATION_TYPES.CREATE_PRIMITIVE &&
      feature.params.objectId === targetId
    ));

  if (originIndexes.length !== 1) {
    return null;
  }

  const { feature, index } = originIndexes[0];
  if (!hasNoConflictingPositionDownstream(normalized, index, targetId)) {
    return null;
  }

  const delta = vectorWithDefaults(operation.params.delta, { x: 0, y: 0, z: 0 });
  if (Math.hypot(delta.x, delta.y, delta.z) < 1e-8) {
    return null;
  }

  const position = vectorWithDefaults(feature.params.position, { x: 0, y: 0, z: 0 });
  const next = structuredClone(normalized);
  next[index].params = {
    ...next[index].params,
    position: {
      x: roundMillimeters(position.x + delta.x),
      y: roundMillimeters(position.y + delta.y),
      z: roundMillimeters(position.z + delta.z),
    },
  };

  return {
    features: normalizeFeatureGraph(next),
    reason: "modified_originating_primitive_position",
    featureId: feature.id,
  };
}

function modifyOriginatingPrimitiveFeature(features, operation) {
  const selectorFace = selectorFaceIdentity(operation.selection?.selector);
  const face = selectorFace ?? axisAlignedFaceIdentity(operation);
  if (!face || (operation.params.mode ?? "move") !== "move") {
    return null;
  }

  const targetId = operation.targetId;
  const normalized = normalizeFeatureGraph(features);
  const originIndexes = normalized
    .map((feature, index) => ({ feature, index }))
    .filter(({ feature }) => (
      feature.type === OPERATION_TYPES.CREATE_PRIMITIVE &&
      feature.params.objectId === targetId &&
      feature.params.primitive === "box"
    ));

  if (originIndexes.length !== 1) {
    return null;
  }

  const { feature, index } = originIndexes[0];
  if (operation.selection?.selector?.featureId && operation.selection.selector.featureId !== feature.id) {
    return null;
  }
  if (!hasOnlySafeDownstreamFeatures(normalized, index, targetId)) {
    return null;
  }

  const distance = operation.params.distance ?? 0;
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-8) {
    return null;
  }

  const size = vectorWithDefaults(feature.params.size, { x: 1, y: 1, z: 1 });
  const position = vectorWithDefaults(feature.params.position, { x: 0, y: 0, z: 0 });
  const currentSize = size[face.axis];
  const nextSize = roundMillimeters(currentSize + distance);
  if (nextSize < MIN_PRIMITIVE_DIMENSION) {
    return null;
  }

  const appliedDistance = nextSize - currentSize;
  const next = structuredClone(normalized);
  next[index].params = {
    ...next[index].params,
    size: {
      ...size,
      [face.axis]: nextSize,
    },
    position: {
      ...position,
      [face.axis]: roundMillimeters(position[face.axis] + face.sign * appliedDistance / 2),
    },
  };

  return {
    features: normalizeFeatureGraph(next),
    reason: "modified_originating_primitive",
    featureId: feature.id,
  };
}

function modifyExistingPushPullFeature(features, operation) {
  const operationFace = selectorFaceIdentity(operation.selection?.selector) ?? stableFaceIdentity(operation);
  if (!operationFace) {
    return null;
  }
  const selectorFeatureId = operation.selection?.selector?.featureId ?? null;

  const normalized = normalizeFeatureGraph(features);
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const feature = normalized[index];
    if (feature.type !== OPERATION_TYPES.PUSH_PULL) {
      continue;
    }
    if (!featureMatchesSelectorFeature(feature, selectorFeatureId)) {
      continue;
    }
    if (feature.target?.objectId !== operation.targetId) {
      continue;
    }
    if ((feature.params.mode ?? "move") !== (operation.params.mode ?? "move")) {
      continue;
    }
    const featureFace = selectorFaceIdentity(feature.target?.selection?.selector) ?? stableFaceIdentity(feature);
    if (!sameFaceIdentity(featureFace, operationFace)) {
      continue;
    }
    if (!hasOnlySafeDownstreamFeatures(normalized, index, operation.targetId)) {
      return null;
    }

    const next = structuredClone(normalized);
    next[index].params = {
      ...next[index].params,
      distance: roundMillimeters((next[index].params.distance ?? 0) + (operation.params.distance ?? 0)),
      faceAxis: next[index].params.faceAxis ?? operationFace.axis,
      faceSign: next[index].params.faceSign ?? operationFace.sign,
      faceNormalWorld: next[index].params.faceNormalWorld ?? operationFace.normal,
    };
    return {
      features: normalizeFeatureGraph(next),
      reason: "modified_existing_push_pull",
      featureId: feature.id,
    };
  }

  return null;
}

function hasOnlySafeDownstreamFeatures(features, originIndex, objectId) {
  for (let index = originIndex + 1; index < features.length; index += 1) {
    const feature = features[index];
    if (!featureTargetsObject(feature, objectId)) {
      continue;
    }
    if (!isNonGeometryMetadataFeature(feature)) {
      return false;
    }
  }
  return true;
}

function featureMatchesSelectorFeature(feature, selectorFeatureId) {
  if (!selectorFeatureId) {
    return true;
  }
  return (
    feature.id === selectorFeatureId ||
    feature.target?.selection?.selector?.featureId === selectorFeatureId ||
    feature.dependsOn?.includes(selectorFeatureId)
  );
}

function hasNoConflictingPositionDownstream(features, originIndex, objectId) {
  for (let index = originIndex + 1; index < features.length; index += 1) {
    const feature = features[index];
    if (!featureTargetsObject(feature, objectId)) {
      continue;
    }
    if (!isPositionSafeDownstreamFeature(feature)) {
      return false;
    }
  }
  return true;
}

function isNonGeometryMetadataFeature(feature) {
  return feature.type === OPERATION_TYPES.GROUP || feature.type === OPERATION_TYPES.COMPONENT;
}

function isPositionSafeDownstreamFeature(feature) {
  return (
    isNonGeometryMetadataFeature(feature) ||
    feature.type === OPERATION_TYPES.PUSH_PULL ||
    Boolean(feature.params?.subshapeMove)
  );
}

function featureTargetsObject(feature, objectId) {
  if (feature.target?.objectId === objectId) {
    return true;
  }
  const objectIds = feature.params?.objectIds;
  return Array.isArray(objectIds) && objectIds.includes(objectId);
}

function axisAlignedFaceIdentity(operationOrFeature) {
  const identity = stableFaceIdentity(operationOrFeature);
  if (!identity) {
    return null;
  }
  if (Math.abs(identity.normal[identity.axis] ?? 0) < AXIS_ALIGNED_THRESHOLD) {
    return null;
  }
  return identity;
}

function stableFaceIdentity(operationOrFeature) {
  const selectorIdentity = selectorFaceIdentity(operationOrFeature.selection?.selector ?? operationOrFeature.target?.selection?.selector);
  if (selectorIdentity) {
    return {
      axis: selectorIdentity.axis,
      sign: selectorIdentity.sign,
      normal: vectorFromFaceIdentity(selectorIdentity),
    };
  }

  const params = operationOrFeature.params ?? {};
  const explicitAxis = AXES.includes(params.faceAxis) ? params.faceAxis : null;
  const explicitSign = params.faceSign === undefined ? null : Math.sign(params.faceSign) || 1;
  const vector =
    params.faceNormalWorld ??
    params.axis ??
    operationOrFeature.selection?.faceNormalWorld ??
    operationOrFeature.target?.selection?.faceNormalWorld;
  const normal = normalizeVector(vector);
  if (!normal) {
    return null;
  }

  const axis = explicitAxis ?? dominantAxis(normal);
  return {
    axis,
    sign: explicitSign ?? (Math.sign(normal[axis] ?? 0) || 1),
    normal,
  };
}

function vectorFromFaceIdentity(identity) {
  return {
    x: identity.axis === "x" ? identity.sign : 0,
    y: identity.axis === "y" ? identity.sign : 0,
    z: identity.axis === "z" ? identity.sign : 0,
  };
}

function sameFaceIdentity(a, b) {
  return Boolean(a && b && a.axis === b.axis && a.sign === b.sign);
}

function faceMoveIdentity(move) {
  const faceAxis = AXES.includes(move?.faceAxis) ? move.faceAxis : null;
  if (!faceAxis) {
    return null;
  }
  return {
    axis: faceAxis,
    sign: Math.sign(move.faceSign ?? 1) || 1,
  };
}

function normalizeFaceTilts(params) {
  const tilts = Array.isArray(params?.faceTilts) && params.faceTilts.length > 0
    ? params.faceTilts
    : [params?.faceTilt].filter(Boolean);
  return tilts
    .filter((tilt) => faceTiltIdentity(tilt))
    .map((tilt) => ({
      ...structuredClone(tilt),
      faceSign: Math.sign(tilt.faceSign ?? 1) || 1,
      hingeSideSign: 0,
      angle: roundMillimeters(tilt.angle ?? 0),
    }));
}

function faceTiltIdentity(tilt) {
  const faceAxis = AXES.includes(tilt?.faceAxis) ? tilt.faceAxis : null;
  if (!faceAxis) {
    return null;
  }
  return {
    axis: faceAxis,
    sign: Math.sign(tilt.faceSign ?? 1) || 1,
  };
}

function mergeFaceTilts(existingTilts, operationTilts) {
  const merged = [];
  const byKey = new Map();
  for (const tilt of [...existingTilts, ...operationTilts]) {
    const key = faceTiltMergeKey(tilt);
    const currentIndex = byKey.get(key);
    if (currentIndex === undefined) {
      byKey.set(key, merged.length);
      merged.push({
        ...structuredClone(tilt),
        hingeSideSign: 0,
        angle: roundMillimeters(tilt.angle ?? 0),
      });
      continue;
    }
    merged[currentIndex] = mergeMatchingFaceTilt(merged[currentIndex], tilt);
  }
  const nonZero = merged.filter((tilt) => Math.abs(tilt.angle ?? 0) >= 1e-6);
  return nonZero.length > 0 ? nonZero : merged.slice(0, 1);
}

function mergeMatchingFaceTilt(existingTilt, operationTilt) {
  return {
    ...existingTilt,
    hingeSideSign: 0,
    angle: roundMillimeters((existingTilt.angle ?? 0) + (operationTilt.angle ?? 0)),
  };
}

function nonZeroEulerAxes(deltaEuler) {
  const vector = vectorWithDefaults(deltaEuler, { x: 0, y: 0, z: 0 });
  return AXES.filter((axis) => Math.abs(vector[axis]) >= 1e-8);
}

function faceTiltMergeKey(tilt) {
  return [
    tilt.faceAxis,
    Math.sign(tilt.faceSign ?? 1) || 1,
    tilt.hingeSideAxis,
  ].join(":");
}

function normalizeVector(vector) {
  if (!vector || typeof vector !== "object") {
    return null;
  }
  const length = Math.hypot(vector.x ?? 0, vector.y ?? 0, vector.z ?? 0);
  if (length < 1e-8) {
    return null;
  }
  return {
    x: (vector.x ?? 0) / length,
    y: (vector.y ?? 0) / length,
    z: (vector.z ?? 0) / length,
  };
}

function dominantAxis(vector) {
  let best = "x";
  for (const axis of AXES) {
    if (Math.abs(vector[axis] ?? 0) > Math.abs(vector[best] ?? 0)) {
      best = axis;
    }
  }
  return best;
}

function vectorWithDefaults(value, defaults) {
  return {
    x: finiteNumber(value?.x, defaults.x),
    y: finiteNumber(value?.y, defaults.y),
    z: finiteNumber(value?.z, defaults.z),
  };
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function roundMillimeters(value) {
  return Math.round(value * 1000) / 1000;
}
