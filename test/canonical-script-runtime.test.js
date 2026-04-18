import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeController } from "../src/app/runtime-controller.js";
import { CanonicalModel } from "../src/modeling/canonical-model.js";
import { ModelExecutor } from "../src/modeling/model-executor.js";
import { createPrimitiveOperation, mapToolGestureToOperation } from "../src/operation/operation-mapper.js";
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

function assertNoBehaviorComments(code) {
  assert.doesNotMatch(code, /\/\/\s*(op|face_rotate|push_pull|group|component)\b/);
  assert.doesNotMatch(code, /CANONICAL_OPS/);
}

function parseFeatureGraph(json) {
  const parsed = JSON.parse(json);
  assert.ok(Array.isArray(parsed.features), "Feature graph JSON must include features");
  return parsed.features;
}

function createModelWithOperations(operations) {
  const model = new CanonicalModel();
  for (const operation of operations) {
    model.appendCommittedOperation(operation);
  }
  return model;
}

test("canonical script serializes push_pull as direct callable geometry code without comment metadata", () => {
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
  assert.match(code, /const obj_1 = sai\.makeBox\(r,/, "Push/pull targets should be editable modeling objects");
  assert.match(code, /sai\.pushPullFace\(r, obj_1,/);
  assert.match(code, /return obj_1\.toShape\(\);/);
  assert.doesNotMatch(code, /\.scale\(/, "Push/pull must not lower to scale");
  assert.doesNotMatch(code, /\.translate\(/, "Push/pull must not lower to translate");
  assertNoBehaviorComments(code);

  const parsed = parseOperationsFromCanonicalModelCode(code);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].type, OPERATION_TYPES.PUSH_PULL);
  assert.equal(parsed[1].targetId, "obj_1");
  assert.deepEqual(parsed[1].params.axis, { x: 1, y: 0, z: 0 });
  assert.equal(parsed[1].params.distance, 3.74);
});

test("canonical script serializes tilted face push_pull as direct face extrusion helper call", () => {
  const model = new CanonicalModel();
  model.appendCommittedOperation(
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  );
  model.appendCommittedOperation({
    type: OPERATION_TYPES.ROTATE,
    targetId: "obj_1",
    selection: { mode: "face", objectId: "obj_1", objectIds: ["obj_1"], faceIndex: 5 },
    params: {
      deltaEuler: { x: 0, y: 0, z: 0 },
      faceTilt: {
        faceIndex: 5,
        faceNormalWorld: { x: 0, y: 1, z: 0 },
        faceAxis: "y",
        faceSign: 1,
        hingeAxis: "x",
        hingeSideAxis: "z",
        hingeSideSign: 0,
        angle: 0.4,
      },
    },
  });
  model.appendCommittedOperation({
    type: OPERATION_TYPES.PUSH_PULL,
    targetId: "obj_1",
    selection: { mode: "face", objectId: "obj_1", objectIds: ["obj_1"], faceIndex: 5 },
    params: {
      axis: { x: 0, y: 0.921061, z: 0.389418 },
      distance: 1.25,
      faceIndex: 5,
    },
  });

  const code = model.toTypeScriptModule();
  assert.match(code, /sai\.pushPullFace\(r, obj_1,/);
  assert.match(code, /"mode":"move"/);
  assert.doesNotMatch(code, /\.scale\(\[1,\s*[\d.]+,\s*1\]\)/, "Tilted face extrusion should not flatten to Y scale");
  assertNoBehaviorComments(code);

  const parsed = parseOperationsFromCanonicalModelCode(code);
  assert.equal(parsed.at(-1).type, OPERATION_TYPES.PUSH_PULL);
  assert.equal(parsed.at(-1).params.axis.x, 0);
  assert.ok(Math.abs(parsed.at(-1).params.axis.y - 0.921061) < 1e-5);
  assert.ok(Math.abs(parsed.at(-1).params.axis.z - 0.389418) < 1e-5);
  assert.equal(parsed.at(-1).params.distance, 1.25);
});

test("canonical script serializes shift push_pull as face extension helper call", () => {
  const model = new CanonicalModel();
  model.appendCommittedOperation(
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  );
  model.appendCommittedOperation({
    type: OPERATION_TYPES.PUSH_PULL,
    targetId: "obj_1",
    selection: { mode: "face", objectId: "obj_1", objectIds: ["obj_1"], faceIndex: 5 },
    params: {
      axis: { x: 0, y: 1, z: 0 },
      distance: 1.2,
      faceIndex: 5,
      mode: "extend",
    },
  });

  const code = model.toTypeScriptModule();
  assert.match(code, /sai\.pushPullFace\(r, obj_1,/);
  assert.match(code, /"mode":"extend"/);
  assert.doesNotMatch(code, /\.scale\(/, "Shift push-pull extension should not serialize as body scale");
  assertNoBehaviorComments(code);

  const parsed = parseOperationsFromCanonicalModelCode(code);
  assert.equal(parsed.at(-1).type, OPERATION_TYPES.PUSH_PULL);
  assert.equal(parsed.at(-1).params.mode, "extend");
  assert.equal(parsed.at(-1).params.distance, 1.2);
});

test("runtime loads persisted feature graph on clean slate and persists on commit", async () => {
  const scriptModel = new CanonicalModel();
  scriptModel.appendCommittedOperation(
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.5, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  );
  const persistedScript = scriptModel.toFeatureGraphJSON();
  const scriptStore = new InMemoryModelScriptStore(persistedScript);

  const executeCalls = [];
  const modelExecutor = {
    async executeCanonicalModel(input) {
      executeCalls.push(structuredClone(input));
      return {
        exactBackend: "test-double",
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
  assert.equal(loaded.length, 1, "Expected one operation loaded from persisted feature graph");
  assert.deepEqual(executeCalls[0].sceneState, {}, "Reload must execute feature graph from a clean scene state");

  await runtime.commitOperation({
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { delta: { x: 1, y: 0, z: 0 } },
  });

  assert.equal(scriptStore.saved.length, 1, "Each committed action should persist the canonical feature graph");
  const savedFeatures = parseFeatureGraph(scriptStore.saved[0]);
  assert.equal(savedFeatures.length, 1);
  assert.equal(savedFeatures[0].type, OPERATION_TYPES.CREATE_PRIMITIVE);
  assert.deepEqual(savedFeatures[0].params.position, { x: 1, y: 0.5, z: 0 });
});

test("runtime refuses persisted TypeScript as model input", async () => {
  const scriptStore = new InMemoryModelScriptStore("export const main = () => null;");
  const runtime = new RuntimeController({
    canonicalModel: new CanonicalModel(),
    modelExecutor: {
      async executeCanonicalModel() {
        throw new Error("TypeScript input should not reach execution");
      },
    },
    representationStore: createRepresentationStore({}),
    modelScriptStore: scriptStore,
  });
  runtime.initialize({ scene: null, seedSceneState: {} });

  const loaded = await runtime.loadCanonicalModelFromStorage({ reload: true, cleanSlate: true });

  assert.deepEqual(loaded, []);
  assert.equal(scriptStore.script, null);
  assert.deepEqual(parseFeatureGraph(runtime.getSnapshot().canonicalGraphJson), []);
});

test("runtime creates a default cube when no feature graph exists", async () => {
  const scriptStore = new InMemoryModelScriptStore();
  const stateReplayExecutor = new ModelExecutor({ adapter: { async execute() { throw new Error("exact kernel unavailable in test"); } } });
  const modelExecutor = {
    async executeCanonicalModel(input) {
      return stateReplayExecutor.executeStateReplay(input);
    },
  };
  const runtime = new RuntimeController({
    canonicalModel: new CanonicalModel(),
    modelExecutor,
    representationStore: createRepresentationStore({}),
    modelScriptStore: scriptStore,
  });
  runtime.initialize({ scene: null, seedSceneState: {} });

  const loaded = await runtime.loadCanonicalModelFromStorage({ reload: true, cleanSlate: true });
  assert.equal(loaded.length, 0);

  const result = await runtime.ensureDefaultModel();
  assert.equal(result.operations.length, 1);
  assert.equal(parseFeatureGraph(result.canonicalGraphJson)[0].type, OPERATION_TYPES.CREATE_PRIMITIVE);
  assert.equal(parseFeatureGraph(scriptStore.script)[0].params.objectId, "obj_1");
  assert.equal(runtime.getSnapshot().representation.exactSceneState.obj_1.primitive, "box");
});

test("runtime starts with explicit state replay test executor", async () => {
  const scriptModel = new CanonicalModel();
  scriptModel.appendCommittedOperation(
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  );
  const scriptStore = new InMemoryModelScriptStore(scriptModel.toFeatureGraphJSON());
  const stateReplayExecutor = new ModelExecutor({
    adapter: {
      async execute() {
        throw new Error("Replicad/OpenCascade exact execution is not implemented for 1 operation(s); refusing to use fallback geometry.");
      },
    },
  });
  const modelExecutor = {
    async executeCanonicalModel(input) {
      return stateReplayExecutor.executeStateReplay(input);
    },
  };
  const runtime = new RuntimeController({
    canonicalModel: new CanonicalModel(),
    modelExecutor,
    representationStore: createRepresentationStore({}),
    modelScriptStore: scriptStore,
  });
  runtime.initialize({ scene: null, seedSceneState: {} });

  const loaded = await runtime.loadCanonicalModelFromStorage({ reload: true, cleanSlate: true });

  assert.equal(loaded.length, 1);
  assert.equal(runtime.getSnapshot().exactBackend, "state-replay:no-exact-kernel");
  assert.equal(runtime.getSnapshot().representation.exactSceneState.obj_1.primitive, "box");
});

test("runtime folds adjacent whole-object moves into the primitive position", async () => {
  const scriptStore = new InMemoryModelScriptStore();
  const modelExecutor = {
    async executeCanonicalModel(input) {
      return {
        exactBackend: "test-double",
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

  const { canonicalGraphJson, operationCount } = await runtime.compressCanonicalModel();

  assert.equal(operationCount, 1);
  const features = parseFeatureGraph(canonicalGraphJson);
  assert.equal(features[0].type, OPERATION_TYPES.CREATE_PRIMITIVE);
  assert.deepEqual(features[0].params.position, { x: 1.539, y: 0.6, z: 0.766 });
  assert.equal(scriptStore.saved.at(-1), canonicalGraphJson, "Compacted graph should persist as the canonical feature graph");
});

test("runtime compresses adjacent scales for the same object into one direct scale call", async () => {
  const scriptStore = new InMemoryModelScriptStore();
  const modelExecutor = {
    async executeCanonicalModel(input) {
      return {
        exactBackend: "test-double",
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

  const model = createModelWithOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
    ...[
      { x: 1, y: 1.908, z: 1 },
      { x: 1, y: 1, z: 1.543 },
      { x: 1.594, y: 1, z: 1 },
      { x: 1, y: 1, z: 1.529 },
      { x: 1, y: 5.854, z: 1 },
      { x: 2.881, y: 1, z: 1 },
      { x: 1, y: -3.742, z: 1 },
    ].map((scaleFactor) => ({
      type: OPERATION_TYPES.SCALE,
      targetId: "obj_1",
      selection: null,
      params: { scaleFactor },
    })),
  ]);
  await runtime.reloadFromFeatureGraphJson(model.toFeatureGraphJSON(), { cleanSlate: true });

  const { canonicalGraphJson, operationCount } = await runtime.compressCanonicalModel();

  assert.equal(operationCount, 2);
  const features = parseFeatureGraph(canonicalGraphJson);
  assert.equal(features[1].type, OPERATION_TYPES.SCALE);
  assert.deepEqual(features[1].params.scaleFactor, { x: 4.592, y: 1.117, z: 2.359 });
  assert.equal(scriptStore.saved.at(-1), canonicalGraphJson, "Compacted graph should persist as the canonical feature graph");
});

test("runtime compresses interleaved scale and translate runs for the same object", async () => {
  const scriptStore = new InMemoryModelScriptStore();
  const modelExecutor = {
    async executeCanonicalModel(input) {
      return {
        exactBackend: "test-double",
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

  const model = createModelWithOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
    { type: OPERATION_TYPES.SCALE, targetId: "obj_1", selection: null, params: { scaleFactor: { x: 1, y: 1, z: 2.49 } } },
    { type: OPERATION_TYPES.MOVE, targetId: "obj_1", selection: null, params: { delta: { x: 0, y: 0, z: -0.745 } } },
    { type: OPERATION_TYPES.SCALE, targetId: "obj_1", selection: null, params: { scaleFactor: { x: 1, y: 1, z: 1.401 } } },
    { type: OPERATION_TYPES.MOVE, targetId: "obj_1", selection: null, params: { delta: { x: 0, y: 0, z: -0.499 } } },
    { type: OPERATION_TYPES.SCALE, targetId: "obj_1", selection: null, params: { scaleFactor: { x: 1, y: 1, z: 1.195 } } },
    { type: OPERATION_TYPES.MOVE, targetId: "obj_1", selection: null, params: { delta: { x: 0, y: 0, z: -0.34 } } },
    { type: OPERATION_TYPES.SCALE, targetId: "obj_1", selection: null, params: { scaleFactor: { x: 2.961, y: 1, z: 1 } } },
    { type: OPERATION_TYPES.MOVE, targetId: "obj_1", selection: null, params: { delta: { x: 0.981, y: 0, z: 0 } } },
    { type: OPERATION_TYPES.SCALE, targetId: "obj_1", selection: null, params: { scaleFactor: { x: 1.206, y: 1, z: 1 } } },
    { type: OPERATION_TYPES.MOVE, targetId: "obj_1", selection: null, params: { delta: { x: 0.305, y: 0, z: 0 } } },
    { type: OPERATION_TYPES.SCALE, targetId: "obj_1", selection: null, params: { scaleFactor: { x: 1.058, y: 1, z: 1 } } },
    { type: OPERATION_TYPES.MOVE, targetId: "obj_1", selection: null, params: { delta: { x: 0.103, y: 0, z: 0 } } },
    { type: OPERATION_TYPES.SCALE, targetId: "obj_1", selection: null, params: { scaleFactor: { x: 1, y: 1.398, z: 1 } } },
    { type: OPERATION_TYPES.MOVE, targetId: "obj_1", selection: null, params: { delta: { x: 0, y: 0.199, z: 0 } } },
    { type: OPERATION_TYPES.SCALE, targetId: "obj_1", selection: null, params: { scaleFactor: { x: 1, y: 1.386, z: 1 } } },
    { type: OPERATION_TYPES.MOVE, targetId: "obj_1", selection: null, params: { delta: { x: 0, y: 0.27, z: 0 } } },
  ]);
  await runtime.reloadFromFeatureGraphJson(model.toFeatureGraphJSON(), { cleanSlate: true });

  const { canonicalGraphJson, operationCount } = await runtime.compressCanonicalModel();

  assert.equal(operationCount, 3);
  const features = parseFeatureGraph(canonicalGraphJson);
  assert.equal(features[1].type, OPERATION_TYPES.SCALE);
  assert.deepEqual(features[1].params.scaleFactor, { x: 3.778, y: 1.938, z: 4.168 });
  assert.equal(features[2].type, OPERATION_TYPES.MOVE);
  assert.deepEqual(features[2].params.delta, { x: 1.389, y: 0.469, z: -1.584 });
  assert.equal(scriptStore.saved.at(-1), canonicalGraphJson, "Compacted graph should persist as the canonical feature graph");
});

test("runtime can compress again after appending push-pull to an already compressed model", async () => {
  const scriptStore = new InMemoryModelScriptStore();
  const modelExecutor = {
    async executeCanonicalModel(input) {
      return {
        exactBackend: "test-double",
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

  const model = createModelWithOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
    { type: OPERATION_TYPES.SCALE, targetId: "obj_1", selection: null, params: { scaleFactor: { x: 1, y: 1, z: 2.49 } } },
    { type: OPERATION_TYPES.MOVE, targetId: "obj_1", selection: null, params: { delta: { x: 0, y: 0, z: -0.745 } } },
    { type: OPERATION_TYPES.SCALE, targetId: "obj_1", selection: null, params: { scaleFactor: { x: 1, y: 1, z: 1.401 } } },
    { type: OPERATION_TYPES.MOVE, targetId: "obj_1", selection: null, params: { delta: { x: 0, y: 0, z: -0.499 } } },
  ]);
  await runtime.reloadFromFeatureGraphJson(model.toFeatureGraphJSON(), { cleanSlate: true });
  await runtime.compressCanonicalModel();
  await runtime.commitOperation({
    type: OPERATION_TYPES.PUSH_PULL,
    targetId: "obj_1",
    selection: { mode: "face", objectId: "obj_1", objectIds: ["obj_1"], faceNormalWorld: { x: 0, y: 0, z: 1 } },
    params: {
      axis: { x: 0, y: 0, z: 1 },
      distance: 1,
    },
  });

  const { canonicalGraphJson, operationCount } = await runtime.compressCanonicalModel();

  assert.equal(operationCount, 4);
  const features = parseFeatureGraph(canonicalGraphJson);
  assert.deepEqual(features.map((feature) => feature.type), [
    OPERATION_TYPES.CREATE_PRIMITIVE,
    OPERATION_TYPES.SCALE,
    OPERATION_TYPES.MOVE,
    OPERATION_TYPES.PUSH_PULL,
  ]);
  assert.deepEqual(features[1].params.scaleFactor, { x: 1, y: 1, z: 3.488 });
  assert.deepEqual(features[2].params.delta, { x: 0, y: 0, z: -1.244 });
  assert.equal(features[3].params.distance, 1);
});

test("face rotate maps to a face tilt and serializes without object rotation", () => {
  const operation = mapToolGestureToOperation({
    tool: "rotate",
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      faceIndex: 2,
      faceNormalWorld: { x: 1, y: 0, z: 0 },
    },
    gesture: { dx: 25, dy: 0, shiftKey: true },
  });

  assert.equal(operation.type, OPERATION_TYPES.ROTATE);
  assert.deepEqual(operation.params.deltaEuler, { x: 0, y: 0, z: 0 });
  assert.equal(operation.params.faceTilt, undefined);
  assert.equal(operation.params.faceTilts.length, 1);
  assert.equal(operation.params.faceTilts[0].faceIndex, undefined);
  assert.equal(operation.params.faceTilts[0].faceAxis, "x");
  assert.equal(operation.params.faceTilts[0].faceSign, 1);
  assert.equal(operation.params.faceTilts[0].hingeAxis, "z");
  assert.equal(operation.params.faceTilts[0].hingeSideAxis, "y");
  assert.equal(operation.params.faceTilts[0].hingeSideSign, 0);
  assert.equal(operation.params.faceTilts[0].angle, 0.25);

  const model = new CanonicalModel();
  model.appendCommittedOperation(
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  );
  model.appendCommittedOperation(operation);

  const code = model.toTypeScriptModule();
  assert.match(code, /sai\.makeTaperedBox\(r,/);
  assertNoBehaviorComments(code);
  assert.doesNotMatch(code, /\.rotate\(/, "Face rotate should not serialize as whole-object rotation");

  const parsed = parseOperationsFromCanonicalModelCode(code);
  assert.equal(parsed.at(-1).type, OPERATION_TYPES.ROTATE);
  assert.equal(parsed.at(-1).selection.mode, "face");
  assert.equal(parsed.at(-1).params.faceTilt, undefined);
  assert.equal(parsed.at(-1).params.faceTilts[0].angle, 0.25);
});

test("move in face, edge, and vertex modes serializes as box subshape translation", () => {
  const model = new CanonicalModel();
  model.appendCommittedOperation(
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  );

  const faceMove = mapToolGestureToOperation({
    tool: "move",
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      faceIndex: 2,
      faceNormalWorld: { x: 1, y: 0, z: 0 },
    },
    gesture: { worldDelta: { x: 0.25, y: 0, z: 0 } },
  });
  const edgeMove = mapToolGestureToOperation({
    tool: "move",
    targetId: "obj_1",
    selection: {
      mode: "edge",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      faceIndex: 2,
      faceNormalWorld: { x: 1, y: 0, z: 0 },
      edge: {
        a: { x: 0.5, y: -0.5, z: -0.5 },
        b: { x: 0.5, y: 0.5, z: -0.5 },
        keys: ["px_ny_nz", "px_py_nz"],
      },
    },
    gesture: { worldDelta: { x: 0, y: 0.2, z: 0 } },
  });
  const vertexMove = mapToolGestureToOperation({
    tool: "move",
    targetId: "obj_1",
    selection: {
      mode: "vertex",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      faceIndex: 2,
      faceNormalWorld: { x: 1, y: 0, z: 0 },
      vertex: { x: 0.5, y: 0.5, z: -0.5, key: "px_py_nz" },
    },
    gesture: { worldDelta: { x: 0, y: 0, z: -0.15 } },
  });

  model.appendCommittedOperation(faceMove);
  model.appendCommittedOperation(edgeMove);
  model.appendCommittedOperation(vertexMove);

  const code = model.toTypeScriptModule();
  assert.match(code, /sai\.makeBox\(r,/);
  assert.match(code, /sai\.moveBoxSubshape\(r, obj_1,/);
  assert.match(code, /sai\.moveBoxVertex\(r, obj_1,/);
  assert.doesNotMatch(code, /\n  obj_1 = sai\./, "Subshape moves should not redefine the object variable");
  assert.doesNotMatch(code, /\.translate\(/, "Subshape moves should not serialize as whole-object translations");
  assertNoBehaviorComments(code);

  const parsed = parseOperationsFromCanonicalModelCode(code).filter((operation) => operation.type === OPERATION_TYPES.MOVE);
  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed.map((operation) => operation.selection.mode), ["face", "edge", "vertex"]);
  assert.equal(parsed[0].params.subshapeMove.faceAxis, "x");
  assert.deepEqual(parsed[1].params.subshapeMove.edge.keys, ["px_ny_nz", "px_py_nz"]);
  assert.equal(parsed[2].params.subshapeMove.vertex.key, "px_py_nz");
});

test("iterative vertex moves serialize as direct vertex helper calls", () => {
  const model = new CanonicalModel();
  model.appendCommittedOperation(
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  );

  model.appendCommittedOperation(
    mapToolGestureToOperation({
      tool: "move",
      targetId: "obj_1",
      selection: {
        mode: "vertex",
        objectId: "obj_1",
        objectIds: ["obj_1"],
        vertex: { x: 0.5, y: 0.5, z: 0.5, world: { x: 0.5, y: 1.1, z: 0.5 }, key: "px_py_pz" },
      },
      gesture: { worldDelta: { x: 0.073, y: -0.241, z: 0.084 } },
    }),
  );
  model.appendCommittedOperation(
    mapToolGestureToOperation({
      tool: "move",
      targetId: "obj_1",
      selection: {
        mode: "vertex",
        objectId: "obj_1",
        objectIds: ["obj_1"],
        vertex: { x: 0.573, y: 0.259, z: 0.584, world: { x: 0.573, y: 0.859, z: 0.584 }, key: "px_py_pz" },
      },
      gesture: { worldDelta: { x: -0.048, y: 0.183, z: -0.07 } },
    }),
  );

  const code = model.toTypeScriptModule();
  assert.match(code, /const obj_1 = sai\.makeBox\(r, \[-0\.5, 0\.1, -0\.5\], \[0\.5, 1\.1, 0\.5\]\);/);
  assert.equal(code.match(/sai\.moveBoxVertex\(r, obj_1,/g)?.length, 2);
  assert.equal(code.match(/\n  obj_1 = /g)?.length ?? 0, 0);
  assert.doesNotMatch(code, /sai\.makeTaperedBox\(r,/);
  assert.match(code, /return obj_1\.toShape\(\);/);
  assertNoBehaviorComments(code);

  const parsed = parseOperationsFromCanonicalModelCode(code);
  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed.map((operation) => operation.type), [
    OPERATION_TYPES.CREATE_PRIMITIVE,
    OPERATION_TYPES.MOVE,
    OPERATION_TYPES.MOVE,
  ]);
  assert.equal(parsed[1].params.subshapeMove.vertex.key, "px_py_pz");
  assert.deepEqual(parsed[2].params.delta, { x: -0.048, y: 0.183, z: -0.07 });
});

test("face rotate gesture can preserve normal-axis tilt while shifting to alternate axis", () => {
  const operation = mapToolGestureToOperation({
    tool: "rotate",
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      faceIndex: 4,
      faceNormalWorld: { x: 0, y: 1, z: 0 },
    },
    gesture: {
      dx: 40,
      dy: 0,
      shiftKey: true,
      faceTiltAngles: { normal: 0.2, alternate: 0.4 },
    },
  });

  assert.equal(operation.params.faceTilts.length, 2);
  assert.equal(operation.params.faceTilts[0].hingeSideAxis, "z");
  assert.equal(operation.params.faceTilts[0].angle, 0.2);
  assert.equal(operation.params.faceTilts[1].hingeSideAxis, "x");
  assert.equal(operation.params.faceTilts[1].angle, 0.4);
});

test("face rotate gesture derives tilt basis from the current selected face normal", () => {
  const normal = normalize({ x: 0, y: 1, z: 1 });
  const operation = mapToolGestureToOperation({
    tool: "rotate",
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      selector: {
        featureId: "feature_2",
        role: "face.py",
        hint: {
          point: { x: 0, y: 1, z: 0.4 },
          normal,
        },
      },
    },
    gesture: {
      dx: 40,
      dy: 0,
      shiftKey: true,
      faceTiltAngles: { normal: 0.2, alternate: 0.4 },
    },
  });

  const [normalTilt, alternateTilt] = operation.params.faceTilts;
  assert.deepEqual(normalTilt.faceNormal, { x: 0, y: 0.707, z: 0.707 });
  assert.ok(Math.abs(dot(normalTilt.faceNormal, normalTilt.hingeSideVector)) < 1e-6);
  assert.ok(Math.abs(dot(alternateTilt.faceNormal, alternateTilt.hingeSideVector)) < 1e-6);
  assert.notDeepEqual(normalTilt.hingeSideVector, { x: 0, y: 0, z: 1 });
  assert.deepEqual(alternateTilt.hingeSideVector, { x: 1, y: 0, z: 0 });
});

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return {
    x: Math.round((vector.x / length) * 1000) / 1000,
    y: Math.round((vector.y / length) * 1000) / 1000,
    z: Math.round((vector.z / length) * 1000) / 1000,
  };
}

function dot(a, b) {
  return (a.x ?? 0) * (b.x ?? 0) + (a.y ?? 0) * (b.y ?? 0) + (a.z ?? 0) * (b.z ?? 0);
}
