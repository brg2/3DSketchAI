import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { RepresentationStore } from "../src/representation/representation-store.js";
import { ModelExecutor } from "../src/modeling/model-executor.js";
import { meshDataSignature } from "../src/modeling/replicad-opencascade-adapter.js";

test("full-object move preview translates the displayed mesh", () => {
  const store = new RepresentationStore();
  store.bindScene(new THREE.Scene());
  store.setInitialSceneState({
    obj_1: {
      primitive: "box",
      position: { x: 0, y: 0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });

  store.setPreviewOperation({
    type: "move",
    targetId: "obj_1",
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { delta: { x: 1.25, y: -0.5, z: 0.75 } },
  });

  const mesh = store.getSelectableMeshes()[0];
  assert.deepEqual(
    { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
    { x: 1.25, y: 0, z: 0.75 },
  );
});

test("state replay move commit uses canonical operations instead of the current preview baseline", async () => {
  const executor = new ModelExecutor({
    adapter: {
      async execute() {
        throw new Error("force state replay");
      },
    },
  });

  const result = await executor.executeStateReplay({
    sceneState: {
      obj_1: {
        primitive: "box",
        position: { x: 5, y: 5, z: 5 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    },
    operations: [
      {
        type: "create_primitive",
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
        type: "move",
        targetId: "obj_1",
        selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
        params: { delta: { x: 1.25, y: -0.5, z: 0.75 } },
      },
    ],
  });

  const position = result.sceneState.obj_1.position;
  assert.equal(position.x, 1.25);
  assert.ok(Math.abs(position.y - 0.1) < 1e-9);
  assert.equal(position.z, 0.75);
});

test("exact brep replacement updates translated geometry with unchanged topology", () => {
  const store = new RepresentationStore();
  store.bindScene(new THREE.Scene());
  const initialMeshData = {
    vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    triangles: [0, 1, 2],
    normals: [],
  };
  const movedMeshData = {
    vertices: [2, 0, -1, 3, 0, -1, 2, 1, -1],
    triangles: [0, 1, 2],
    normals: [],
  };
  const initialSignature = meshDataSignature(initialMeshData);
  const movedSignature = meshDataSignature(movedMeshData);

  assert.notEqual(movedSignature, initialSignature);

  store.setInitialSceneState({
    obj_1: {
      primitive: "brep_mesh",
      meshData: initialMeshData,
      meshSignature: initialSignature,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });

  store.replaceWithExact({
    sceneState: {
      obj_1: {
        primitive: "brep_mesh",
        meshData: movedMeshData,
        meshSignature: movedSignature,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    },
  });

  const mesh = store.getSelectableMeshes()[0];
  const positions = mesh.geometry.getAttribute("position");
  assert.equal(mesh.position.x, 0);
  assert.equal(positions.getX(0), 2);
  assert.equal(positions.getZ(0), -1);
});

test("face move preview translates selected brep face vertices", () => {
  const store = new RepresentationStore();
  store.bindScene(new THREE.Scene());
  const meshData = {
    vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    triangles: [0, 1, 2],
    normals: [],
  };

  store.setInitialSceneState({
    obj_1: {
      primitive: "brep_mesh",
      meshData,
      meshSignature: meshDataSignature(meshData),
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });

  store.setPreviewOperation({
    type: "move",
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      faceIndex: 0,
      faceNormalWorld: { x: 0, y: 0, z: 1 },
    },
    params: {
      delta: { x: 0, y: 0, z: 2 },
      subshapeMove: {
        mode: "face",
        faceIndex: 0,
        faceNormalWorld: { x: 0, y: 0, z: 1 },
        faceAxis: "z",
        faceSign: 1,
        delta: { x: 0, y: 0, z: 2 },
      },
    },
  });

  let positions = store.getSelectableMeshes()[0].geometry.getAttribute("position");
  assert.equal(positions.getZ(0), 2);
  assert.equal(positions.getZ(1), 2);
  assert.equal(positions.getZ(2), 2);

  store.clearPreview();

  positions = store.getSelectableMeshes()[0].geometry.getAttribute("position");
  assert.equal(positions.getZ(0), 0);
  assert.equal(positions.getZ(1), 0);
  assert.equal(positions.getZ(2), 0);
});
