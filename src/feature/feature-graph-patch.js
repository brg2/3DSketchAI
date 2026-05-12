import { normalizeFeature, normalizeFeatureGraph } from "./feature-store.js";
import { assertResolvableParameterReferences, normalizeParameters } from "./feature-parameters.js";

const PATCH_TYPES = new Set([
  "add_parameter",
  "update_parameter",
  "rename_parameter",
  "remove_parameter",
  "append_feature",
  "replace_feature",
  "update_feature_params",
  "replace_feature_params",
]);

const FORBIDDEN_KEYS = new Set([
  "mesh",
  "meshes",
  "meshData",
  "geometry",
  "viewer",
  "scene",
  "object3D",
  "apiKey",
  "providerKey",
]);

export function normalizeFeatureGraphPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Feature graph patch must be an object");
  }
  const operations = Array.isArray(patch.operations)
    ? patch.operations
    : Array.isArray(patch.patch)
      ? patch.patch
      : [];
  if (operations.length === 0) {
    throw new Error("Feature graph patch must contain operations");
  }
  return {
    operations: operations.map((operation, index) => normalizePatchOperation(operation, index)),
  };
}

export function applyFeatureGraphPatch({ features = [], parameters = [], patch }) {
  const normalizedPatch = normalizeFeatureGraphPatch(patch);
  let nextFeatures = normalizeFeatureGraph(features);
  let nextParameters = normalizeParameters(parameters);

  const parameterOperations = normalizedPatch.operations.filter((operation) => (
    operation.type === "add_parameter" ||
    operation.type === "update_parameter" ||
    operation.type === "rename_parameter" ||
    operation.type === "remove_parameter"
  ));
  const featureOperations = normalizedPatch.operations.filter((operation) => !parameterOperations.includes(operation));

  for (const operation of parameterOperations) {
    assertNoForbiddenPatchData(operation);
    const paramIndex = (name) => nextParameters.findIndex((parameter) => parameter.name === name);
    if (operation.type === "add_parameter") {
      if (paramIndex(operation.parameter.name) >= 0) {
        throw new Error(`Parameter already exists: ${operation.parameter.name}`);
      }
      nextParameters = normalizeParameters([...nextParameters, operation.parameter]);
      continue;
    }
    if (operation.type === "update_parameter") {
      const index = paramIndex(operation.name);
      if (index < 0) throw new Error(`Unknown parameter: ${operation.name}`);
      const merged = { ...nextParameters[index], ...operation.parameter, name: operation.name };
      nextParameters = normalizeParameters(nextParameters.map((entry, entryIndex) => entryIndex === index ? merged : entry));
      continue;
    }
    if (operation.type === "rename_parameter") {
      const index = paramIndex(operation.name);
      if (index < 0) throw new Error(`Unknown parameter: ${operation.name}`);
      if (paramIndex(operation.nextName) >= 0) {
        throw new Error(`Parameter already exists: ${operation.nextName}`);
      }
      const renamed = { ...nextParameters[index], name: operation.nextName };
      nextParameters = normalizeParameters(nextParameters.map((entry, entryIndex) => entryIndex === index ? renamed : entry));
      nextFeatures = replaceParameterReferences(nextFeatures, operation.name, { $param: operation.nextName });
      continue;
    }
    if (operation.type === "remove_parameter") {
      if (operation.replaceReferencesWithValue) {
        const index = paramIndex(operation.name);
        if (index < 0) throw new Error(`Unknown parameter: ${operation.name}`);
        nextFeatures = replaceParameterReferences(nextFeatures, operation.name, nextParameters[index].value);
      }
      nextParameters = normalizeParameters(nextParameters.filter((parameter) => parameter.name !== operation.name));
    }
  }

  for (const operation of featureOperations) {
    assertNoForbiddenPatchData(operation);
    if (operation.type === "append_feature") {
      nextFeatures = normalizeFeatureGraph([...nextFeatures, operation.feature]);
      continue;
    }
    const index = nextFeatures.findIndex((feature) => feature.id === operation.featureId);
    if (index < 0) {
      throw new Error(`Unknown feature: ${operation.featureId}`);
    }
    if (operation.type === "replace_feature") {
      nextFeatures = normalizeFeatureGraph(nextFeatures.map((feature, entryIndex) => entryIndex === index ? operation.feature : feature));
      continue;
    }
    if (operation.type === "replace_feature_params") {
      nextFeatures = normalizeFeatureGraph(nextFeatures.map((feature, entryIndex) => entryIndex === index ? {
        ...feature,
        params: operation.params,
      } : feature));
      continue;
    }
    if (operation.type === "update_feature_params") {
      nextFeatures = normalizeFeatureGraph(nextFeatures.map((feature, entryIndex) => entryIndex === index ? {
        ...feature,
        params: deepMerge(feature.params ?? {}, operation.params),
      } : feature));
    }
  }

  assertGraphResolvable(nextFeatures, nextParameters);
  return { features: nextFeatures, parameters: nextParameters, patch: normalizedPatch };
}

function normalizePatchOperation(operation, index) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new Error(`Patch operation ${index} must be an object`);
  }
  const type = operation.type ?? operation.op;
  if (!PATCH_TYPES.has(type)) {
    throw new Error(`Unsupported feature graph patch operation: ${type}`);
  }
  if (type === "add_parameter") {
    return { type, parameter: normalizeParameters([operation.parameter ?? operation.value])[0] };
  }
  if (type === "update_parameter") {
    const name = operation.name ?? operation.parameter?.name;
    if (typeof name !== "string") throw new Error("update_parameter requires name");
    return { type, name, parameter: operation.parameter ?? operation.value ?? {} };
  }
  if (type === "rename_parameter") {
    const name = operation.name ?? operation.from;
    const nextName = operation.nextName ?? operation.to;
    if (typeof name !== "string" || typeof nextName !== "string") {
      throw new Error("rename_parameter requires name and nextName");
    }
    return { type, name, nextName };
  }
  if (type === "remove_parameter") {
    if (typeof operation.name !== "string") throw new Error("remove_parameter requires name");
    return { type, name: operation.name, replaceReferencesWithValue: Boolean(operation.replaceReferencesWithValue) };
  }
  if (type === "append_feature") {
    return { type, feature: normalizeFeature(operation.feature) };
  }
  if (type === "replace_feature") {
    const feature = normalizeFeature(operation.feature);
    return { type, featureId: operation.featureId ?? feature.id, feature };
  }
  if (typeof operation.featureId !== "string") {
    throw new Error(`${type} requires featureId`);
  }
  if (!operation.params || typeof operation.params !== "object" || Array.isArray(operation.params)) {
    throw new Error(`${type} requires params object`);
  }
  return { type, featureId: operation.featureId, params: structuredClone(operation.params) };
}

function replaceParameterReferences(value, name, replacement) {
  if (Array.isArray(value)) {
    return value.map((entry) => replaceParameterReferences(entry, name, replacement));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (value.$param === name && Object.keys(value).length === 1) {
    return structuredClone(replacement);
  }
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = replaceParameterReferences(entry, name, replacement);
  }
  return next;
}

function assertGraphResolvable(features, parameters) {
  for (const feature of features) {
    assertResolvableParameterReferences(feature.params, parameters);
  }
}

function assertNoForbiddenPatchData(value) {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoForbiddenPatchData(entry);
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Feature graph patch cannot contain ${key}`);
    }
    assertNoForbiddenPatchData(entry);
  }
}

function deepMerge(base, patch) {
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = structuredClone(value);
    }
  }
  return merged;
}
