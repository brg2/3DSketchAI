import { OPERATION_TYPES, operationForTool } from "./operation-types.js";
import { validateOperation } from "./operation-validator.js";

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

export function mapToolGestureToOperation({ tool, targetId, selection, gesture }) {
  const operationType = operationForTool(tool);
  const { dx = 0, dy = 0, shiftKey = false, worldDelta = null, pushPullDistance = null, faceTiltAngles = null } = gesture ?? {};
  const pushPullAxis = normalizeAxis(selection?.faceNormalWorld ?? { x: 0, y: 0, z: 1 });
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
          faceNormalWorld: selection.faceNormalWorld ?? { x: 0, y: 0, z: 1 },
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
        faceIndex: selection?.faceIndex ?? null,
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
    const identity = faceTiltIdentity(selection.faceNormalWorld ?? { x: 0, y: 0, z: 1 }, false);
    return {
      mode: "face",
      faceIndex: selection.faceIndex ?? null,
      faceNormalWorld: identity.faceNormalWorld,
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


function faceRotateParams({ selection, faceNormalWorld, shiftKey, angle, faceTiltAngles }) {
  const makeTilt = (alternateAxis, tiltAngle) => ({
    faceIndex: selection.faceIndex ?? null,
    ...faceTiltIdentity(faceNormalWorld, alternateAxis),
    angle: round3(tiltAngle),
  });

  if (faceTiltAngles && typeof faceTiltAngles === "object") {
    const faceTilts = [
      makeTilt(false, faceTiltAngles.normal ?? 0),
      makeTilt(true, faceTiltAngles.alternate ?? 0),
    ].filter((tilt) => Math.abs(tilt.angle) > 1e-6);
    return {
      deltaEuler: { x: 0, y: 0, z: 0 },
      faceTilt: faceTilts.at(-1) ?? makeTilt(Boolean(shiftKey), 0),
      faceTilts,
    };
  }

  return {
    deltaEuler: { x: 0, y: 0, z: 0 },
    faceTilt: makeTilt(Boolean(shiftKey), angle),
  };
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
  return {
    faceNormalWorld: faceNormal,
    faceAxis,
    faceSign: Math.sign(component) || 1,
    hingeAxis: hinge.axis,
    hingeSideAxis: hinge.sideAxis,
    hingeSideSign: -1,
  };
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
