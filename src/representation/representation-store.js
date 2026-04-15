import * as THREE from "three";

function createGeometryForState(state) {
  let geometry;
  switch (state.primitive) {
    case "sphere":
      geometry = new THREE.SphereGeometry(0.5, 24, 16);
      break;
    case "cylinder":
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
      break;
    case "box":
    default:
      geometry = new THREE.BoxGeometry(1, 1, 1);
      applyFaceTiltsToGeometry(geometry, state.faceTilts ?? [], state.rotation ?? { x: 0, y: 0, z: 0 });
      applyFaceExtrudesToGeometry(geometry, state.faceExtrudes ?? [], state.rotation ?? { x: 0, y: 0, z: 0 });
      geometry = applyFaceExtensionsToGeometry(geometry, state.faceExtensions ?? [], state.rotation ?? { x: 0, y: 0, z: 0 });
      break;
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
    faceTilts: state.faceTilts ?? [],
    faceExtrudes: state.faceExtrudes ?? [],
    faceExtensions: state.faceExtensions ?? [],
  });
}

function applyTransform(mesh, state) {
  mesh.position.set(state.position.x, state.position.y, state.position.z);
  mesh.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
  mesh.scale.set(state.scale.x, state.scale.y, state.scale.z);
}

function applyFaceTiltsToGeometry(geometry, faceTilts, rotation) {
  if (!Array.isArray(faceTilts) || faceTilts.length === 0) {
    return;
  }

  const position = geometry.attributes.position;
  const basePoints = [];
  for (let i = 0; i < position.count; i += 1) {
    basePoints.push(new THREE.Vector3().fromBufferAttribute(position, i));
  }

  for (const tilt of faceTilts) {
    const angle = tilt?.angle ?? 0;
    if (!Number.isFinite(angle) || Math.abs(angle) < 1e-6) {
      continue;
    }

    const localNormal = localFaceNormalFromTilt(tilt, rotation);
    const dominant = tilt.faceAxis ?? dominantAxis(localNormal);
    const sign = tilt.faceSign ?? (Math.sign(localNormal[dominant]) || 1);
    const hingeAxisName = tilt.hingeAxis ?? defaultHingeAxisForFace(dominant);
    const hingeSideAxis = tilt.hingeSideAxis ?? defaultHingeSideAxisForFace(dominant, hingeAxisName);
    const hingeSideSign = tilt.hingeSideSign ?? -1;
    const targetVertexIndices = vertexIndicesForTiltFace(geometry, tilt, dominant, sign, basePoints);
    const hingeCoordinate = 0;
    const slope = Math.tan(angle);

    for (let i = 0; i < position.count; i += 1) {
      if (!targetVertexIndices.has(i)) {
        continue;
      }

      const point = new THREE.Vector3().fromBufferAttribute(position, i);
      const basePoint = basePoints[i];
      point[dominant] += sign * slope * (basePoint[hingeSideAxis] - hingeCoordinate);
      point[dominant] = clampTaperCoordinate(point[dominant], sign);
      position.setXYZ(i, point.x, point.y, point.z);
    }
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function clampTaperCoordinate(value, faceSign) {
  return faceSign > 0 ? Math.max(value, -0.5) : Math.min(value, 0.5);
}

function vertexIndicesForTiltFace(geometry, tilt, dominant, sign, basePoints) {
  const indices = new Set();
  const faceIndex = Number.isInteger(tilt.faceIndex) ? tilt.faceIndex : -1;
  if (faceIndex >= 0 && geometry.index) {
    const selectedBasePoints = [];
    const firstFaceTri = Math.floor(faceIndex / 2) * 2;
    for (const tri of [firstFaceTri, firstFaceTri + 1]) {
      const base = tri * 3;
      if (base + 2 >= geometry.index.count) {
        continue;
      }
      selectedBasePoints.push(basePoints[geometry.index.getX(base + 0)]);
      selectedBasePoints.push(basePoints[geometry.index.getX(base + 1)]);
      selectedBasePoints.push(basePoints[geometry.index.getX(base + 2)]);
    }

    for (let i = 0; i < basePoints.length; i += 1) {
      if (selectedBasePoints.some((point) => pointsCoincide(basePoints[i], point))) {
        indices.add(i);
      }
    }
    return indices;
  }

  for (let i = 0; i < basePoints.length; i += 1) {
    if (Math.abs(basePoints[i][dominant] - sign * 0.5) <= 1e-4) {
      indices.add(i);
    }
  }
  return indices;
}

function pointsCoincide(a, b) {
  return Math.abs(a.x - b.x) <= 1e-4 && Math.abs(a.y - b.y) <= 1e-4 && Math.abs(a.z - b.z) <= 1e-4;
}

function applyFaceExtrudesToGeometry(geometry, faceExtrudes, rotation) {
  if (!Array.isArray(faceExtrudes) || faceExtrudes.length === 0) {
    return;
  }

  const position = geometry.attributes.position;
  for (const extrude of faceExtrudes) {
    const distance = extrude?.distance ?? 0;
    if (!Number.isFinite(distance) || Math.abs(distance) < 1e-6) {
      continue;
    }

    const axis = localFaceNormalFromExtrude(extrude, rotation);
    const targetVertexIndices = vertexIndicesForExtrudeFace(geometry, extrude);
    for (const index of targetVertexIndices) {
      const point = new THREE.Vector3().fromBufferAttribute(position, index);
      point.add(axis.clone().multiplyScalar(distance));
      position.setXYZ(index, point.x, point.y, point.z);
    }
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function applyFaceExtensionsToGeometry(geometry, faceExtensions, rotation) {
  if (!Array.isArray(faceExtensions) || faceExtensions.length === 0) {
    return geometry;
  }

  let nextGeometry = geometry;
  for (const extension of faceExtensions) {
    nextGeometry = appendFaceExtension(nextGeometry, extension, rotation);
  }
  return nextGeometry;
}

function appendFaceExtension(geometry, extension, rotation) {
  const distance = extension?.distance ?? 0;
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-6) {
    return geometry;
  }

  const axis = localFaceNormalFromExtrude(extension, rotation);
  const baseLoop = orderedFaceLoopFromGeometry(geometry, extension);
  if (baseLoop.length < 3) {
    return geometry;
  }

  const extensionLoop = baseLoop.map((point) => point.clone().add(axis.clone().multiplyScalar(distance)));
  const triangles = trianglesFromGeometry(geometry);
  addLoopCapTriangles(triangles, extensionLoop);
  addSideWallTriangles(triangles, baseLoop, extensionLoop);
  geometry.dispose();
  return geometryFromTriangles(triangles);
}

function orderedFaceLoopFromGeometry(geometry, faceOperation) {
  const position = geometry.attributes.position;
  const indices = vertexIndicesForExtrudeFace(geometry, faceOperation);
  const unique = [];
  for (const index of indices) {
    const point = new THREE.Vector3().fromBufferAttribute(position, index);
    if (!unique.some((existing) => pointsCoincide(existing, point))) {
      unique.push(point);
    }
  }
  if (unique.length < 3) {
    return unique;
  }

  const center = unique.reduce((acc, point) => acc.add(point), new THREE.Vector3()).multiplyScalar(1 / unique.length);
  const normal = localFaceNormalFromExtrude(faceOperation, { x: 0, y: 0, z: 0 }).normalize();
  const reference = unique[0].clone().sub(center).normalize();
  const tangent = normal.clone().cross(reference).normalize();
  return unique.sort((a, b) => {
    const av = a.clone().sub(center);
    const bv = b.clone().sub(center);
    return Math.atan2(av.dot(tangent), av.dot(reference)) - Math.atan2(bv.dot(tangent), bv.dot(reference));
  });
}

function trianglesFromGeometry(geometry) {
  const position = geometry.attributes.position;
  const index = geometry.index;
  const triangles = [];
  const triCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
  const idxAt = (idx) => (index ? index.getX(idx) : idx);
  for (let tri = 0; tri < triCount; tri += 1) {
    const base = tri * 3;
    triangles.push([
      new THREE.Vector3().fromBufferAttribute(position, idxAt(base + 0)),
      new THREE.Vector3().fromBufferAttribute(position, idxAt(base + 1)),
      new THREE.Vector3().fromBufferAttribute(position, idxAt(base + 2)),
    ]);
  }
  return triangles;
}

function addLoopCapTriangles(triangles, loop) {
  for (let i = 1; i < loop.length - 1; i += 1) {
    triangles.push([loop[0].clone(), loop[i].clone(), loop[i + 1].clone()]);
  }
}

function addSideWallTriangles(triangles, baseLoop, extensionLoop) {
  for (let i = 0; i < baseLoop.length; i += 1) {
    const next = (i + 1) % baseLoop.length;
    const a = baseLoop[i].clone();
    const b = baseLoop[next].clone();
    const c = extensionLoop[next].clone();
    const d = extensionLoop[i].clone();
    triangles.push([a, b, c], [a, c, d]);
  }
}

function geometryFromTriangles(triangles) {
  const flat = new Float32Array(triangles.length * 9);
  triangles.forEach((tri, triIndex) => {
    tri.forEach((point, pointIndex) => {
      const offset = triIndex * 9 + pointIndex * 3;
      flat[offset + 0] = point.x;
      flat[offset + 1] = point.y;
      flat[offset + 2] = point.z;
    });
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(flat, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function vertexIndicesForExtrudeFace(geometry, extrude) {
  const position = geometry.attributes.position;
  const basePoints = [];
  for (let i = 0; i < position.count; i += 1) {
    basePoints.push(new THREE.Vector3().fromBufferAttribute(position, i));
  }
  const indices = vertexIndicesForTiltFace(
    geometry,
    { faceIndex: extrude.faceIndex ?? -1 },
    extrude.faceAxis ?? dominantAxis(localFaceNormalFromExtrude(extrude, { x: 0, y: 0, z: 0 })),
    extrude.faceSign ?? 1,
    basePoints,
  );
  return indices;
}

function localFaceNormalFromTilt(tilt, rotation) {
  const normal = tilt.faceNormalWorld ?? { x: 0, y: 0, z: 1 };
  return localVectorFromWorld(normal, rotation);
}

function localFaceNormalFromExtrude(extrude, rotation) {
  const normal = extrude.axis ?? { x: 0, y: 0, z: 1 };
  return localVectorFromWorld(normal, rotation);
}

function localVectorFromWorld(normal, rotation) {
  const vector = new THREE.Vector3(normal.x ?? 0, normal.y ?? 0, normal.z ?? 1);
  if (vector.lengthSq() < 1e-8) {
    vector.set(0, 0, 1);
  }
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0),
  );
  return vector.normalize().applyQuaternion(quaternion.invert());
}

function dominantAxis(vector) {
  const abs = { x: Math.abs(vector.x), y: Math.abs(vector.y), z: Math.abs(vector.z) };
  if (abs.x >= abs.y && abs.x >= abs.z) return "x";
  if (abs.y >= abs.x && abs.y >= abs.z) return "y";
  return "z";
}

function defaultHingeAxisForFace(dominant) {
  if (dominant === "x") return "y";
  return "x";
}

function defaultHingeSideAxisForFace(dominant, hingeAxisName) {
  return ["x", "y", "z"].find((axis) => axis !== dominant && axis !== hingeAxisName) ?? "z";
}

function applyPushPullToState(state, params) {
  const axis = params.axis ?? { x: 0, y: 0, z: 1 };
  const distance = params.distance ?? 0;
  if (state.primitive === "box" && params.mode === "extend") {
    const faceExtension = makeFaceExtrude(params);
    state.faceExtensions = [...(state.faceExtensions ?? []), faceExtension];
    return;
  }
  if (state.primitive === "box" && !isAxisAligned(axis)) {
    const faceExtrude = makeFaceExtrude(params);
    state.faceExtrudes = [...(state.faceExtrudes ?? []), faceExtrude];
    return;
  }

  const axisEntries = [
    ["x", axis.x ?? 0],
    ["y", axis.y ?? 0],
    ["z", axis.z ?? 0],
  ];
  axisEntries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

  const [dominantAxis, dominantComponent] = axisEntries[0];
  const axisSign = Math.sign(dominantComponent) || 1;
  const previousScale = state.scale[dominantAxis];
  const nextScale = Math.max(0.1, previousScale + distance);
  const appliedDelta = nextScale - previousScale;

  state.scale[dominantAxis] = nextScale;
  state.position[dominantAxis] += axisSign * (appliedDelta * 0.5);
}

function makeFaceExtrude(params) {
  const axis = normalizeAxis(params.axis ?? { x: 0, y: 0, z: 1 });
  const faceAxis = dominantAxis(new THREE.Vector3(axis.x, axis.y, axis.z));
  return {
    faceIndex: Number.isInteger(params.faceIndex) ? params.faceIndex : null,
    axis,
    distance: params.distance ?? 0,
    faceAxis,
    faceSign: Math.sign(axis[faceAxis] ?? 0) || 1,
  };
}

function normalizeAxis(axis) {
  const length = Math.hypot(axis.x ?? 0, axis.y ?? 0, axis.z ?? 0);
  if (length < 1e-8) {
    return { x: 0, y: 0, z: 1 };
  }
  return { x: axis.x / length, y: axis.y / length, z: axis.z / length };
}

function isAxisAligned(axis) {
  const normalized = normalizeAxis(axis);
  const components = [Math.abs(normalized.x), Math.abs(normalized.y), Math.abs(normalized.z)];
  return components.filter((value) => value > 1e-4).length <= 1;
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
    if (!mesh) {
      return;
    }

    const exactState = this.exactSceneState[targetId];
    if (!exactState) {
      return;
    }

    const previewState = structuredClone(exactState);
    if (type === "move") {
      previewState.position.x += params.delta.x;
      previewState.position.y += params.delta.y;
      previewState.position.z += params.delta.z;
    }

    if (type === "rotate") {
      if (this.previewOperation.selection?.mode === "face" && params.faceTilt) {
        const faceTilts = Array.isArray(params.faceTilts) ? params.faceTilts : [params.faceTilt];
        previewState.faceTilts = [...(previewState.faceTilts ?? []), ...faceTilts.map((tilt) => structuredClone(tilt))];
      } else {
        previewState.rotation.x += params.deltaEuler.x;
        previewState.rotation.y += params.deltaEuler.y;
        previewState.rotation.z += params.deltaEuler.z;
      }
    }

    if (type === "scale") {
      previewState.scale.x *= Math.max(0.1, params.scaleFactor.x);
      previewState.scale.y *= Math.max(0.1, params.scaleFactor.y);
      previewState.scale.z *= Math.max(0.1, params.scaleFactor.z);
    }

    if (type === "push_pull") {
      applyPushPullToState(previewState, params);
    }

    updateMeshGeometry(mesh, previewState);
    applyTransform(mesh, previewState);
  }

  getSelectableMeshes() {
    return [...this.meshById.values()];
  }
}
