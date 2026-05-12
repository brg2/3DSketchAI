import { OPERATION_TYPES, assertValidOperationType, normalizeOperationParams } from "../operation/operation-types.js";
import { validateOperation } from "../operation/operation-validator.js";
import { resolveParameterReferences } from "./feature-parameters.js";
import { sanitizeSelectionForFeature, selectorFaceIdentity } from "./feature-selectors.js";

export class FeatureStore {
  constructor(features = []) {
    this._features = normalizeFeatureGraph(features);
  }

  appendOperation(operation) {
    const nextFeature = featureFromOperation(operation, {
      id: nextFeatureId(this._features.length),
      dependsOn: dependenciesForOperation(this._features, operation),
    });
    this._features.push(nextFeature);
    return structuredClone(nextFeature);
  }

  appendFeature(feature) {
    const normalized = normalizeFeature(feature);
    this._features.push(normalized);
    return structuredClone(normalized);
  }

  replaceOperations(operations) {
    this._features = featureGraphFromOperations(operations);
  }

  replaceFeatures(features) {
    this._features = normalizeFeatureGraph(features);
  }

  getFeatures() {
    return this._features.map((feature) => structuredClone(feature));
  }

  getOperations() {
    return this._features.map((feature) => operationFromFeature(feature));
  }

  clear() {
    this._features = [];
  }
}

export function featureGraphFromOperations(operations) {
  const features = [];
  for (const operation of operations ?? []) {
    features.push(featureFromOperation(operation, {
      id: nextFeatureId(features.length),
      dependsOn: dependenciesForOperation(features, operation),
    }));
  }
  return features;
}

export function normalizeFeatureGraph(features) {
  return (features ?? []).map((feature, index) => normalizeFeature({
    ...feature,
    id: feature?.id ?? nextFeatureId(index),
  }));
}

export function featureFromOperation(operation, { id, dependsOn = [] } = {}) {
  const validOperation = validateOperation(structuredClone(operation));
  const targetObjectId = targetObjectIdForOperation(validOperation);
  const params = normalizeFeatureParams(validOperation);
  const selection = sanitizeSelectionForFeature(validOperation.selection);
  return normalizeFeature({
    id: id ?? nextFeatureId(0),
    type: validOperation.type,
    params,
    target: {
      objectId: targetObjectId,
      selection,
    },
    dependsOn,
  });
}

export function operationFromFeature(feature, { parameters = [] } = {}) {
  const normalized = normalizeFeature(feature);
  return validateOperation({
    type: normalized.type,
    targetId: normalized.type === OPERATION_TYPES.CREATE_PRIMITIVE ? null : normalized.target.objectId,
    selection: normalized.target.selection ? structuredClone(normalized.target.selection) : null,
    params: normalizeOperationParams(resolveParameterReferences(normalized.params, parameters)),
  });
}

export function normalizeFeature(feature) {
  if (!feature || typeof feature !== "object" || Array.isArray(feature)) {
    throw new Error("Feature must be an object");
  }
  if (!feature.id || typeof feature.id !== "string") {
    throw new Error("Feature id is required");
  }
  assertValidOperationType(feature.type);
  if (!feature.target || typeof feature.target !== "object" || Array.isArray(feature.target)) {
    throw new Error("Feature target is required");
  }
  if (feature.target.objectId !== null && typeof feature.target.objectId !== "string") {
    throw new Error("Feature target.objectId must be a string or null");
  }
  if (!Array.isArray(feature.dependsOn)) {
    throw new Error("Feature dependsOn must be an array");
  }

  const normalized = {
    id: feature.id,
    type: feature.type,
    target: {
      objectId: feature.target.objectId ?? null,
      selection: sanitizeSelectionForFeature(feature.target.selection),
    },
    dependsOn: feature.dependsOn.map((dependency) => String(dependency)),
  };
  normalized.params = normalizeFeatureParams({
    type: normalized.type,
    targetId: normalized.type === OPERATION_TYPES.CREATE_PRIMITIVE ? null : normalized.target.objectId,
    selection: normalized.target.selection,
    params: feature.params,
  });
  operationFromNormalizedFeature(normalized);
  return normalized;
}

export function orderedFeatures(features) {
  const normalized = normalizeFeatureGraph(features);
  const byId = new Map(normalized.map((feature) => [feature.id, feature]));
  const inputIndex = new Map(normalized.map((feature, index) => [feature.id, index]));
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(feature) {
    if (visited.has(feature.id)) {
      return;
    }
    if (visiting.has(feature.id)) {
      throw new Error(`Feature dependency cycle detected at ${feature.id}`);
    }
    visiting.add(feature.id);
    const dependencies = [...feature.dependsOn]
      .filter((dependencyId) => byId.has(dependencyId))
      .sort((a, b) => inputIndex.get(a) - inputIndex.get(b));
    for (const dependencyId of dependencies) {
      visit(byId.get(dependencyId));
    }
    visiting.delete(feature.id);
    visited.add(feature.id);
    ordered.push(feature);
  }

  for (const feature of normalized) {
    visit(feature);
  }

  return ordered.map((feature) => structuredClone(feature));
}

function operationFromNormalizedFeature(feature) {
  return validateOperation({
    type: feature.type,
    targetId: feature.type === OPERATION_TYPES.CREATE_PRIMITIVE ? null : feature.target.objectId,
    selection: feature.target.selection ? structuredClone(feature.target.selection) : null,
    params: normalizeOperationParams(feature.params),
  });
}

function dependenciesForOperation(features, operation) {
  const objectIds = objectIdsForOperation(operation);
  const dependencies = [];
  for (const objectId of objectIds) {
    const dependency = [...features].reverse().find((feature) => featureTargetsObject(feature, objectId));
    if (dependency && !dependencies.includes(dependency.id)) {
      dependencies.push(dependency.id);
    }
  }
  return dependencies;
}

function featureTargetsObject(feature, objectId) {
  if (feature.target?.objectId === objectId) {
    return true;
  }
  if (feature.params?.objectId === objectId) {
    return true;
  }
  const objectIds = feature.params?.objectIds;
  return Array.isArray(objectIds) && objectIds.includes(objectId);
}

function objectIdsForOperation(operation) {
  const validOperation = validateOperation(structuredClone(operation));
  if (validOperation.type === OPERATION_TYPES.CREATE_PRIMITIVE) {
    return validOperation.params.objectId ? [validOperation.params.objectId] : [];
  }
  if (validOperation.type === OPERATION_TYPES.GROUP || validOperation.type === OPERATION_TYPES.COMPONENT) {
    return [...(validOperation.params.objectIds ?? [])];
  }
  if (validOperation.type === OPERATION_TYPES.PUSH_PULL && validOperation.params.profile?.objectId) {
    return [validOperation.targetId, validOperation.params.profile.objectId].filter(Boolean);
  }
  return validOperation.targetId ? [validOperation.targetId] : [];
}

function targetObjectIdForOperation(operation) {
  if (operation.type === OPERATION_TYPES.CREATE_PRIMITIVE) {
    return operation.params.objectId ?? null;
  }
  if (operation.type === OPERATION_TYPES.GROUP || operation.type === OPERATION_TYPES.COMPONENT) {
    return operation.targetId ?? operation.params.objectIds?.[0] ?? null;
  }
  return operation.targetId ?? null;
}

function nextFeatureId(index) {
  return `feature_${index + 1}`;
}

function normalizeFeatureParams(operation) {
  const params = sanitizeParamsForFeature(operation, normalizeOperationParams(operation.params));
  if (operation.type !== OPERATION_TYPES.PUSH_PULL) {
    return params;
  }

  const identity = faceIdentityFromOperation(operation);
  if (!identity) {
    return params;
  }

  return {
    ...params,
    faceAxis: params.faceAxis ?? identity.faceAxis,
    faceSign: params.faceSign ?? identity.faceSign,
    ...(params.faceNormalWorld && !operation.selection?.selector
      ? { faceNormalWorld: params.faceNormalWorld }
      : {}),
  };
}

function sanitizeParamsForFeature(operation, params) {
  const next = structuredClone(params);

  if (next.subshapeMove) {
    delete next.subshapeMove.faceIndex;
    delete next.subshapeMove.faceNormalWorld;
  }
  if (next.faceTilt && !Array.isArray(next.faceTilts)) {
    next.faceTilts = [next.faceTilt];
  }
  if (Array.isArray(next.faceTilts)) {
    next.faceTilts = next.faceTilts.map((tilt) => sanitizeFaceTilt(tilt));
  }
  delete next.faceTilt;

  if (!operation.selection?.selector) {
    return next;
  }
  delete next.faceIndex;
  delete next.faceNormalWorld;
  return next;
}

function sanitizeFaceTilt(tilt) {
  const next = structuredClone(tilt);
  delete next.faceIndex;
  delete next.faceNormalWorld;
  return next;
}

function faceIdentityFromOperation(operation) {
  const selectorIdentity = selectorFaceIdentity(operation.selection?.selector);
  if (selectorIdentity) {
    return {
      faceAxis: selectorIdentity.axis,
      faceSign: selectorIdentity.sign,
      faceNormalWorld: vectorFromFaceIdentity(selectorIdentity),
    };
  }

  const vector = operation.params?.faceNormalWorld ?? operation.params?.axis ?? operation.selection?.faceNormalWorld ?? operation.selection?.selector?.hint?.normal;
  if (!vector || typeof vector !== "object") {
    return null;
  }

  const normal = normalizeVector(vector);
  const faceAxis = dominantAxis(normal);
  return {
    faceAxis,
    faceSign: Math.sign(normal[faceAxis] ?? 0) || 1,
    faceNormalWorld: normal,
  };
}

function vectorFromFaceIdentity(identity) {
  return {
    x: identity.axis === "x" ? identity.sign : 0,
    y: identity.axis === "y" ? identity.sign : 0,
    z: identity.axis === "z" ? identity.sign : 0,
  };
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x ?? 0, vector.y ?? 0, vector.z ?? 0);
  if (length < 1e-8) {
    return { x: 0, y: 0, z: 1 };
  }
  return {
    x: roundMillimeters((vector.x ?? 0) / length),
    y: roundMillimeters((vector.y ?? 0) / length),
    z: roundMillimeters((vector.z ?? 0) / length),
  };
}

function dominantAxis(vector) {
  const axes = ["x", "y", "z"];
  let best = "x";
  for (const axis of axes) {
    if (Math.abs(vector[axis] ?? 0) > Math.abs(vector[best] ?? 0)) {
      best = axis;
    }
  }
  return best;
}

function roundMillimeters(value) {
  return Math.round(value * 1000) / 1000;
}
