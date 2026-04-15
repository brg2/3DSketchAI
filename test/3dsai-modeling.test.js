import test from "node:test";
import assert from "node:assert/strict";
import { makeTaperedBox } from "../src/modeling/3dsai-modeling.js";

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
