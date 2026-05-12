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
  const profileNormal = intersection?.object?.userData?.profile?.plane?.normal;
  if (profileNormal) {
    return {
      x: profileNormal.x ?? 0,
      y: profileNormal.y ?? 0,
      z: profileNormal.z ?? 0,
    };
  }
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

function profileFromIntersection(intersection) {
  const profile = intersection?.object?.userData?.profile;
  if (profile) {
    return structuredClone(profile);
  }
  return splitFaceProfileFromIntersection(intersection);
}

function splitFaceProfileFromIntersection(intersection) {
  const faceIndex = intersection?.faceIndex;
  const object = intersection?.object;
  const geometry = object?.geometry;
  const provenance = Number.isInteger(faceIndex)
    ? geometry?.userData?.faceProvenance?.[faceIndex]
    : null;
  if (
    !object?.userData?.objectId ||
    !geometry?.attributes?.position ||
    !geometry?.index ||
    !provenance?.featureId ||
    !provenance?.role?.startsWith?.("split.")
  ) {
    return null;
  }

  const triangleIndices = matchingProvenanceTriangles(geometry.userData.faceProvenance, provenance);
  const points = boundaryPointsForTriangles(geometry, triangleIndices);
  if (points.length < 3) {
    return null;
  }

  const normal = intersection.face?.normal?.clone?.().normalize?.() ?? null;
  return {
    objectId: `${object.userData.objectId}:${provenance.role}`,
    featureId: provenance.featureId,
    targetId: object.userData.objectId,
    closed: true,
    points: orderPlanarProfilePoints(points, normal),
    plane: {
      origin: points[0],
      normal: normal ? vecToRoundedObject(normal) : provenance.hint?.normal ?? { x: 0, y: 1, z: 0 },
    },
  };
}

function matchingProvenanceTriangles(faceProvenance, seed) {
  const matches = [];
  if (!Array.isArray(faceProvenance)) {
    return matches;
  }
  for (let triangleIndex = 0; triangleIndex < faceProvenance.length; triangleIndex += 1) {
    const candidate = faceProvenance[triangleIndex];
    if (
      candidate?.featureId === seed.featureId &&
      candidate?.role === seed.role &&
      (candidate?.sketchId ?? null) === (seed.sketchId ?? null)
    ) {
      matches.push(triangleIndex);
    }
  }
  return matches;
}

function boundaryPointsForTriangles(geometry, triangleIndices) {
  const position = geometry.attributes.position;
  const index = geometry.index;
  const origin = geometry.userData.featureSpaceOrigin;
  const edgeCounts = new Map();
  const pointsByKey = new Map();

  const vertexIndexAt = (offset) => index.getX(offset);
  const pointForVertex = (vertexIndex) => {
    const local = new THREE.Vector3().fromBufferAttribute(position, vertexIndex);
    if (origin) {
      local.add(new THREE.Vector3(origin.x ?? 0, origin.y ?? 0, origin.z ?? 0));
    }
    return vecToRoundedObject(local);
  };
  const pointKey = (point) => `${point.x}:${point.y}:${point.z}`;

  for (const triangleIndex of triangleIndices) {
    const base = triangleIndex * 3;
    const corners = [0, 1, 2].map((corner) => {
      const point = pointForVertex(vertexIndexAt(base + corner));
      pointsByKey.set(pointKey(point), point);
      return point;
    });
    for (const [a, b] of [[corners[0], corners[1]], [corners[1], corners[2]], [corners[2], corners[0]]]) {
      const aKey = pointKey(a);
      const bKey = pointKey(b);
      const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  const boundaryKeys = new Set();
  for (const [edgeKey, count] of edgeCounts.entries()) {
    if (count !== 1) {
      continue;
    }
    for (const key of edgeKey.split("|")) {
      boundaryKeys.add(key);
    }
  }
  return [...boundaryKeys].map((key) => pointsByKey.get(key)).filter(Boolean);
}

function orderPlanarProfilePoints(points, normal) {
  if (points.length <= 3) {
    return points;
  }
  const centroid = points.reduce((sum, point) => ({
    x: sum.x + point.x / points.length,
    y: sum.y + point.y / points.length,
    z: sum.z + point.z / points.length,
  }), { x: 0, y: 0, z: 0 });
  const n = normal?.clone?.() ?? new THREE.Vector3(0, 1, 0);
  if (n.lengthSq() < 1e-8) {
    n.set(0, 1, 0);
  }
  n.normalize();
  const tangent = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0).cross(n).normalize();
  const bitangent = n.clone().cross(tangent).normalize();
  return [...points].sort((a, b) => {
    const av = new THREE.Vector3(a.x - centroid.x, a.y - centroid.y, a.z - centroid.z);
    const bv = new THREE.Vector3(b.x - centroid.x, b.y - centroid.y, b.z - centroid.z);
    const aa = Math.atan2(av.dot(bitangent), av.dot(tangent));
    const ba = Math.atan2(bv.dot(bitangent), bv.dot(tangent));
    return aa - ba;
  });
}

export function selectorFromIntersection(intersection) {
  const faceIndex = intersection?.faceIndex;
  const provenance = Number.isInteger(faceIndex)
    ? intersection.object?.geometry?.userData?.faceProvenance?.[faceIndex]
    : null;
  if (!provenance?.featureId || !provenance?.role || !intersection?.object || !intersection?.point) {
    return null;
  }

  const point = intersection.object.worldToLocal(intersection.point.clone());
  const origin = intersection.object.geometry.userData.featureSpaceOrigin;
  if (origin) {
    point.add(new THREE.Vector3(origin.x ?? 0, origin.y ?? 0, origin.z ?? 0));
  }
  const normal = intersection.face?.normal?.clone?.().normalize?.() ?? null;
  return {
    featureId: provenance.featureId,
    role: provenance.role,
    ...(provenance.sketchId ? { sketchId: provenance.sketchId } : {}),
    hint: {
      point: vecToRoundedObject(point),
      normal: normal ? vecToRoundedObject(normal) : provenance.hint?.normal ?? null,
    },
  };
}

function vecToObject(vector) {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function vecToRoundedObject(vector) {
  return {
    x: round6(vector.x),
    y: round6(vector.y),
    z: round6(vector.z),
  };
}

function round6(value) {
  return Math.round(value * 1000000) / 1000000;
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
      selector: selectorFromIntersection(hit),
      profile: profileFromIntersection(hit),
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
      selector: selectorFromIntersection(hit),
      profile: profileFromIntersection(hit),
      edge: this.selectionMode === SELECTION_MODES.EDGE ? pickFaceEdge(hit) : null,
      vertex: this.selectionMode === SELECTION_MODES.VERTEX ? pickFaceVertex(hit) : null,
    };

    return { hit, selection };
  }
}
