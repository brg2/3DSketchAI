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
  const editableTargets = new Set(
    normalizedOperations
      .filter((operation) => operation.type === "push_pull" || operation.params?.subshapeMove)
      .map((operation) => operation.targetId)
      .filter(Boolean),
  );
  const mutableEditableTargets = new Set(
    normalizedOperations
      .filter((operation) => operation.type === "scale" && editableTargets.has(operation.targetId))
      .map((operation) => operation.targetId)
      .filter(Boolean),
  );

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
          editable: primitive === "box" && editableTargets.has(objectId),
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
        } else if (editableTargets.has(objectId)) {
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
          const declaration = mutableEditableTargets.has(objectId) ? "let" : "const";
          bodyLines.push(`  ${declaration} ${varName} = sai.makeBox(r, ${_vec3Literal(c1)}, ${_vec3Literal(c2)});`);
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
        if (operation.params.subshapeMove && state?.primitive === "box") {
          const move = operation.params.subshapeMove;
          if (move.mode === "vertex") {
            bodyLines.push(`  sai.moveBoxVertex(r, ${varName}, ${JSON.stringify(move.vertex)}, ${_vec3Literal(operation.params.delta)});`);
          } else {
            bodyLines.push(`  sai.moveBoxSubshape(r, ${varName}, ${JSON.stringify(move)});`);
          }
          break;
        }
        if (state?.editable) {
          bodyLines.push(`  sai.translateObject(r, ${varName}, ${_vec3Literal(operation.params.delta)});`);
        } else {
          bodyLines.push(`  ${varName} = ${varName}.translate(${_vec3Literal(operation.params.delta)});`);
        }
        if (state) {
          state.position.x += operation.params.delta.x;
          state.position.y += operation.params.delta.y;
          state.position.z += operation.params.delta.z;
        }
        break;
      }
      case "rotate": {
        const varName = getVarName(operation.targetId);
        if (operation.params.subshapeRotate) {
          bodyLines.push(`  sai.rotateBoxSubshape(r, ${varName}, ${JSON.stringify(operation.params.subshapeRotate)});`);
          break;
        }
        if (operation.selection?.mode === "face" && faceTiltsFromParams(operation.params).length > 0) {
          const state = objectState.get(operation.targetId);
          const faceTilts = faceTiltsFromParams(operation.params);
          if (state?.primitive === "box") {
            state.faceTilts.push(...faceTilts.map((tilt) => structuredClone(tilt)));
            if (state.editable) {
              bodyLines.push(`  ${varName}.applyCenteredTapers(${JSON.stringify(faceTilts)});`);
            } else {
              bodyLines.push(`  ${varName} = sai.makeTaperedBox(r, ${_boxConfigLiteral(state)});`);
            }
          }
          break;
        }
        const state = objectState.get(operation.targetId);
        const origin = state?.position ?? { x: 0, y: 0, z: 0 };
        for (const rotation of _rotationsFromEuler(operation.params.deltaEuler)) {
          const rotateCall = `${varName}.rotate(${_formatNumber(rotation.angle)}, ${_vec3Literal(origin)}, ${_arrayVec3Literal(rotation.axis)})`;
          bodyLines.push(state?.editable ? `  ${rotateCall};` : `  ${varName} = ${rotateCall};`);
        }
        if (state) {
          state.rotation.x += operation.params.deltaEuler.x;
          state.rotation.y += operation.params.deltaEuler.y;
          state.rotation.z += operation.params.deltaEuler.z;
        }
        break;
      }

      case "scale": {
        const varName = getVarName(operation.targetId);
        const scale = operation.params.scaleFactor;
        bodyLines.push(`  ${varName} = ${varName}.scale([${_formatNumber(scale.x)}, ${_formatNumber(scale.y)}, ${_formatNumber(scale.z)}]);`);
        const state = objectState.get(operation.targetId);
        if (state) {
          state.scale.x *= Math.max(0.1, scale.x);
          state.scale.y *= Math.max(0.1, scale.y);
          state.scale.z *= Math.max(0.1, scale.z);
        }
        break;
      }

      case "push_pull": {
        const varName = getVarName(operation.targetId);
        if (operation.params?.profile) {
          const profileOperation = _profileOperationFromPushPull(operation.params);
          bodyLines.push(`  ${varName} = sai.pushPullProfile(r, ${varName}, ${JSON.stringify(profileOperation)});`);
          break;
        }
        const state = objectState.get(operation.targetId);
        if (state?.primitive === "box") {
          const faceOperation = _faceOperationFromPushPull(operation.params);
          if (faceOperation.mode === "extend") {
            state.faceExtensions.push(faceOperation);
          } else {
            state.faceExtrudes.push(faceOperation);
          }
          bodyLines.push(`  sai.pushPullFace(r, ${varName}, ${JSON.stringify(faceOperation)});`);
          break;
        }
        throw new Error("push_pull requires a solid modeling implementation for non-box targets");
      }
      case "polyline": {
        const varName = operation.params.objectId;
        bodyLines.push(`  const ${varName} = sai.makePolyline(r, ${JSON.stringify(operation.params.points)}, { closed: ${operation.params.closed === true ? "true" : "false"} });`);
        break;
      }
      case "group":
      case "component":
        break;
      default:
        break;
    }
  }

  const resultForObject = (objectId) => {
    const varName = objectVars.get(objectId);
    return objectState.get(objectId)?.editable ? `${varName}.toShape()` : varName;
  };
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
  candidates.push(..._parseDirectMoveBoxSubshape(code));
  candidates.push(..._parseDirectMoveBoxVertex(code));
  candidates.push(..._parseDirectRotateBoxSubshape(code));
  candidates.push(..._parseDirectRotate(code));
  candidates.push(..._parseDirectRotateObjectMethod(code));
  candidates.push(..._parseDirectTaperedBox(code));
  candidates.push(..._parseDirectPushPullFace(code));
  candidates.push(..._parseDirectPushPullProfile(code));
  candidates.push(..._parseDirectScale(code));
  candidates.push(..._parseCreatePrimitiveBox(code));
  candidates.push(..._parseCreatePrimitiveSphere(code));
  candidates.push(..._parseCreatePrimitiveCylinder(code));
  candidates.push(..._parseMove(code));
  candidates.push(..._parseRotate(code));
  candidates.push(..._parseScale(code));

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

function _rotationsFromEuler(deltaEuler = {}) {
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

function _deltaEulerFromAngleAxis(angle, rawAxis) {
  if (angle === null || !Array.isArray(rawAxis) || rawAxis.length < 3) {
    return null;
  }
  const axis = _normalizeAxis({ x: rawAxis[0] ?? 0, y: rawAxis[1] ?? 0, z: rawAxis[2] ?? 0 });
  const entries = [
    ["x", axis.x],
    ["y", axis.y],
    ["z", axis.z],
  ];
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const [key, component] = entries[0];
  if (Math.abs(component) < 0.5) {
    return null;
  }
  return {
    x: key === "x" ? angle * Math.sign(component) : 0,
    y: key === "y" ? angle * Math.sign(component) : 0,
    z: key === "z" ? angle * Math.sign(component) : 0,
  };
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

function _parseDirectMoveBoxSubshape(code) {
  const regex = /sai\.moveBoxSubshape\(\s*r\s*,\s*([A-Za-z_$][\w$]*)\s*,\s*(\{[^\n]*?\})\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const targetId = match[1];
    const move = _safeJsonParse(match[2]);
    if (!targetId || !move?.delta) return null;
    const mode = ["face", "edge", "vertex"].includes(move.mode) ? move.mode : "face";
    return {
      type: "move",
      targetId,
      selection: {
        mode,
        objectId: targetId,
        objectIds: [targetId],
        faceIndex: move.faceIndex ?? null,
        faceNormalWorld: move.faceNormalWorld ?? null,
        edge: mode === "edge" ? move.edge ?? null : null,
        vertex: mode === "vertex" ? move.vertex ?? null : null,
      },
      params: {
        delta: move.delta,
        subshapeMove: move,
      },
    };
  });
}

function _parseDirectMoveBoxVertex(code) {
  const regex = /sai\.moveBoxVertex\(\s*r\s*,\s*([A-Za-z_$][\w$]*)\s*,\s*(\{[^\n]*?\})\s*,\s*(\[[^\n]*?\])\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const targetId = match[1];
    const vertex = _safeJsonParse(match[2]);
    const delta = _toVec3FromArray(_safeJsonParse(match[3]));
    if (!targetId || !vertex || !delta) return null;
    const subshapeMove = {
      mode: "vertex",
      vertex,
      delta,
    };
    return {
      type: "move",
      targetId,
      selection: {
        mode: "vertex",
        objectId: targetId,
        objectIds: [targetId],
        faceIndex: null,
        faceNormalWorld: null,
        edge: null,
        vertex,
      },
      params: {
        delta,
        subshapeMove,
      },
    };
  });
}

function _parseDirectRotateBoxSubshape(code) {
  const regex = /sai\.rotateBoxSubshape\(\s*r\s*,\s*([A-Za-z_$][\w$]*)\s*,\s*(\{[^\n]*?\})\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const targetId = match[1];
    const rotate = _safeJsonParse(match[2]);
    if (!targetId || !rotate?.axis || !rotate?.origin || !Number.isFinite(rotate.angle)) return null;
    const mode = rotate.mode === "edge" ? "edge" : "object";
    return {
      type: "rotate",
      targetId,
      selection: {
        mode,
        objectId: targetId,
        objectIds: [targetId],
        faceIndex: null,
        faceNormalWorld: null,
        edge: mode === "edge" ? rotate.edge ?? null : null,
        vertex: null,
      },
      params: {
        deltaEuler: { x: 0, y: 0, z: 0 },
        subshapeRotate: rotate,
      },
    };
  });
}

function _parseDirectRotate(code) {
  const regex = /([A-Za-z_$][\w$]*)\s*=\s*\1\.rotate\(\s*([-\d.eE+]+)\s*,\s*(\[[\s\S]*?\])\s*,\s*(\[[\s\S]*?\])\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const targetId = match[1];
    const angle = _toFiniteNumber(match[2]);
    const deltaEuler = _deltaEulerFromAngleAxis(angle, _safeJsonParse(match[4]));
    if (!targetId || !deltaEuler) return null;
    return { type: "rotate", targetId, selection: null, params: { deltaEuler } };
  });
}

function _parseDirectRotateObjectMethod(code) {
  const regex = /^\s*([A-Za-z_$][\w$]*)\.rotate\(\s*([-\d.eE+]+)\s*,\s*(\[[\s\S]*?\])\s*,\s*(\[[\s\S]*?\])\s*\);/gm;
  return _collectMatches(code, regex, (match) => {
    const targetId = match[1];
    const angle = _toFiniteNumber(match[2]);
    const deltaEuler = _deltaEulerFromAngleAxis(angle, _safeJsonParse(match[4]));
    if (!targetId || !deltaEuler) return null;
    return { type: "rotate", targetId, selection: null, params: { deltaEuler } };
  });
}

function _parseDirectTaperedBox(code) {
  const regex = /([A-Za-z_$][\w$]*)\s*=\s*sai\.makeTaperedBox\(\s*r\s*,\s*(\{[^\n]*\})\s*\);/g;
  const latestByTarget = new Map();
  for (const match of code.matchAll(regex)) {
    const targetId = match[1];
    const config = _safeJsonParse(match[2]);
    if (!targetId || !config) {
      continue;
    }
    latestByTarget.set(targetId, { index: match.index ?? 0, targetId, config });
  }

  const candidates = [];
  for (const { index, targetId, config } of latestByTarget.values()) {
    const faceTilts = Array.isArray(config.faceTilts)
      ? config.faceTilts.filter((tilt) => tilt && typeof tilt === "object")
      : [];
    const faceTilt = faceTilts.at(-1);
    if (faceTilt) {
      candidates.push({
        index,
        operation: {
          type: "rotate",
          targetId,
          selection: {
            mode: "face",
            objectId: targetId,
            objectIds: [targetId],
            faceIndex: faceTilt.faceIndex ?? null,
            faceNormalWorld: faceTilt.faceNormalWorld ?? null,
          },
          params: {
            deltaEuler: { x: 0, y: 0, z: 0 },
            faceTilts,
          },
        },
      });
    }
  }
  return candidates;
}

function faceTiltsFromParams(params) {
  return Array.isArray(params?.faceTilts) && params.faceTilts.length > 0
    ? params.faceTilts
    : [params?.faceTilt].filter(Boolean);
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

function _parseDirectPushPullProfile(code) {
  const regex = /(?:([A-Za-z_$][\w$]*)\s*=\s*)?sai\.pushPullProfile\(\s*r\s*,\s*([A-Za-z_$][\w$]*)\s*,\s*(\{[^\n]*\})\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const targetId = match[2];
    const operation = _safeJsonParse(match[3]);
    if (!targetId || !operation?.profile) return null;
    return {
      type: "push_pull",
      targetId,
      selection: {
        mode: "face",
        objectId: targetId,
        objectIds: [targetId],
        faceNormalWorld: operation.axis ?? operation.profile?.plane?.normal ?? null,
        profile: operation.profile,
      },
      params: {
        axis: operation.axis ?? operation.profile?.plane?.normal ?? { x: 0, y: 1, z: 0 },
        distance: operation.distance ?? 0,
        mode: operation.mode === "extend" ? "extend" : "move",
        profile: operation.profile,
      },
    };
  });
}

function _profileOperationFromPushPull(params) {
  return {
    axis: params.axis ?? params.profile?.plane?.normal ?? { x: 0, y: 1, z: 0 },
    distance: params.distance ?? 0,
    mode: params.mode ?? "move",
    profile: structuredClone(params.profile),
  };
}

function _parseDirectScale(code) {
  const regex = /([A-Za-z_$][\w$]*)\s*=\s*\1\.scale\(\s*(\[[\s\S]*?\])\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const targetId = match[1];
    const scale = _toVec3FromArray(_safeJsonParse(match[2]));
    if (!targetId || !scale) return null;
    return { type: "scale", targetId, selection: null, params: { scaleFactor: scale } };
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
    /if\s*\(shapes\[\s*"([^"]+)"\s*\]\)\s*shapes\[\s*"\1"\s*\]\s*=\s*shapes\[\s*"\1"\s*\]\.rotate\(\s*([-\d.eE+]+)\s*,\s*\[[^\]]*\]\s*,\s*(\[[^\]]*\])\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const targetId = match[1];
    const angle = _toFiniteNumber(match[2]);
    const deltaEuler = _deltaEulerFromAngleAxis(angle, _safeJsonParse(match[3]));
    if (!targetId || !deltaEuler) {
      return null;
    }

    return {
      type: "rotate",
      targetId,
      selection: null,
      params: { deltaEuler },
    };
  });
}

function _parseScale(code) {
  const regex =
    /if\s*\(shapes\[\s*"([^"]+)"\s*\]\)\s*shapes\[\s*"\1"\s*\]\s*=\s*shapes\[\s*"\1"\s*\]\.scale\(\s*(\[[\s\S]*?\])\s*\);/g;
  return _collectMatches(code, regex, (match) => {
    const targetId = match[1];
    const scale = _toVec3FromArray(_safeJsonParse(match[2]));
    if (!targetId || !scale) {
      return null;
    }

    return {
      type: "scale",
      targetId,
      selection: null,
      params: { scaleFactor: scale },
    };
  });
}
