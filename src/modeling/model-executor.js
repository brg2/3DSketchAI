import { featureGraphFromOperations } from "../feature/feature-store.js";
import { replayFeaturesToSceneState } from "../feature/feature-replay.js";
import { ReplicadOpenCascadeAdapter } from "./replicad-opencascade-adapter.js";

export class ModelExecutor {
  constructor({ adapter } = {}) {
    this.adapter = adapter || new ReplicadOpenCascadeAdapter();
  }

  async executeCanonicalModel({ features, operations, sceneState }) {
    return this.adapter.execute({
      features: features ?? featureGraphFromOperations(operations ?? []),
      sceneState,
    });
  }

  async executeStateReplay({ features, operations, sceneState, exactBackend = "state-replay:no-exact-kernel" }) {
    await Promise.resolve();
    void sceneState;
    return replayFeaturesToSceneState({
      features: features ?? featureGraphFromOperations(operations ?? []),
      exactBackend,
    });
  }
}
