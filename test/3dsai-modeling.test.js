import test from "node:test";
import assert from "node:assert/strict";
import { makeBox, makeTaperedBox, moveBoxVertex, pushPullFace } from "../src/modeling/3dsai-modeling.js";

test("makeTaperedBox builds a solid through direct Replicad-compatible calls", () => {
  const calls = { polygons: [], solids: [] };
  const r = {
    makePolygon(points) {
      calls.polygons.push(points);
      return { type: "face", points };
    },
    makeSolid(faces) {
      calls.solids.push(faces);
      return { type: "solid", faces };
    },
  };

  const solid = makeTaperedBox(r, {
    min: [-0.5, 0.1, -0.5],
    max: [0.5, 1.1, 0.5],
    faceTilts: [
      {
        faceAxis: "y",
        faceSign: 1,
        hingeSideAxis: "z",
        angle: 0.25,
      },
    ],
    faceExtrudes: [
      {
        faceAxis: "y",
        faceSign: 1,
        axis: { x: 0, y: 0.9, z: 0.4 },
        distance: 1,
      },
    ],
  });

  assert.equal(solid.type, "solid");
  assert.equal(calls.polygons.length, 6);
  assert.equal(calls.solids.length, 1);
  assert.equal(calls.solids[0].length, 6);
});

test("makeTaperedBox can add extension faces from a source face", () => {
  const calls = { polygons: [], solids: [] };
  const r = {
    makePolygon(points) {
      calls.polygons.push(points);
      return { type: "face", points };
    },
    makeSolid(faces) {
      calls.solids.push(faces);
      return { type: "solid", faces };
    },
  };

  const solid = makeTaperedBox(r, {
    min: [-0.5, 0.1, -0.5],
    max: [0.5, 1.1, 0.5],
    faceExtensions: [
      {
        faceAxis: "y",
        faceSign: 1,
        axis: { x: 0, y: 1, z: 0 },
        distance: 1,
      },
    ],
  });

  assert.equal(solid.type, "solid");
  assert.equal(calls.polygons.length, 11);
  assert.equal(calls.solids[0].length, 11);
});

test("vector face tilt replays along the current face normal instead of a world axis", () => {
  const r = {
    makePolygon(points) {
      return { type: "face", points };
    },
    makeSolid(faces) {
      return { type: "solid", faces };
    },
  };
  const box = makeBox(r, [0, 0, 0], [1, 1, 1]);
  box.applyCenteredTapers([
    {
      faceAxis: "z",
      faceSign: 1,
      faceNormal: { x: 0, y: 0, z: 1 },
      hingeSideVector: { x: 0, y: 1, z: 0 },
      angle: 0.2,
    },
  ]);

  const tiltedNormal = normalize({ x: 0, y: -Math.tan(0.2), z: 1 });
  const before = [...box.corners.px_py_pz];
  box.applyCenteredTapers([
    {
      faceAxis: "z",
      faceSign: 1,
      faceNormal: tiltedNormal,
      hingeSideVector: { x: 1, y: 0, z: 0 },
      angle: 0.2,
    },
  ]);

  assert.notEqual(box.corners.px_py_pz[1], before[1], "Tilted-normal replay should move in the normal's y component");
  assert.notEqual(box.corners.px_py_pz[2], before[2], "Tilted-normal replay should move in the normal's z component");
});

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

test("moveBoxVertex applies iterative vertex moves from editable box state", () => {
  const calls = { boxes: [], polygons: [], solids: [] };
  const r = {
    makeBox(min, max) {
      calls.boxes.push({ min, max });
      return { type: "box", min, max };
    },
    makePolygon(points) {
      calls.polygons.push(points);
      return { type: "face", points };
    },
    makeSolid(faces) {
      calls.solids.push(faces);
      return { type: "solid", faces };
    },
  };

  const box = makeBox(r, [-0.5, 0.1, -0.5], [0.5, 1.1, 0.5]);
  moveBoxVertex(r, box, { x: 0.5, y: 0.5, z: 0.5, key: "px_py_pz" }, [0.073, -0.241, 0.084]);
  moveBoxVertex(r, box, { x: 0.573, y: 0.259, z: 0.584, key: "px_py_pz" }, [-0.048, 0.183, -0.07]);
  const solid = box.toShape();

  assert.equal(solid.type, "solid");
  assert.equal(calls.boxes.length, 0);
  assert.equal(calls.solids.length, 1);
  const topFace = calls.solids.at(-1)[1];
  assert.deepEqual(topFace.points[2].map((value) => Math.round(value * 1000) / 1000), [0.525, 1.042, 0.514]);
});

test("pushPullFace records a semantic face extrusion without body scale transforms", () => {
  const calls = { boxes: [], polygons: [], solids: [] };
  const r = {
    makeBox(min, max) {
      calls.boxes.push({ min, max });
      return { type: "box", min, max };
    },
    makePolygon(points) {
      calls.polygons.push(points);
      return { type: "face", points };
    },
    makeSolid(faces) {
      calls.solids.push(faces);
      return { type: "solid", faces };
    },
  };

  const box = makeBox(r, [-0.5, 0.1, -0.5], [0.5, 1.1, 0.5]);
  pushPullFace(r, box, {
    axis: { x: 1, y: 0, z: 0 },
    distance: 0.25,
    faceAxis: "x",
    faceSign: 1,
    mode: "move",
  });
  const solid = box.toShape();

  assert.equal(solid.type, "solid");
  assert.equal(calls.boxes.length, 0);
  assert.equal(calls.solids.length, 1);
  const positiveXFace = calls.solids[0][3];
  assert.deepEqual(positiveXFace.points.map((point) => point[0]), [0.75, 0.75, 0.75, 0.75]);
});

test("editable box object translation replays to the BREP kernel with array vectors", () => {
  const calls = { boxes: [], translates: [] };
  const shape = {
    fuse() {
      return this;
    },
    cut() {
      return this;
    },
    translate(delta) {
      calls.translates.push(delta);
      return this;
    },
  };
  const r = {
    setOC() {},
    makeBox(min, max) {
      calls.boxes.push({ min, max });
      return shape;
    },
    makePolygon(points) {
      return { type: "face", points };
    },
  };

  const box = makeBox(r, [-0.5, 0.1, -0.5], [0.5, 1.1, 0.5]);
  box.translate({ x: 1.25, y: -0.5, z: 0.75 });
  const solid = box.toShape();

  assert.equal(solid, shape);
  assert.equal(calls.boxes.length, 1);
  assert.deepEqual(calls.translates, [[1.25, -0.5, 0.75]]);
});
