const PARAM_REF_KEY = "$param";

export function isParameterReference(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value[PARAM_REF_KEY] === "string" &&
    Object.keys(value).length === 1,
  );
}

export function normalizeParameters(parameters = []) {
  if (!Array.isArray(parameters)) {
    throw new Error("Feature graph parameters must be an array");
  }
  const seen = new Set();
  return parameters.map((parameter) => {
    if (!parameter || typeof parameter !== "object" || Array.isArray(parameter)) {
      throw new Error("Feature graph parameter must be an object");
    }
    const name = String(parameter.name ?? parameter.id ?? "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error("Feature graph parameter name must be an identifier");
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate feature graph parameter: ${name}`);
    }
    seen.add(name);
    const value = Number(parameter.value);
    if (!Number.isFinite(value)) {
      throw new Error(`Feature graph parameter ${name} value must be finite`);
    }
    return {
      name,
      value,
      ...(typeof parameter.label === "string" ? { label: parameter.label } : {}),
      ...(typeof parameter.unit === "string" ? { unit: parameter.unit } : {}),
    };
  });
}

export function parameterMap(parameters = []) {
  return new Map(normalizeParameters(parameters).map((parameter) => [parameter.name, parameter.value]));
}

export function resolveParameterReferences(value, parameters = []) {
  const values = parameters instanceof Map ? parameters : parameterMap(parameters);
  return resolveValue(value, values);
}

export function assertResolvableParameterReferences(value, parameters = []) {
  resolveParameterReferences(value, parameters);
  return true;
}

export function featureGraphSchema() {
  return {
    version: 1,
    graph: {
      parameters: [{ name: "identifier", value: "finite number", label: "optional string", unit: "optional string" }],
      features: "canonical ordered feature array",
    },
    parameterReference: { [PARAM_REF_KEY]: "parameterName" },
    patch: {
      operations: [
        "add_parameter",
        "update_parameter",
        "remove_parameter",
        "append_feature",
        "replace_feature",
        "update_feature_params",
        "replace_feature_params",
      ],
    },
  };
}

function resolveValue(value, values) {
  if (isParameterReference(value)) {
    const name = value[PARAM_REF_KEY];
    if (!values.has(name)) {
      throw new Error(`Unknown feature graph parameter reference: ${name}`);
    }
    return values.get(name);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveValue(entry, values));
  }
  if (value && typeof value === "object") {
    const resolved = {};
    for (const [key, entry] of Object.entries(value)) {
      resolved[key] = resolveValue(entry, values);
    }
    return resolved;
  }
  return value;
}
