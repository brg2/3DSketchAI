import { OPERATION_TYPES, operationForTool } from "./operation-types.js";
import { validateOperation } from "./operation-validator.js";
import { selectorFaceIdentity } from "../feature/feature-selectors.js";

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

export function mapToolGestureToOperation({ tool, targetId, selection, gesture }) {
  const operationType = operationForTool(tool);
  const { dx = 0, dy = 0, shiftKey = false, worldDelta = null, pushPullDistance = null, faceTiltAngles = null } = gesture ?? {};
  const faceNormal = selection?.selector?.hint?.normal ?? selection?.faceNormalWorld ?? { x: 0, y: 0, z: 1 };
  const pushPullAxis = normalizeAxis(faceNormal);
  const nextPushPullDistance =
    typeof pushPullDistance === "number" ? round3(pushPullDistance) : round3(dy * -0.02);
  const moveDelta = worldDelta
    ? {
        x: round3(worldDelta.x),
        y: round3(worldDelta.y),
        z: round3(worldDelta.z),
      }
    : {
        x: round3(dx * 0.02),
        y: 0,
        z: round3(-dy * 0.02),
      };

  const rotateParams =
    selection?.mode === "face"
      ? faceRotateParams({
          selection,
          faceNormal,
          shiftKey,
          angle: round3(dx * 0.01),
          faceTiltAngles,
        })
      : {
          deltaEuler: { x: 0, y: round3(dx * 0.01), z: 0 },
        };

  const operation = {
    type: operationType,
    targetId,
    selection,
    params: {
      [OPERATION_TYPES.MOVE]: moveParams(selection, moveDelta),
      [OPERATION_TYPES.ROTATE]: rotateParams,
      [OPERATION_TYPES.SCALE]: {
        scaleFactor: {
          x: round3(1 + dy * -0.005),
          y: round3(1 + dy * -0.005),
          z: round3(1 + dy * -0.005),
        },
      },
      [OPERATION_TYPES.PUSH_PULL]: {
        axis: pushPullAxis,
        distance: nextPushPullDistance,
        mode: shiftKey ? "extend" : "move",
      },
    }[operationType] ?? {},
  };

  return validateOperation(operation);
}

function moveParams(selection, delta) {
  const params = { delta };
  const subshapeMove = subshapeMoveParams(selection, delta);
  if (subshapeMove) {
    params.subshapeMove = subshapeMove;
  }
  return params;
}

function subshapeMoveParams(selection, delta) {
  if (!selection || selection.mode === "object") {
    return null;
  }

  if (selection.mode === "face") {
    const identity = faceTiltIdentityFromSelection(selection, false);
    return {
      mode: "face",
      faceAxis: identity.faceAxis,
      faceSign: identity.faceSign,
      delta: { ...delta },
    };
  }

  if (selection.mode === "edge" && selection.edge) {
    return {
      mode: "edge",
      edge: structuredClone(selection.edge),
      delta: { ...delta },
    };
  }

  if (selection.mode === "vertex" && selection.vertex) {
    return {
      mode: "vertex",
      vertex: structuredClone(selection.vertex),
      delta: { ...delta },
    };
  }

  return null;
}


function faceRotateParams({ selection, faceNormal, shiftKey, angle, faceTiltAngles }) {
  const makeTilt = (alternateAxis, tiltAngle) => ({
    ...faceTiltIdentityFromSelection(selection, alternateAxis, faceNormal),
    angle: round3(tiltAngle),
  });

  if (faceTiltAngles && typeof faceTiltAngles === "object") {
    const faceTilts = [
      makeTilt(false, faceTiltAngles.normal ?? 0),
      makeTilt(true, faceTiltAngles.alternate ?? 0),
    ].filter((tilt) => Math.abs(tilt.angle) > 1e-6);
    return {
      deltaEuler: { x: 0, y: 0, z: 0 },
      faceTilts: faceTilts.length > 0 ? faceTilts : [makeTilt(Boolean(shiftKey), 0)],
    };
  }

  return {
    deltaEuler: { x: 0, y: 0, z: 0 },
    faceTilts: [makeTilt(Boolean(shiftKey), angle)],
  };
}

function faceTiltIdentityFromSelection(selection, alternateAxis = false, fallbackNormal = null) {
  const selectorIdentity = selectorFaceIdentity(selection?.selector);
  const normal = normalizeAxis(selection?.selector?.hint?.normal ?? fallbackNormal ?? selection?.faceNormalWorld ?? { x: 0, y: 0, z: 1 });
  if (selectorIdentity) {
    const hinge = hingeForFaceAxis(selectorIdentity.axis, alternateAxis);
    const basis = faceTiltBasis({
      normal,
      faceAxis: selectorIdentity.axis,
      alternateAxis,
    });
    return compactFaceTiltIdentity({
      faceAxis: selectorIdentity.axis,
      faceSign: selectorIdentity.sign,
      hingeAxis: hinge.axis,
      hingeSideAxis: hinge.sideAxis,
      hingeSideSign: 0,
      normal,
      basis,
    });
  }
  return faceTiltIdentity(normal, alternateAxis);
}

function faceTiltIdentity(faceNormalWorld, alternateAxis = false) {
  const faceNormal = normalizeAxis(faceNormalWorld);
  const entries = [
    ["x", faceNormal.x],
    ["y", faceNormal.y],
    ["z", faceNormal.z],
  ];
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const [faceAxis, component] = entries[0];
  const hinge = hingeForFaceAxis(faceAxis, alternateAxis);
  const basis = faceTiltBasis({ normal: faceNormal, faceAxis, alternateAxis });
  return compactFaceTiltIdentity({
    faceAxis,
    faceSign: Math.sign(component) || 1,
    hingeAxis: hinge.axis,
    hingeSideAxis: hinge.sideAxis,
    hingeSideSign: 0,
    normal: faceNormal,
    basis,
  });
}

function compactFaceTiltIdentity({ faceAxis, faceSign, hingeAxis, hingeSideAxis, hingeSideSign, normal, basis }) {
  const identity = {
    faceAxis,
    faceSign,
    hingeAxis,
    hingeSideAxis,
    hingeSideSign,
  };
  if (isAxisAligned(normal, faceAxis, faceSign)) {
    return identity;
  }
  return {
    ...identity,
    faceNormal: normal,
    hingeAxisVector: basis.hingeAxisVector,
    hingeSideVector: basis.hingeSideVector,
  };
}

function isAxisAligned(vector, axis, sign = 1) {
  return (
    Math.abs((vector?.[axis] ?? 0) - (Math.sign(sign) || 1)) <= 1e-6 &&
    ["x", "y", "z"].every((component) => (
      component === axis || Math.abs(vector?.[component] ?? 0) <= 1e-6
    ))
  );
}

function hingeForFaceAxis(faceAxis, alternateAxis) {
  if (faceAxis === "x") {
    return alternateAxis ? { axis: "z", sideAxis: "y" } : { axis: "y", sideAxis: "z" };
  }
  if (faceAxis === "y") {
    return alternateAxis ? { axis: "z", sideAxis: "x" } : { axis: "x", sideAxis: "z" };
  }
  return alternateAxis ? { axis: "y", sideAxis: "x" } : { axis: "x", sideAxis: "y" };
}

function faceTiltBasis({ normal, faceAxis, alternateAxis }) {
  const hinge = hingeForFaceAxis(faceAxis, alternateAxis);
  let side = projectOntoPlane(unitAxis(hinge.sideAxis), normal);
  if (vectorLength(side) < 1e-8) {
    side = fallbackPerpendicular(normal);
  }
  side = normalizeAxis(side);
  let hingeVector = projectOntoPlane(unitAxis(hinge.axis), normal);
  if (vectorLength(hingeVector) < 1e-8) {
    hingeVector = cross(normal, side);
  }
  hingeVector = normalizeAxis(hingeVector);
  return {
    hingeAxisVector: hingeVector,
    hingeSideVector: side,
  };
}

function unitAxis(axis) {
  return {
    x: axis === "x" ? 1 : 0,
    y: axis === "y" ? 1 : 0,
    z: axis === "z" ? 1 : 0,
  };
}

function projectOntoPlane(vector, normal) {
  const projection = dot(vector, normal);
  return {
    x: vector.x - normal.x * projection,
    y: vector.y - normal.y * projection,
    z: vector.z - normal.z * projection,
  };
}

function fallbackPerpendicular(normal) {
  const seed = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  return projectOntoPlane(seed, normal);
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a, b) {
  return (a.x ?? 0) * (b.x ?? 0) + (a.y ?? 0) * (b.y ?? 0) + (a.z ?? 0) * (b.z ?? 0);
}

function vectorLength(vector) {
  return Math.hypot(vector.x ?? 0, vector.y ?? 0, vector.z ?? 0);
}

function normalizeAxis(axis) {
  const length = Math.hypot(axis.x ?? 0, axis.y ?? 0, axis.z ?? 0);
  if (length < 1e-8) {
    return { x: 0, y: 0, z: 1 };
  }

  return {
    x: round3((axis.x ?? 0) / length),
    y: round3((axis.y ?? 0) / length),
    z: round3((axis.z ?? 0) / length),
  };
}

export function createPrimitiveOperation({
  primitive = "box",
  position = { x: 0, y: 0.5, z: 0 },
  size = { x: 1, y: 1, z: 1 },
  objectId,
}) {
  return validateOperation({
    type: OPERATION_TYPES.CREATE_PRIMITIVE,
    targetId: null,
    selection: null,
    params: { primitive, position, size, objectId },
  });
}

export function createGroupingOperation({ type, objectIds, groupId, componentId }) {
  return validateOperation({
    type,
    targetId: objectIds[0] ?? null,
    selection: { objectIds },
    params: { objectIds, groupId, componentId },
  });
}
