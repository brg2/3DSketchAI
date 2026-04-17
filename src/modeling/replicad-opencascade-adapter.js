import { create3dsaiModelingLibrary } from "./3dsai-modeling.js";
import { serializeCanonicalModelModule } from "../operation/operation-serializer.js";

/**
 * Adapter boundary for exact kernel execution.
 */
export class ReplicadOpenCascadeAdapter {
  constructor() {
    this._cachedReplicad = null;
  }

  async execute({ operations }) {
    const replicad = await this._loadReplicad();
    const sai = create3dsaiModelingLibrary();
    const script = serializeCanonicalModelModule(operations);

    // We execute the script to get the resulting shape.
    // The script is: "export const main = (r, sai) => { ... }"
    // We'll use a simple regex to get the function body.
    const bodyMatch = script.match(/export const main = \(r, sai\) => \{([\s\S]*)\}/);
    if (!bodyMatch) {
      throw new Error("Failed to parse canonical model script for execution");
    }

    const body = bodyMatch[1];
    const mainFunc = new Function("r", "sai", body);
    const shape = mainFunc(replicad, sai);

    // If the script returned null, return an empty state.
    if (!shape) {
      return {
        kind: "exact_geometry",
        exactBackend: "replicad",
        sceneState: {},
        operationCount: operations.length,
      };
    }

    const meshData = shape.mesh();

    return {
      kind: "exact_geometry",
      exactBackend: "replicad",
      sceneState: {
        obj_1: {
          primitive: "brep_mesh",
          meshData,
          meshSignature: meshDataSignature(meshData),
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        }
      },
      operationCount: operations.length,
    };
  }

  async executeStateReplay({ operations, sceneState, replayExecutor }) {
    if (typeof replayExecutor !== "function") {
      throw new Error("State replay requires an explicit replay executor");
    }
    return replayExecutor({ operations, sceneState, exactBackend: "state-replay" });
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
