import { OPERATION_TYPES, operationForTool } from "./operation-types.js";
import { validateOperation } from "./operation-validator.js";

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

export function mapToolGestureToOperation({ tool, targetId, selection, gesture }) {
  const operationType = operationForTool(tool);
  const { dx = 0, dy = 0, worldDelta = null, pushPullDistance = null } = gesture ?? {};
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

  const paramsByType = {
    [OPERATION_TYPES.MOVE]: {
      delta: moveDelta,
    },
    [OPERATION_TYPES.ROTATE]: {
      deltaEuler: { x: 0, y: round3(dx * 0.01), z: 0 },
    },
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
    },
  };

  const operation = {
    type: operationType,
    targetId,
    selection,
    params: paramsByType[operationType] ?? {},
  };

  return validateOperation(operation);
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
