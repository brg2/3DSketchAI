import test from "node:test";
import assert from "node:assert/strict";
import { assembleAiPromptContext, applyFeatureGraphPatch, ApiKeyVault } from "../src/index.js";
import { parseProviderPatch } from "../src/ai/ai-providers.js";
import { createPrimitiveOperation } from "../src/operation/operation-mapper.js";
import { featureGraphFromOperations } from "../src/feature/feature-store.js";

test("AI context includes schema, graph, selection, provenance, view, and prompt", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({ primitive: "box", objectId: "cube" }),
  ]);
  const context = assembleAiPromptContext({
    featureGraph: features,
    parameters: [{ name: "width", value: 2 }],
    selection: { mode: "face", objectId: "cube" },
    provenance: { featureId: "feature_1", role: "face.py" },
    view: { projection: "orthographic" },
    prompt: "Make it wider",
  });

  assert.equal(context.kind, "3dsai.feature_graph_edit_context");
  assert.ok(context.schema.parameterReference);
  assert.equal(context.featureGraph.parameters[0].name, "width");
  assert.equal(context.featureGraph.features[0].id, "feature_1");
  assert.equal(context.selection.mode, "face");
  assert.equal(context.provenance.role, "face.py");
  assert.equal(context.view.projection, "orthographic");
  assert.equal(context.userPrompt, "Make it wider");
});

test("feature graph patch creates parameters and applies parameter references", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({
      primitive: "box",
      objectId: "cube",
      position: { x: 0, y: 0, z: 0 },
      size: { x: 1, y: 1, z: 1 },
    }),
  ]);

  const result = applyFeatureGraphPatch({
    features,
    patch: {
      operations: [
        { type: "add_parameter", parameter: { name: "width", value: 2 } },
        {
          type: "update_feature_params",
          featureId: "feature_1",
          params: { size: { x: { $param: "width" } } },
        },
      ],
    },
  });

  assert.deepEqual(result.parameters, [{ name: "width", value: 2 }]);
  assert.deepEqual(result.features[0].params.size, { x: { $param: "width" }, y: 1, z: 1 });
});

test("feature graph patch rejects mesh or viewer edits", () => {
  const features = featureGraphFromOperations([
    createPrimitiveOperation({ primitive: "box", objectId: "cube" }),
  ]);

  assert.throws(() => applyFeatureGraphPatch({
    features,
    patch: {
      operations: [
        {
          type: "update_feature_params",
          featureId: "feature_1",
          params: { meshData: { vertices: [] } },
        },
      ],
    },
  }), /meshData/);
});

test("encrypted API key vault stores ciphertext without exposing raw key", async () => {
  const backing = new Map();
  const storage = {
    setItem: (key, value) => backing.set(key, value),
    getItem: (key) => backing.get(key) ?? null,
    removeItem: (key) => backing.delete(key),
  };
  const vault = new ApiKeyVault({
    indexedDBImpl: null,
    storage,
    cryptoImpl: globalThis.crypto,
    origin: "https://example.test",
  });

  await vault.saveKey("openai", "sk-test-secret");
  const stored = [...backing.values()].join("\n");
  assert.equal(stored.includes("sk-test-secret"), false);
  assert.equal(await vault.loadKey("openai"), "sk-test-secret");
  await vault.removeKey("openai");
  assert.equal(await vault.hasKey("openai"), false);
});

test("OpenAI Responses API output text is parsed as the feature graph patch", () => {
  const patch = parseProviderPatch({
    id: "resp_test",
    object: "response",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "{\"operations\":[{\"op\":\"update_feature_params\",\"featureId\":\"feature_1\",\"params\":{\"size\":{\"x\":1,\"y\":2,\"z\":1}}}]}",
          },
        ],
      },
    ],
  });

  assert.deepEqual(patch, {
    operations: [
      {
        op: "update_feature_params",
        featureId: "feature_1",
        params: { size: { x: 1, y: 2, z: 1 } },
      },
    ],
  });
});
