import { ReplicadOpenCascadeAdapter } from "./replicad-opencascade-adapter.js";

function cloneSceneState(sceneState) {
  const next = {};
  for (const [id, value] of Object.entries(sceneState)) {
    next[id] = {
      primitive: value.primitive,
      position: { ...value.position },
      rotation: { ...value.rotation },
      scale: { ...value.scale },
      groupId: value.groupId ?? null,
      componentId: value.componentId ?? null,
    };
  }
  return next;
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

function replayOperations({ operations, sceneState, exactBackend }) {
  const nextState = cloneSceneState(sceneState);

  for (const operation of operations) {
    const target = operation.targetId ? nextState[operation.targetId] : null;

    switch (operation.type) {
      case "move":
        if (target) {
          target.position.x += operation.params.delta.x;
          target.position.y += operation.params.delta.y;
          target.position.z += operation.params.delta.z;
        }
        break;
      case "rotate":
        if (target) {
          target.rotation.x += operation.params.deltaEuler.x;
          target.rotation.y += operation.params.deltaEuler.y;
          target.rotation.z += operation.params.deltaEuler.z;
        }
        break;
      case "scale":
        if (target) {
          target.scale.x *= Math.max(0.1, operation.params.scaleFactor.x);
          target.scale.y *= Math.max(0.1, operation.params.scaleFactor.y);
          target.scale.z *= Math.max(0.1, operation.params.scaleFactor.z);
        }
        break;
      case "push_pull":
        if (target) {
          applyPushPullToState(target, operation.params);
        }
        break;
      case "create_primitive": {
        const id = operation.params.objectId;
        if (id) {
          nextState[id] = {
            primitive: operation.params.primitive,
            position: { ...operation.params.position },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { ...operation.params.size },
            groupId: null,
            componentId: null,
          };
        }
        break;
      }
      case "group":
        for (const objectId of operation.params.objectIds) {
          if (nextState[objectId]) {
            nextState[objectId].groupId = operation.params.groupId;
          }
        }
        break;
      case "component":
        for (const objectId of operation.params.objectIds) {
          if (nextState[objectId]) {
            nextState[objectId].componentId = operation.params.componentId;
          }
        }
        break;
      default:
        break;
    }
  }

  return {
    kind: "exact_geometry",
    exactBackend,
    sceneState: nextState,
    operationCount: operations.length,
  };
}

export class ModelExecutor {
  constructor({ adapter } = {}) {
    this.adapter =
      adapter ||
      new ReplicadOpenCascadeAdapter({
        fallbackExecutor: async ({ operations, sceneState, exactBackend }) => {
          await Promise.resolve();
          return replayOperations({ operations, sceneState, exactBackend });
        },
      });
  }

  async executeCanonicalModel({ operations, sceneState }) {
    return this.adapter.execute({ operations, sceneState });
  }
}
