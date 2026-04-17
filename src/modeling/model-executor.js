import { ReplicadOpenCascadeAdapter } from "./replicad-opencascade-adapter.js";

export class ModelExecutor {
  constructor({ adapter } = {}) {
    this.adapter = adapter || new ReplicadOpenCascadeAdapter();
  }

  async executeCanonicalModel({ operations, sceneState }) {
    return this.adapter.execute({ operations, sceneState });
  }
}
