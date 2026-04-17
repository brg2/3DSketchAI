import { basicFaceExtrusion } from "replicad";

export function create3dsaiModelingLibrary() {
  return {
    makeBox,
    pushPull,
    pushPullFace,
    translateObject,
  };
}

export function makeBox(r, min, max) {
  return r.makeBox(min, max);
}

export function pushPullFace(_r, shape, operation) {
  const { distance, axis } = operation;

  if (axis) {
    return pushPull(shape, (face, index, faces) => {
      const selected = selectFaceForOperation(faces, operation);
      return selected ? face === selected : false;
    }, distance);
  }

  const faces = getFaces(shape);
  const faceIndex = operation?.faceIndex;
  if (Number.isInteger(faceIndex) && faceIndex >= 0 && faceIndex < faces.length) {
    return pushPull(shape, faceIndex, distance);
  }

  throw new Error("pushPullFace: cannot determine target face from operation");
}

export function translateObject(_r, shape, delta) {
  if (!shape || typeof shape.translate !== "function") {
    throw new Error("translateObject requires a shape");
  }
  return shape.translate(normalizeDelta(delta));
}

export function pushPull(shape, faceSelector, distance) {
  const faces = getFaces(shape);
  const face =
    typeof faceSelector === "function"
      ? faces.find((candidate, index) => faceSelector(candidate, index, faces))
      : faces[faceSelector];

  if (!face) {
    throw new Error(`pushPull: target face not found (${faces.length} available)`);
  }

  const normal = face.normalAt().normalized();
  const extrusionVec = normal.multiply(distance);
  const tool = basicFaceExtrusion(face, extrusionVec);

  return distance > 0
    ? shape.fuse(tool)
    : shape.cut(tool);
}

function getFaces(shape) {
  const faces = typeof shape?.faces === "function" ? shape.faces() : shape?.faces;
  return Array.isArray(faces) ? faces : [];
}

function selectFaceForOperation(faces, operation) {
  if (!Array.isArray(faces) || faces.length === 0) {
    return null;
  }

  const axis = normalizeAxis(operation?.axis ?? axisFromFaceIdentity(operation));
  const byNormal = bestFaceByNormal(faces, axis);
  if (byNormal) {
    return byNormal;
  }

  const byCoordinate = bestFaceByCoordinate(faces, operation, axis);
  if (byCoordinate) {
    return byCoordinate;
  }

  const faceIndex = operation?.faceIndex;
  if (Number.isInteger(faceIndex) && faceIndex >= 0 && faceIndex < faces.length) {
    return faces[faceIndex];
  }

  return null;
}

function bestFaceByNormal(faces, axis) {
  let best = null;
  let bestDot = -Infinity;

  for (const face of faces) {
    const normal = safeFaceNormal(face);
    if (!normal) {
      continue;
    }
    const dot = normal.x * axis.x + normal.y * axis.y + normal.z * axis.z;
    if (dot > bestDot) {
      best = face;
      bestDot = dot;
    }
  }

  return bestDot > 0.25 ? best : null;
}

function bestFaceByCoordinate(faces, operation, axis) {
  const faceAxis = ["x", "y", "z"].includes(operation?.faceAxis)
    ? operation.faceAxis
    : dominantAxis(axis);
  const faceSign = Math.sign(operation?.faceSign ?? axis[faceAxis] ?? 1) || 1;
  let best = null;
  let bestScore = -Infinity;

  for (const face of faces) {
    const center = safeFaceCenter(face);
    if (!center) {
      continue;
    }
    const score = faceSign * (center[faceAxis] ?? 0);
    if (score > bestScore) {
      best = face;
      bestScore = score;
    }
  }

  return best;
}

function axisFromFaceIdentity(operation) {
  const faceAxis = ["x", "y", "z"].includes(operation?.faceAxis) ? operation.faceAxis : "z";
  const faceSign = Math.sign(operation?.faceSign ?? 1) || 1;
  return {
    x: faceAxis === "x" ? faceSign : 0,
    y: faceAxis === "y" ? faceSign : 0,
    z: faceAxis === "z" ? faceSign : 0,
  };
}

function safeFaceNormal(face) {
  try {
    return face.normalAt().normalized();
  } catch {
    return null;
  }
}

function safeFaceCenter(face) {
  try {
    return face.center;
  } catch {
    return null;
  }
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

function normalizeAxis(axis) {
  const length = Math.hypot(axis.x ?? 0, axis.y ?? 0, axis.z ?? 0);
  if (length < 1e-8) {
    return { x: 0, y: 0, z: 1 };
  }
  return { x: (axis.x ?? 0) / length, y: (axis.y ?? 0) / length, z: (axis.z ?? 0) / length };
}

function normalizeDelta(delta) {
  if (Array.isArray(delta)) {
    return { x: delta[0] ?? 0, y: delta[1] ?? 0, z: delta[2] ?? 0 };
  }
  return { x: delta?.x ?? 0, y: delta?.y ?? 0, z: delta?.z ?? 0 };
}
