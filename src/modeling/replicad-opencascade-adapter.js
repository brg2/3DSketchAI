/**
 * Adapter boundary for exact kernel execution.
 * Refuses to produce exact geometry unless Replicad/OpenCascade execution is wired.
 */
export class ReplicadOpenCascadeAdapter {
  constructor() {
    this._cachedReplicad = null;
  }

  async execute({ operations, sceneState }) {
    await this._loadReplicad();
    throw new Error(
      `Replicad/OpenCascade exact execution is not implemented for ${operations.length} operation(s); refusing to use fallback geometry.`,
    );
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

    // Optional dependency; app remains usable without full kernel package availability.
    const module = await import("replicad");
    this._cachedReplicad = module;
    return module;
  }
}
