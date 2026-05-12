import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeController } from "../src/app/runtime-controller.js";
import { SketchApp } from "../src/app/sketch-app.js";
import { CanonicalModel } from "../src/modeling/canonical-model.js";
import { FeatureStore, featureGraphFromOperations, orderedFeatures } from "../src/feature/feature-store.js";
import { applyOperationToFeatureGraph } from "../src/feature/feature-resolution.js";
import { annotateMeshDataWithFeatureProvenance } from "../src/feature/feature-provenance.js";
import { replayFeaturesToSceneState, replayFeaturesToShapes } from "../src/feature/feature-replay.js";
import { createPrimitiveOperation, createSketchSplitOperation, mapToolGestureToOperation } from "../src/operation/operation-mapper.js";
import { OPERATION_TYPES } from "../src/operation/operation-types.js";

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

test("canonical model stores committed modeling actions as ordered features", () => {
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
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { delta: { x: 2, y: 0, z: 0 } },
  });

  const features = model.getFeatures();
  assert.equal(features.length, 2);
  assert.deepEqual(features.map((feature) => feature.id), ["feature_1", "feature_2"]);
  assert.deepEqual(features[1].dependsOn, ["feature_1"]);
  assert.deepEqual(model.getOperations().map((operation) => operation.type), [
    OPERATION_TYPES.CREATE_PRIMITIVE,
    OPERATION_TYPES.MOVE,
  ]);
});

test("sketch split operations round-trip as feature graph topology edits", () => {
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
    createSketchSplitOperation({
      sketchId: "sketch_1",
      targetId: "obj_1",
      selection: {
        mode: "face",
        objectId: "obj_1",
        objectIds: ["obj_1"],
        selector: { featureId: "feature_1", role: "face.py" },
      },
      targetSelector: { featureId: "feature_1", role: "face.py" },
      points: [
        { x: -0.25, y: 1.1, z: -0.25 },
        { x: 0.25, y: 1.1, z: -0.25 },
        { x: 0.25, y: 1.1, z: 0.25 },
      ],
      closed: false,
      plane: {
        origin: { x: 0, y: 1.1, z: 0 },
        normal: { x: 0, y: 1, z: 0 },
      },
    }),
  );

  const features = model.getFeatures();
  assert.equal(features.length, 2);
  assert.equal(features[1].type, OPERATION_TYPES.SKETCH_SPLIT);
  assert.deepEqual(features[1].dependsOn, ["feature_1"]);
  assert.equal(features[1].params.sketchId, "sketch_1");
  assert.equal(features[1].params.segments.length, 2);

  const operations = model.getOperations();
  assert.equal(operations[1].type, OPERATION_TYPES.SKETCH_SPLIT);
  assert.deepEqual(operations[1].params.segments, features[1].params.segments);
});

test("feature ordering honors dependencies without changing the serialized graph", () => {
  const features = featureGraphFromOperations([
    {
      type: OPERATION_TYPES.CREATE_PRIMITIVE,
      targetId: null,
      selection: null,
      params: {
        primitive: "box",
        objectId: "obj_1",
        position: { x: 0, y: 0.6, z: 0 },
        size: { x: 1, y: 1, z: 1 },
      },
    },
    {
      type: OPERATION_TYPES.MOVE,
      targetId: "obj_1",
      selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
      params: { delta: { x: 1, y: 0, z: 0 } },
    },
  ]);

  const reversed = [features[1], features[0]];
  assert.deepEqual(orderedFeatures(reversed).map((feature) => feature.id), ["feature_1", "feature_2"]);
});

test("runtime sends feature graph to exact execution and ignores stale display state", async () => {
  const executeCalls = [];
  const modelExecutor = {
    async executeCanonicalModel(input) {
      executeCalls.push(structuredClone(input));
      return replayFeaturesToSceneState({
        features: input.features,
        exactBackend: "test-feature-replay",
      });
    },
  };
  const runtime = new RuntimeController({
    canonicalModel: new CanonicalModel(),
    modelExecutor,
    representationStore: createRepresentationStore({
      stale_obj: {
        primitive: "box",
        position: { x: 9, y: 9, z: 9 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    }),
    modelScriptStore: { async saveScript() {}, async loadScript() { return null; }, async clear() {} },
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

  assert.equal(executeCalls.length, 1);
  assert.equal(executeCalls[0].features.length, 1);
  assert.equal(executeCalls[0].features[0].type, OPERATION_TYPES.CREATE_PRIMITIVE);
  assert.equal(runtime.getSnapshot().representation.exactSceneState.obj_1.primitive, "box");
  assert.equal(runtime.getSnapshot().representation.exactSceneState.stale_obj, undefined);
});

test("runtime does not publish an uncommitted graph when exact replay fails", async () => {
  const published = [];
  const saved = [];
  const runtime = new RuntimeController({
    canonicalModel: new CanonicalModel(),
    modelExecutor: {
      async executeCanonicalModel() {
        throw new Error("exact replay failed");
      },
    },
    representationStore: createRepresentationStore({}),
    modelScriptStore: {
      async saveScript(script) { saved.push(script); },
      async loadScript() { return null; },
      async clear() {},
    },
    onCanonicalCodeChanged: (projection) => published.push(projection),
  });
  runtime.initialize({ scene: null, seedSceneState: {} });

  await assert.rejects(
    () => runtime.commitOperation(
      createPrimitiveOperation({
        primitive: "box",
        objectId: "obj_1",
        position: { x: 0, y: 0.6, z: 0 },
        size: { x: 1, y: 1, z: 1 },
      }),
    ),
    /exact replay failed/,
  );

  assert.deepEqual(runtime.getSnapshot().featureGraph, []);
  assert.deepEqual(saved, []);
  assert.deepEqual(published, []);
});

test("shape replay returns all primitive object shapes without requiring a compound", () => {
  const shapeFor = (id) => ({
    id,
    mesh() {
      return { vertices: [], triangles: [], normals: [] };
    },
    translate() {
      return this;
    },
  });
  const r = {
    makeBox() {
      return shapeFor(`box_${Math.random()}`);
    },
    makeCompound() {
      throw new Error("compound should not be required for per-object replay");
    },
  };
  const sai = {
    makeBox() {
      return shapeFor("editable_box");
    },
  };
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_2",
      position: { x: 2, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  ]);

  const replayed = replayFeaturesToShapes({ features, r, sai });

  assert.deepEqual([...replayed.objectShapes.keys()], ["obj_1", "obj_2"]);
  assert.ok(replayed.shape);
});

test("feature replay does not emit committed sketch split overlay scene objects", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
    createSketchSplitOperation({
      sketchId: "sketch_1",
      targetId: "obj_1",
      selection: {
        mode: "face",
        objectId: "obj_1",
        objectIds: ["obj_1"],
        selector: { featureId: "feature_1", role: "face.py" },
      },
      targetSelector: { featureId: "feature_1", role: "face.py" },
      points: [
        { x: -0.5, y: 1.1, z: -0.5 },
        { x: 0.5, y: 1.1, z: 0.5 },
      ],
      closed: false,
      plane: {
        origin: { x: 0, y: 1.1, z: 0 },
        normal: { x: 0, y: 1, z: 0 },
      },
    }),
  ]);

  const replayed = replayFeaturesToSceneState({ features, exactBackend: "test" });

  assert.deepEqual(Object.keys(replayed.sceneState), ["obj_1"]);
  assert.equal(replayed.sceneState.obj_1.primitive, "box");
});

test("shape replay applies whole-object rotate feature across changed axes", () => {
  const calls = [];
  const shape = {
    rotate(angle, origin, axis) {
      calls.push({ angle, origin, axis });
      return this;
    },
    mesh() {
      return { vertices: [], triangles: [], normals: [] };
    },
  };
  const r = {
    makeBox() {
      return shape;
    },
  };
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 2, y: 0.6, z: -1 },
      size: { x: 1, y: 1, z: 1 },
    }),
    {
      type: OPERATION_TYPES.ROTATE,
      targetId: "obj_1",
      selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
      params: { deltaEuler: { x: 0.3, y: 0.4, z: 0 } },
    },
  ]);

  replayFeaturesToShapes({ features, r, sai: {} });

  assert.deepEqual(calls, [
    { angle: 0.3, origin: [2, 0.6, -1], axis: [1, 0, 0] },
    { angle: 0.4, origin: [2, 0.6, -1], axis: [0, 1, 0] },
  ]);
});

test("shape replay can leave whole-object rotation for display transform state", () => {
  const calls = [];
  const shape = {
    rotate(angle, origin, axis) {
      calls.push({ angle, origin, axis });
      return this;
    },
    mesh() {
      return { vertices: [], triangles: [], normals: [] };
    },
  };
  const r = {
    makeBox() {
      return shape;
    },
  };
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 2, y: 0.6, z: -1 },
      size: { x: 1, y: 1, z: 1 },
    }),
    {
      type: OPERATION_TYPES.ROTATE,
      targetId: "obj_1",
      selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
      params: { deltaEuler: { x: 0, y: 0.4, z: 0 } },
    },
  ]);

  replayFeaturesToShapes({ features, r, sai: {}, bakeObjectRotations: false });

  assert.deepEqual(calls, []);
});

test("feature store can round-trip features and operation compatibility view", () => {
  const store = new FeatureStore();
  store.appendOperation(
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  );
  store.appendOperation({
    type: OPERATION_TYPES.PUSH_PULL,
    targetId: "obj_1",
    selection: { mode: "face", objectId: "obj_1", objectIds: ["obj_1"], faceIndex: 0 },
    params: { axis: { x: 1, y: 0, z: 0 }, distance: 0.5, faceIndex: 0 },
  });

  const cloned = new FeatureStore(store.getFeatures());
  assert.deepEqual(cloned.getFeatures(), store.getFeatures());
  assert.deepEqual(cloned.getOperations(), store.getOperations());
});

test("feature targets persist provenance selectors instead of topology indices", () => {
  const store = new FeatureStore();
  store.appendOperation(
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  );
  store.appendOperation({
    type: OPERATION_TYPES.PUSH_PULL,
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      faceIndex: 11,
      faceNormalWorld: { x: 0, y: 0, z: 1 },
      selector: {
        featureId: "feature_1",
        role: "face.pz",
        hint: {
          point: { x: 0, y: 0.6, z: 0.5 },
          normal: { x: 0, y: 0, z: 1 },
        },
      },
    },
    params: { axis: { x: 0, y: 0, z: 1 }, distance: 0.5, faceIndex: 11 },
  });

  const feature = store.getFeatures()[1];
  assert.equal(feature.target.selection.faceIndex, undefined);
  assert.equal(feature.target.selection.faceNormalWorld, undefined);
  assert.deepEqual(feature.target.selection.selector, {
    featureId: "feature_1",
    role: "face.pz",
    hint: {
      point: { x: 0, y: 0.6, z: 0.5 },
      normal: { x: 0, y: 0, z: 1 },
    },
  });
  assert.equal(feature.params.faceIndex, undefined);
});

test("replayed mesh data carries feature provenance selectors by semantic face role", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  ]);
  const meshData = annotateMeshDataWithFeatureProvenance({
    vertices: [
      0, 0, 1,
      1, 0, 1,
      1, 1, 1,
      0, 1, 1,
    ],
    triangles: [0, 1, 2, 0, 2, 3],
    normals: [
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ],
  }, { objectId: "obj_1", features });

  assert.equal(meshData.faceProvenance.length, 2);
  assert.deepEqual(meshData.faceProvenance.map((provenance) => [provenance.featureId, provenance.role]), [
    ["feature_1", "face.pz"],
    ["feature_1", "face.pz"],
  ]);
});

test("feature graph save action serializes runtime graph, not displayed projection text", () => {
  const app = Object.create(SketchApp.prototype);
  const canonicalGraphJson = JSON.stringify({ features: [{ id: "feature_1", type: "create_primitive" }] }, null, 2);
  app.runtimeController = {
    getSnapshot() {
      return { canonicalGraphJson };
    },
  };
  app.codeElement = {
    textContent: JSON.stringify({ features: [{ id: "stale_projection" }] }, null, 2),
  };
  app.modelName = "Visibility Test";
  let downloaded = null;
  app._downloadTextFile = (filename, contents, type) => {
    downloaded = { filename, contents, type };
  };

  app._saveFeatureGraphToFile();

  assert.equal(downloaded.filename, "Visibility-Test.3dsai.json");
  assert.equal(downloaded.contents, canonicalGraphJson);
  assert.equal(downloaded.type, "application/json;charset=utf-8");
});

test("push-pull on a safe box face modifies the originating primitive feature", async () => {
  const runtime = new RuntimeController({
    modelExecutor: {
      async executeCanonicalModel(input) {
        return replayFeaturesToSceneState({ features: input.features, exactBackend: "test-feature-replay" });
      },
    },
    representationStore: createRepresentationStore({}),
    modelScriptStore: { async saveScript() {}, async loadScript() { return null; }, async clear() {} },
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
  const result = await runtime.commitOperation({
    type: OPERATION_TYPES.PUSH_PULL,
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      faceIndex: 11,
      faceNormalWorld: { x: 0, y: 0, z: 1 },
    },
    params: { axis: { x: 0, y: 0, z: 1 }, distance: 1.313, faceIndex: 11 },
  });

  const features = runtime.getSnapshot().featureGraph;
  assert.equal(result.featureGraphUpdate.reason, "modified_originating_primitive");
  assert.equal(features.length, 1);
  assert.equal(features[0].type, OPERATION_TYPES.CREATE_PRIMITIVE);
  assert.deepEqual(features[0].params.size, { x: 1, y: 1, z: 2.313 });
  assert.deepEqual(features[0].params.position, { x: 0, y: 0.6, z: 0.657 });
  assert.equal(runtime.getSnapshot().representation.exactSceneState.obj_1.scale.z, 2.313);
});

test("whole-object move modifies the originating primitive position", async () => {
  const runtime = new RuntimeController({
    modelExecutor: {
      async executeCanonicalModel(input) {
        return replayFeaturesToSceneState({ features: input.features, exactBackend: "test-feature-replay" });
      },
    },
    representationStore: createRepresentationStore({}),
    modelScriptStore: { async saveScript() {}, async loadScript() { return null; }, async clear() {} },
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
  const result = await runtime.commitOperation({
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { delta: { x: 1.25, y: -0.1, z: 0.5 } },
  });

  const features = runtime.getSnapshot().featureGraph;
  assert.equal(result.featureGraphUpdate.reason, "modified_originating_primitive_position");
  assert.equal(features.length, 1);
  assert.deepEqual(features[0].params.position, { x: 1.25, y: 0.5, z: 0.5 });
  assert.deepEqual(runtime.getSnapshot().representation.exactSceneState.obj_1.position, { x: 1.25, y: 0.5, z: 0.5 });
});

test("repeated whole-object moves accumulate in the originating primitive", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  ]);

  const first = applyOperationToFeatureGraph(features, {
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { delta: { x: 1, y: 0, z: 0.25 } },
  });
  const second = applyOperationToFeatureGraph(first.features, {
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { delta: { x: -0.4, y: 0.2, z: 0.75 } },
  });

  assert.equal(first.reason, "modified_originating_primitive_position");
  assert.equal(second.reason, "modified_originating_primitive_position");
  assert.equal(second.features.length, 1);
  assert.deepEqual(second.features[0].params.position, { x: 0.6, y: 0.8, z: 1 });
});

test("whole-object move falls back when downstream transforms make creation-position edits unsafe", () => {
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
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { deltaEuler: { x: 0, y: 0.5, z: 0 } },
  });

  const result = applyOperationToFeatureGraph(model.getFeatures(), {
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { delta: { x: 1, y: 0, z: 0 } },
  });

  assert.equal(result.reason, "fallback_new_feature");
  assert.equal(result.features.length, 3);
  assert.equal(result.features[2].type, OPERATION_TYPES.MOVE);
});

test("whole-object move after a face move still modifies the originating primitive position", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
    {
      type: OPERATION_TYPES.MOVE,
      targetId: "obj_1",
      selection: {
        mode: "face",
        objectId: "obj_1",
        objectIds: ["obj_1"],
        selector: {
          featureId: "feature_1",
          role: "face.pz",
          hint: {
            point: { x: -0.057884, y: 0.370144, z: 0.5 },
            normal: { x: 0, y: 0, z: 1 },
          },
        },
      },
      params: {
        delta: { x: -0.543, y: 0, z: 0.115 },
        subshapeMove: {
          mode: "face",
          faceAxis: "z",
          faceSign: 1,
          delta: { x: -0.543, y: 0, z: 0.115 },
        },
      },
    },
  ]);

  const result = applyOperationToFeatureGraph(features, {
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection: {
      mode: "object",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      selector: {
        featureId: "feature_1",
        role: "face.px",
        hint: {
          point: { x: 0.126181, y: 0.397245, z: 0.267603 },
          normal: { x: 0.899055, y: 0, z: 0.437836 },
        },
      },
    },
    params: {
      delta: { x: 1.693, y: 0, z: -2.009 },
    },
  });

  assert.equal(result.reason, "modified_originating_primitive_position");
  assert.equal(result.features.length, 2);
  assert.deepEqual(result.features[0].params.position, { x: 1.693, y: 0.6, z: -2.009 });
  assert.equal(result.features[1].type, OPERATION_TYPES.MOVE);
  assert.deepEqual(result.features[1].params.delta, { x: -0.543, y: 0, z: 0.115 });
});

test("repeated whole-object rotations on the same axis modify the existing rotate feature", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
    {
      type: OPERATION_TYPES.ROTATE,
      targetId: "obj_1",
      selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
      params: { deltaEuler: { x: 0, y: 0.25, z: 0 } },
    },
  ]);

  const result = applyOperationToFeatureGraph(features, {
    type: OPERATION_TYPES.ROTATE,
    targetId: "obj_1",
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { deltaEuler: { x: 0, y: 0.4, z: 0 } },
  });

  assert.equal(result.reason, "modified_existing_object_rotate");
  assert.equal(result.features.length, 2);
  assert.deepEqual(result.features[1].params.deltaEuler, { x: 0, y: 0.65, z: 0 });
});

test("whole-object rotations on a different axis modify the root rotate feature", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
    {
      type: OPERATION_TYPES.ROTATE,
      targetId: "obj_1",
      selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
      params: { deltaEuler: { x: 0, y: 0.25, z: 0 } },
    },
  ]);

  const result = applyOperationToFeatureGraph(features, {
    type: OPERATION_TYPES.ROTATE,
    targetId: "obj_1",
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { deltaEuler: { x: 0.4, y: 0, z: 0 } },
  });

  assert.equal(result.reason, "modified_existing_object_rotate");
  assert.equal(result.features.length, 2);
  assert.deepEqual(result.features[1].params.deltaEuler, { x: 0.4, y: 0.25, z: 0 });
});

test("whole-object rotation does not merge across downstream geometry edits", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
    {
      type: OPERATION_TYPES.ROTATE,
      targetId: "obj_1",
      selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
      params: { deltaEuler: { x: 0, y: 0.25, z: 0 } },
    },
    {
      type: OPERATION_TYPES.PUSH_PULL,
      targetId: "obj_1",
      selection: { mode: "face", objectId: "obj_1", objectIds: ["obj_1"], faceNormalWorld: { x: 0, y: 0, z: 1 } },
      params: { axis: { x: 0, y: 0, z: 1 }, distance: 0.5, mode: "move" },
    },
  ]);

  const result = applyOperationToFeatureGraph(features, {
    type: OPERATION_TYPES.ROTATE,
    targetId: "obj_1",
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { deltaEuler: { x: 0, y: 0.4, z: 0 } },
  });

  assert.equal(result.reason, "fallback_new_feature");
  assert.equal(result.features.length, 4);
  assert.deepEqual(result.features[1].params.deltaEuler, { x: 0, y: 0.25, z: 0 });
});

test("edge move always creates its own subshape move feature", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  ]);

  const result = applyOperationToFeatureGraph(features, {
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection: {
      mode: "edge",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      edge: {
        a: { x: 0.5, y: -0.5, z: -0.5 },
        b: { x: 0.5, y: 0.5, z: -0.5 },
        keys: ["px_ny_nz", "px_py_nz"],
      },
    },
    params: {
      delta: { x: 0, y: 0.25, z: 0 },
      subshapeMove: {
        mode: "edge",
        edge: {
          a: { x: 0.5, y: -0.5, z: -0.5 },
          b: { x: 0.5, y: 0.5, z: -0.5 },
          keys: ["px_ny_nz", "px_py_nz"],
        },
        delta: { x: 0, y: 0.25, z: 0 },
      },
    },
  });

  assert.equal(result.reason, "fallback_new_feature");
  assert.equal(result.features.length, 2);
  assert.deepEqual(result.features[0].params.position, { x: 0, y: 0.6, z: 0 });
  assert.equal(result.features[1].type, OPERATION_TYPES.MOVE);
  assert.equal(result.features[1].params.subshapeMove.mode, "edge");
});

test("vertex move always creates its own subshape move feature", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  ]);

  const result = applyOperationToFeatureGraph(features, {
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection: {
      mode: "vertex",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      vertex: { x: 0.5, y: 0.5, z: -0.5, key: "px_py_nz" },
    },
    params: {
      delta: { x: -0.1, y: 0.2, z: 0.3 },
      subshapeMove: {
        mode: "vertex",
        vertex: { x: 0.5, y: 0.5, z: -0.5, key: "px_py_nz" },
        delta: { x: -0.1, y: 0.2, z: 0.3 },
      },
    },
  });

  assert.equal(result.reason, "fallback_new_feature");
  assert.equal(result.features.length, 2);
  assert.deepEqual(result.features[0].params.position, { x: 0, y: 0.6, z: 0 });
  assert.equal(result.features[1].type, OPERATION_TYPES.MOVE);
  assert.equal(result.features[1].params.subshapeMove.mode, "vertex");
});

test("repeated face moves modify the existing face move feature", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
    {
      type: OPERATION_TYPES.MOVE,
      targetId: "obj_1",
      selection: {
        mode: "face",
        objectId: "obj_1",
        objectIds: ["obj_1"],
        selector: {
          featureId: "feature_1",
          role: "face.nx",
          hint: {
            point: { x: -0.5, y: 0.61064, z: 0.241734 },
            normal: { x: -1, y: 0, z: 0 },
          },
        },
      },
      params: {
        delta: { x: -0.122, y: 0, z: -0.679 },
        subshapeMove: {
          mode: "face",
          faceAxis: "x",
          faceSign: -1,
          delta: { x: -0.122, y: 0, z: -0.679 },
        },
      },
    },
  ]);

  const result = applyOperationToFeatureGraph(features, {
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      selector: {
        featureId: "feature_2",
        role: "face.nx",
        hint: {
          point: { x: -0.622, y: 0.626499, z: -0.44219 },
          normal: { x: -1, y: 0, z: 0 },
        },
      },
    },
    params: {
      delta: { x: -0.241, y: 0, z: 1.275 },
      subshapeMove: {
        mode: "face",
        faceAxis: "x",
        faceSign: -1,
        delta: { x: -0.241, y: 0, z: 1.275 },
      },
    },
  });

  assert.equal(result.reason, "modified_existing_face_move");
  assert.equal(result.features.length, 2);
  assert.equal(result.featureId, "feature_2");
  assert.deepEqual(result.features[1].params.delta, { x: -0.363, y: 0, z: 0.596 });
  assert.deepEqual(result.features[1].params.subshapeMove.delta, { x: -0.363, y: 0, z: 0.596 });
  assert.equal(result.features[1].target.selection.selector.featureId, "feature_1");
});

test("repeated face rotation modifies the existing rotate feature", () => {
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
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      faceIndex: 6,
      faceNormalWorld: { x: 0, y: 1, z: 0 },
    },
    params: {
      deltaEuler: { x: 0, y: 0, z: 0 },
      faceTilt: {
        faceIndex: 6,
        faceNormalWorld: { x: 0, y: 1, z: 0 },
        faceAxis: "y",
        faceSign: 1,
        hingeAxis: "x",
        hingeSideAxis: "z",
        hingeSideSign: 0,
        angle: 0.2,
      },
    },
  });

  const result = applyOperationToFeatureGraph(model.getFeatures(), {
    type: OPERATION_TYPES.ROTATE,
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      faceIndex: 9,
      faceNormalWorld: { x: 0, y: 1, z: 0 },
    },
    params: {
      deltaEuler: { x: 0, y: 0, z: 0 },
      faceTilt: {
        faceIndex: 9,
        faceNormalWorld: { x: 0, y: 1, z: 0 },
        faceAxis: "y",
        faceSign: 1,
        hingeAxis: "x",
        hingeSideAxis: "z",
        hingeSideSign: 0,
        angle: 0.367,
      },
    },
  });

  assert.equal(result.reason, "modified_existing_face_rotate");
  assert.equal(result.features.length, 2);
  assert.equal(result.features[1].type, OPERATION_TYPES.ROTATE);
  assert.equal(result.features[1].params.faceTilts.length, 1);
  assert.equal(result.features[1].params.faceTilt, undefined);
  assert.equal(result.features[1].params.faceTilts[0].angle, 0.567);
  assert.equal(result.features[1].params.faceTilts[0].hingeSideSign, 0);
});

test("repeated mapped face rotation modifies one tilt feature from origin provenance", () => {
  let features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  ]);
  const selection = {
    mode: "face",
    objectId: "obj_1",
    objectIds: ["obj_1"],
    selector: {
      featureId: "feature_1",
      role: "face.py",
      hint: { normal: { x: 0, y: 1, z: 0 } },
    },
  };

  for (const dx of [10, 20, 30]) {
    const operation = mapToolGestureToOperation({
      tool: "rotate",
      targetId: "obj_1",
      selection,
      gesture: { dx },
    });
    const result = applyOperationToFeatureGraph(features, operation);
    features = result.features;
  }

  assert.equal(features.length, 2);
  assert.equal(features[1].type, OPERATION_TYPES.ROTATE);
  assert.equal(features[1].params.faceTilts.length, 1);
  assert.equal(features[1].params.faceTilt, undefined);
  assert.equal(features[1].params.faceTilts[0].angle, 0.6);
  assert.equal(features[1].params.faceTilts[0].faceNormal, undefined);
  assert.equal(features[1].params.faceTilts[0].hingeSideVector, undefined);
});

test("repeated face rotation keeps the original compact tilt basis", () => {
  let features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  ]);

  const first = mapToolGestureToOperation({
    tool: "rotate",
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      selector: {
        featureId: "feature_1",
        role: "face.py",
        hint: { normal: { x: 0, y: 1, z: 0 } },
      },
    },
    gesture: { dx: 20 },
  });
  features = applyOperationToFeatureGraph(features, first).features;

  const second = mapToolGestureToOperation({
    tool: "rotate",
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      selector: {
        featureId: "feature_2",
        role: "face.py",
        hint: { normal: { x: 0, y: 0.981, z: 0.195 } },
      },
    },
    gesture: { dx: 30 },
  });
  const result = applyOperationToFeatureGraph(features, second);

  assert.equal(result.reason, "modified_existing_face_rotate");
  assert.equal(result.features.length, 2);
  assert.equal(result.features[1].params.faceTilts.length, 1);
  assert.equal(result.features[1].params.faceTilt, undefined);
  assert.equal(result.features[1].params.faceTilts[0].angle, 0.5);
  assert.equal(result.features[1].params.faceTilts[0].faceNormal, undefined);
  assert.equal(result.features[1].params.faceTilts[0].hingeAxisVector, undefined);
  assert.equal(result.features[1].params.faceTilts[0].hingeSideVector, undefined);
});

test("face rotation preview uses the resolved final tilt delta", () => {
  const canonicalModel = new CanonicalModel();
  canonicalModel.appendCommittedOperation(
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  );
  canonicalModel.appendCommittedOperation({
    type: OPERATION_TYPES.ROTATE,
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      selector: {
        featureId: "feature_1",
        role: "face.pz",
        hint: { normal: { x: 0, y: 0, z: 1 } },
      },
    },
    params: {
      deltaEuler: { x: 0, y: 0, z: 0 },
      faceTilts: [
        {
          faceAxis: "z",
          faceSign: 1,
          hingeAxis: "x",
          hingeSideAxis: "y",
          hingeSideSign: 0,
          angle: 0.171,
        },
      ],
    },
  });

  let previewOperation = null;
  const controller = new RuntimeController({
    canonicalModel,
    representationStore: {
      setPreviewOperation(operation) {
        previewOperation = operation;
      },
    },
  });
  const selection = {
    mode: "face",
    objectId: "obj_1",
    objectIds: ["obj_1"],
    selector: {
      featureId: "feature_2",
      role: "face.pz",
      hint: { normal: { x: 0, y: -0.17, z: 0.985 } },
    },
  };
  controller.beginManipulation({
    type: OPERATION_TYPES.ROTATE,
    targetId: "obj_1",
    selection,
    params: { deltaEuler: { x: 0, y: 0, z: 0 }, faceTilts: [] },
  });

  controller.updateManipulation({
    deltaEuler: { x: 0, y: 0, z: 0 },
    faceTilts: [
      {
        faceAxis: "z",
        faceSign: 1,
        hingeAxis: "x",
        hingeSideAxis: "y",
        hingeSideSign: 0,
        angle: 0.146,
        faceNormal: { x: 0, y: -0.17, z: 0.985 },
        hingeAxisVector: { x: 1, y: 0, z: 0 },
        hingeSideVector: { x: 0, y: 0.985, z: 0.17 },
      },
    ],
  });

  const previewTilt = previewOperation.params.faceTilts[0];
  const expectedPreviewAngle = Math.atan(Math.tan(0.317) - Math.tan(0.171));
  assert.ok(Math.abs(previewTilt.angle - expectedPreviewAngle) < 0.001);
  assert.equal(previewTilt.faceNormal, undefined);
  assert.equal(previewTilt.hingeAxisVector, undefined);
  assert.equal(previewTilt.hingeSideVector, undefined);
});

test("preview updates record feature-graph resolution for primitive position edits", () => {
  const canonicalModel = new CanonicalModel();
  canonicalModel.appendCommittedOperation(
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  );

  let previewOperation = null;
  const controller = new RuntimeController({
    canonicalModel,
    representationStore: {
      setPreviewOperation(operation) {
        previewOperation = operation;
      },
      snapshot() {
        return {};
      },
    },
  });

  controller.beginManipulation({
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { delta: { x: 0, y: 0, z: 0 } },
  });
  controller.updateManipulation({ delta: { x: 1.25, y: 0, z: -0.5 } });

  assert.equal(controller.getSnapshot().previewFeatureGraphUpdate.reason, "modified_originating_primitive_position");
  assert.equal(controller.getSnapshot().previewFeatureGraphUpdate.featureId, "feature_1");
  assert.deepEqual(previewOperation.params.delta, { x: 1.25, y: 0, z: -0.5 });
});

test("push-pull preview for primitive box edits carries the resolved primitive state", () => {
  const canonicalModel = new CanonicalModel();
  canonicalModel.appendCommittedOperation(
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  );

  let previewOperation = null;
  const controller = new RuntimeController({
    canonicalModel,
    representationStore: {
      setPreviewOperation(operation) {
        previewOperation = operation;
      },
      snapshot() {
        return {};
      },
    },
  });

  controller.beginManipulation({
    type: OPERATION_TYPES.PUSH_PULL,
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      selector: {
        featureId: "feature_1",
        role: "face.pz",
        hint: { normal: { x: 0, y: 0, z: 1 } },
      },
    },
    params: {
      axis: { x: 0, y: 0, z: 1 },
      distance: 0,
      mode: "move",
    },
  });
  controller.updateManipulation({
    axis: { x: 0, y: 0, z: 1 },
    distance: 0.562,
    mode: "move",
  });

  assert.equal(controller.getSnapshot().previewFeatureGraphUpdate.reason, "modified_originating_primitive");
  assert.deepEqual(previewOperation.params.previewPrimitiveState, {
    primitive: "box",
    position: { x: 0, y: 0.6, z: 0.281 },
    size: { x: 1, y: 1, z: 1.562 },
  });
});

test("preview updates use incremental feature diffs for repeated face moves", () => {
  const canonicalModel = new CanonicalModel();
  canonicalModel.appendCommittedOperation(
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  );
  canonicalModel.appendCommittedOperation({
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      selector: {
        featureId: "feature_1",
        role: "face.nx",
        hint: { normal: { x: -1, y: 0, z: 0 } },
      },
    },
    params: {
      delta: { x: -0.122, y: 0, z: -0.679 },
      subshapeMove: {
        mode: "face",
        faceAxis: "x",
        faceSign: -1,
        delta: { x: -0.122, y: 0, z: -0.679 },
      },
    },
  });

  let previewOperation = null;
  const controller = new RuntimeController({
    canonicalModel,
    representationStore: {
      setPreviewOperation(operation) {
        previewOperation = operation;
      },
      snapshot() {
        return {};
      },
    },
  });
  const selection = {
    mode: "face",
    objectId: "obj_1",
    objectIds: ["obj_1"],
    selector: {
      featureId: "feature_2",
      role: "face.nx",
      hint: { normal: { x: -1, y: 0, z: 0 } },
    },
  };

  controller.beginManipulation({
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection,
    params: {
      delta: { x: 0, y: 0, z: 0 },
      subshapeMove: {
        mode: "face",
        faceAxis: "x",
        faceSign: -1,
        delta: { x: 0, y: 0, z: 0 },
      },
    },
  });
  controller.updateManipulation({
    delta: { x: -0.241, y: 0, z: 1.275 },
    subshapeMove: {
      mode: "face",
      faceAxis: "x",
      faceSign: -1,
      delta: { x: -0.241, y: 0, z: 1.275 },
    },
  });

  assert.equal(controller.getSnapshot().previewFeatureGraphUpdate.reason, "modified_existing_face_move");
  assert.equal(controller.getSnapshot().previewFeatureGraphUpdate.featureId, "feature_2");
  assert.deepEqual(previewOperation.params.delta, { x: -0.241, y: 0, z: 1.275 });
  assert.deepEqual(previewOperation.params.subshapeMove.delta, { x: -0.241, y: 0, z: 1.275 });
});

test("face rotation merge preserves alternate centered tilt axes", () => {
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
    selection: { mode: "face", objectId: "obj_1", objectIds: ["obj_1"], faceNormalWorld: { x: 0, y: 1, z: 0 } },
    params: {
      deltaEuler: { x: 0, y: 0, z: 0 },
      faceTilt: {
        faceAxis: "y",
        faceSign: 1,
        hingeAxis: "x",
        hingeSideAxis: "z",
        hingeSideSign: 0,
        angle: 0.2,
      },
      faceTilts: [
        {
          faceAxis: "y",
          faceSign: 1,
          hingeAxis: "x",
          hingeSideAxis: "z",
          hingeSideSign: 0,
          angle: 0.2,
        },
      ],
    },
  });

  const result = applyOperationToFeatureGraph(model.getFeatures(), {
    type: OPERATION_TYPES.ROTATE,
    targetId: "obj_1",
    selection: { mode: "face", objectId: "obj_1", objectIds: ["obj_1"], faceNormalWorld: { x: 0, y: 1, z: 0 } },
    params: {
      deltaEuler: { x: 0, y: 0, z: 0 },
      faceTilt: {
        faceAxis: "y",
        faceSign: 1,
        hingeAxis: "z",
        hingeSideAxis: "x",
        hingeSideSign: 0,
        angle: 0.3,
      },
      faceTilts: [
        {
          faceAxis: "y",
          faceSign: 1,
          hingeAxis: "x",
          hingeSideAxis: "z",
          hingeSideSign: 0,
          angle: 0.1,
        },
        {
          faceAxis: "y",
          faceSign: 1,
          hingeAxis: "z",
          hingeSideAxis: "x",
          hingeSideSign: 0,
          angle: 0.3,
        },
      ],
    },
  });

  assert.equal(result.reason, "modified_existing_face_rotate");
  assert.deepEqual(result.features[1].params.faceTilts.map((tilt) => [tilt.hingeSideAxis, tilt.angle]), [
    ["z", 0.3],
    ["x", 0.3],
  ]);
});

test("repeated face rotation resolves existing rotate feature from provenance selector", () => {
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
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      selector: {
        featureId: "feature_1",
        role: "face.py",
        hint: {
          point: { x: 0, y: 1.1, z: 0 },
          normal: { x: 0, y: 1, z: 0 },
        },
      },
    },
    params: {
      deltaEuler: { x: 0, y: 0, z: 0 },
      faceTilt: {
        faceAxis: "y",
        faceSign: 1,
        hingeAxis: "x",
        hingeSideAxis: "z",
        hingeSideSign: 0,
        angle: 0.2,
      },
    },
  });

  const result = applyOperationToFeatureGraph(model.getFeatures(), {
    type: OPERATION_TYPES.ROTATE,
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      selector: {
        featureId: "feature_2",
        role: "face.py",
        hint: {
          point: { x: 0, y: 1.1, z: 0 },
          normal: { x: 0, y: 1, z: 0 },
        },
      },
    },
    params: {
      deltaEuler: { x: 0, y: 0, z: 0 },
      faceTilt: {
        faceAxis: "y",
        faceSign: 1,
        hingeAxis: "x",
        hingeSideAxis: "z",
        hingeSideSign: 0,
        angle: 0.367,
      },
    },
  });

  assert.equal(result.reason, "modified_existing_face_rotate");
  assert.equal(result.features.length, 2);
  assert.equal(result.features[1].id, "feature_2");
  assert.equal(result.features[1].target.selection.selector.featureId, "feature_1");
  assert.equal(result.features[1].target.selection.faceIndex, undefined);
  assert.equal(result.features[1].params.faceTilt, undefined);
  assert.equal(result.features[1].params.faceTilts[0].angle, 0.567);
});

test("repeated primitive push-pull resolves by stable face identity instead of face index", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  ]);

  const first = applyOperationToFeatureGraph(features, {
    type: OPERATION_TYPES.PUSH_PULL,
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      faceIndex: 11,
      faceNormalWorld: { x: 0, y: 0, z: 1 },
    },
    params: { axis: { x: 0, y: 0, z: 1 }, distance: 1.313, faceIndex: 11 },
  });
  const second = applyOperationToFeatureGraph(first.features, {
    type: OPERATION_TYPES.PUSH_PULL,
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      faceIndex: 8,
      faceNormalWorld: { x: 0, y: 0, z: 1 },
    },
    params: { axis: { x: 0, y: 0, z: 1 }, distance: 0.487, faceIndex: 8 },
  });

  assert.equal(first.reason, "modified_originating_primitive");
  assert.equal(second.reason, "modified_originating_primitive");
  assert.equal(second.features.length, 1);
  assert.deepEqual(second.features[0].params.size, { x: 1, y: 1, z: 2.8 });
  assert.deepEqual(second.features[0].params.position, { x: 0, y: 0.6, z: 0.9 });
});

test("push-pull falls back to a new feature when downstream geometry depends on the primitive", () => {
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
    type: OPERATION_TYPES.MOVE,
    targetId: "obj_1",
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { delta: { x: 1, y: 0, z: 0 } },
  });

  const result = applyOperationToFeatureGraph(model.getFeatures(), {
    type: OPERATION_TYPES.PUSH_PULL,
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      faceIndex: 11,
      faceNormalWorld: { x: 0, y: 0, z: 1 },
    },
    params: { axis: { x: 0, y: 0, z: 1 }, distance: 1, faceIndex: 11 },
  });

  assert.equal(result.reason, "fallback_new_feature");
  assert.equal(result.features.length, 3);
  assert.deepEqual(result.features.map((feature) => feature.type), [
    OPERATION_TYPES.CREATE_PRIMITIVE,
    OPERATION_TYPES.MOVE,
    OPERATION_TYPES.PUSH_PULL,
  ]);
  assert.equal(result.features[2].params.faceAxis, "z");
  assert.equal(result.features[2].params.faceSign, 1);
});

test("existing push-pull features accumulate by face origin metadata without face-index matching", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
    {
      type: OPERATION_TYPES.PUSH_PULL,
      targetId: "obj_1",
      selection: {
        mode: "face",
        objectId: "obj_1",
        objectIds: ["obj_1"],
        faceIndex: 2,
        faceNormalWorld: { x: 1, y: 0, z: 0 },
      },
      params: { axis: { x: 1, y: 0, z: 0 }, distance: 0.5, faceIndex: 2 },
    },
  ]);

  const result = applyOperationToFeatureGraph(features, {
    type: OPERATION_TYPES.PUSH_PULL,
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      faceIndex: 7,
      faceNormalWorld: { x: 1, y: 0, z: 0 },
    },
    params: { axis: { x: 1, y: 0, z: 0 }, distance: 0.25, faceIndex: 7 },
  });

  assert.equal(result.reason, "modified_existing_push_pull");
  assert.equal(result.features.length, 2);
  assert.equal(result.features[1].params.distance, 0.75);
  assert.equal(result.features[1].params.faceAxis, "x");
  assert.equal(result.features[1].params.faceSign, 1);
});

test("push-pull feature origin metadata derives stable identity from the committed operation axis", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
    {
      type: OPERATION_TYPES.PUSH_PULL,
      targetId: "obj_1",
      selection: {
        mode: "face",
        objectId: "obj_1",
        objectIds: ["obj_1"],
        faceIndex: 5,
        faceNormalWorld: { x: 0, y: 1, z: 0 },
      },
      params: {
        axis: { x: 0, y: 0.921061, z: 0.389418 },
        distance: 1.25,
        faceIndex: 5,
      },
    },
  ]);

  assert.equal(features[1].params.faceNormalWorld, undefined);
  assert.deepEqual(features[1].params.axis, { x: 0, y: 0.921061, z: 0.389418 });
  assert.equal(features[1].params.faceAxis, "y");
  assert.equal(features[1].params.faceSign, 1);
});

test("sketch split feature resolution appends segments to the originating sketch", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "obj_1",
      position: { x: 0, y: 0.6, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
    createSketchSplitOperation({
      sketchId: "sketch_1",
      targetId: "obj_1",
      selection: {
        mode: "face",
        objectId: "obj_1",
        objectIds: ["obj_1"],
        selector: { featureId: "feature_1", role: "face.py" },
      },
      targetSelector: { featureId: "feature_1", role: "face.py" },
      points: [
        { x: -0.5, y: 1.1, z: -0.5 },
        { x: 0.5, y: 1.1, z: 0.5 },
      ],
      closed: false,
      plane: {
        origin: { x: 0, y: 1.1, z: 0 },
        normal: { x: 0, y: 1, z: 0 },
      },
    }),
  ]);

  const result = applyOperationToFeatureGraph(features, createSketchSplitOperation({
    sketchId: "sketch_1",
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      selector: { featureId: "feature_2", role: "split.sketch_1.face.py", sketchId: "sketch_1" },
    },
    targetSelector: { featureId: "feature_1", role: "face.py" },
    points: [
      { x: -0.5, y: 1.1, z: 0.5 },
      { x: 0.5, y: 1.1, z: -0.5 },
    ],
    closed: false,
    plane: {
      origin: { x: 0, y: 1.1, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
    },
  }));

  assert.equal(result.reason, "modified_existing_sketch_split");
  assert.equal(result.features.length, 2);
  assert.equal(result.features[1].type, OPERATION_TYPES.SKETCH_SPLIT);
  assert.equal(result.features[1].params.segments.length, 2);
  assert.deepEqual(result.features[1].params.segments.map((segment) => segment.id), [
    "sketch_1_segment_1",
    "sketch_1_segment_2",
  ]);
});
