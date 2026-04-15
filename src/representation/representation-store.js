import * as THREE from "three";

function createMeshForPrimitive(primitive) {
  let geometry;
  switch (primitive) {
    case "sphere":
      geometry = new THREE.SphereGeometry(0.5, 24, 16);
      break;
    case "cylinder":
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
      break;
    case "box":
    default:
      geometry = new THREE.BoxGeometry(1, 1, 1);
      break;
  }

  const material = new THREE.MeshStandardMaterial({ color: 0x7aa2f7, roughness: 0.4, metalness: 0.1 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function applyTransform(mesh, state) {
  mesh.position.set(state.position.x, state.position.y, state.position.z);
  mesh.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
  mesh.scale.set(state.scale.x, state.scale.y, state.scale.z);
}

function applyPushPullToState(state, params) {
  const axis = params.axis ?? { x: 0, y: 0, z: 1 };
  const distance = params.distance ?? 0;
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
        mesh = createMeshForPrimitive(state.primitive);
        mesh.userData.objectId = objectId;
        this.meshById.set(objectId, mesh);
        this.scene.add(mesh);
      }
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
      previewState.rotation.x += params.deltaEuler.x;
      previewState.rotation.y += params.deltaEuler.y;
      previewState.rotation.z += params.deltaEuler.z;
    }

    if (type === "scale") {
      previewState.scale.x *= Math.max(0.1, params.scaleFactor.x);
      previewState.scale.y *= Math.max(0.1, params.scaleFactor.y);
      previewState.scale.z *= Math.max(0.1, params.scaleFactor.z);
    }

    if (type === "push_pull") {
      applyPushPullToState(previewState, params);
    }

    applyTransform(mesh, previewState);
  }

  getSelectableMeshes() {
    return [...this.meshById.values()];
  }
}
