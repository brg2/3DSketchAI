import { ReplicadOpenCascadeAdapter } from "./replicad-opencascade-adapter.js";

function cloneSceneState(sceneState) {
  const next = {};
  for (const [id, value] of Object.entries(sceneState)) {
    next[id] = {
      primitive: value.primitive,
      position: { ...value.position },
      rotation: { ...value.rotation },
      scale: { ...value.scale },
      faceTilts: Array.isArray(value.faceTilts) ? value.faceTilts.map((tilt) => structuredClone(tilt)) : [],
      faceExtrudes: Array.isArray(value.faceExtrudes) ? value.faceExtrudes.map((extrude) => structuredClone(extrude)) : [],
      subshapeMoves: Array.isArray(value.subshapeMoves) ? value.subshapeMoves.map((move) => structuredClone(move)) : [],
      faceExtensions: Array.isArray(value.faceExtensions) ? value.faceExtensions.map((extension) => structuredClone(extension)) : [],
      groupId: value.groupId ?? null,
      componentId: value.componentId ?? null,
    };
  }
  return next;
}

function applyPushPullToState(state, params) {
  if (state.primitive !== "box") {
    throw new Error("push_pull requires a solid modeling implementation for non-box targets");
  }
  if (params.mode === "extend") {
    state.faceExtensions = [...(state.faceExtensions ?? []), makeFaceOperation(params)];
    return;
  }
  state.faceExtrudes = [...(state.faceExtrudes ?? []), makeFaceOperation(params)];
}

function makeFaceOperation(params) {
  const axis = normalizeAxis(params.axis ?? { x: 0, y: 0, z: 1 });
  const faceAxis = dominantAxis(axis);
  return {
    faceIndex: Number.isInteger(params.faceIndex) ? params.faceIndex : null,
    axis,
    distance: params.distance ?? 0,
    faceAxis,
    faceSign: Math.sign(axis[faceAxis] ?? 0) || 1,
  };
}

function normalizeAxis(axis) {
  const length = Math.hypot(axis.x ?? 0, axis.y ?? 0, axis.z ?? 0);
  if (length < 1e-8) return { x: 0, y: 0, z: 1 };
  return { x: axis.x / length, y: axis.y / length, z: axis.z / length };
}

function dominantAxis(axis) {
  const entries = [
    ["x", axis.x ?? 0],
    ["y", axis.y ?? 0],
    ["z", axis.z ?? 0],
  ];
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return entries[0][0];
}

function replayOperations({ operations, sceneState, exactBackend }) {
  const nextState = cloneSceneState(sceneState);

  for (const operation of operations) {
    const target = operation.targetId ? nextState[operation.targetId] : null;

    switch (operation.type) {
      case "move":
        if (target) {
          if (operation.params.subshapeMove && target.primitive === "box") {
            target.subshapeMoves = [
              ...(target.subshapeMoves ?? []),
              structuredClone(operation.params.subshapeMove),
            ];
          } else {
            target.position.x += operation.params.delta.x;
            target.position.y += operation.params.delta.y;
            target.position.z += operation.params.delta.z;
          }
        }
        break;
      case "rotate":
        if (target) {
          if (operation.selection?.mode === "face" && operation.params.faceTilt) {
            const faceTilts = Array.isArray(operation.params.faceTilts)
              ? operation.params.faceTilts
              : [operation.params.faceTilt];
            target.faceTilts = [...(target.faceTilts ?? []), ...faceTilts.map((tilt) => structuredClone(tilt))];
          } else {
            target.rotation.x += operation.params.deltaEuler.x;
            target.rotation.y += operation.params.deltaEuler.y;
            target.rotation.z += operation.params.deltaEuler.z;
          }
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
            faceTilts: [],
            faceExtrudes: [],
            subshapeMoves: [],
            faceExtensions: [],
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
    this.adapter = adapter || new ReplicadOpenCascadeAdapter();
  }

  async executeCanonicalModel({ operations, sceneState }) {
    return this.adapter.execute({ operations, sceneState });
  }

  async executeStateReplay({ operations, sceneState }) {
    return replayOperations({ operations, sceneState, exactBackend: "state-replay" });
  }
}
