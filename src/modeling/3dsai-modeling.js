const AXES = ["x", "y", "z"];

export function create3dsaiModelingLibrary() {
  return {
    makeTaperedBox,
  };
}

export function makeTaperedBox(r, { min, max, faceTilts = [], faceExtrudes = [], faceExtensions = [] }) {
  const corners = createBoxCorners(min, max);
  for (const tilt of faceTilts) {
    applyCenteredTaper(corners, tilt);
  }
  for (const extrude of faceExtrudes) {
    applyFaceExtrude(corners, extrude);
  }

  const faces = [
    r.makePolygon([corners.nx_ny_nz, corners.px_ny_nz, corners.px_ny_pz, corners.nx_ny_pz]),
    r.makePolygon([corners.nx_py_nz, corners.nx_py_pz, corners.px_py_pz, corners.px_py_nz]),
    r.makePolygon([corners.nx_ny_nz, corners.nx_py_nz, corners.px_py_nz, corners.px_ny_nz]),
    r.makePolygon([corners.px_ny_nz, corners.px_py_nz, corners.px_py_pz, corners.px_ny_pz]),
    r.makePolygon([corners.px_ny_pz, corners.px_py_pz, corners.nx_py_pz, corners.nx_ny_pz]),
    r.makePolygon([corners.nx_ny_pz, corners.nx_py_pz, corners.nx_py_nz, corners.nx_ny_nz]),
  ];

  for (const extension of faceExtensions) {
    addFaceExtensionFaces(r, faces, corners, extension);
  }

  return r.makeSolid(faces);
}

function applyFaceExtrude(corners, extrude) {
  const axis = normalizeVector(extrude?.axis ?? { x: 0, y: 0, z: 1 });
  const distance = extrude?.distance ?? 0;
  const faceAxis = extrude?.faceAxis;
  const faceSign = Math.sign(extrude?.faceSign ?? 1) || 1;
  if (!AXES.includes(faceAxis) || !Number.isFinite(distance) || Math.abs(distance) < 1e-6) {
    return;
  }

  const faceIndex = axisIndex(faceAxis);
  const faceCoordinate = faceSign > 0 ? maxCoordinate(corners, faceIndex) : minCoordinate(corners, faceIndex);
  const delta = [axis.x * distance, axis.y * distance, axis.z * distance];
  for (const corner of Object.values(corners)) {
    if (Math.abs(corner[faceIndex] - faceCoordinate) > 1e-6) {
      continue;
    }
    corner[0] += delta[0];
    corner[1] += delta[1];
    corner[2] += delta[2];
  }
}

function addFaceExtensionFaces(r, faces, corners, extension) {
  const axis = normalizeVector(extension?.axis ?? { x: 0, y: 0, z: 1 });
  const distance = extension?.distance ?? 0;
  const loop = faceLoop(corners, extension);
  if (!loop || !Number.isFinite(distance) || Math.abs(distance) < 1e-6) {
    return;
  }

  const delta = [axis.x * distance, axis.y * distance, axis.z * distance];
  const outer = loop.map((point) => [point[0] + delta[0], point[1] + delta[1], point[2] + delta[2]]);
  faces.push(r.makePolygon(outer));
  for (let i = 0; i < loop.length; i += 1) {
    const next = (i + 1) % loop.length;
    faces.push(r.makePolygon([loop[i], loop[next], outer[next], outer[i]]));
  }
}

function faceLoop(corners, operation) {
  const faceAxis = operation?.faceAxis;
  const faceSign = Math.sign(operation?.faceSign ?? 1) || 1;
  if (!AXES.includes(faceAxis)) {
    return null;
  }

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

function normalizeVector(vector) {
  const length = Math.hypot(vector.x ?? 0, vector.y ?? 0, vector.z ?? 0);
  if (length < 1e-8) {
    return { x: 0, y: 0, z: 1 };
  }
  return { x: (vector.x ?? 0) / length, y: (vector.y ?? 0) / length, z: (vector.z ?? 0) / length };
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

function applyCenteredTaper(corners, tilt) {
  const faceAxis = tilt.faceAxis;
  const faceSign = Math.sign(tilt.faceSign ?? 1) || 1;
  const sideAxis = tilt.hingeSideAxis;
  const angle = tilt.angle ?? 0;
  if (!AXES.includes(faceAxis) || !AXES.includes(sideAxis) || !Number.isFinite(angle)) {
    return;
  }

  const faceIndex = axisIndex(faceAxis);
  const sideIndex = axisIndex(sideAxis);
  const faceCoordinate = faceSign > 0 ? maxCoordinate(corners, faceIndex) : minCoordinate(corners, faceIndex);
  const sideCenter = (minCoordinate(corners, sideIndex) + maxCoordinate(corners, sideIndex)) / 2;
  const oppositeCoordinate = faceSign > 0 ? minCoordinate(corners, faceIndex) : maxCoordinate(corners, faceIndex);
  const slope = Math.tan(angle);

  for (const corner of Object.values(corners)) {
    if (Math.abs(corner[faceIndex] - faceCoordinate) > 1e-6) {
      continue;
    }
    corner[faceIndex] += faceSign * slope * (corner[sideIndex] - sideCenter);
    corner[faceIndex] = faceSign > 0
      ? Math.max(corner[faceIndex], oppositeCoordinate)
      : Math.min(corner[faceIndex], oppositeCoordinate);
  }
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
