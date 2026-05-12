const AXES = ["x", "y", "z"];
const ROLE_PATTERN = /(?:^|\.)face\.([p,n])([xyz])$/;

export function faceRole(axis, sign) {
  if (!AXES.includes(axis)) {
    return null;
  }
  return `face.${Math.sign(sign ?? 1) >= 0 ? "p" : "n"}${axis}`;
}

export function faceIdentityFromRole(role) {
  if (typeof role !== "string") {
    return null;
  }
  const match = ROLE_PATTERN.exec(role);
  if (!match) {
    return null;
  }
  return {
    axis: match[2],
    sign: match[1] === "p" ? 1 : -1,
  };
}

export function selectorFaceIdentity(selector) {
  return faceIdentityFromRole(selector?.role);
}

export function normalizeSelector(selector) {
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) {
    return null;
  }
  if (typeof selector.featureId !== "string" || typeof selector.role !== "string") {
    return null;
  }

  const normalized = {
    featureId: selector.featureId,
    role: selector.role,
  };
  if (typeof selector.sketchId === "string") {
    normalized.sketchId = selector.sketchId;
  }
  const hint = normalizeSelectorHint(selector.hint);
  if (hint) {
    normalized.hint = hint;
  }
  return normalized;
}

export function sanitizeSelectionForFeature(selection) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    return null;
  }

  const sanitized = {
    mode: selection.mode ?? "object",
    objectId: selection.objectId ?? null,
    objectIds: Array.isArray(selection.objectIds) ? [...selection.objectIds] : [],
  };
  const selector = normalizeSelector(selection.selector);
  if (selector) {
    sanitized.selector = selector;
  }
  const profile = sanitizeProfile(selection.profile);
  if (profile) {
    sanitized.profile = profile;
  }

  if (selection.mode === "edge" && selection.edge) {
    sanitized.edge = sanitizeEdge(selection.edge);
  }
  if (selection.mode === "vertex" && selection.vertex) {
    sanitized.vertex = sanitizeVertex(selection.vertex);
  }

  return sanitized;
}

function sanitizeProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return null;
  }
  if (typeof profile.objectId !== "string" || typeof profile.targetId !== "string") {
    return null;
  }
  const points = Array.isArray(profile.points)
    ? profile.points.map((point) => normalizeVector(point)).filter(Boolean)
    : [];
  if (points.length < 3) {
    return null;
  }
  const plane = sanitizeProfilePlane(profile.plane);
  return {
    objectId: profile.objectId,
    ...(typeof profile.featureId === "string" ? { featureId: profile.featureId } : {}),
    targetId: profile.targetId,
    closed: true,
    points,
    ...(plane ? { plane } : {}),
  };
}

function sanitizeProfilePlane(plane) {
  if (!plane || typeof plane !== "object" || Array.isArray(plane)) {
    return null;
  }
  const origin = normalizeVector(plane.origin);
  const normal = normalizeVector(plane.normal);
  if (!origin || !normal) {
    return null;
  }
  return { origin, normal };
}

export function cloneSelector(selector) {
  const normalized = normalizeSelector(selector);
  return normalized ? structuredClone(normalized) : null;
}

function normalizeSelectorHint(hint) {
  if (!hint || typeof hint !== "object" || Array.isArray(hint)) {
    return null;
  }
  const point = normalizeVector(hint.point);
  const normal = normalizeVector(hint.normal);
  if (!point && !normal) {
    return null;
  }
  return {
    ...(point ? { point } : {}),
    ...(normal ? { normal } : {}),
  };
}

function sanitizeEdge(edge) {
  return {
    ...(normalizeVector(edge.a) ? { a: normalizeVector(edge.a) } : {}),
    ...(normalizeVector(edge.b) ? { b: normalizeVector(edge.b) } : {}),
    ...(Array.isArray(edge.keys) ? { keys: [...edge.keys].filter((key) => typeof key === "string") } : {}),
  };
}

function sanitizeVertex(vertex) {
  return {
    ...(normalizeVector(vertex) ? normalizeVector(vertex) : {}),
    ...(typeof vertex.key === "string" ? { key: vertex.key } : {}),
  };
}

function normalizeVector(vector) {
  if (!vector || typeof vector !== "object" || Array.isArray(vector)) {
    return null;
  }
  const x = finiteRounded(vector.x);
  const y = finiteRounded(vector.y);
  const z = finiteRounded(vector.z);
  if (x === null || y === null || z === null) {
    return null;
  }
  return { x, y, z };
}

function finiteRounded(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 1000000) / 1000000;
}
