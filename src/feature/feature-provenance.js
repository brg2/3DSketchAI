import { OPERATION_TYPES } from "../operation/operation-types.js";
import { faceIdentityFromRole, faceRole, selectorFaceIdentity } from "./feature-selectors.js";
import { normalizeFeatureGraph, orderedFeatures } from "./feature-store.js";

const AXES = ["x", "y", "z"];
const BOX_FACE_ROLES = Object.freeze([
  "face.px",
  "face.nx",
  "face.py",
  "face.ny",
  "face.pz",
  "face.nz",
]);

export function annotateMeshDataWithFeatureProvenance(meshData, { objectId, features } = {}) {
  if (!meshData || !objectId) {
    return meshData;
  }

  const vertices = meshData.vertices ?? meshData.positions ?? [];
  const triangles = meshData.triangles ?? meshData.indices ?? [];
  const normals = meshData.normals ?? [];
  if (!Array.isArray(vertices) || !Array.isArray(triangles) || vertices.length === 0 || triangles.length === 0) {
    return meshData;
  }

  const roleOwners = featureRoleOwnersForObject(features, objectId);
  if (roleOwners.size === 0) {
    return meshData;
  }

  const faceProvenance = [];
  for (let triangleIndex = 0; triangleIndex < triangles.length / 3; triangleIndex += 1) {
    const geometry = triangleGeometry(vertices, triangles, normals, triangleIndex);
    const role = roleForTriangle(geometry);
    const owner = role ? roleOwners.get(role) : null;
    faceProvenance.push(owner ? {
      objectId,
      featureId: owner.featureId,
      role,
      hint: {
        point: geometry.centroid,
        normal: geometry.normal,
      },
    } : null);
  }

  return {
    ...meshData,
    faceProvenance,
    faceGroups: provenanceFaceGroups(faceProvenance),
  };
}

export function featureRoleOwnersForObject(features, objectId) {
  const roleOwners = new Map();
  for (const feature of orderedFeatures(normalizeFeatureGraph(features ?? []))) {
    if (feature.type === OPERATION_TYPES.CREATE_PRIMITIVE && feature.params?.objectId === objectId) {
      for (const role of BOX_FACE_ROLES) {
        roleOwners.set(role, { featureId: feature.id, role });
      }
      continue;
    }

    if (feature.target?.objectId !== objectId) {
      continue;
    }

    const role = feature.target?.selection?.selector?.role ?? roleFromFeature(feature);
    if (role && faceIdentityFromRole(role)) {
      roleOwners.set(role, { featureId: feature.id, role });
    }
  }
  return roleOwners;
}

function roleFromFeature(feature) {
  const selectorIdentity = selectorFaceIdentity(feature.target?.selection?.selector);
  if (selectorIdentity) {
    return faceRole(selectorIdentity.axis, selectorIdentity.sign);
  }

  const params = feature.params ?? {};
  if (AXES.includes(params.faceAxis)) {
    return faceRole(params.faceAxis, Math.sign(params.faceSign ?? 1) || 1);
  }

  const faceTilt = Array.isArray(params.faceTilts) && params.faceTilts.length > 0
    ? params.faceTilts[0]
    : params.faceTilt;
  if (AXES.includes(faceTilt?.faceAxis)) {
    return faceRole(faceTilt.faceAxis, Math.sign(faceTilt.faceSign ?? 1) || 1);
  }

  return null;
}

function roleForTriangle({ normal }) {
  const axis = dominantAxis(normal);
  const component = normal[axis] ?? 0;
  if (Math.abs(component) < 1e-8) {
    return null;
  }
  return faceRole(axis, Math.sign(component) || 1);
}

function triangleGeometry(vertices, triangles, normals, triangleIndex) {
  const base = triangleIndex * 3;
  const a = vertexAt(vertices, triangles[base]);
  const b = vertexAt(vertices, triangles[base + 1]);
  const c = vertexAt(vertices, triangles[base + 2]);
  const ab = subtract(b, a);
  const ac = subtract(c, a);
  const normal = averagedTriangleNormal(normals, triangles, base) ?? normalize(cross(ab, ac)) ?? { x: 0, y: 0, z: 1 };
  const centroid = {
    x: round((a.x + b.x + c.x) / 3),
    y: round((a.y + b.y + c.y) / 3),
    z: round((a.z + b.z + c.z) / 3),
  };
  return { centroid, normal };
}

function averagedTriangleNormal(normals, triangles, base) {
  if (!Array.isArray(normals) || normals.length === 0) {
    return null;
  }
  const a = vertexAt(normals, triangles[base]);
  const b = vertexAt(normals, triangles[base + 1]);
  const c = vertexAt(normals, triangles[base + 2]);
  return normalize({
    x: a.x + b.x + c.x,
    y: a.y + b.y + c.y,
    z: a.z + b.z + c.z,
  });
}

function provenanceFaceGroups(faceProvenance) {
  const groups = [];
  let current = null;
  for (let triangleIndex = 0; triangleIndex < faceProvenance.length; triangleIndex += 1) {
    const provenance = faceProvenance[triangleIndex];
    const key = provenance ? `${provenance.featureId}:${provenance.role}` : null;
    const triangleStart = triangleIndex * 3;
    if (current && current.key === key) {
      current.count += 3;
      continue;
    }
    if (current) {
      groups.push(groupForOutput(current));
    }
    current = {
      key,
      start: triangleStart,
      count: 3,
      provenance: provenance ? {
        featureId: provenance.featureId,
        role: provenance.role,
      } : null,
    };
  }
  if (current) {
    groups.push(groupForOutput(current));
  }
  return groups;
}

function groupForOutput(group) {
  return {
    start: group.start,
    count: group.count,
    ...(group.provenance ? { provenance: group.provenance } : {}),
  };
}

function vertexAt(vertices, vertexIndex) {
  const offset = (vertexIndex ?? 0) * 3;
  return {
    x: vertices[offset + 0] ?? 0,
    y: vertices[offset + 1] ?? 0,
    z: vertices[offset + 2] ?? 0,
  };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length < 1e-8) {
    return null;
  }
  return {
    x: round(vector.x / length),
    y: round(vector.y / length),
    z: round(vector.z / length),
  };
}

function dominantAxis(vector) {
  let best = "x";
  for (const axis of AXES) {
    if (Math.abs(vector[axis] ?? 0) > Math.abs(vector[best] ?? 0)) {
      best = axis;
    }
  }
  return best;
}

function round(value) {
  return Math.round(value * 1000000) / 1000000;
}
