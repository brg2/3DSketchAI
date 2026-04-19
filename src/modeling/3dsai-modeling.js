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
  box.applyCenteredTapers(faceTilts);
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
  return shape.translate(deltaArray(delta));
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

  const result = distance > 0
    ? shape.fuse(tool, { optimisation: "sameFace" })
    : shape.cut(tool, { optimisation: "sameFace" });
  return simplifyBooleanResult(result);
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
    this.hiddenBaseFaces = new Set();
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

  rotate(angle, origin = [0, 0, 0], axis = [0, 1, 0]) {
    const normalizedAngle = Number.isFinite(angle) ? angle : 0;
    if (Math.abs(normalizedAngle) < 1e-8) {
      return this;
    }
    const normalizedOrigin = vectorArray(origin);
    const normalizedAxis = normalizeVector(arrayToVector(axis));
    this.brepOperations.push({
      type: "rotate",
      angle: normalizedAngle,
      origin: normalizedOrigin,
      axis: vectorArray(normalizedAxis),
    });

    for (const corner of Object.values(this.corners)) {
      rotatePointInPlace(corner, normalizedAngle, normalizedOrigin, normalizedAxis);
    }
    for (const face of this.extraFaces) {
      for (const point of face) {
        rotatePointInPlace(point, normalizedAngle, normalizedOrigin, normalizedAxis);
      }
    }
    this.refreshBoundsFromCorners();
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

    this.addFaceExtension({ ...operation, axis, distance }, { recordBrep: false });
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
    return this.applyCenteredTapers([tilt]);
  }

  applyCenteredTapers(tilts) {
    const validTilts = (Array.isArray(tilts) ? tilts : [])
      .filter((tilt) => (
        (AXES.includes(tilt?.faceAxis) || normalizeVectorOrNull(tilt?.faceNormal)) &&
        (AXES.includes(tilt?.hingeSideAxis) || normalizeVectorOrNull(tilt?.hingeSideVector)) &&
        Number.isFinite(tilt?.angle) &&
        Math.abs(tilt.angle) >= 1e-8
      ));
    if (validTilts.length === 0) {
      return this;
    }
    this.brepCompatible = false;

    if (validTilts.some((tilt) => tilt.faceNormal || tilt.hingeSideVector)) {
      for (const tilt of validTilts) {
        this.applyVectorCenteredTaper(tilt);
      }
      return this;
    }

    const sourceCorners = Object.fromEntries(
      Object.entries(this.corners).map(([key, point]) => [key, [...point]]),
    );
    const deltas = Object.fromEntries(
      Object.keys(this.corners).map((key) => [key, [0, 0, 0]]),
    );

    for (const tilt of validTilts) {
      const faceAxis = tilt.faceAxis;
      const faceSign = Math.sign(tilt.faceSign ?? 1) || 1;
      const sideAxis = tilt.hingeSideAxis;
      const faceIndex = axisIndex(faceAxis);
      const sideIndex = axisIndex(sideAxis);
      const faceCoordinate = faceSign > 0
        ? maxCoordinate(Object.values(sourceCorners), faceIndex)
        : minCoordinate(Object.values(sourceCorners), faceIndex);
      const sideCenter = (
        minCoordinate(Object.values(sourceCorners), sideIndex) +
        maxCoordinate(Object.values(sourceCorners), sideIndex)
      ) / 2;
      const slope = Math.tan(tilt.angle);

      for (const [key, source] of Object.entries(sourceCorners)) {
        if (Math.abs(source[faceIndex] - faceCoordinate) > 1e-6) {
          continue;
        }
        deltas[key][faceIndex] += faceSign * slope * (source[sideIndex] - sideCenter);
      }
    }

    for (const [key, delta] of Object.entries(deltas)) {
      const corner = this.corners[key];
      for (let index = 0; index < 3; index += 1) {
        corner[index] = sourceCorners[key][index] + delta[index];
      }
    }
    this.refreshBoundsFromCorners();
    return this;
  }

  applyVectorCenteredTaper(tilt) {
    const normal = normalizeVector(tilt.faceNormal ?? axisFromFaceIdentity(tilt));
    const side = tiltSideVector(tilt, normal);
    const sourceCorners = Object.fromEntries(
      Object.entries(this.corners).map(([key, point]) => [key, [...point]]),
    );
    const sourcePoints = Object.values(sourceCorners);
    const faceProjection = maxProjection(sourcePoints, normal);
    const tolerance = Math.max(boxDiagonal(sourcePoints) * 1e-6, 1e-6);
    const selectedKeys = Object.entries(sourceCorners)
      .filter(([, point]) => Math.abs(dotArray(point, normal) - faceProjection) <= tolerance)
      .map(([key]) => key);
    if (selectedKeys.length === 0) {
      return this;
    }

    const sideValues = selectedKeys.map((key) => dotArray(sourceCorners[key], side));
    const sideCenter = (Math.min(...sideValues) + Math.max(...sideValues)) / 2;
    const slope = Math.tan(tilt.angle);
    for (const key of selectedKeys) {
      const corner = this.corners[key];
      const source = sourceCorners[key];
      const displacement = slope * (dotArray(source, side) - sideCenter);
      corner[0] = source[0] + normal.x * displacement;
      corner[1] = source[1] + normal.y * displacement;
      corner[2] = source[2] + normal.z * displacement;
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

    this.hiddenBaseFaces.add(faceKeyFromOperation(operation, axis));
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
        shape = shape.translate(deltaArray(entry.delta));
      } else if (entry.type === "rotate") {
        if (typeof shape.rotate !== "function") {
          return null;
        }
        shape = shape.rotate(entry.angle, entry.origin, entry.axis);
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
    const faces = baseBoxFaces(this.corners)
      .filter((entry) => !this.hiddenBaseFaces.has(entry.key))
      .flatMap((entry) => this.makePolygonFaces(entry.points));
    faces.push(...this.extraFaces.flatMap((points) => this.makePolygonFaces(points)));
    return this.r.makeSolid(faces);
  }

  makePolygonFaces(points) {
    if (!Array.isArray(points) || points.length < 3) {
      return [];
    }
    if (points.length === 3 || pointsArePlanar(points)) {
      return [this.r.makePolygon(points)];
    }
    const faces = [];
    for (let index = 1; index < points.length - 1; index += 1) {
      faces.push(this.r.makePolygon([points[0], points[index], points[index + 1]]));
    }
    return faces;
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

function simplifyBooleanResult(shape) {
  if (!shape || typeof shape.simplify !== "function") {
    return shape;
  }
  try {
    return shape.simplify();
  } catch {
    return shape;
  }
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

function pointsArePlanar(points) {
  const origin = points[0];
  let normal = null;
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = subtractArray(points[i], origin);
    const b = subtractArray(points[i + 1], origin);
    const candidate = crossArray(a, b);
    if (lengthArray(candidate) > 1e-10) {
      normal = candidate;
      break;
    }
  }
  if (!normal) {
    return true;
  }
  const normalLength = lengthArray(normal);
  const tolerance = 1e-7;
  return points.every((point) => Math.abs(dotArrays(subtractArray(point, origin), normal)) / normalLength <= tolerance);
}

function subtractArray(a, b) {
  return [
    (a?.[0] ?? 0) - (b?.[0] ?? 0),
    (a?.[1] ?? 0) - (b?.[1] ?? 0),
    (a?.[2] ?? 0) - (b?.[2] ?? 0),
  ];
}

function crossArray(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function lengthArray(vector) {
  return Math.hypot(vector?.[0] ?? 0, vector?.[1] ?? 0, vector?.[2] ?? 0);
}

function dotArrays(a, b) {
  return (
    (a?.[0] ?? 0) * (b?.[0] ?? 0) +
    (a?.[1] ?? 0) * (b?.[1] ?? 0) +
    (a?.[2] ?? 0) * (b?.[2] ?? 0)
  );
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

function baseBoxFaces(corners) {
  return [
    { key: "y:-1", points: [corners.nx_ny_nz, corners.px_ny_nz, corners.px_ny_pz, corners.nx_ny_pz] },
    { key: "y:1", points: [corners.nx_py_nz, corners.nx_py_pz, corners.px_py_pz, corners.px_py_nz] },
    { key: "z:-1", points: [corners.nx_ny_nz, corners.nx_py_nz, corners.px_py_nz, corners.px_ny_nz] },
    { key: "x:1", points: [corners.px_ny_nz, corners.px_py_nz, corners.px_py_pz, corners.px_ny_pz] },
    { key: "z:1", points: [corners.px_ny_pz, corners.px_py_pz, corners.nx_py_pz, corners.nx_ny_pz] },
    { key: "x:-1", points: [corners.nx_ny_pz, corners.nx_py_pz, corners.nx_py_nz, corners.nx_ny_nz] },
  ];
}

function faceKeyFromOperation(operation, axisInput) {
  const axis = normalizeVector(axisInput ?? axisFromFaceIdentity(operation));
  const faceAxis = AXES.includes(operation?.faceAxis) ? operation.faceAxis : dominantAxis(axis);
  const faceSign = Math.sign(operation?.faceSign ?? axis[faceAxis] ?? 1) || 1;
  return `${faceAxis}:${faceSign}`;
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

function arrayToVector(value) {
  if (Array.isArray(value)) {
    return { x: value[0] ?? 0, y: value[1] ?? 0, z: value[2] ?? 0 };
  }
  return value ?? { x: 0, y: 1, z: 0 };
}

function vectorArray(value) {
  if (Array.isArray(value)) {
    return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
  }
  return [value?.x ?? 0, value?.y ?? 0, value?.z ?? 0];
}

function rotatePointInPlace(point, angle, origin, axis) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = point[0] - origin[0];
  const y = point[1] - origin[1];
  const z = point[2] - origin[2];
  const u = axis.x;
  const v = axis.y;
  const w = axis.z;
  const dot = u * x + v * y + w * z;

  point[0] = origin[0] + u * dot * (1 - cos) + x * cos + (-w * y + v * z) * sin;
  point[1] = origin[1] + v * dot * (1 - cos) + y * cos + (w * x - u * z) * sin;
  point[2] = origin[2] + w * dot * (1 - cos) + z * cos + (-v * x + u * y) * sin;
}

function normalizeVectorOrNull(vector) {
  if (!vector || typeof vector !== "object") {
    return null;
  }
  const length = Math.hypot(vector.x ?? 0, vector.y ?? 0, vector.z ?? 0);
  if (length < 1e-8) {
    return null;
  }
  return { x: (vector.x ?? 0) / length, y: (vector.y ?? 0) / length, z: (vector.z ?? 0) / length };
}

function tiltSideVector(tilt, normal) {
  const explicit = normalizeVectorOrNull(tilt?.hingeSideVector);
  if (explicit) {
    return explicit;
  }
  const projected = projectOntoPlane(axisUnit(tilt?.hingeSideAxis), normal);
  return normalizeVectorOrNull(projected) ?? fallbackPerpendicular(normal);
}

function axisUnit(axis) {
  return {
    x: axis === "x" ? 1 : 0,
    y: axis === "y" ? 1 : 0,
    z: axis === "z" ? 1 : 0,
  };
}

function projectOntoPlane(vector, normal) {
  const projection = dotVector(vector, normal);
  return {
    x: vector.x - normal.x * projection,
    y: vector.y - normal.y * projection,
    z: vector.z - normal.z * projection,
  };
}

function fallbackPerpendicular(normal) {
  const seed = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  return normalizeVector(projectOntoPlane(seed, normal));
}

function maxProjection(points, vector) {
  return Math.max(...points.map((point) => dotArray(point, vector)));
}

function dotArray(point, vector) {
  return (
    (point[0] ?? 0) * (vector.x ?? 0) +
    (point[1] ?? 0) * (vector.y ?? 0) +
    (point[2] ?? 0) * (vector.z ?? 0)
  );
}

function dotVector(a, b) {
  return (a.x ?? 0) * (b.x ?? 0) + (a.y ?? 0) * (b.y ?? 0) + (a.z ?? 0) * (b.z ?? 0);
}

function boxDiagonal(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let index = 0; index < 3; index += 1) {
      min[index] = Math.min(min[index], point[index] ?? 0);
      max[index] = Math.max(max[index], point[index] ?? 0);
    }
  }
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
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
