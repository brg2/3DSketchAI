import * as THREE from "three";
import { SELECTION_MODES } from "../operation/operation-types.js";

function pickFaceEdge(intersection) {
  if (!intersection?.face || !intersection?.object?.geometry) {
    return null;
  }

  const { face, object, point } = intersection;
  const geom = object.geometry;
  const position = geom.attributes.position;
  const localA = new THREE.Vector3().fromBufferAttribute(position, face.a);
  const localB = new THREE.Vector3().fromBufferAttribute(position, face.b);
  const localC = new THREE.Vector3().fromBufferAttribute(position, face.c);
  const a = object.localToWorld(localA.clone());
  const b = object.localToWorld(localB.clone());
  const c = object.localToWorld(localC.clone());

  const edges = [
    { world: [a, b], local: [localA, localB] },
    { world: [b, c], local: [localB, localC] },
    { world: [c, a], local: [localC, localA] },
  ];
  let best = edges[0];
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (const edge of edges) {
    const [p0, p1] = edge.world;
    const distSq = distancePointToSegmentSquared(point, p0, p1);
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = edge;
    }
  }

  return {
    a: vecToObject(best.local[0]),
    b: vecToObject(best.local[1]),
    worldA: vecToObject(best.world[0]),
    worldB: vecToObject(best.world[1]),
    keys: best.local.map(cornerKeyFromLocalPoint).filter(Boolean),
  };
}

function pickFaceVertex(intersection) {
  if (!intersection?.face || !intersection?.object?.geometry || !intersection?.point) {
    return null;
  }

  const { face, object, point } = intersection;
  const position = object.geometry.attributes.position;
  const locals = [
    new THREE.Vector3().fromBufferAttribute(position, face.a),
    new THREE.Vector3().fromBufferAttribute(position, face.b),
    new THREE.Vector3().fromBufferAttribute(position, face.c),
  ];
  const worlds = locals.map((local) => object.localToWorld(local.clone()));
  let bestIndex = 0;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (let index = 0; index < worlds.length; index += 1) {
    const distSq = point.distanceToSquared(worlds[index]);
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIndex = index;
    }
  }

  return {
    ...vecToObject(locals[bestIndex]),
    world: vecToObject(worlds[bestIndex]),
    key: cornerKeyFromLocalPoint(locals[bestIndex]),
  };
}

function distancePointToSegmentSquared(point, a, b) {
  const ab = b.clone().sub(a);
  const ap = point.clone().sub(a);
  const denom = ab.lengthSq();
  if (denom <= 1e-10) {
    return point.distanceToSquared(a);
  }

  const t = THREE.MathUtils.clamp(ap.dot(ab) / denom, 0, 1);
  const closest = a.clone().add(ab.multiplyScalar(t));
  return point.distanceToSquared(closest);
}

function pickFaceNormalWorld(intersection) {
  if (!intersection?.face || !intersection?.object) {
    return null;
  }

  const normal = intersection.face.normal.clone().transformDirection(intersection.object.matrixWorld).normalize();
  return {
    x: normal.x,
    y: normal.y,
    z: normal.z,
  };
}

function vecToObject(vector) {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function cornerKeyFromLocalPoint(point) {
  if (!point) {
    return null;
  }
  const sx = point.x >= 0 ? "px" : "nx";
  const sy = point.y >= 0 ? "py" : "ny";
  const sz = point.z >= 0 ? "pz" : "nz";
  return `${sx}_${sy}_${sz}`;
}

export class SelectionPipeline {
  constructor({ camera, domElement }) {
    this.camera = camera;
    this.domElement = domElement;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.selectionMode = SELECTION_MODES.OBJECT;
    this.selectedObjectIds = [];
  }

  setSelectionMode(mode) {
    this.selectionMode = mode;
  }

  rayFromClient(clientX, clientY) {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray.clone();
  }

  pointOnPlane({ clientX, clientY, plane }) {
    const ray = this.rayFromClient(clientX, clientY);
    const out = new THREE.Vector3();
    const hit = ray.intersectPlane(plane, out);
    return hit ? out : null;
  }

  hover({ clientX, clientY, selectableMeshes }) {
    this.rayFromClient(clientX, clientY);
    const intersections = this.raycaster.intersectObjects(selectableMeshes, false);
    const hit = intersections[0] ?? null;
    const objectId = hit?.object?.userData?.objectId ?? null;

    if (!hit || !objectId) {
      return { hit: null, objectId: null, faceIndex: null, faceNormalWorld: null };
    }

    return {
      hit,
      objectId,
      faceIndex: hit.faceIndex ?? null,
      faceNormalWorld: pickFaceNormalWorld(hit),
    };
  }

  pick({ clientX, clientY, selectableMeshes, multiSelect = false }) {
    this.rayFromClient(clientX, clientY);
    const intersections = this.raycaster.intersectObjects(selectableMeshes, false);
    const hit = intersections[0] ?? null;

    if (!hit) {
      if (!multiSelect) {
        this.selectedObjectIds = [];
      }
      return { hit: null, selection: null };
    }

    const objectId = hit.object.userData.objectId;
    if (!objectId) {
      return { hit: null, selection: null };
    }

    if (multiSelect) {
      if (this.selectedObjectIds.includes(objectId)) {
        this.selectedObjectIds = this.selectedObjectIds.filter((id) => id !== objectId);
      } else {
        this.selectedObjectIds = [...this.selectedObjectIds, objectId];
      }
    } else {
      this.selectedObjectIds = [objectId];
    }

    const selection = {
      mode: this.selectionMode,
      objectId,
      objectIds: [...this.selectedObjectIds],
      faceIndex: hit.faceIndex ?? null,
      faceNormalWorld: pickFaceNormalWorld(hit),
      edge: this.selectionMode === SELECTION_MODES.EDGE ? pickFaceEdge(hit) : null,
      vertex: this.selectionMode === SELECTION_MODES.VERTEX ? pickFaceVertex(hit) : null,
    };

    return { hit, selection };
  }
}
