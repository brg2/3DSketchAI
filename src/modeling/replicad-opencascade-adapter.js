import { create3dsaiModelingLibrary } from "./3dsai-modeling.js";
import { replayFeaturesToSceneState, replayFeaturesToShapes } from "../feature/feature-replay.js";
import { annotateMeshDataWithFeatureProvenance } from "../feature/feature-provenance.js";

/**
 * Adapter boundary for exact kernel execution.
 */
export class ReplicadOpenCascadeAdapter {
  constructor() {
    this._cachedReplicad = null;
  }

  async execute({ features = [] }) {
    const replicad = await this._loadReplicad();
    const sai = create3dsaiModelingLibrary();
    const transformReplay = replayFeaturesToSceneState({ features, exactBackend: "replicad:transforms" });
    const replayed = replayFeaturesToShapes({ features, r: replicad, sai, bakeObjectRotations: false });

    if (!replayed.shape) {
      return {
        kind: "exact_geometry",
        exactBackend: "replicad",
        sceneState: {},
        operationCount: features.length,
      };
    }

    const sceneState = {};
    for (const [objectId, shape] of replayed.objectShapes.entries()) {
      const transformState = transformReplay.sceneState[objectId] ?? null;
      const meshData = meshDataForDisplayTransform(
        annotateMeshDataWithFeatureProvenance(shape.mesh(), { objectId, features }),
        transformState,
      );
      sceneState[objectId] = {
        primitive: "brep_mesh",
        meshData,
        meshSignature: meshDataSignature(meshData),
        position: shouldUseDisplayTransform(transformState) ? { ...transformState.position } : { x: 0, y: 0, z: 0 },
        rotation: shouldUseDisplayTransform(transformState) ? { ...transformState.rotation } : { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
    }

    return {
      kind: "exact_geometry",
      exactBackend: "replicad",
      sceneState,
      operationCount: features.length,
    };
  }

  async executeStateReplay({ features, operations, sceneState, replayExecutor }) {
    if (typeof replayExecutor !== "function") {
      throw new Error("State replay requires an explicit replay executor");
    }
    return replayExecutor({ features, operations, sceneState, exactBackend: "feature-replay" });
  }

  async _loadReplicad() {
    if (this._cachedReplicad) {
      return this._cachedReplicad;
    }

    const [replicad, { default: initOpenCascade }, wasmModule] = await Promise.all([
      import("replicad"),
      import("replicad-opencascadejs"),
      import("replicad-opencascadejs/src/replicad_single.wasm?url"),
    ]);

    const opencascadeWasmUrl = wasmModule.default;
    const OC = await initOpenCascade({ locateFile: () => opencascadeWasmUrl });
    replicad.setOC(OC);

    this._cachedReplicad = replicad;
    return replicad;
  }
}

function shouldUseDisplayTransform(state) {
  return Boolean(state && (
    Math.abs(state.rotation?.x ?? 0) > 1e-8 ||
    Math.abs(state.rotation?.y ?? 0) > 1e-8 ||
    Math.abs(state.rotation?.z ?? 0) > 1e-8
  ));
}

export function meshDataForDisplayTransform(meshData, transformState) {
  if (!shouldUseDisplayTransform(transformState)) {
    return meshData;
  }
  const position = transformState.position ?? { x: 0, y: 0, z: 0 };
  const sourceVertices = meshData?.vertices ?? meshData?.positions ?? [];
  const vertices = [...sourceVertices];
  for (let offset = 0; offset < vertices.length; offset += 3) {
    vertices[offset + 0] = (vertices[offset + 0] ?? 0) - (position.x ?? 0);
    vertices[offset + 1] = (vertices[offset + 1] ?? 0) - (position.y ?? 0);
    vertices[offset + 2] = (vertices[offset + 2] ?? 0) - (position.z ?? 0);
  }
  return {
    ...meshData,
    vertices,
    positions: meshData?.positions ? vertices : meshData?.positions,
    featureSpaceOrigin: { x: position.x ?? 0, y: position.y ?? 0, z: position.z ?? 0 },
  };
}

export function meshDataSignature(meshData) {
  const vertices = meshData?.vertices ?? meshData?.positions ?? [];
  const triangles = meshData?.triangles ?? meshData?.indices ?? [];
  const normals = meshData?.normals ?? [];
  const bounds = vertexBounds(vertices);
  let hash = 2166136261;
  hash = hashNumberArray(hash, vertices);
  hash = hashNumberArray(hash, triangles);
  hash = hashNumberArray(hash, normals);

  return [
    `v${vertices.length}`,
    `t${triangles.length}`,
    `n${normals.length}`,
    `b${bounds.map(formatSignatureNumber).join(",")}`,
    `h${hash.toString(16)}`,
  ].join(":");
}

function vertexBounds(vertices) {
  if (!vertices.length) {
    return [0, 0, 0, 0, 0, 0];
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let offset = 0; offset < vertices.length; offset += 3) {
    const x = vertices[offset + 0] ?? 0;
    const y = vertices[offset + 1] ?? 0;
    const z = vertices[offset + 2] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return [minX, minY, minZ, maxX, maxY, maxZ];
}

function hashNumberArray(hash, values) {
  for (const value of values) {
    const text = formatSignatureNumber(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    hash ^= 124;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function formatSignatureNumber(value) {
  return Number(value ?? 0).toPrecision(12);
}
