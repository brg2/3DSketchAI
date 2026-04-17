const AXES = ["x", "y", "z"];

export function create3dsaiModelingLibrary() {
  return {
    makeBox,
    makeTaperedBox,
    moveBoxSubshape,
    moveBoxVertex,
    pushPullFace,
    translateObject,
  };
}

export function makeBox(r, min, max) {
  return new EditableBox(r, min, max);
}

export function makeTaperedBox(r, { min, max, faceTilts = [], faceExtrudes = [], subshapeMoves = [], faceExtensions = [] }) {
  const corners = createBoxCorners(min, max);
  for (const tilt of faceTilts) {
    applyCenteredTaper(corners, tilt);
  }
  for (const extrude of faceExtrudes) {
    applyFaceExtrude(corners, extrude);
  }
  for (const move of subshapeMoves) {
    applySubshapeMove(corners, move);
  }

  const faces = [
    r.makePolygon([corners.nx_ny_nz, corners.px_ny_nz, corners.px_ny_pz, corners.nx_ny_pz]),
    r.makePolygon([corners.nx_py_nz, corners.nx_py_pz, corners.px_py_pz, corners.px_py_nz]),
    r.makePolygon([corners.nx_ny_nz, corners.nx_py_nz, corners.px_py_nz, corners.px_ny_nz]),
    r.makePolygon([corners.px_ny_nz, corners.px_py_nz, corners.px_py_pz, corners.px_ny_pz]),
    r.makePolygon([corners.px_ny_pz, corners.px_py_pz, corners.nx_py_pz, corners.nx_ny_pz]),
    r.makePolygon([corners.nx_ny_pz, corners.nx_py_pz, corners.nx_py_nz, corners.nx_ny_nz]),
  ];

  for (const extension of faceExtensions) {
    addFaceExtensionFaces(r, faces, corners, extension);
  }

  return r.makeSolid(faces);
}

export function moveBoxVertex(r, shape, vertex, delta) {
  return moveBoxSubshape(r, shape, {
    mode: "vertex",
    vertex: normalizeVertex(vertex),
    delta: normalizeDelta(delta),
  });
}

export function moveBoxSubshape(_r, shape, move) {
  if (!shape || typeof shape.moveSubshape !== "function") {
    throw new Error("moveBoxSubshape requires a shape created by sai.makeBox");
  }
  shape.moveSubshape(move);
  return shape;
}

export function pushPullFace(_r, shape, operation) {
  if (!shape || typeof shape.pushPullFace !== "function") {
    throw new Error("pushPullFace requires a shape created by sai.makeBox");
  }
  shape.pushPullFace(operation);
  return shape;
}

export function translateObject(_r, shape, delta) {
  if (!shape || typeof shape.translateObject !== "function") {
    throw new Error("translateObject requires a shape created by sai.makeBox");
  }
  shape.translateObject(normalizeDelta(delta));
  return shape;
}

class EditableBox {
  constructor(r, min, max) {
    this.r = r;
    this.min = [...min];
    this.max = [...max];
    this.faceTilts = [];
    this.faceExtrudes = [];
    this.subshapeMoves = [];
    this.faceExtensions = [];
  }

  moveSubshape(move) {
    this.subshapeMoves.push(structuredClone(move));
    return this;
  }

  pushPullFace(operation) {
    const faceOperation = normalizeFaceOperation(operation);
    if (faceOperation.mode === "extend") {
      this.faceExtensions.push(faceOperation);
    } else {
      this.faceExtrudes.push(faceOperation);
    }
    return this;
  }

  translateObject(delta) {
    const normalized = normalizeDelta(delta);
    this.min[0] += normalized.x;
    this.min[1] += normalized.y;
    this.min[2] += normalized.z;
    this.max[0] += normalized.x;
    this.max[1] += normalized.y;
    this.max[2] += normalized.z;
    return this;
  }

  toShape() {
    if (
      this.faceTilts.length === 0 &&
      this.faceExtrudes.length === 0 &&
      this.subshapeMoves.length === 0 &&
      this.faceExtensions.length === 0
    ) {
      return this.r.makeBox(this.min, this.max);
    }

    return makeTaperedBox(this.r, {
      min: this.min,
      max: this.max,
      faceTilts: this.faceTilts,
      faceExtrudes: this.faceExtrudes,
      subshapeMoves: this.subshapeMoves,
      faceExtensions: this.faceExtensions,
    });
  }
}

function normalizeFaceOperation(operation) {
  const axis = normalizeVector(operation?.axis ?? { x: 0, y: 0, z: 1 });
  const faceAxis = AXES.includes(operation?.faceAxis) ? operation.faceAxis : dominantAxis(axis);
  return {
    faceIndex: Number.isInteger(operation?.faceIndex) ? operation.faceIndex : null,
    axis,
    distance: operation?.distance ?? 0,
    faceAxis,
    faceSign: Math.sign(operation?.faceSign ?? axis[faceAxis] ?? 1) || 1,
    mode: operation?.mode === "extend" ? "extend" : "move",
  };
}

function normalizeVertex(vertex) {
  if (typeof vertex === "string") {
    return { ...pointFromCornerKey(vertex), key: vertex };
  }
  if (!vertex || typeof vertex !== "object") {
    return { x: 0, y: 0, z: 0, key: "px_py_pz" };
  }
  return structuredClone(vertex);
}

function pointFromCornerKey(key) {
  const parts = typeof key === "string" ? key.split("_") : [];
  return {
    x: parts[0] === "nx" ? -0.5 : 0.5,
    y: parts[1] === "ny" ? -0.5 : 0.5,
    z: parts[2] === "nz" ? -0.5 : 0.5,
  };
}

function normalizeDelta(delta) {
  if (Array.isArray(delta)) {
    return { x: delta[0] ?? 0, y: delta[1] ?? 0, z: delta[2] ?? 0 };
  }
  return { x: delta?.x ?? 0, y: delta?.y ?? 0, z: delta?.z ?? 0 };
}

function applySubshapeMove(corners, move) {
  const delta = move?.delta ?? { x: 0, y: 0, z: 0 };
  const dx = delta.x ?? 0;
  const dy = delta.y ?? 0;
  const dz = delta.z ?? 0;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz) || Math.hypot(dx, dy, dz) < 1e-8) {
    return;
  }

  const keys = subshapeCornerKeys(corners, move);
  for (const key of keys) {
    const corner = corners[key];
    if (!corner) {
      continue;
    }
    corner[0] += dx;
    corner[1] += dy;
    corner[2] += dz;
  }
}

function subshapeCornerKeys(corners, move) {
  if (move?.mode === "face") {
    const loop = faceLoop(corners, move);
    return Object.entries(corners)
      .filter(([, corner]) => loop?.includes(corner))
      .map(([key]) => key);
  }

  if (move?.mode === "edge") {
    const keys = Array.isArray(move.edge?.keys) ? move.edge.keys.filter((key) => corners[key]) : [];
    if (keys.length > 0) {
      return keys;
    }
    return [cornerKeyFromPoint(move.edge?.a), cornerKeyFromPoint(move.edge?.b)].filter((key) => corners[key]);
  }

  if (move?.mode === "vertex") {
    const key = typeof move.vertex?.key === "string" ? move.vertex.key : cornerKeyFromPoint(move.vertex);
    return corners[key] ? [key] : [];
  }

  return [];
}

function applyFaceExtrude(corners, extrude) {
  const axis = normalizeVector(extrude?.axis ?? { x: 0, y: 0, z: 1 });
  const distance = extrude?.distance ?? 0;
  const faceAxis = extrude?.faceAxis;
  const faceSign = Math.sign(extrude?.faceSign ?? 1) || 1;
  if (!AXES.includes(faceAxis) || !Number.isFinite(distance) || Math.abs(distance) < 1e-6) {
    return;
  }

  const faceIndex = axisIndex(faceAxis);
  const faceCoordinate = faceSign > 0 ? maxCoordinate(corners, faceIndex) : minCoordinate(corners, faceIndex);
  const delta = [axis.x * distance, axis.y * distance, axis.z * distance];
  for (const corner of Object.values(corners)) {
    if (Math.abs(corner[faceIndex] - faceCoordinate) > 1e-6) {
      continue;
    }
    corner[0] += delta[0];
    corner[1] += delta[1];
    corner[2] += delta[2];
  }
}

function addFaceExtensionFaces(r, faces, corners, extension) {
  const axis = normalizeVector(extension?.axis ?? { x: 0, y: 0, z: 1 });
  const distance = extension?.distance ?? 0;
  const loop = faceLoop(corners, extension);
  if (!loop || !Number.isFinite(distance) || Math.abs(distance) < 1e-6) {
    return;
  }

  const delta = [axis.x * distance, axis.y * distance, axis.z * distance];
  const outer = loop.map((point) => [point[0] + delta[0], point[1] + delta[1], point[2] + delta[2]]);
  faces.push(r.makePolygon(outer));
  for (let i = 0; i < loop.length; i += 1) {
    const next = (i + 1) % loop.length;
    faces.push(r.makePolygon([loop[i], loop[next], outer[next], outer[i]]));
  }
}

function faceLoop(corners, operation) {
  const faceAxis = operation?.faceAxis;
  const faceSign = Math.sign(operation?.faceSign ?? 1) || 1;
  if (!AXES.includes(faceAxis)) {
    return null;
  }

  if (faceAxis === "x") {
    return faceSign > 0
      ? [corners.px_ny_nz, corners.px_py_nz, corners.px_py_pz, corners.px_ny_pz]
      : [corners.nx_ny_nz, corners.nx_ny_pz, corners.nx_py_pz, corners.nx_py_nz];
  }
  if (faceAxis === "y") {
    return faceSign > 0
      ? [corners.nx_py_nz, corners.nx_py_pz, corners.px_py_pz, corners.px_py_nz]
      : [corners.nx_ny_nz, corners.px_ny_nz, corners.px_ny_pz, corners.nx_ny_pz];
  }
  return faceSign > 0
    ? [corners.nx_ny_pz, corners.px_ny_pz, corners.px_py_pz, corners.nx_py_pz]
    : [corners.nx_ny_nz, corners.nx_py_nz, corners.px_py_nz, corners.px_ny_nz];
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x ?? 0, vector.y ?? 0, vector.z ?? 0);
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

function createBoxCorners(min, max) {
  return {
    nx_ny_nz: [min[0], min[1], min[2]],
    px_ny_nz: [max[0], min[1], min[2]],
    px_ny_pz: [max[0], min[1], max[2]],
    nx_ny_pz: [min[0], min[1], max[2]],
    nx_py_nz: [min[0], max[1], min[2]],
    px_py_nz: [max[0], max[1], min[2]],
    px_py_pz: [max[0], max[1], max[2]],
    nx_py_pz: [min[0], max[1], max[2]],
  };
}

function cornerKeyFromPoint(point) {
  if (!point) {
    return null;
  }
  const sx = (point.x ?? 0) >= 0 ? "px" : "nx";
  const sy = (point.y ?? 0) >= 0 ? "py" : "ny";
  const sz = (point.z ?? 0) >= 0 ? "pz" : "nz";
  return `${sx}_${sy}_${sz}`;
}

function applyCenteredTaper(corners, tilt) {
  const faceAxis = tilt.faceAxis;
  const faceSign = Math.sign(tilt.faceSign ?? 1) || 1;
  const sideAxis = tilt.hingeSideAxis;
  const angle = tilt.angle ?? 0;
  if (!AXES.includes(faceAxis) || !AXES.includes(sideAxis) || !Number.isFinite(angle)) {
    return;
  }

  const faceIndex = axisIndex(faceAxis);
  const sideIndex = axisIndex(sideAxis);
  const faceCoordinate = faceSign > 0 ? maxCoordinate(corners, faceIndex) : minCoordinate(corners, faceIndex);
  const sideCenter = (minCoordinate(corners, sideIndex) + maxCoordinate(corners, sideIndex)) / 2;
  const oppositeCoordinate = faceSign > 0 ? minCoordinate(corners, faceIndex) : maxCoordinate(corners, faceIndex);
  const slope = Math.tan(angle);

  for (const corner of Object.values(corners)) {
    if (Math.abs(corner[faceIndex] - faceCoordinate) > 1e-6) {
      continue;
    }
    corner[faceIndex] += faceSign * slope * (corner[sideIndex] - sideCenter);
    corner[faceIndex] = faceSign > 0
      ? Math.max(corner[faceIndex], oppositeCoordinate)
      : Math.min(corner[faceIndex], oppositeCoordinate);
  }
}

function axisIndex(axis) {
  return axis === "x" ? 0 : axis === "y" ? 1 : 2;
}

function minCoordinate(corners, index) {
  return Math.min(...Object.values(corners).map((corner) => corner[index]));
}

function maxCoordinate(corners, index) {
  return Math.max(...Object.values(corners).map((corner) => corner[index]));
}
