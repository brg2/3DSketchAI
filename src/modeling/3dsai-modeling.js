import { basicFaceExtrusion, Vector } from "replicad";

const AXES = ["x", "y", "z"];

export function create3dsaiModelingLibrary() {
  return {
    makeBox,
    makeTaperedBox,
    moveBoxSubshape,
    moveBoxVertex,
    pushPull,
    pushPullFace,
    translateObject,
  };
}

export function makeBox(r, min, max) {
  return new EditableBox(r, min, max);
}

export function makeTaperedBox(r, { min, max, faceTilts = [], faceExtrudes = [], subshapeMoves = [], faceExtensions = [] }) {
  const box = makeBox(r, min, max);
  for (const tilt of faceTilts) {
    box.applyCenteredTaper(tilt);
  }
  for (const extrude of faceExtrudes) {
    box.pushPullFace(extrude);
  }
  for (const move of subshapeMoves) {
    box.moveSubshape(move);
  }
  for (const extension of faceExtensions) {
    box.addFaceExtension(extension);
  }
  return box.toShape();
}

export function pushPullFace(_r, shape, operation) {
  if (shape instanceof EditableBox || typeof shape?.pushPullFace === "function") {
    shape.pushPullFace(operation);
    return shape;
  }

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

export function moveBoxSubshape(_r, shape, operation) {
  if (!shape || typeof shape.moveSubshape !== "function") {
    throw new Error("moveBoxSubshape requires an editable box");
  }
  shape.moveSubshape(operation);
  return shape;
}

export function moveBoxVertex(_r, shape, vertex, delta) {
  if (!shape || typeof shape.moveSubshape !== "function") {
    throw new Error("moveBoxVertex requires an editable box");
  }
  shape.moveSubshape({
    mode: "vertex",
    vertex,
    delta: normalizeDelta(delta),
  });
  return shape;
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

class EditableBox {
  constructor(r, min, max) {
    this.r = r;
    this.baseMin = [...min];
    this.baseMax = [...max];
    this.min = [...min];
    this.max = [...max];
    this.corners = createBoxCorners(min, max);
    this.extraFaces = [];
    this.brepOperations = [];
    this.brepCompatible = true;
  }

  translate(delta) {
    const vector = deltaArray(delta);
    this.brepOperations.push({
      type: "translate",
      delta: normalizeDelta(delta),
    });
    for (let index = 0; index < 3; index += 1) {
      this.min[index] += vector[index];
      this.max[index] += vector[index];
    }
    for (const corner of Object.values(this.corners)) {
      corner[0] += vector[0];
      corner[1] += vector[1];
      corner[2] += vector[2];
    }
    for (const face of this.extraFaces) {
      for (const point of face) {
        point[0] += vector[0];
        point[1] += vector[1];
        point[2] += vector[2];
      }
    }
    return this;
  }

  scale(scaleFactor) {
    this.brepCompatible = false;
    const scale = Array.isArray(scaleFactor)
      ? [scaleFactor[0] ?? 1, scaleFactor[1] ?? 1, scaleFactor[2] ?? 1]
      : [scaleFactor?.x ?? 1, scaleFactor?.y ?? 1, scaleFactor?.z ?? 1];
    for (const corner of Object.values(this.corners)) {
      corner[0] *= scale[0];
      corner[1] *= scale[1];
      corner[2] *= scale[2];
    }
    for (const face of this.extraFaces) {
      for (const point of face) {
        point[0] *= scale[0];
        point[1] *= scale[1];
        point[2] *= scale[2];
      }
    }
    return this;
  }

  pushPullFace(operation) {
    const axis = normalizeVector(operation?.axis ?? axisFromFaceIdentity(operation));
    const distance = operation?.distance ?? 0;
    if (!Number.isFinite(distance) || Math.abs(distance) < 1e-8) {
      return this;
    }

    this.brepOperations.push({
      type: "pushPull",
      operation: normalizeFaceOperation({ ...operation, axis, distance }),
      min: [...this.min],
      max: [...this.max],
    });

    if (operation?.mode === "extend") {
      this.addFaceExtension(operation, { recordBrep: false });
      return this;
    }

    const delta = [axis.x * distance, axis.y * distance, axis.z * distance];
    for (const key of faceCornerKeys(this.corners, operation, axis)) {
      const corner = this.corners[key];
      corner[0] += delta[0];
      corner[1] += delta[1];
      corner[2] += delta[2];
    }
    this.refreshBoundsFromCorners();
    return this;
  }

  moveSubshape(operation) {
    const vector = deltaArray(operation?.delta);
    if (Math.hypot(vector[0], vector[1], vector[2]) < 1e-8) {
      return this;
    }

    if (operation?.mode === "face") {
      this.brepOperations.push({
        type: "faceMove",
        operation: structuredClone(operation),
        min: [...this.min],
        max: [...this.max],
      });
    } else {
      this.brepCompatible = false;
    }

    for (const key of subshapeCornerKeys(this.corners, operation)) {
      const corner = this.corners[key];
      if (!corner) {
        continue;
      }
      corner[0] += vector[0];
      corner[1] += vector[1];
      corner[2] += vector[2];
    }
    this.refreshBoundsFromCorners();
    return this;
  }

  applyCenteredTaper(tilt) {
    const faceAxis = tilt?.faceAxis;
    const faceSign = Math.sign(tilt?.faceSign ?? 1) || 1;
    const sideAxis = tilt?.hingeSideAxis;
    const angle = tilt?.angle ?? 0;
    if (!AXES.includes(faceAxis) || !AXES.includes(sideAxis) || !Number.isFinite(angle)) {
      return this;
    }
    this.brepCompatible = false;

    const faceIndex = axisIndex(faceAxis);
    const sideIndex = axisIndex(sideAxis);
    const faceCoordinate = faceSign > 0 ? maxCoordinate(this.corners, faceIndex) : minCoordinate(this.corners, faceIndex);
    const sideCenter = (minCoordinate(this.corners, sideIndex) + maxCoordinate(this.corners, sideIndex)) / 2;
    const oppositeCoordinate = faceSign > 0 ? minCoordinate(this.corners, faceIndex) : maxCoordinate(this.corners, faceIndex);
    const slope = Math.tan(angle);

    for (const corner of Object.values(this.corners)) {
      if (Math.abs(corner[faceIndex] - faceCoordinate) > 1e-6) {
        continue;
      }
      corner[faceIndex] += faceSign * slope * (corner[sideIndex] - sideCenter);
      corner[faceIndex] = faceSign > 0
        ? Math.max(corner[faceIndex], oppositeCoordinate)
        : Math.min(corner[faceIndex], oppositeCoordinate);
    }
    this.refreshBoundsFromCorners();
    return this;
  }

  addFaceExtension(operation, { recordBrep = true } = {}) {
    const axis = normalizeVector(operation?.axis ?? axisFromFaceIdentity(operation));
    const distance = operation?.distance ?? 0;
    const loop = faceLoop(this.corners, operation, axis);
    if (!loop || !Number.isFinite(distance) || Math.abs(distance) < 1e-8) {
      return this;
    }

    if (recordBrep) {
      this.brepOperations.push({
        type: "pushPull",
        operation: normalizeFaceOperation({ ...operation, axis, distance, mode: "extend" }),
        min: [...this.min],
        max: [...this.max],
      });
    }

    const delta = [axis.x * distance, axis.y * distance, axis.z * distance];
    const outer = loop.map((point) => [point[0] + delta[0], point[1] + delta[1], point[2] + delta[2]]);
    this.extraFaces.push(outer);
    for (let index = 0; index < loop.length; index += 1) {
      const next = (index + 1) % loop.length;
      this.extraFaces.push([loop[index], loop[next], outer[next], outer[index]]);
    }
    this.refreshBoundsFromCorners();
    return this;
  }

  toShape() {
    const brepShape = this.toBrepShape();
    if (brepShape) {
      return brepShape;
    }

    return this.toLegacyPolygonShape();
  }

  toBrepShape() {
    if (!this.brepCompatible || this.brepOperations.length === 0 || !canUseBrepKernel(this.r)) {
      return null;
    }

    let shape = this.r.makeBox(this.baseMin, this.baseMax);
    if (!shape || typeof shape.fuse !== "function" || typeof shape.cut !== "function") {
      return null;
    }

    for (const entry of this.brepOperations) {
      if (entry.type === "translate") {
        if (typeof shape.translate !== "function") {
          return null;
        }
        shape = shape.translate(entry.delta);
      } else if (entry.type === "pushPull") {
        shape = pushPullFaceOnShape(this.r, shape, entry.operation);
      } else if (entry.type === "faceMove") {
        shape = moveBoxFaceWithBooleans(this.r, shape, entry.min, entry.max, entry.operation);
      }
    }
    return shape;
  }

  refreshBoundsFromCorners() {
    for (let index = 0; index < 3; index += 1) {
      this.min[index] = minCoordinate(this.corners, index);
      this.max[index] = maxCoordinate(this.corners, index);
    }
  }

  toLegacyPolygonShape() {
    const faces = [
      this.r.makePolygon([this.corners.nx_ny_nz, this.corners.px_ny_nz, this.corners.px_ny_pz, this.corners.nx_ny_pz]),
      this.r.makePolygon([this.corners.nx_py_nz, this.corners.nx_py_pz, this.corners.px_py_pz, this.corners.px_py_nz]),
      this.r.makePolygon([this.corners.nx_ny_nz, this.corners.nx_py_nz, this.corners.px_py_nz, this.corners.px_ny_nz]),
      this.r.makePolygon([this.corners.px_ny_nz, this.corners.px_py_nz, this.corners.px_py_pz, this.corners.px_ny_pz]),
      this.r.makePolygon([this.corners.px_ny_pz, this.corners.px_py_pz, this.corners.nx_py_pz, this.corners.nx_ny_pz]),
      this.r.makePolygon([this.corners.nx_ny_pz, this.corners.nx_py_pz, this.corners.nx_py_nz, this.corners.nx_ny_nz]),
      ...this.extraFaces.map((points) => this.r.makePolygon(points)),
    ];
    return this.r.makeSolid(faces);
  }
}

function canUseBrepKernel(r) {
  return (
    typeof r?.setOC === "function" &&
    typeof r?.makeBox === "function" &&
    typeof r?.makePolygon === "function"
  );
}

function pushPullFaceOnShape(r, shape, operation) {
  return pushPullFace(r, shape, operation);
}

function moveBoxFaceWithBooleans(r, shape, min, max, operation) {
  const delta = normalizeDelta(operation?.delta);
  const normal = normalizeVector(operation?.faceNormalWorld ?? axisFromFaceIdentity(operation));
  const normalDistance = dot(delta, normal);
  let nextShape = shape;
  const extents = { min: [...min], max: [...max] };
  const faceAxis = AXES.includes(operation?.faceAxis) ? operation.faceAxis : dominantAxis(normal);
  const faceSign = Math.sign(operation?.faceSign ?? normal[faceAxis] ?? 1) || 1;

  if (Math.abs(normalDistance) > 1e-8) {
    nextShape = pushPullFaceOnShape(r, nextShape, {
      ...operation,
      axis: normal,
      distance: normalDistance,
      mode: "move",
    });
    moveSelectedFaceExtent(extents, faceAxis, faceSign, normalDistance);
  }

  for (const tangentAxis of AXES.filter((axis) => axis !== faceAxis)) {
    const distance = delta[tangentAxis] ?? 0;
    if (Math.abs(distance) < 1e-8) {
      continue;
    }

    const { addTool, cutTool } = makeFaceMoveWedgeTools(r, extents.min, extents.max, operation, tangentAxis, distance);
    nextShape = nextShape.fuse(addTool).cut(cutTool);
    expandExtentForTangentialMove(extents, tangentAxis, distance);
  }

  return nextShape;
}

function moveSelectedFaceExtent(extents, faceAxis, faceSign, distance) {
  const index = axisIndex(faceAxis);
  if (faceSign > 0) {
    extents.max[index] += distance;
  } else {
    extents.min[index] -= distance;
  }
}

function expandExtentForTangentialMove(extents, tangentAxis, distance) {
  const index = axisIndex(tangentAxis);
  if (distance > 0) {
    extents.max[index] += distance;
  } else {
    extents.min[index] += distance;
  }
}

function makeFaceMoveWedgeTools(r, min, max, operation, tangentAxis, distance) {
  const normal = normalizeVector(operation?.faceNormalWorld ?? axisFromFaceIdentity(operation));
  const faceAxis = AXES.includes(operation?.faceAxis) ? operation.faceAxis : dominantAxis(normal);
  const spanAxis = AXES.find((axis) => axis !== faceAxis && axis !== tangentAxis);
  const faceSign = Math.sign(operation?.faceSign ?? normal[faceAxis] ?? 1) || 1;
  const sideSign = Math.sign(distance) || 1;
  const addTool = makeShearWedgeTool(r, min, max, {
    faceAxis,
    tangentAxis,
    spanAxis,
    faceSign,
    sideSign,
    distance,
  });
  const cutTool = makeShearWedgeTool(r, min, max, {
    faceAxis,
    tangentAxis,
    spanAxis,
    faceSign,
    sideSign: -sideSign,
    distance,
  });

  return { addTool, cutTool };
}

function makeShearWedgeTool(r, min, max, { faceAxis, tangentAxis, spanAxis, faceSign, sideSign, distance }) {
  const faceIndex = axisIndex(faceAxis);
  const tangentIndex = axisIndex(tangentAxis);
  const spanIndex = axisIndex(spanAxis);
  const targetFaceCoord = faceSign > 0 ? max[faceIndex] : min[faceIndex];
  const fixedFaceCoord = faceSign > 0 ? min[faceIndex] : max[faceIndex];
  const sideCoord = sideSign > 0 ? max[tangentIndex] : min[tangentIndex];
  const spanStart = min[spanIndex];
  const spanDistance = max[spanIndex] - min[spanIndex];
  const p1 = pointFromAxisValues(faceIndex, fixedFaceCoord, tangentIndex, sideCoord, spanIndex, spanStart);
  const p2 = pointFromAxisValues(faceIndex, targetFaceCoord, tangentIndex, sideCoord + distance, spanIndex, spanStart);
  const p3 = pointFromAxisValues(faceIndex, targetFaceCoord, tangentIndex, sideCoord, spanIndex, spanStart);
  const face = r.makePolygon([p1, p2, p3]);
  const extrusion = [0, 0, 0];
  extrusion[spanIndex] = spanDistance;
  return basicFaceExtrusion(face, new Vector(extrusion));
}

function pointFromAxisValues(firstIndex, firstValue, secondIndex, secondValue, thirdIndex, thirdValue) {
  const point = [0, 0, 0];
  point[firstIndex] = firstValue;
  point[secondIndex] = secondValue;
  point[thirdIndex] = thirdValue;
  return point;
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

function subshapeCornerKeys(corners, operation) {
  if (operation?.mode === "face") {
    return faceCornerKeys(corners, operation, operation?.faceNormalWorld ?? operation?.axis);
  }

  if (operation?.mode === "edge") {
    const keys = Array.isArray(operation.edge?.keys) ? operation.edge.keys.filter((key) => corners[key]) : [];
    if (keys.length > 0) {
      return keys;
    }
    return [cornerKeyFromPoint(operation.edge?.a), cornerKeyFromPoint(operation.edge?.b)].filter((key) => corners[key]);
  }

  if (operation?.mode === "vertex") {
    const key = typeof operation.vertex?.key === "string" ? operation.vertex.key : cornerKeyFromPoint(operation.vertex);
    return corners[key] ? [key] : [];
  }

  return [];
}

function faceCornerKeys(corners, operation, axisInput) {
  const axis = normalizeVector(axisInput ?? axisFromFaceIdentity(operation));
  const faceAxis = AXES.includes(operation?.faceAxis) ? operation.faceAxis : dominantAxis(axis);
  const faceSign = Math.sign(operation?.faceSign ?? axis[faceAxis] ?? 1) || 1;
  const prefix = faceSign > 0 ? `p${faceAxis}` : `n${faceAxis}`;
  return Object.keys(corners).filter((key) => key.split("_").includes(prefix));
}

function faceLoop(corners, operation, axisInput) {
  const axis = normalizeVector(axisInput ?? axisFromFaceIdentity(operation));
  const faceAxis = AXES.includes(operation?.faceAxis) ? operation.faceAxis : dominantAxis(axis);
  const faceSign = Math.sign(operation?.faceSign ?? axis[faceAxis] ?? 1) || 1;

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

function cornerKeyFromPoint(point) {
  if (!point) {
    return null;
  }
  const sx = (point.x ?? 0) >= 0 ? "px" : "nx";
  const sy = (point.y ?? 0) >= 0 ? "py" : "ny";
  const sz = (point.z ?? 0) >= 0 ? "pz" : "nz";
  return `${sx}_${sy}_${sz}`;
}

function getFaces(shape) {
  const faces = typeof shape?.faces === "function" ? shape.faces() : shape?.faces;
  return Array.isArray(faces) ? faces : [];
}

function selectFaceForOperation(faces, operation) {
  if (!Array.isArray(faces) || faces.length === 0) {
    return null;
  }

  const axis = normalizeVector(operation?.axis ?? axisFromFaceIdentity(operation));
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
  const faceAxis = AXES.includes(operation?.faceAxis)
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

function axisFromFaceIdentity(operation) {
  const faceAxis = AXES.includes(operation?.faceAxis) ? operation.faceAxis : "z";
  const faceSign = Math.sign(operation?.faceSign ?? 1) || 1;
  return {
    x: faceAxis === "x" ? faceSign : 0,
    y: faceAxis === "y" ? faceSign : 0,
    z: faceAxis === "z" ? faceSign : 0,
  };
}

function normalizeFaceOperation(operation) {
  const axis = normalizeVector(operation?.axis ?? axisFromFaceIdentity(operation));
  const faceAxis = AXES.includes(operation?.faceAxis) ? operation.faceAxis : dominantAxis(axis);
  return {
    faceIndex: Number.isInteger(operation?.faceIndex) ? operation.faceIndex : null,
    faceNormalWorld: operation?.faceNormalWorld ?? axis,
    axis,
    distance: operation?.distance ?? 0,
    faceAxis,
    faceSign: Math.sign(operation?.faceSign ?? axis[faceAxis] ?? 1) || 1,
    mode: operation?.mode === "extend" ? "extend" : "move",
  };
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

function normalizeVector(vector) {
  const length = Math.hypot(vector?.x ?? 0, vector?.y ?? 0, vector?.z ?? 0);
  if (length < 1e-8) {
    return { x: 0, y: 0, z: 1 };
  }
  return { x: (vector.x ?? 0) / length, y: (vector.y ?? 0) / length, z: (vector.z ?? 0) / length };
}

function normalizeDelta(delta) {
  if (Array.isArray(delta)) {
    return { x: delta[0] ?? 0, y: delta[1] ?? 0, z: delta[2] ?? 0 };
  }
  return { x: delta?.x ?? 0, y: delta?.y ?? 0, z: delta?.z ?? 0 };
}

function dot(a, b) {
  return (a.x ?? 0) * (b.x ?? 0) + (a.y ?? 0) * (b.y ?? 0) + (a.z ?? 0) * (b.z ?? 0);
}

function deltaArray(delta) {
  const normalized = normalizeDelta(delta);
  return [normalized.x, normalized.y, normalized.z];
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
