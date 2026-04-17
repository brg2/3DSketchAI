import * as THREE from "three";

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
  return geometry;
}

function createMeshForState(state) {
  const geometry = createGeometryForState(state);
  const material = new THREE.MeshStandardMaterial({ color: 0x7aa2f7, roughness: 0.4, metalness: 0.1 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.geometrySignature = geometrySignature(state);
  return mesh;
}

function updateMeshGeometry(mesh, state) {
  const signature = geometrySignature(state);
  if (mesh.userData.geometrySignature === signature) {
    return;
  }
  mesh.geometry.dispose();
  mesh.geometry = createGeometryForState(state);
  mesh.userData.geometrySignature = signature;
}

function geometrySignature(state) {
  return JSON.stringify({
    primitive: state.primitive,
    meshSignature: state.meshSignature ?? null,
  });
}

function applyTransform(mesh, state) {
  mesh.position.set(state.position.x, state.position.y, state.position.z);
  mesh.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
  mesh.scale.set(state.scale.x, state.scale.y, state.scale.z);
}

function previewPushPullMeshData(meshData, operation) {
  if (!meshData) {
    return null;
  }

  const vertices = [...(meshData.vertices ?? meshData.positions ?? [])];
  const triangles = [...(meshData.triangles ?? meshData.indices ?? [])];
  if (vertices.length === 0 || triangles.length === 0) {
    return null;
  }

  const axis = normalizeVector(operation.params?.axis ?? { x: 0, y: 0, z: 1 });
  const distance = operation.params?.distance ?? 0;
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-8) {
    return {
      ...meshData,
      vertices,
      triangles,
      normals: [...(meshData.normals ?? [])],
      faceGroups: cloneFaceGroups(meshData.faceGroups),
    };
  }

  const selectedVertices = selectedPushPullVertexIndices({
    vertices,
    triangles,
    faceGroups: meshData.faceGroups ?? [],
    faceIndex: operation.selection?.faceIndex ?? operation.params?.faceIndex ?? null,
    axis,
  });

  for (const index of selectedVertices) {
    const offset = index * 3;
    vertices[offset + 0] += axis.x * distance;
    vertices[offset + 1] += axis.y * distance;
    vertices[offset + 2] += axis.z * distance;
  }

  return {
    ...meshData,
    vertices,
    triangles,
    normals: [],
    faceGroups: cloneFaceGroups(meshData.faceGroups),
  };
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

function selectedSubshapeMoveVertexIndices({ vertices, triangles, faceGroups, operation, move }) {
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

function selectedPushPullVertexIndices({ vertices, triangles, faceGroups, faceIndex, axis }) {
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

function cloneFaceGroups(faceGroups) {
  return Array.isArray(faceGroups) ? faceGroups.map((group) => ({ ...group })) : [];
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
    if (!this.scene) {
      return;
    }

    const liveIds = new Set(Object.keys(this.exactSceneState));
    for (const [objectId, mesh] of this.meshById.entries()) {
      if (!liveIds.has(objectId)) {
        this.scene.remove(mesh);
        this.meshById.delete(objectId);
      }
    }

    for (const [objectId, state] of Object.entries(this.exactSceneState)) {
      let mesh = this.meshById.get(objectId);
      if (!mesh) {
        mesh = createMeshForState(state);
        mesh.userData.objectId = objectId;
        this.meshById.set(objectId, mesh);
        this.scene.add(mesh);
      }
      updateMeshGeometry(mesh, state);
      applyTransform(mesh, state);
      mesh.material.color.setHex(0x7aa2f7);
    }
  }

  applyPreviewToScene() {
    this.applyExactStateToScene();
    if (!this.previewOperation) {
      return;
    }

    const { type, targetId, params } = this.previewOperation;
    const mesh = targetId ? this.meshById.get(targetId) : null;
    const exactState = targetId ? this.exactSceneState[targetId] : null;
    if (!mesh || !exactState) {
      return;
    }

    const previewState = structuredClone(exactState);
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

    if (type !== "push_pull") {
      return;
    }

    if (previewState.primitive === "brep_mesh") {
      const meshData = previewPushPullMeshData(previewState.meshData, this.previewOperation);
      if (!meshData) {
        return;
      }
      previewState.meshData = meshData;
      previewState.meshSignature = [
        previewState.meshSignature ?? "mesh",
        this.previewOperation.selection?.faceIndex ?? "face",
        this.previewOperation.params?.distance ?? 0,
      ].join(":");
      updateMeshGeometry(mesh, previewState);
      applyTransform(mesh, previewState);
    }
  }

  getSelectableMeshes() {
    return [...this.meshById.values()];
  }
}
