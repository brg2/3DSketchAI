import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeController } from "../src/app/runtime-controller.js";
import { CanonicalModel } from "../src/modeling/canonical-model.js";
import { createPrimitiveOperation } from "../src/operation/operation-mapper.js";
import { OPERATION_TYPES } from "../src/operation/operation-types.js";
import { parseOperationsFromCanonicalModelCode } from "../src/operation/operation-serializer.js";

function createRepresentationStore(initialState = {}) {
  let exactSceneState = structuredClone(initialState);
  return {
    bindScene() {},
    setInitialSceneState(sceneState) {
      exactSceneState = structuredClone(sceneState);
    },
    setPreviewOperation() {},
    clearPreview() {},
    replaceWithExact(exactRepresentation) {
      exactSceneState = structuredClone(exactRepresentation.sceneState);
    },
    getExactSceneState() {
      return structuredClone(exactSceneState);
    },
    snapshot() {
      return {
        previewOperation: null,
        exactSceneState: structuredClone(exactSceneState),
      };
    },
  };
}

class InMemoryModelScriptStore {
  constructor(initialScript = null) {
    this.script = initialScript;
    this.saved = [];
    this.cleared = 0;
  }

  async saveScript(code) {
    this.script = code;
    this.saved.push(code);
  }

  async loadScript() {
    return this.script;
  }

  async clear() {
    this.script = null;
    this.cleared += 1;
  }
}

test("canonical script round-trip preserves push_pull operation payload", () => {
  const model = new CanonicalModel();
  model.appendCommittedOperation(
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.5, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  );
  model.appendCommittedOperation({
    type: OPERATION_TYPES.PUSH_PULL,
    targetId: "obj_1",
    selection: { mode: "face", objectId: "obj_1", faceIndex: 0 },
    params: {
      axis: { x: 1, y: 0, z: 0 },
      distance: 3.74,
    },
  });

  const code = model.toTypeScriptModule();
  assert.match(code, /r\.makeBox\(/, "Serialized script should emit direct Replicad calls");
  assert.match(code, /push_pull/, "Serialized script should preserve push_pull metadata in comments");
  assert.doesNotMatch(code, /CANONICAL_OPS/, "Serialized script should not embed an operation array");

  const parsed = parseOperationsFromCanonicalModelCode(code);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].type, OPERATION_TYPES.PUSH_PULL);
  assert.equal(parsed[1].targetId, "obj_1");
  assert.deepEqual(parsed[1].params.axis, { x: 1, y: 0, z: 0 });
  assert.equal(parsed[1].params.distance, 3.74);
});

test("runtime loads persisted script on clean slate and persists on commit", async () => {
  const scriptModel = new CanonicalModel();
  scriptModel.appendCommittedOperation(
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.5, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  );
  const persistedScript = scriptModel.toTypeScriptModule();
  const scriptStore = new InMemoryModelScriptStore(persistedScript);

  const executeCalls = [];
  const modelExecutor = {
    async executeCanonicalModel(input) {
      executeCalls.push(structuredClone(input));
      return {
        exactBackend: "fallback",
        sceneState: structuredClone(input.sceneState),
        operationCount: input.operations.length,
      };
    },
  };

  const staleState = {
    stale_obj: {
      primitive: "box",
      position: { x: 5, y: 0.5, z: 5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      groupId: null,
      componentId: null,
    },
  };

  const runtime = new RuntimeController({
    canonicalModel: new CanonicalModel(),
    modelExecutor,
    representationStore: createRepresentationStore(staleState),
    modelScriptStore: scriptStore,
  });
  runtime.initialize({ scene: null, seedSceneState: staleState });

  const loaded = await runtime.loadCanonicalModelFromStorage({ reload: true, cleanSlate: true });
  assert.equal(loaded.length, 1, "Expected one operation loaded from persisted script");
  assert.deepEqual(executeCalls[0].sceneState, {}, "Reload must execute script from a clean scene state");

  await runtime.commitOperation({
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { delta: { x: 1, y: 0, z: 0 } },
  });

  assert.equal(scriptStore.saved.length, 1, "Each committed action should persist the canonical script");
  assert.match(scriptStore.saved[0], /translate\(/, "Persisted script should contain the committed operation");
  assert.doesNotMatch(scriptStore.saved[0], /CANONICAL_OPS/, "Persisted script should be direct code, not an operation array");
});

test("runtime compresses adjacent translates for the same object into one direct translate call", async () => {
  const scriptStore = new InMemoryModelScriptStore();
  const modelExecutor = {
    async executeCanonicalModel(input) {
      return {
        exactBackend: "fallback",
        sceneState: structuredClone(input.sceneState),
        operationCount: input.operations.length,
      };
    },
  };
  const runtime = new RuntimeController({
    canonicalModel: new CanonicalModel(),
    modelExecutor,
    representationStore: createRepresentationStore(),
    modelScriptStore: scriptStore,
  });
  runtime.initialize({ scene: null, seedSceneState: {} });

  await runtime.commitOperation(
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  );
  await runtime.commitOperation({
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { delta: { x: 0.734, y: 0, z: 5.459 } },
  });
  await runtime.commitOperation({
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { delta: { x: 0.805, y: 0, z: -4.693 } },
  });

  const { canonicalCode, operationCount } = await runtime.compressCanonicalModel();

  assert.equal(operationCount, 2);
  assert.match(canonicalCode, /obj_1 = obj_1\.translate\(\[1\.539, 0, 0\.766\]\);/);
  assert.equal(canonicalCode.match(/\.translate\(/g)?.length, 1);
  assert.doesNotMatch(canonicalCode, /CANONICAL_OPS/, "Compressed script should remain direct code, not an operation array");
  assert.equal(scriptStore.saved.at(-1), canonicalCode, "Compressed script should persist as the new canonical script");
});
