import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeController } from "../src/app/runtime-controller.js";
import { CanonicalModel } from "../src/modeling/canonical-model.js";
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
  assert.match(code, /r\.makeBox\(/, "Serialized script should emit direct Replicad calls");
  assert.match(code, /\.scale\(\[4\.74, 1, 1\]\)/, "Push/pull fallback must emit direct callable geometry code");
  assert.match(code, /\.translate\(\[1\.87, 0, 0\]\)/, "Push/pull must preserve the shifted face center");
  assertNoBehaviorComments(code);

  const parsed = parseOperationsFromCanonicalModelCode(code);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[1].type, OPERATION_TYPES.SCALE);
  assert.equal(parsed[1].targetId, "obj_1");
  assert.deepEqual(parsed[1].params.scaleFactor, { x: 4.74, y: 1, z: 1 });
  assert.equal(parsed[2].type, OPERATION_TYPES.MOVE);
  assert.deepEqual(parsed[2].params.delta, { x: 1.87, y: 0, z: 0 });
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
        hingeSideSign: -1,
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
  assert.match(code, /sai\.makeTaperedBox\(r,/);
  assert.match(code, /"faceExtrudes":\[/);
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
  assert.match(code, /sai\.makeTaperedBox\(r,/);
  assert.match(code, /"faceExtensions":\[/);
  assert.doesNotMatch(code, /\.scale\(/, "Shift push-pull extension should not serialize as body scale");
  assertNoBehaviorComments(code);

  const parsed = parseOperationsFromCanonicalModelCode(code);
  assert.equal(parsed.at(-1).type, OPERATION_TYPES.PUSH_PULL);
  assert.equal(parsed.at(-1).params.mode, "extend");
  assert.equal(parsed.at(-1).params.distance, 1.2);
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
  assertNoBehaviorComments(scriptStore.saved[0]);
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
  assertNoBehaviorComments(canonicalCode);
  assert.equal(scriptStore.saved.at(-1), canonicalCode, "Compressed script should persist as the new canonical script");
});

test("runtime compresses adjacent scales for the same object into one direct scale call", async () => {
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

  await runtime.reloadFromCanonicalCode(
    [
      "export const main = (r, sai) => {",
      "  let obj_1 = r.makeBox([-0.5, 0.1, -0.5], [0.5, 1.1, 0.5]);",
      "  obj_1 = obj_1.scale([1, 1.908, 1]);",
      "  obj_1 = obj_1.scale([1, 1, 1.543]);",
      "  obj_1 = obj_1.scale([1.594, 1, 1]);",
      "  obj_1 = obj_1.scale([1, 1, 1.529]);",
      "  obj_1 = obj_1.scale([1, 5.854, 1]);",
      "  obj_1 = obj_1.scale([2.881, 1, 1]);",
      "  obj_1 = obj_1.scale([1, -3.742, 1]);",
      "  return obj_1;",
      "}",
    ].join("\n"),
    { cleanSlate: true },
  );

  const { canonicalCode, operationCount } = await runtime.compressCanonicalModel();

  assert.equal(operationCount, 2);
  assert.match(canonicalCode, /obj_1 = obj_1\.scale\(\[4\.592, 1\.117, 2\.359\]\);/);
  assert.equal(canonicalCode.match(/\.scale\(/g)?.length, 1);
  assertNoBehaviorComments(canonicalCode);
  assert.equal(scriptStore.saved.at(-1), canonicalCode, "Compressed script should persist as the new canonical script");
});

test("runtime compresses interleaved scale and translate runs for the same object", async () => {
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

  await runtime.reloadFromCanonicalCode(
    [
      "export const main = (r, sai) => {",
      "  let obj_1 = r.makeBox([-0.5, 0.1, -0.5], [0.5, 1.1, 0.5]);",
      "  obj_1 = obj_1.scale([1, 1, 2.49]);",
      "  obj_1 = obj_1.translate([0, 0, -0.745]);",
      "  obj_1 = obj_1.scale([1, 1, 1.401]);",
      "  obj_1 = obj_1.translate([0, 0, -0.499]);",
      "  obj_1 = obj_1.scale([1, 1, 1.195]);",
      "  obj_1 = obj_1.translate([0, 0, -0.34]);",
      "  obj_1 = obj_1.scale([2.961, 1, 1]);",
      "  obj_1 = obj_1.translate([0.981, 0, 0]);",
      "  obj_1 = obj_1.scale([1.206, 1, 1]);",
      "  obj_1 = obj_1.translate([0.305, 0, 0]);",
      "  obj_1 = obj_1.scale([1.058, 1, 1]);",
      "  obj_1 = obj_1.translate([0.103, 0, 0]);",
      "  obj_1 = obj_1.scale([1, 1.398, 1]);",
      "  obj_1 = obj_1.translate([0, 0.199, 0]);",
      "  obj_1 = obj_1.scale([1, 1.386, 1]);",
      "  obj_1 = obj_1.translate([0, 0.27, 0]);",
      "  return obj_1;",
      "}",
    ].join("\n"),
    { cleanSlate: true },
  );

  const { canonicalCode, operationCount } = await runtime.compressCanonicalModel();

  assert.equal(operationCount, 3);
  assert.match(canonicalCode, /obj_1 = obj_1\.scale\(\[3\.778, 1\.938, 4\.168\]\);/);
  assert.match(canonicalCode, /obj_1 = obj_1\.translate\(\[1\.389, 0\.469, -1\.584\]\);/);
  assert.equal(canonicalCode.match(/\.scale\(/g)?.length, 1);
  assert.equal(canonicalCode.match(/\.translate\(/g)?.length, 1);
  assertNoBehaviorComments(canonicalCode);
  assert.equal(scriptStore.saved.at(-1), canonicalCode, "Compressed script should persist as the new canonical script");
});

test("runtime can compress again after appending push-pull to an already compressed model", async () => {
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

  await runtime.reloadFromCanonicalCode(
    [
      "export const main = (r, sai) => {",
      "  let obj_1 = r.makeBox([-0.5, 0.1, -0.5], [0.5, 1.1, 0.5]);",
      "  obj_1 = obj_1.scale([1, 1, 2.49]);",
      "  obj_1 = obj_1.translate([0, 0, -0.745]);",
      "  obj_1 = obj_1.scale([1, 1, 1.401]);",
      "  obj_1 = obj_1.translate([0, 0, -0.499]);",
      "  return obj_1;",
      "}",
    ].join("\n"),
    { cleanSlate: true },
  );
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

  const { canonicalCode, operationCount } = await runtime.compressCanonicalModel();

  assert.equal(operationCount, 3);
  assert.match(canonicalCode, /obj_1 = obj_1\.scale\(\[1, 1, 4\.489\]\);/);
  assert.match(canonicalCode, /obj_1 = obj_1\.translate\(\[0, 0, -0\.744\]\);/);
  assert.equal(canonicalCode.match(/\.scale\(/g)?.length, 1);
  assert.equal(canonicalCode.match(/\.translate\(/g)?.length, 1);
  assertNoBehaviorComments(canonicalCode);
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
  assert.equal(operation.params.faceTilt.faceIndex, 2);
  assert.equal(operation.params.faceTilt.faceAxis, "x");
  assert.equal(operation.params.faceTilt.faceSign, 1);
  assert.equal(operation.params.faceTilt.hingeAxis, "z");
  assert.equal(operation.params.faceTilt.hingeSideAxis, "y");
  assert.equal(operation.params.faceTilt.angle, 0.25);

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
  assert.equal(parsed.at(-1).params.faceTilt.angle, 0.25);
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
