import { create3dsaiModelingLibrary } from "./3dsai-modeling.js";
import { serializeCanonicalModelModule } from "../operation/operation-serializer.js";
import opencascadeWasmUrl from "replicad-opencascadejs/src/replicad_single.wasm?url";

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
          meshSignature: `${meshData.vertices.length}:${meshData.triangles.length}:${meshData.normals.length}`,
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

    const [replicad, { default: initOpenCascade }] = await Promise.all([
      import("replicad"),
      import("replicad-opencascadejs"),
    ]);

    const OC = await initOpenCascade({ locateFile: () => opencascadeWasmUrl });
    replicad.setOC(OC);

    this._cachedReplicad = replicad;
    return replicad;
  }
}
