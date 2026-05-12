import * as THREE from "three";

const SPLIT_EDGE_OVERLAY_NAME = "3dsai-split-edge-overlay";

function createGeometryForState(state) {
  let geometry;
  switch (state.primitive) {
    case "brep_mesh":
      geometry = createGeometryFromBrepMesh(state.meshData);
      break;
    case "box":
    default:
      geometry = new THREE.BoxGeometry(1, 1, 1);
      break;
  }
  return geometry;
}

function createGeometryFromBrepMesh(meshData) {
  if (!meshData) {
    return new THREE.BufferGeometry();
  }

  const vertices = meshData.vertices ?? meshData.positions ?? [];
  const normals = meshData.normals ?? [];
  const triangles = meshData.triangles ?? meshData.indices ?? [];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices), 3));
  if (normals.length > 0) {
    geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
  }
  geometry.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(triangles), 1));
  if (normals.length === 0) {
    geometry.computeVertexNormals();
  }
  applyGeometryUserData(geometry, meshData);
  return geometry;
}

function createMeshForState(state) {
  const geometry = createGeometryForState(state);
  const material = new THREE.MeshStandardMaterial({ color: 0x7aa2f7, roughness: 0.4, metalness: 0.1 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.geometrySignature = geometrySignature(state);
  mesh.userData.meshKind = meshKindForState(state);
  mesh.userData.baseColor = 0x7aa2f7;
  return mesh;
}

function updateMeshGeometry(mesh, state) {
  const signature = geometrySignature(state);
  if (mesh.userData.geometrySignature === signature) {
    if (state.primitive === "brep_mesh") {
      applyGeometryUserData(mesh.geometry, state.meshData);
    }
    return;
  }
  mesh.geometry.dispose();
  mesh.geometry = createGeometryForState(state);
  mesh.userData.geometrySignature = signature;
}

function applyGeometryUserData(geometry, meshData) {
  geometry.userData.faceProvenance = cloneFaceProvenance(meshData?.faceProvenance);
  geometry.userData.faceGroups = cloneFaceGroups(meshData?.faceGroups);
  geometry.userData.renderEdges = cloneRenderEdges(meshData?.renderEdges);
  geometry.userData.featureSpaceOrigin = meshData?.featureSpaceOrigin ? { ...meshData.featureSpaceOrigin } : null;
}

function geometrySignature(state) {
  return JSON.stringify({
    primitive: state.primitive,
    meshSignature: state.meshSignature ?? null,
  });
}

function meshKindForState(state) {
  return state?.primitive ?? "mesh";
}

function selectableObjectIdForState(objectId, state) {
  return objectId;
}

function applyTransform(mesh, state) {
  mesh.position.set(state.position.x, state.position.y, state.position.z);
  mesh.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
  mesh.scale.set(state.scale.x, state.scale.y, state.scale.z);
}

function previewSubshapeMoveMeshData(meshData, operation) {
  if (!meshData) {
    return null;
  }

  const vertices = [...(meshData.vertices ?? meshData.positions ?? [])];
  const triangles = [...(meshData.triangles ?? meshData.indices ?? [])];
  if (vertices.length === 0) {
    return null;
  }

  const move = operation.params?.subshapeMove;
  const delta = operation.params?.delta ?? move?.delta;
  if (!move || !delta) {
    return null;
  }

  const selectedVertices = selectedSubshapeMoveVertexIndices({
    vertices,
    triangles,
    faceGroups: meshData.faceGroups ?? [],
    faceProvenance: meshData.faceProvenance ?? [],
    operation,
    move,
  });
  if (selectedVertices.size === 0) {
    return null;
  }

  for (const index of selectedVertices) {
    const offset = index * 3;
    vertices[offset + 0] += delta.x ?? 0;
    vertices[offset + 1] += delta.y ?? 0;
    vertices[offset + 2] += delta.z ?? 0;
  }

  return {
    ...meshData,
    vertices,
    triangles,
    normals: [],
    faceGroups: cloneFaceGroups(meshData.faceGroups),
  };
}

function previewFaceRotateMeshData(meshData, operation) {
  if (!meshData) {
    return null;
  }

  const vertices = [...(meshData.vertices ?? meshData.positions ?? [])];
  const triangles = [...(meshData.triangles ?? meshData.indices ?? [])];
  if (vertices.length === 0) {
    return null;
  }

  const faceTilts = faceTiltsFromParams(operation.params);
  if (faceTilts.length === 0) {
    return null;
  }

  let changed = false;
  changed = applyFaceTiltsToVertices(vertices, faceTilts, {
    triangles,
    faceProvenance: meshData.faceProvenance ?? [],
    selector: operation.selection?.selector ?? null,
  });
  if (!changed) {
    return null;
  }

  return {
    ...meshData,
    vertices,
    triangles,
    normals: [],
    faceGroups: cloneFaceGroups(meshData.faceGroups),
  };
}

function previewSubshapeRotateMeshData(meshData, operation) {
  if (!meshData) {
    return null;
  }

  const vertices = [...(meshData.vertices ?? meshData.positions ?? [])];
  const triangles = [...(meshData.triangles ?? meshData.indices ?? [])];
  if (vertices.length === 0) {
    return null;
  }

  const rotate = operation.params?.subshapeRotate;
  const angle = rotate?.angle ?? 0;
  if (!rotate || !Number.isFinite(angle) || Math.abs(angle) < 1e-8) {
    return null;
  }

  const selectedVertices = selectedSubshapeMoveVertexIndices({
    vertices,
    triangles,
    faceGroups: meshData.faceGroups ?? [],
    faceProvenance: meshData.faceProvenance ?? [],
    operation,
    move: rotate,
  });
  if (selectedVertices.size === 0) {
    return null;
  }

  const axis = normalizeVector(rotate.axis ?? { x: 0, y: 1, z: 0 });
  const origin = rotate.origin ?? selectedVertexCenter(vertices, selectedVertices);
  for (const vertexIndex of selectedVertices) {
    rotateVertexInPlace(vertices, vertexIndex, angle, origin, axis);
  }

  return {
    ...meshData,
    vertices,
    triangles,
    normals: [],
    faceGroups: cloneFaceGroups(meshData.faceGroups),
  };
}

function faceTiltsFromParams(params) {
  return Array.isArray(params?.faceTilts) && params.faceTilts.length > 0
    ? params.faceTilts
    : [params?.faceTilt].filter(Boolean);
}

function applyFaceTiltsToVertices(vertices, tilts, { triangles = [], faceProvenance = [], selector = null } = {}) {
  const validTilts = (Array.isArray(tilts) ? tilts : [])
    .filter((tilt) => (
      ["x", "y", "z"].includes(tilt?.faceAxis) &&
      ["x", "y", "z"].includes(tilt?.hingeSideAxis) &&
      Number.isFinite(tilt?.angle) &&
      Math.abs(tilt.angle) >= 1e-8
    ));
  if (validTilts.length === 0) {
    return false;
  }

  const tolerance = meshTolerance(vertices);
  const source = [...vertices];
  const deltas = new Array(vertices.length).fill(0);
  let changed = false;

  for (const tilt of validTilts) {
    const normal = tiltNormalVector(tilt);
    const side = tiltSideVector(tilt, normal);
    const selectedVertices = selectedTiltVertexIndices({
      vertices: source,
      triangles,
      faceProvenance,
      selector,
      tilt,
      tolerance,
    });
    if (selectedVertices.size === 0) {
      continue;
    }

    const sideValues = [...selectedVertices].map((vertexIndex) => vertexDot(source, vertexIndex, side));
    const sideCenter = (Math.min(...sideValues) + Math.max(...sideValues)) / 2;
    const slope = Math.tan(tilt.angle);

    for (const vertexIndex of selectedVertices) {
      const offset = vertexIndex * 3;
      const displacement = slope * (vertexDot(source, vertexIndex, side) - sideCenter);
      deltas[offset + 0] += normal.x * displacement;
      deltas[offset + 1] += normal.y * displacement;
      deltas[offset + 2] += normal.z * displacement;
    }
  }

  for (let index = 0; index < vertices.length; index += 1) {
    if (Math.abs(deltas[index]) > 1e-8) {
      vertices[index] = source[index] + deltas[index];
      changed = true;
    }
  }

  return changed;
}

function selectedTiltVertexIndices({ vertices, triangles, faceProvenance, selector, tilt, tolerance }) {
  const bySelector = selectedVerticesFromSelector({ vertices, triangles, faceProvenance, selector });
  if (bySelector.size > 0) {
    return bySelector;
  }

  const normal = tiltNormalVector(tilt);
  const bounds = meshBounds(vertices);
  const corners = boxCornerPoints(bounds);
  const faceCoordinate = Math.max(...corners.map((corner) => dotVector(corner, normal)));
  const selected = new Set();
  for (let vertexIndex = 0; vertexIndex < vertices.length / 3; vertexIndex += 1) {
    if (Math.abs(vertexDot(vertices, vertexIndex, normal) - faceCoordinate) <= tolerance) {
      selected.add(vertexIndex);
    }
  }
  return selected;
}

function tiltNormalVector(tilt) {
  return normalizeVector(tilt?.faceNormal ?? axisFromTiltFace(tilt));
}

function tiltSideVector(tilt, normal) {
  const explicit = normalizeVectorOrNull(tilt?.hingeSideVector);
  if (explicit) {
    return explicit;
  }
  const side = projectOntoPlane(axisUnit(tilt?.hingeSideAxis), normal);
  return normalizeVectorOrNull(side) ?? fallbackPerpendicular(normal);
}

function axisFromTiltFace(tilt) {
  const faceAxis = ["x", "y", "z"].includes(tilt?.faceAxis) ? tilt.faceAxis : "z";
  const faceSign = Math.sign(tilt?.faceSign ?? 1) || 1;
  return {
    x: faceAxis === "x" ? faceSign : 0,
    y: faceAxis === "y" ? faceSign : 0,
    z: faceAxis === "z" ? faceSign : 0,
  };
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

function vertexDot(vertices, vertexIndex, vector) {
  const offset = vertexIndex * 3;
  return (
    (vertices[offset + 0] ?? 0) * vector.x +
    (vertices[offset + 1] ?? 0) * vector.y +
    (vertices[offset + 2] ?? 0) * vector.z
  );
}

function dotVector(a, b) {
  return (a.x ?? 0) * (b.x ?? 0) + (a.y ?? 0) * (b.y ?? 0) + (a.z ?? 0) * (b.z ?? 0);
}

function boxCornerPoints(bounds) {
  return [
    { x: bounds.minX, y: bounds.minY, z: bounds.minZ },
    { x: bounds.minX, y: bounds.minY, z: bounds.maxZ },
    { x: bounds.minX, y: bounds.maxY, z: bounds.minZ },
    { x: bounds.minX, y: bounds.maxY, z: bounds.maxZ },
    { x: bounds.maxX, y: bounds.minY, z: bounds.minZ },
    { x: bounds.maxX, y: bounds.minY, z: bounds.maxZ },
    { x: bounds.maxX, y: bounds.maxY, z: bounds.minZ },
    { x: bounds.maxX, y: bounds.maxY, z: bounds.maxZ },
  ];
}

function selectedSubshapeMoveVertexIndices({ vertices, triangles, faceGroups, faceProvenance, operation, move }) {
  if (move.mode === "face") {
    const axis = normalizeVector(
      move.faceNormalWorld ??
      operation.selection?.faceNormalWorld ??
      axisFromMoveIdentity(move),
    );
    return selectedPushPullVertexIndices({
      vertices,
      triangles,
      faceGroups,
      faceProvenance,
      selector: operation.selection?.selector ?? null,
      faceIndex: operation.selection?.faceIndex ?? move.faceIndex ?? null,
      axis,
    });
  }

  if (move.mode === "edge") {
    const selected = new Set();
    addMatchingVertexIndices(selected, vertices, move.edge?.a);
    addMatchingVertexIndices(selected, vertices, move.edge?.b);
    if (selected.size > 0) {
      return selected;
    }
    return selectedVerticesFromCornerKeys(vertices, move.edge?.keys);
  }

  if (move.mode === "vertex") {
    const selected = new Set();
    addMatchingVertexIndices(selected, vertices, move.vertex);
    if (selected.size > 0) {
      return selected;
    }
    return selectedVerticesFromCornerKeys(vertices, [move.vertex?.key]);
  }

  return new Set();
}

function selectedPushPullVertexIndices({ vertices, triangles, faceGroups, faceProvenance, selector, faceIndex, axis }) {
  const bySelector = selectedVerticesFromSelector({ vertices, triangles, faceProvenance, selector });
  if (bySelector.size > 0) {
    return bySelector;
  }

  const byTrianglePlane = selectedVerticesFromTrianglePlane({ vertices, triangles, faceIndex, axis });
  if (byTrianglePlane.size > 0) {
    return byTrianglePlane;
  }

  const byGroup = selectedVerticesFromFaceGroup({ triangles, faceGroups, faceIndex });
  if (byGroup.size > 0) {
    return byGroup;
  }

  return selectedVerticesFromExtremePlane({ vertices, axis });
}

function selectedVerticesFromSelector({ vertices, triangles, faceProvenance, selector }) {
  const selected = new Set();
  if (!selector?.role || !Array.isArray(faceProvenance)) {
    return selected;
  }

  for (let triangleIndex = 0; triangleIndex < faceProvenance.length; triangleIndex += 1) {
    const provenance = faceProvenance[triangleIndex];
    if (!provenance || provenance.role !== selector.role) {
      continue;
    }
    if (selector.featureId && provenance.featureId !== selector.featureId) {
      continue;
    }
    if (selector.sketchId && provenance.sketchId !== selector.sketchId) {
      continue;
    }
    addTriangleVertices(selected, triangles, triangleIndex);
  }

  if (selected.size > 0 || !selector.featureId) {
    return expandSelectedByCoincidentVertices(vertices, selected);
  }

  for (let triangleIndex = 0; triangleIndex < faceProvenance.length; triangleIndex += 1) {
    const provenance = faceProvenance[triangleIndex];
    if (provenance?.role === selector.role) {
      addTriangleVertices(selected, triangles, triangleIndex);
    }
  }
  return expandSelectedByCoincidentVertices(vertices, selected);
}

function expandSelectedByCoincidentVertices(vertices, selected) {
  if (selected.size === 0) {
    return selected;
  }

  const expanded = new Set(selected);
  const tolerance = meshTolerance(vertices);
  const selectedPoints = [...selected].map((vertexIndex) => vertexPoint(vertices, vertexIndex));
  for (let vertexIndex = 0; vertexIndex < vertices.length / 3; vertexIndex += 1) {
    const point = vertexPoint(vertices, vertexIndex);
    if (selectedPoints.some((selectedPoint) => pointsNear(point, selectedPoint, tolerance))) {
      expanded.add(vertexIndex);
    }
  }
  return expanded;
}

function vertexPoint(vertices, vertexIndex) {
  const offset = vertexIndex * 3;
  return {
    x: vertices[offset + 0] ?? 0,
    y: vertices[offset + 1] ?? 0,
    z: vertices[offset + 2] ?? 0,
  };
}

function selectedVertexCenter(vertices, selectedVertices) {
  const selected = [...selectedVertices];
  if (selected.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  const sum = selected.reduce((accumulator, vertexIndex) => {
    const point = vertexPoint(vertices, vertexIndex);
    accumulator.x += point.x;
    accumulator.y += point.y;
    accumulator.z += point.z;
    return accumulator;
  }, { x: 0, y: 0, z: 0 });
  return {
    x: sum.x / selected.length,
    y: sum.y / selected.length,
    z: sum.z / selected.length,
  };
}

function rotateVertexInPlace(vertices, vertexIndex, angle, origin, axis) {
  const offset = vertexIndex * 3;
  const x = (vertices[offset + 0] ?? 0) - (origin.x ?? 0);
  const y = (vertices[offset + 1] ?? 0) - (origin.y ?? 0);
  const z = (vertices[offset + 2] ?? 0) - (origin.z ?? 0);
  const u = axis.x ?? 0;
  const v = axis.y ?? 0;
  const w = axis.z ?? 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const projection = u * x + v * y + w * z;

  vertices[offset + 0] = (origin.x ?? 0) + u * projection * (1 - cos) + x * cos + (-w * y + v * z) * sin;
  vertices[offset + 1] = (origin.y ?? 0) + v * projection * (1 - cos) + y * cos + (w * x - u * z) * sin;
  vertices[offset + 2] = (origin.z ?? 0) + w * projection * (1 - cos) + z * cos + (-v * x + u * y) * sin;
}

function pointsNear(a, b, tolerance) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= tolerance;
}

function addTriangleVertices(selected, triangles, triangleIndex) {
  const base = triangleIndex * 3;
  for (let index = base; index < base + 3 && index < triangles.length; index += 1) {
    selected.add(triangles[index]);
  }
}

function selectedVerticesFromCornerKeys(vertices, keys) {
  const selected = new Set();
  if (!Array.isArray(keys) || keys.length === 0) {
    return selected;
  }

  const bounds = meshBounds(vertices);
  const tolerance = meshTolerance(vertices);
  for (const key of keys) {
    const target = cornerPointFromKey(bounds, key);
    if (!target) {
      continue;
    }
    addMatchingVertexIndices(selected, vertices, target, tolerance);
  }
  return selected;
}

function addMatchingVertexIndices(selected, vertices, point, tolerance = meshTolerance(vertices)) {
  if (!point) {
    return;
  }

  const x = point.x ?? 0;
  const y = point.y ?? 0;
  const z = point.z ?? 0;
  for (let vertexIndex = 0; vertexIndex < vertices.length / 3; vertexIndex += 1) {
    const offset = vertexIndex * 3;
    const distance = Math.hypot(
      vertices[offset + 0] - x,
      vertices[offset + 1] - y,
      vertices[offset + 2] - z,
    );
    if (distance <= tolerance) {
      selected.add(vertexIndex);
    }
  }
}

function cornerPointFromKey(bounds, key) {
  if (typeof key !== "string") {
    return null;
  }
  const parts = key.split("_");
  if (parts.length !== 3) {
    return null;
  }
  return {
    x: parts[0] === "px" ? bounds.maxX : bounds.minX,
    y: parts[1] === "py" ? bounds.maxY : bounds.minY,
    z: parts[2] === "pz" ? bounds.maxZ : bounds.minZ,
  };
}

function selectedVerticesFromFaceGroup({ triangles, faceGroups, faceIndex }) {
  const selected = new Set();
  if (!Number.isInteger(faceIndex) || faceIndex < 0 || !Array.isArray(faceGroups)) {
    return selected;
  }

  const triangleOffset = faceIndex * 3;
  const group = faceGroups.find((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return false;
    }
    const start = candidate.start ?? 0;
    const count = candidate.count ?? 0;
    return triangleOffset >= start && triangleOffset < start + count;
  });

  if (!group) {
    return selected;
  }

  const start = group.start ?? 0;
  const count = group.count ?? 0;
  const endIndex = Math.min(triangles.length, start + count);
  for (let index = start; index < endIndex; index += 1) {
    selected.add(triangles[index]);
  }
  return selected;
}

function selectedVerticesFromTrianglePlane({ vertices, triangles, faceIndex, axis }) {
  const selected = new Set();
  if (!Number.isInteger(faceIndex) || faceIndex < 0) {
    return selected;
  }

  const base = faceIndex * 3;
  if (base + 2 >= triangles.length) {
    return selected;
  }

  const planeProjection =
    (
      vertexProjection(vertices, triangles[base], axis) +
      vertexProjection(vertices, triangles[base + 1], axis) +
      vertexProjection(vertices, triangles[base + 2], axis)
    ) / 3;
  const tolerance = meshTolerance(vertices);

  for (let vertexIndex = 0; vertexIndex < vertices.length / 3; vertexIndex += 1) {
    if (Math.abs(vertexProjection(vertices, vertexIndex, axis) - planeProjection) <= tolerance) {
      selected.add(vertexIndex);
    }
  }

  return selected;
}

function selectedVerticesFromExtremePlane({ vertices, axis }) {
  const selected = new Set();
  let maxProjection = -Infinity;
  for (let vertexIndex = 0; vertexIndex < vertices.length / 3; vertexIndex += 1) {
    maxProjection = Math.max(maxProjection, vertexProjection(vertices, vertexIndex, axis));
  }

  const tolerance = meshTolerance(vertices);
  for (let vertexIndex = 0; vertexIndex < vertices.length / 3; vertexIndex += 1) {
    if (Math.abs(vertexProjection(vertices, vertexIndex, axis) - maxProjection) <= tolerance) {
      selected.add(vertexIndex);
    }
  }

  return selected;
}

function vertexProjection(vertices, vertexIndex, axis) {
  const offset = vertexIndex * 3;
  return vertices[offset + 0] * axis.x + vertices[offset + 1] * axis.y + vertices[offset + 2] * axis.z;
}

function meshTolerance(vertices) {
  const bounds = meshBounds(vertices);
  const diagonal = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ);
  return Math.max(diagonal * 1e-4, 1e-5);
}

function meshBounds(vertices) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let offset = 0; offset < vertices.length; offset += 3) {
    minX = Math.min(minX, vertices[offset + 0]);
    minY = Math.min(minY, vertices[offset + 1]);
    minZ = Math.min(minZ, vertices[offset + 2]);
    maxX = Math.max(maxX, vertices[offset + 0]);
    maxY = Math.max(maxY, vertices[offset + 1]);
    maxZ = Math.max(maxZ, vertices[offset + 2]);
  }

  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function axisIndex(axis) {
  return axis === "x" ? 0 : axis === "y" ? 1 : 2;
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x ?? 0, vector.y ?? 0, vector.z ?? 0);
  if (length < 1e-8) {
    return { x: 0, y: 0, z: 1 };
  }
  return {
    x: (vector.x ?? 0) / length,
    y: (vector.y ?? 0) / length,
    z: (vector.z ?? 0) / length,
  };
}

function normalizeVectorOrNull(vector) {
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

function cloneFaceGroups(faceGroups) {
  return Array.isArray(faceGroups) ? faceGroups.map((group) => ({ ...group })) : [];
}

function cloneFaceProvenance(faceProvenance) {
  return Array.isArray(faceProvenance)
    ? faceProvenance.map((provenance) => (provenance ? structuredClone(provenance) : null))
    : [];
}

function cloneRenderEdges(renderEdges) {
  return Array.isArray(renderEdges) ? renderEdges.map((edge) => structuredClone(edge)) : [];
}

function axisFromMoveIdentity(move) {
  const faceAxis = ["x", "y", "z"].includes(move?.faceAxis) ? move.faceAxis : "z";
  const faceSign = Math.sign(move?.faceSign ?? 1) || 1;
  return {
    x: faceAxis === "x" ? faceSign : 0,
    y: faceAxis === "y" ? faceSign : 0,
    z: faceAxis === "z" ? faceSign : 0,
  };
}



export class RepresentationStore {
  constructor() {
    this.scene = null;
    this.meshById = new Map();
    this.exactSceneState = {};
    this.previewOperation = null;
    this.objectColorHex = 0x7aa2f7;
  }

  setObjectColorHex(hex) {
    if (typeof hex !== "number" || !Number.isFinite(hex)) {
      return;
    }
    this.objectColorHex = Math.max(0, Math.min(0xffffff, Math.floor(hex)));
  }

  bindScene(scene) {
    this.scene = scene;
  }

  setInitialSceneState(sceneState) {
    this.exactSceneState = structuredClone(sceneState);
    this.applyExactStateToScene();
  }

  addObject(objectId, objectState) {
    this.exactSceneState[objectId] = structuredClone(objectState);
    this.applyExactStateToScene();
  }

  setPreviewOperation(operation) {
    this.previewOperation = structuredClone(operation);
    this.applyPreviewToScene();
  }

  setPreviewExactRepresentation(exactRepresentation) {
    this.previewOperation = null;
    this._applySceneStateToScene(structuredClone(exactRepresentation?.sceneState ?? {}));
  }

  clearPreview() {
    this.previewOperation = null;
    this.applyExactStateToScene();
  }

  replaceWithExact(exactRepresentation) {
    this.previewOperation = null;
    this.exactSceneState = structuredClone(exactRepresentation.sceneState);
    this.applyExactStateToScene();
  }

  getExactSceneState() {
    return structuredClone(this.exactSceneState);
  }

  snapshot() {
    return {
      previewOperation: this.previewOperation ? structuredClone(this.previewOperation) : null,
      exactSceneState: this.getExactSceneState(),
    };
  }

  applyExactStateToScene() {
    this._applySceneStateToScene(this.exactSceneState);
  }

  _applySceneStateToScene(sceneState) {
    if (!this.scene) {
      return;
    }

    const liveIds = new Set(Object.keys(sceneState));
    for (const [objectId, mesh] of this.meshById.entries()) {
      if (!liveIds.has(objectId)) {
        this.scene.remove(mesh);
        this.meshById.delete(objectId);
      }
    }

    for (const [objectId, state] of Object.entries(sceneState)) {
      let mesh = this.meshById.get(objectId);
      if (mesh && mesh.userData.meshKind !== meshKindForState(state)) {
        this.scene.remove(mesh);
        mesh.geometry?.dispose?.();
        mesh.material?.dispose?.();
        this.meshById.delete(objectId);
        mesh = null;
      }
      if (!mesh) {
        mesh = createMeshForState(state);
        this.meshById.set(objectId, mesh);
        this.scene.add(mesh);
      }
      mesh.userData.objectId = selectableObjectIdForState(objectId, state);
      mesh.userData.sourceObjectId = objectId;
      mesh.userData.profile = null;
      updateMeshGeometry(mesh, state);
      updateSplitEdgeOverlay(mesh, state);
      applyTransform(mesh, state);
      mesh.castShadow = state.primitive === "brep_mesh";
      mesh.receiveShadow = state.primitive === "brep_mesh";
      mesh.userData.baseColor = this.objectColorHex;
      mesh.material.color?.setHex(mesh.userData.baseColor);
    }
  }

  applyPreviewToScene() {
    if (!this.previewOperation) {
      this.applyExactStateToScene();
      return;
    }

    const { type, targetId, params } = this.previewOperation;

    this.applyExactStateToScene();
    const mesh = targetId ? this.meshById.get(targetId) : null;
    const exactState = targetId ? this.exactSceneState[targetId] : null;
    if (!mesh || !exactState) {
      return;
    }

    const previewState = structuredClone(exactState);
    const primitivePreview = params?.previewPrimitiveState;
    if (primitivePreview?.primitive === "box") {
      previewState.primitive = "box";
      previewState.position = {
        x: primitivePreview.position?.x ?? 0,
        y: primitivePreview.position?.y ?? 0,
        z: primitivePreview.position?.z ?? 0,
      };
      previewState.rotation = previewState.rotation ?? { x: 0, y: 0, z: 0 };
      previewState.scale = {
        x: Math.max(0.1, primitivePreview.size?.x ?? 1),
        y: Math.max(0.1, primitivePreview.size?.y ?? 1),
        z: Math.max(0.1, primitivePreview.size?.z ?? 1),
      };
      updateMeshGeometry(mesh, previewState);
      applyTransform(mesh, previewState);
      return;
    }

    if (type === "move") {
      if (!params?.subshapeMove) {
        previewState.position.x += params.delta.x;
        previewState.position.y += params.delta.y;
        previewState.position.z += params.delta.z;
        applyTransform(mesh, previewState);
        return;
      }

      if (previewState.primitive === "brep_mesh") {
        const meshData = previewSubshapeMoveMeshData(previewState.meshData, this.previewOperation);
        if (!meshData) {
          return;
        }
        previewState.meshData = meshData;
        previewState.meshSignature = [
          previewState.meshSignature ?? "mesh",
          "subshape-move",
          params.subshapeMove.mode ?? "subshape",
          params.delta?.x ?? 0,
          params.delta?.y ?? 0,
          params.delta?.z ?? 0,
        ].join(":");
        updateMeshGeometry(mesh, previewState);
        applyTransform(mesh, previewState);
        return;
      }
      return;
    }

    if (type === "scale") {
      previewState.scale.x *= Math.max(0.1, params.scaleFactor.x);
      previewState.scale.y *= Math.max(0.1, params.scaleFactor.y);
      previewState.scale.z *= Math.max(0.1, params.scaleFactor.z);
      applyTransform(mesh, previewState);
      return;
    }

    if (type === "rotate" && params?.subshapeRotate) {
      if (previewState.primitive !== "brep_mesh") {
        return;
      }
      const meshData = previewSubshapeRotateMeshData(previewState.meshData, this.previewOperation);
      if (!meshData) {
        return;
      }
      previewState.meshData = meshData;
      previewState.meshSignature = [
        previewState.meshSignature ?? "mesh",
        "subshape-rotate",
        params.subshapeRotate.mode ?? "subshape",
        params.subshapeRotate.angle ?? 0,
        params.subshapeRotate.axis?.x ?? 0,
        params.subshapeRotate.axis?.y ?? 0,
        params.subshapeRotate.axis?.z ?? 0,
      ].join(":");
      updateMeshGeometry(mesh, previewState);
      applyTransform(mesh, previewState);
      return;
    }

    const faceTilts = faceTiltsFromParams(params);
    if (type === "rotate" && this.previewOperation.selection?.mode === "face" && faceTilts.length > 0) {
      if (previewState.primitive !== "brep_mesh") {
        return;
      }
      const meshData = previewFaceRotateMeshData(previewState.meshData, this.previewOperation);
      if (!meshData) {
        return;
      }
      previewState.meshData = meshData;
      previewState.meshSignature = [
        previewState.meshSignature ?? "mesh",
        "face-rotate",
        ...faceTilts.flatMap((tilt) => [
          tilt?.faceAxis ?? "axis",
          tilt?.faceSign ?? 1,
          tilt?.hingeSideAxis ?? "side",
          tilt?.angle ?? 0,
        ]),
      ].join(":");
      updateMeshGeometry(mesh, previewState);
      applyTransform(mesh, previewState);
      return;
    }

    if (type === "rotate") {
      previewState.rotation.x += params.deltaEuler?.x ?? 0;
      previewState.rotation.y += params.deltaEuler?.y ?? 0;
      previewState.rotation.z += params.deltaEuler?.z ?? 0;
      applyTransform(mesh, previewState);
      return;
    }

    if (type !== "push_pull") {
      return;
    }

    void params;
  }

  getSelectableMeshes() {
    return [...this.meshById.values()].filter((object) => object.isMesh);
  }
}

function updateSplitEdgeOverlay(mesh, state) {
  const edges = state.primitive === "brep_mesh" ? state.meshData?.renderEdges ?? [] : [];
  let overlay = mesh.getObjectByName(SPLIT_EDGE_OVERLAY_NAME);
  if (!Array.isArray(edges) || edges.length === 0) {
    if (overlay) {
      mesh.remove(overlay);
      overlay.geometry?.dispose?.();
      overlay.material?.dispose?.();
    }
    return;
  }

  const vertices = [];
  for (const edge of edges) {
    const [a, b] = edge?.points ?? [];
    if (!a || !b) {
      continue;
    }
    vertices.push(a.x ?? 0, a.y ?? 0, a.z ?? 0, b.x ?? 0, b.y ?? 0, b.z ?? 0);
  }

  if (vertices.length === 0) {
    return;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices), 3));

  if (!overlay) {
    overlay = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0x143a5a,
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      }),
    );
    overlay.name = SPLIT_EDGE_OVERLAY_NAME;
    overlay.renderOrder = 80;
    overlay.frustumCulled = false;
    overlay.userData.renderOnly = true;
    mesh.add(overlay);
    return;
  }

  overlay.geometry.dispose();
  overlay.geometry = geometry;
}
