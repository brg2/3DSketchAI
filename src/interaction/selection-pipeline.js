import * as THREE from "three";
import { SELECTION_MODES } from "../operation/operation-types.js";

function pickFaceEdge(intersection) {
  if (!intersection?.face || !intersection?.object?.geometry) {
    return null;
  }

  const { face, object, point } = intersection;
  const geom = object.geometry;
  const position = geom.attributes.position;
  const a = object.localToWorld(new THREE.Vector3().fromBufferAttribute(position, face.a));
  const b = object.localToWorld(new THREE.Vector3().fromBufferAttribute(position, face.b));
  const c = object.localToWorld(new THREE.Vector3().fromBufferAttribute(position, face.c));

  const edges = [
    [a, b],
    [b, c],
    [c, a],
  ];
  let best = edges[0];
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (const [p0, p1] of edges) {
    const distSq = distancePointToSegmentSquared(point, p0, p1);
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = [p0, p1];
    }
  }

  return {
    a: { x: best[0].x, y: best[0].y, z: best[0].z },
    b: { x: best[1].x, y: best[1].y, z: best[1].z },
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
    };

    return { hit, selection };
  }
}
