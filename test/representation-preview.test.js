import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { RepresentationStore } from "../src/representation/representation-store.js";
import { selectorFromIntersection } from "../src/interaction/selection-pipeline.js";
import { ModelExecutor } from "../src/modeling/model-executor.js";
import { meshDataForDisplayTransform, meshDataSignature } from "../src/modeling/replicad-opencascade-adapter.js";

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

test("full-object rotate preview rotates the displayed mesh", () => {
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
    type: "rotate",
    targetId: "obj_1",
    selection: { mode: "object", objectId: "obj_1", objectIds: ["obj_1"] },
    params: { deltaEuler: { x: 0, y: 0.75, z: 0 } },
  });

  const mesh = store.getSelectableMeshes()[0];
  assert.equal(mesh.rotation.x, 0);
  assert.equal(mesh.rotation.y, 0.75);
  assert.equal(mesh.rotation.z, 0);
});

test("exact brep replacement preserves committed object rotation as display transform", () => {
  const store = new RepresentationStore();
  store.bindScene(new THREE.Scene());
  const meshData = {
    vertices: [-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5],
    triangles: [0, 1, 2],
    normals: [],
  };
  const signature = meshDataSignature(meshData);
  store.setInitialSceneState({
    obj_1: {
      primitive: "brep_mesh",
      meshData,
      meshSignature: signature,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  });

  store.replaceWithExact({
    sceneState: {
      obj_1: {
        primitive: "brep_mesh",
        meshData,
        meshSignature: signature,
        position: { x: 0, y: 0.6, z: 0 },
        rotation: { x: 0, y: 0.4, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    },
  });

  const mesh = store.getSelectableMeshes()[0];
  assert.equal(mesh.position.y, 0.6);
  assert.equal(mesh.rotation.y, 0.4);
});

test("display transform mesh data keeps feature-space selector hints stable", () => {
  const meshData = meshDataForDisplayTransform({
    vertices: [1.5, 0.1, -1.5, 2.5, 0.1, -1.5, 2.5, 1.1, -1.5],
    triangles: [0, 1, 2],
    normals: [],
    faceProvenance: [{
      objectId: "obj_1",
      featureId: "feature_1",
      role: "face.nz",
      hint: {
        point: { x: 2, y: 0.6, z: -1.5 },
        normal: { x: 0, y: 0, z: -1 },
      },
    }],
  }, {
    position: { x: 2, y: 0.6, z: -1 },
    rotation: { x: 0, y: 0.4, z: 0 },
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(meshData.vertices), 3));
  geometry.setIndex([0, 1, 2]);
  geometry.userData.faceProvenance = meshData.faceProvenance;
  geometry.userData.featureSpaceOrigin = meshData.featureSpaceOrigin;
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.set(2, 0.6, -1);
  mesh.rotation.set(0, 0.4, 0);
  mesh.updateMatrixWorld(true);
  const localPoint = new THREE.Vector3(0.2, 0, -0.5);
  const worldPoint = mesh.localToWorld(localPoint.clone());

  const selector = selectorFromIntersection({
    object: mesh,
    faceIndex: 0,
    face: { normal: new THREE.Vector3(0, 0, -1) },
    point: worldPoint,
  });

  assert.deepEqual(selector.hint.point, { x: 2.2, y: 0.6, z: -1.5 });
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

test("picking builds a model-space selector from triangle provenance", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]), 3));
  geometry.setIndex([0, 1, 2]);
  geometry.userData.faceProvenance = [{
    objectId: "obj_1",
    featureId: "feature_1",
    role: "face.pz",
    hint: {
      point: { x: 0.333333, y: 0.333333, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
    },
  }];
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.set(2, 0, 0);
  mesh.updateMatrixWorld(true);

  const selector = selectorFromIntersection({
    object: mesh,
    faceIndex: 0,
    face: { normal: new THREE.Vector3(0, 0, 1) },
    point: new THREE.Vector3(2.25, 0.25, 0),
  });

  assert.deepEqual(selector, {
    featureId: "feature_1",
    role: "face.pz",
    hint: {
      point: { x: 0.25, y: 0.25, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
    },
  });
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

test("push-pull preview extrudes the provenance face without moving its source vertices", () => {
  const store = new RepresentationStore();
  store.bindScene(new THREE.Scene());
  const meshData = {
    vertices: [
      0, 0, 1,
      1, 0, 1,
      1, 1, 1,
      0, 1, 1,
      0, 0, 0,
      1, 0, 0,
      1, 0, 1,
      0, 0, 1,
      1, 0, 0,
      1, 1, 0,
      1, 1, 1,
      1, 0, 1,
    ],
    triangles: [
      0, 1, 2, 0, 2, 3,
      4, 5, 6, 4, 6, 7,
      8, 9, 10, 8, 10, 11,
    ],
    normals: [],
    faceProvenance: [
      { featureId: "feature_1", role: "face.pz" },
      { featureId: "feature_1", role: "face.pz" },
      { featureId: "feature_1", role: "face.ny" },
      { featureId: "feature_1", role: "face.ny" },
      { featureId: "feature_1", role: "face.px" },
      { featureId: "feature_1", role: "face.px" },
    ],
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
    type: "push_pull",
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      selector: {
        featureId: "feature_1",
        role: "face.pz",
        hint: {
          point: { x: 0.5, y: 0.5, z: 1 },
          normal: { x: 0, y: 0, z: 1 },
        },
      },
    },
    params: {
      axis: { x: 0, y: 0, z: 1 },
      distance: 1,
      mode: "move",
    },
  });

  const positions = store.getSelectableMeshes()[0].geometry.getAttribute("position");
  assert.equal(positions.count, 32, "Preview should split cap and wall vertices so generated normals stay flat");
  assert.equal(positions.getZ(0), 1, "Selected source face should stay at its original position");
  assert.equal(positions.getZ(6), 1, "Coincident side top vertex should stay at the source boundary");
  assert.equal(positions.getZ(10), 1, "Adjacent side top vertex should stay at the source boundary");
  assert.equal(positions.getZ(12), 2, "Extruded cap should move along the push-pull axis");
  assert.equal(positions.getZ(13), 2, "Extruded cap should include all selected face corners");
  assert.equal(positions.getZ(4), 0, "Side bottom vertex should remain fixed");
  assert.equal(store.getSelectableMeshes()[0].geometry.index.count, 42, "Preview should replace the source face with cap and side-wall triangles");
  const indices = [...store.getSelectableMeshes()[0].geometry.index.array];
  assert.deepEqual(indices.slice(0, 6), [4, 5, 6, 4, 6, 7], "Source face triangles should be removed from the exterior preview mesh");
});

test("push-pull preview uses the picked face group before broad provenance roles", () => {
  const store = new RepresentationStore();
  store.bindScene(new THREE.Scene());
  const meshData = {
    vertices: [
      0, 0, 1,
      1, 0, 1,
      1, 1, 1,
      0, 1, 1,
      2, 0, 1,
      3, 0, 1,
      3, 1, 1,
      2, 1, 1,
    ],
    triangles: [
      0, 1, 2, 0, 2, 3,
      4, 5, 6, 4, 6, 7,
    ],
    normals: [],
    faceProvenance: [
      { featureId: "feature_1", role: "face.pz" },
      { featureId: "feature_1", role: "face.pz" },
      { featureId: "feature_1", role: "face.pz" },
      { featureId: "feature_1", role: "face.pz" },
    ],
    faceGroups: [
      { start: 0, count: 6, provenance: { featureId: "feature_1", role: "face.pz" } },
      { start: 6, count: 6, provenance: { featureId: "feature_1", role: "face.pz" } },
    ],
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
    type: "push_pull",
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      faceIndex: 2,
      selector: {
        featureId: "feature_1",
        role: "face.pz",
        hint: {
          point: { x: 2.5, y: 0.5, z: 1 },
          normal: { x: 0, y: 0, z: 1 },
        },
      },
    },
    params: {
      axis: { x: 0, y: 0, z: 1 },
      distance: 1,
      mode: "move",
    },
  });

  const positions = store.getSelectableMeshes()[0].geometry.getAttribute("position");
  assert.equal(positions.count, 28, "Only the picked face group should be extruded");
  for (let index = 0; index < 4; index += 1) {
    assert.equal(positions.getZ(index), 1, "Unpicked coplanar face should stay in place");
  }
  for (let index = 8; index < positions.count; index += 1) {
    assert.ok(
      positions.getX(index) >= 2,
      "Extruded preview vertices should come from the picked face, not every face with the same role",
    );
  }
});

test("primitive push-pull preview renders the resolved box instead of an extrusion shell", () => {
  const store = new RepresentationStore();
  store.bindScene(new THREE.Scene());
  const meshData = {
    vertices: [
      -0.5, -0.5, -0.5,
      0.5, -0.5, -0.5,
      0.5, 0.5, -0.5,
      -0.5, 0.5, -0.5,
      -0.5, -0.5, 0.5,
      0.5, -0.5, 0.5,
      0.5, 0.5, 0.5,
      -0.5, 0.5, 0.5,
    ],
    triangles: [
      0, 1, 2, 0, 2, 3,
      4, 6, 5, 4, 7, 6,
      0, 4, 5, 0, 5, 1,
      3, 2, 6, 3, 6, 7,
      1, 5, 6, 1, 6, 2,
      0, 3, 7, 0, 7, 4,
    ],
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
    type: "push_pull",
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
      distance: 0.562,
      mode: "move",
      previewPrimitiveState: {
        primitive: "box",
        position: { x: 0, y: 0, z: 0.281 },
        size: { x: 1, y: 1, z: 1.562 },
      },
    },
  });

  const mesh = store.getSelectableMeshes()[0];
  const positions = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.index;
  const bounds = new THREE.Box3().setFromObject(mesh);

  assert.equal(positions.count, 24, "Resolved primitive preview should use a clean box mesh");
  assert.equal(index.count, 36, "Resolved primitive preview should not generate extra extrusion shell triangles");
  assert.deepEqual(
    {
      minZ: Math.round(bounds.min.z * 1000) / 1000,
      maxZ: Math.round(bounds.max.z * 1000) / 1000,
    },
    { minZ: -0.5, maxZ: 1.062 },
  );
});

test("face rotate preview tapers the selected brep face", () => {
  const store = new RepresentationStore();
  store.bindScene(new THREE.Scene());
  const meshData = {
    vertices: [
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
      0, 0, 1,
      1, 0, 1,
      1, 1, 1,
      0, 1, 1,
      0.5, 0.5, 1,
    ],
    triangles: [
      0, 1, 2, 0, 2, 3,
      4, 6, 5, 4, 7, 6,
      0, 4, 5, 0, 5, 1,
      3, 2, 6, 3, 6, 7,
      1, 5, 6, 1, 6, 2,
      0, 3, 7, 0, 7, 4,
    ],
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
    type: "rotate",
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      faceIndex: 2,
      faceNormalWorld: { x: 0, y: 0, z: 1 },
    },
    params: {
      deltaEuler: { x: 0, y: 0, z: 0 },
      faceTilt: {
        faceIndex: 2,
        faceNormalWorld: { x: 0, y: 0, z: 1 },
        faceAxis: "z",
        faceSign: 1,
        hingeAxis: "x",
        hingeSideAxis: "y",
        hingeSideSign: 0,
        angle: 0.2,
      },
    },
  });

  let positions = store.getSelectableMeshes()[0].geometry.getAttribute("position");
  const lowerTopZ = positions.getZ(4);
  const upperTopZ = positions.getZ(7);
  const centerTopZ = positions.getZ(8);
  assert.ok(lowerTopZ < 1, "Lower side of selected face should move inward");
  assert.ok(upperTopZ > 1, "Upper side of selected face should move outward");
  assert.equal(centerTopZ, 1, "Center hinge line should stay fixed");
  assert.equal(positions.getZ(0), 0, "Opposite face should remain fixed");

  store.clearPreview();

  positions = store.getSelectableMeshes()[0].geometry.getAttribute("position");
  assert.equal(positions.getZ(4), 1);
  assert.equal(positions.getZ(7), 1);
  assert.equal(positions.getZ(8), 1);
});

test("face rotate preview hinges around the provenance face center, not whole-mesh bounds", () => {
  const store = new RepresentationStore();
  store.bindScene(new THREE.Scene());
  const meshData = {
    vertices: [
      0, 0, 1,
      1, 0, 1,
      1, 1, 1,
      0, 1, 1,
      0.5, 0.5, 1,
      0, 3, 0,
      1, 3, 0,
      0.5, 3, 1,
    ],
    triangles: [
      0, 1, 4,
      1, 2, 4,
      2, 3, 4,
      3, 0, 4,
      5, 6, 7,
    ],
    normals: [],
    faceProvenance: [
      { featureId: "feature_1", role: "face.pz" },
      { featureId: "feature_1", role: "face.pz" },
      { featureId: "feature_1", role: "face.pz" },
      { featureId: "feature_1", role: "face.pz" },
      { featureId: "feature_2", role: "face.py" },
    ],
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
    type: "rotate",
    targetId: "obj_1",
    selection: {
      mode: "face",
      objectId: "obj_1",
      objectIds: ["obj_1"],
      selector: {
        featureId: "feature_1",
        role: "face.pz",
        hint: {
          point: { x: 0.5, y: 0.5, z: 1 },
          normal: { x: 0, y: 0, z: 1 },
        },
      },
    },
    params: {
      deltaEuler: { x: 0, y: 0, z: 0 },
      faceTilt: {
        faceAxis: "z",
        faceSign: 1,
        hingeAxis: "x",
        hingeSideAxis: "y",
        hingeSideSign: 0,
        angle: 0.2,
      },
    },
  });

  const positions = store.getSelectableMeshes()[0].geometry.getAttribute("position");
  assert.equal(positions.getZ(4), 1, "Selected face center should stay on the hinge");
  assert.ok(positions.getZ(0) < 1, "Low side of selected face should tilt inward");
  assert.ok(positions.getZ(2) > 1, "High side of selected face should tilt outward");
  assert.equal(positions.getZ(7), 1, "Unselected distant mesh should not affect the hinge center");
});

test("face rotate preview applies both accumulated tilt axes", () => {
  const store = new RepresentationStore();
  store.bindScene(new THREE.Scene());
  const meshData = {
    vertices: [
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
      0, 0, 1,
      1, 0, 1,
      1, 1, 1,
      0, 1, 1,
    ],
    triangles: [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6],
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
    type: "rotate",
    targetId: "obj_1",
    selection: { mode: "face", objectId: "obj_1", objectIds: ["obj_1"], faceNormalWorld: { x: 0, y: 0, z: 1 } },
    params: {
      deltaEuler: { x: 0, y: 0, z: 0 },
      faceTilt: {
        faceAxis: "z",
        faceSign: 1,
        hingeAxis: "y",
        hingeSideAxis: "x",
        hingeSideSign: 0,
        angle: 0.2,
      },
      faceTilts: [
        {
          faceAxis: "z",
          faceSign: 1,
          hingeAxis: "x",
          hingeSideAxis: "y",
          hingeSideSign: 0,
          angle: 0.2,
        },
        {
          faceAxis: "z",
          faceSign: 1,
          hingeAxis: "y",
          hingeSideAxis: "x",
          hingeSideSign: 0,
          angle: 0.2,
        },
      ],
    },
  });

  const positions = store.getSelectableMeshes()[0].geometry.getAttribute("position");
  assert.ok(positions.getZ(4) < 1, "Low x/low y top corner should move inward");
  assert.ok(positions.getZ(6) > 1, "High x/high y top corner should move outward");
});
