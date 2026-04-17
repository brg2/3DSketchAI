import { assertValidOperationType, normalizeOperationParams } from "./operation-types.js";
import { validateOperation } from "./operation-validator.js";

export function serializeOperationToTypeScript(operation) {
  assertValidOperationType(operation.type);
  const normalized = _normalizeOperationForModule(operation);
  return serializeCanonicalModelModule([normalized]);
}

export function serializeOperationsToTypeScript(operations) {
  return operations.map((operation) => serializeOperationToTypeScript(operation)).join("\n\n");
}

export function serializeCanonicalModelModule(operations) {
  const normalizedOperations = operations.map((operation) => _normalizeOperationForModule(operation));
  if (normalizedOperations.length === 0) {
    return [
      "export const main = (_r, _sai) => null;",
    ].join("\n");
  }

  const bodyLines = [];
  const objectOrder = [];
  const objectVars = new Map();
  const objectState = new Map();

  const getVarName = (objectId) => {
    if (!objectVars.has(objectId)) {
      objectVars.set(objectId, objectId);
      objectOrder.push(objectId);
    }
    return objectVars.get(objectId);
  };

  for (const operation of normalizedOperations) {
    switch (operation.type) {
      case "create_primitive": {
        const { objectId, primitive, position, size } = operation.params;
        const varName = getVarName(objectId);
        objectState.set(objectId, {
          primitive,
          position: { ...position },
          scale: { ...size },
          rotation: { x: 0, y: 0, z: 0 },
          faceTilts: [],
          faceExtrudes: [],
          faceExtensions: [],
        });
        if (primitive === "sphere") {
          bodyLines.push(
            `  let ${varName} = r.makeSphere(${_formatNumber(Math.max(0.1, size.x) / 2)}).translate(${_vec3Literal(position)});`,
          );
        } else if (primitive === "cylinder") {
          bodyLines.push(
            `  let ${varName} = r.makeCylinder(${_formatNumber(Math.max(0.1, size.x) / 2)}, ${_formatNumber(Math.max(0.1, size.z))}, ${_vec3Literal(position)}, [0, 0, 1]);`,
          );
        } else {
          const c1 = {
            x: position.x - size.x / 2,
            y: position.y - size.y / 2,
            z: position.z - size.z / 2,
          };
          const c2 = {
            x: position.x + size.x / 2,
            y: position.y + size.y / 2,
            z: position.z + size.z / 2,
          };
          bodyLines.push(`  let ${varName} = r.makeBox(${_vec3Literal(c1)}, ${_vec3Literal(c2)});`);
        }
        break;
      }
      case "move": {
        const varName = getVarName(operation.targetId);
        const state = objectState.get(operation.targetId);

        bodyLines.push(`  ${varName} = ${varName}.translate(${_vec3Literal(operation.params.delta)});`);
        if (state) {
          state.position.x += operation.params.delta.x;
          state.position.y += operation.params.delta.y;
          state.position.z += operation.params.delta.z;
        }
        break;
      }
      case "rotate": {
        const varName = getVarName(operation.targetId);
        if (operation.selection?.mode === "face" && operation.params.faceTilt) {
          // Note: makeTaperedBox and direct face tilting has been removed.
          break;
        }
        const origin = { x: 0, y: 0, z: 0 };
        bodyLines.push(`  ${varName} = ${varName}.rotate(${_formatNumber(operation.params.deltaEuler.y)}, ${_vec3Literal(origin)}, [0, 1, 0]);`);
        const state = objectState.get(operation.targetId);
        if (state) {
          state.rotation.x += operation.params.deltaEuler.x;
          state.rotation.y += operation.params.deltaEuler.y;
          state.rotation.z += operation.params.deltaEuler.z;
        }
        break;
      }

      case "push_pull": {
        const varName = getVarName(operation.targetId);
        const state = objectState.get(operation.targetId);
        if (state?.primitive === "box") {
          const faceOperation = _faceOperationFromPushPull(operation.params);
          if (faceOperation.mode === "extend") {
            state.faceExtensions.push(faceOperation);
          } else {
            state.faceExtrudes.push(faceOperation);
          }
          bodyLines.push(`  ${varName} = sai.pushPullFace(r, ${varName}, ${JSON.stringify(faceOperation)});`);
          break;
        }
        throw new Error("push_pull requires a solid modeling implementation for non-box targets");
      }
      case "group":
      case "component":
        break;
      default:
        break;
    }
  }

  const resultForObject = (objectId) => objectVars.get(objectId);
  const resultExpr = objectOrder.length === 0 ? "null" : objectOrder.length === 1 ? resultForObject(objectOrder[0]) : `r.makeCompound([${objectOrder.map((id) => resultForObject(id)).join(", ")}])`;

  return [
    "export const main = (r, sai) => {",
    ...bodyLines,
    `  return ${resultExpr};`,
    "}",
  ].join("\n");
}

export function parseOperationsFromCanonicalModelCode(code) {
  if (typeof code !== "string" || code.trim().length === 0) {
    return [];
  }

  const candidates = [];
  candidates.push(..._parseDirectCreatePrimitiveBox(code));
  candidates.push(..._parseDirectCreatePrimitiveSaiBox(code));
  candidates.push(..._parseDirectCreatePrimitiveSphere(code));
  candidates.push(..._parseDirectCreatePrimitiveCylinder(code));
  candidates.push(..._parseDirectTranslate(code));
  candidates.push(..._parseDirectTranslateObject(code));
  candidates.push(..._parseDirectRotate(code));
  candidates.push(..._parseDirectPushPullFace(code));
  candidates.push(..._parseCreatePrimitiveBox(code));
  candidates.push(..._parseCreatePrimitiveSphere(code));
  candidates.push(..._parseCreatePrimitiveCylinder(code));
  candidates.push(..._parseMove(code));
  candidates.push(..._parseRotate(code));

  candidates.sort((a, b) => a.index - b.index);

  const operations = [];
  let lastObjectId = null;
  let legacyGroupCounter = 0;
  let legacyComponentCounter = 0;

  for (const candidate of candidates) {
    const operation = structuredClone(candidate.operation);

    if (operation.type === "group" && !operation.params.groupId) {
      operation.params.groupId = `group_legacy_${legacyGroupCounter++}`;
    }

    if (operation.type === "component" && !operation.params.componentId) {
      operation.params.componentId = `component_legacy_${legacyComponentCounter++}`;
    }

    if ((operation.type === "group" || operation.type === "component") && !operation.targetId) {
      operation.targetId = operation.params.objectIds?.[0] ?? null;
    }

    try {
      operations.push(validateOperation(operation));
      if (operation.type === "create_primitive") {
        lastObjectId = operation.params.objectId;
      } else if (typeof operation.targetId === "string" && operation.targetId.length > 0) {
        lastObjectId = operation.targetId;
      }
    } catch {
      // Ignore lines that do not map to a valid committed operation.
    }
  }

  return operations;
}

function _normalizeOperationForModule(operation) {
  assertValidOperationType(operation.type);
  return {
    type: operation.type,
    targetId: operation.targetId ?? null,
    selection: operation.selection ?? null,
    params: normalizeOperationParams(operation.params),
  };
}


function _formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

function _vec3Literal(value) {
  return `[${_formatNumber(value.x)}, ${_formatNumber(value.y)}, ${_formatNumber(value.z)}]`;
}

function _arrayVec3Literal(values) {
  return `[${values.map((value) => _formatNumber(value)).join(", ")}]`;
}

function _boxConfigLiteral(state) {
  const min = [
    state.position.x - state.scale.x / 2,
    state.position.y - state.scale.y / 2,
    state.position.z - state.scale.z / 2,
  ];
  const max = [
    state.position.x + state.scale.x / 2,
    state.position.y + state.scale.y / 2,
    state.position.z + state.scale.z / 2,
  ];
  return `{"min":${_arrayVec3Literal(min)},"max":${_arrayVec3Literal(max)},"faceTilts":${JSON.stringify(state.faceTilts)},"faceExtrudes":${JSON.stringify(state.faceExtrudes ?? [])},"faceExtensions":${JSON.stringify(state.faceExtensions ?? [])}}`;
}

function _dominantAxis(axis) {
  const entries = [
    ["x", axis.x ?? 0],
    ["y", axis.y ?? 0],
    ["z", axis.z ?? 0],
  ];
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return entries[0][0];
}

function _faceOperationFromPushPull(params) {
  const axis = _normalizeAxis(params.axis ?? { x: 0, y: 0, z: 1 });
  const faceAxis = _dominantAxis(axis);
  return {
    faceIndex: Number.isInteger(params.faceIndex) ? params.faceIndex : null,
    axis,
    distance: params.distance ?? 0,
    faceAxis,
    faceSign: Math.sign(axis[faceAxis] ?? 0) || 1,
    mode: params.mode === "extend" ? "extend" : "move",
  };
}

function _normalizeAxis(axis) {
  const length = Math.hypot(axis.x ?? 0, axis.y ?? 0, axis.z ?? 0);
  if (length < 1e-8) {
    return { x: 0, y: 0, z: 1 };
  }
  return { x: axis.x / length, y: axis.y / length, z: axis.z / length };
}

function _safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function _toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function _toVec3FromArray(raw) {
  if (!Array.isArray(raw) || raw.length < 3) {
    return null;
  }
  const x = _toFiniteNumber(raw[0]);
  const y = _toFiniteNumber(raw[1]);
  const z = _toFiniteNumber(raw[2]);
  if (x === null || y === null || z === null) {
    return null;
  }
  return { x, y, z };
}

function _collectMatches(code, regex, toCandidate) {
  const matches = [];
  for (const match of code.matchAll(regex)) {
    const candidate = toCandidate(match);
    if (candidate) {
      matches.push({
        index: match.index ?? 0,
        operation: candidate,
      });
    }
  }
  return matches;
}

function _parseDirectCreatePrimitiveBox(code) {
  const regex = /(?:let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*r\.makeBox\(\s*(\[[\s\S]*?\])\s*,\s*(\[[\s\S]*?\])\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const objectId = match[1];
    const c1 = _toVec3FromArray(_safeJsonParse(match[2]));
    const c2 = _toVec3FromArray(_safeJsonParse(match[3]));
    if (!objectId || !c1 || !c2) return null;
    return {
      type: "create_primitive",
      targetId: null,
      selection: null,
      params: {
        primitive: "box",
        objectId,
        position: { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2, z: (c1.z + c2.z) / 2 },
        size: { x: Math.abs(c2.x - c1.x), y: Math.abs(c2.y - c1.y), z: Math.abs(c2.z - c1.z) },
      },
    };
  });
}
function _parseDirectCreatePrimitiveSaiBox(code) {
  const regex = /(?:let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*sai\.makeBox\(\s*r\s*,\s*(\[[\s\S]*?\])\s*,\s*(\[[\s\S]*?\])\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const objectId = match[1];
    const c1 = _toVec3FromArray(_safeJsonParse(match[2]));
    const c2 = _toVec3FromArray(_safeJsonParse(match[3]));
    if (!objectId || !c1 || !c2) return null;
    return {
      type: "create_primitive",
      targetId: null,
      selection: null,
      params: {
        primitive: "box",
        objectId,
        position: { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2, z: (c1.z + c2.z) / 2 },
        size: { x: Math.abs(c2.x - c1.x), y: Math.abs(c2.y - c1.y), z: Math.abs(c2.z - c1.z) },
      },
    };
  });
}

function _parseDirectCreatePrimitiveSphere(code) {
  const regex = /let\s+([A-Za-z_$][\w$]*)\s*=\s*r\.makeSphere\(\s*([-\d.eE+]+)\s*\)\.translate\(\s*(\[[\s\S]*?\])\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const objectId = match[1];
    const radius = _toFiniteNumber(match[2]);
    const position = _toVec3FromArray(_safeJsonParse(match[3]));
    if (!objectId || radius === null || !position) return null;
    return {
      type: "create_primitive",
      targetId: null,
      selection: null,
      params: { primitive: "sphere", objectId, position, size: { x: radius * 2, y: radius * 2, z: radius * 2 } },
    };
  });
}

function _parseDirectCreatePrimitiveCylinder(code) {
  const regex = /let\s+([A-Za-z_$][\w$]*)\s*=\s*r\.makeCylinder\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*(\[[\s\S]*?\])\s*,\s*\[0,\s*0,\s*1\]\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const objectId = match[1];
    const radius = _toFiniteNumber(match[2]);
    const height = _toFiniteNumber(match[3]);
    const position = _toVec3FromArray(_safeJsonParse(match[4]));
    if (!objectId || radius === null || height === null || !position) return null;
    return {
      type: "create_primitive",
      targetId: null,
      selection: null,
      params: { primitive: "cylinder", objectId, position, size: { x: radius * 2, y: radius * 2, z: height } },
    };
  });
}

function _parseDirectTranslate(code) {
  const regex = /([A-Za-z_$][\w$]*)\s*=\s*\1\.translate\(\s*(\[[\s\S]*?\])\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const targetId = match[1];
    const delta = _toVec3FromArray(_safeJsonParse(match[2]));
    if (!targetId || !delta) return null;
    return { type: "move", targetId, selection: null, params: { delta } };
  });
}

function _parseDirectTranslateObject(code) {
  const regex = /sai\.translateObject\(\s*r\s*,\s*([A-Za-z_$][\w$]*)\s*,\s*(\[[^\n]*?\])\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const targetId = match[1];
    const delta = _toVec3FromArray(_safeJsonParse(match[2]));
    if (!targetId || !delta) return null;
    return { type: "move", targetId, selection: null, params: { delta } };
  });
}

function _parseDirectRotate(code) {
  const regex = /([A-Za-z_$][\w$]*)\s*=\s*\1\.rotate\(\s*([-\d.eE+]+)\s*,\s*(\[[\s\S]*?\])\s*,\s*(\[[\s\S]*?\])\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const targetId = match[1];
    const y = _toFiniteNumber(match[2]);
    if (!targetId || y === null) return null;
    return { type: "rotate", targetId, selection: null, params: { deltaEuler: { x: 0, y, z: 0 } } };
  });
}


function _parseDirectPushPullFace(code) {
  // Matches: varName = sai.pushPullFace(r, varName, {...});
  // Also matches legacy: sai.pushPullFace(r, varName, {...});
  const regex = /(?:[A-Za-z_$][\w$]*\s*=\s*)?sai\.pushPullFace\(\s*r\s*,\s*([A-Za-z_$][\w$]*)\s*,\s*(\{[^\n]*\})\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const targetId = match[1];
    const operation = _safeJsonParse(match[2]);
    if (!targetId || !operation) return null;
    return {
      type: "push_pull",
      targetId,
      selection: {
        mode: "face",
        objectId: targetId,
        objectIds: [targetId],
        faceIndex: operation.faceIndex ?? null,
        faceNormalWorld: operation.axis ?? null,
      },
      params: {
        axis: operation.axis ?? { x: 0, y: 0, z: 1 },
        distance: operation.distance ?? 0,
        faceIndex: operation.faceIndex ?? null,
        mode: operation.mode === "extend" ? "extend" : "move",
      },
    };
  });
}





function _parseCreatePrimitiveBox(code) {
  const regex =
    /if\s*\(\s*"([^"]+)"\s*\)\s*\{\s*shapes\[\s*"\1"\s*\]\s*=\s*r\.makeBox\(\s*(\[[\s\S]*?\])\s*,\s*(\[[\s\S]*?\])\s*\);\s*\}/g;
  return _collectMatches(code, regex, (match) => {
    const objectId = match[1];
    const c1 = _toVec3FromArray(_safeJsonParse(match[2]));
    const c2 = _toVec3FromArray(_safeJsonParse(match[3]));
    if (!objectId || !c1 || !c2) {
      return null;
    }

    return {
      type: "create_primitive",
      targetId: null,
      selection: null,
      params: {
        primitive: "box",
        objectId,
        position: {
          x: (c1.x + c2.x) / 2,
          y: (c1.y + c2.y) / 2,
          z: (c1.z + c2.z) / 2,
        },
        size: {
          x: Math.abs(c2.x - c1.x),
          y: Math.abs(c2.y - c1.y),
          z: Math.abs(c2.z - c1.z),
        },
      },
    };
  });
}

function _parseCreatePrimitiveSphere(code) {
  const regex =
    /if\s*\(\s*"([^"]+)"\s*\)\s*\{\s*shapes\[\s*"\1"\s*\]\s*=\s*r\.makeSphere\(\s*([-\d.eE+]+)\s*\)\.translate\(\s*(\[[\s\S]*?\])\s*\);\s*\}/g;
  return _collectMatches(code, regex, (match) => {
    const objectId = match[1];
    const radius = _toFiniteNumber(match[2]);
    const position = _toVec3FromArray(_safeJsonParse(match[3]));
    if (!objectId || radius === null || !position) {
      return null;
    }

    return {
      type: "create_primitive",
      targetId: null,
      selection: null,
      params: {
        primitive: "sphere",
        objectId,
        position,
        size: { x: radius * 2, y: radius * 2, z: radius * 2 },
      },
    };
  });
}

function _parseCreatePrimitiveCylinder(code) {
  const regex =
    /if\s*\(\s*"([^"]+)"\s*\)\s*\{\s*shapes\[\s*"\1"\s*\]\s*=\s*r\.makeCylinder\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*,\s*(\[[\s\S]*?\])\s*,\s*\[0,\s*0,\s*1\]\s*\);\s*\}/g;
  return _collectMatches(code, regex, (match) => {
    const objectId = match[1];
    const radius = _toFiniteNumber(match[2]);
    const height = _toFiniteNumber(match[3]);
    const position = _toVec3FromArray(_safeJsonParse(match[4]));
    if (!objectId || radius === null || height === null || !position) {
      return null;
    }

    return {
      type: "create_primitive",
      targetId: null,
      selection: null,
      params: {
        primitive: "cylinder",
        objectId,
        position,
        size: { x: radius * 2, y: radius * 2, z: height },
      },
    };
  });
}

function _parseMove(code) {
  const regex =
    /if\s*\(shapes\[\s*"([^"]+)"\s*\]\)\s*shapes\[\s*"\1"\s*\]\s*=\s*shapes\[\s*"\1"\s*\]\.translate\(\s*(\[[\s\S]*?\])\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const targetId = match[1];
    const delta = _toVec3FromArray(_safeJsonParse(match[2]));
    if (!targetId || !delta) {
      return null;
    }

    return {
      type: "move",
      targetId,
      selection: null,
      params: { delta },
    };
  });
}

function _parseRotate(code) {
  const regex =
    /if\s*\(shapes\[\s*"([^"]+)"\s*\]\)\s*shapes\[\s*"\1"\s*\]\s*=\s*shapes\[\s*"\1"\s*\]\.rotate\(\s*([-\d.eE+]+)\s*,\s*\[[^\]]*\]\s*,\s*\[[^\]]*\]\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const targetId = match[1];
    const y = _toFiniteNumber(match[2]);
    if (!targetId || y === null) {
      return null;
    }

    return {
      type: "rotate",
      targetId,
      selection: null,
      params: { deltaEuler: { x: 0, y, z: 0 } },
    };
  });
}
