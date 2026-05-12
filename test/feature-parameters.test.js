import test from "node:test";
import assert from "node:assert/strict";
import { CanonicalModel, normalizeParameters, resolveParameterReferences } from "../src/index.js";
import { createPrimitiveOperation } from "../src/operation/operation-mapper.js";

test("feature graph JSON includes parameters and loads older graphs", () => {
  const model = new CanonicalModel();
  model.fromFeatureGraphJSON({
    features: [],
  });
  assert.deepEqual(model.getParameters(), []);
  assert.deepEqual(JSON.parse(model.toFeatureGraphJSON()).parameters, []);

  model.replaceParameters([{ name: "height", value: 3, unit: "m" }]);
  assert.deepEqual(JSON.parse(model.toFeatureGraphJSON()).parameters, [{ name: "height", value: 3, unit: "m" }]);
});

test("parameter references resolve deterministically", () => {
  const resolved = resolveParameterReferences({
    size: {
      x: { $param: "width" },
      y: 1,
      z: { $param: "depth" },
    },
  }, [
    { name: "width", value: 2 },
    { name: "depth", value: 4 },
  ]);

  assert.deepEqual(resolved, { size: { x: 2, y: 1, z: 4 } });
});

test("invalid and duplicate parameters are rejected", () => {
  assert.throws(() => normalizeParameters([{ name: "1bad", value: 1 }]), /identifier/);
  assert.throws(() => normalizeParameters([{ name: "w", value: 1 }, { name: "w", value: 2 }]), /Duplicate/);
});

test("canonical model operations resolve parameter refs but graph preserves them", () => {
  const model = new CanonicalModel();
  model.appendCommittedOperation(createPrimitiveOperation({
    primitive: "box",
    objectId: "cube",
    position: { x: 0, y: 0, z: 0 },
    size: { x: 1, y: 1, z: 1 },
  }));
  model.replaceParameters([{ name: "width", value: 2 }]);
  const feature = model.getFeatures()[0];
  feature.params.size.x = { $param: "width" };
  model.replaceFeatures([feature]);

  assert.deepEqual(model.getFeatures()[0].params.size.x, { $param: "width" });
  assert.equal(model.getOperations()[0].params.size.x, 2);
  assert.doesNotThrow(() => model.toTypeScriptModule());
});
