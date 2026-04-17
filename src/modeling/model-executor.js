import { ReplicadOpenCascadeAdapter } from "./replicad-opencascade-adapter.js";

export class ModelExecutor {
  constructor({ adapter } = {}) {
    this.adapter = adapter || new ReplicadOpenCascadeAdapter();
  }

  async executeCanonicalModel({ operations, sceneState }) {
    return this.adapter.execute({ operations, sceneState });
  }

  async executeStateReplay({ operations, sceneState, exactBackend = "state-replay:no-exact-kernel" }) {
    await Promise.resolve();
    return replayOperations({ operations, sceneState, exactBackend });
  }
}

function replayOperations({ operations, exactBackend }) {
  const nextState = {};

  for (const operation of operations ?? []) {
    const target = operation.targetId ? nextState[operation.targetId] : null;

    switch (operation.type) {
      case "create_primitive": {
        const id = operation.params.objectId;
        if (id) {
          nextState[id] = {
            primitive: operation.params.primitive,
            position: { ...(operation.params.position ?? { x: 0, y: 0, z: 0 }) },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { ...(operation.params.size ?? { x: 1, y: 1, z: 1 }) },
            groupId: null,
            componentId: null,
          };
        }
        break;
      }
      case "move":
        if (target && !operation.params.subshapeMove) {
          target.position.x += operation.params.delta.x;
          target.position.y += operation.params.delta.y;
          target.position.z += operation.params.delta.z;
        }
        break;
      case "rotate":
        if (target && operation.params.deltaEuler) {
          target.rotation.x += operation.params.deltaEuler.x;
          target.rotation.y += operation.params.deltaEuler.y;
          target.rotation.z += operation.params.deltaEuler.z;
        }
        break;
      case "scale":
        if (target && operation.params.scaleFactor) {
          target.scale.x *= Math.max(0.1, operation.params.scaleFactor.x);
          target.scale.y *= Math.max(0.1, operation.params.scaleFactor.y);
          target.scale.z *= Math.max(0.1, operation.params.scaleFactor.z);
        }
        break;
      case "group":
        for (const objectId of operation.params.objectIds ?? []) {
          if (nextState[objectId]) {
            nextState[objectId].groupId = operation.params.groupId;
          }
        }
        break;
      case "component":
        for (const objectId of operation.params.objectIds ?? []) {
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
    operationCount: operations?.length ?? 0,
  };
}
