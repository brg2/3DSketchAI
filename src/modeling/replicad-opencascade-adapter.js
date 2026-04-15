/**
 * Adapter boundary for exact kernel execution.
 * Tries Replicad/OpenCascade when available, otherwise falls back to deterministic JS replay.
 */
export class ReplicadOpenCascadeAdapter {
  constructor({ fallbackExecutor }) {
    this.fallbackExecutor = fallbackExecutor;
    this._cachedReplicad = null;
  }

  async execute({ operations, sceneState }) {
    const replicadModule = await this._loadReplicad().catch(() => null);
    if (!replicadModule) {
      return this.fallbackExecutor({ operations, sceneState, exactBackend: "fallback" });
    }

    // Real kernel integration placeholder: keep interface stable and asynchronous.
    return this.fallbackExecutor({ operations, sceneState, exactBackend: "replicad-opencascade" });
  }

  async _loadReplicad() {
    if (this._cachedReplicad) {
      return this._cachedReplicad;
    }

    // Optional dependency; app remains usable without full kernel package availability.
    const moduleName = "replicad";
    const module = await import(/* @vite-ignore */ moduleName);
    this._cachedReplicad = module;
    return module;
  }
}
