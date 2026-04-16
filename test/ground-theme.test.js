import test from "node:test";
import assert from "node:assert/strict";
import {
  GROUND_THEMES,
  createGroundThemeGroup,
  normalizeGroundTheme,
  normalizeElevationVariation,
  normalizeTerrainDensity,
  normalizeTerrainSeed,
  normalizeTerrainVariation,
} from "../src/environment/ground-theme.js";

test("ground theme normalizers preserve safe defaults", () => {
  assert.equal(normalizeGroundTheme("unknown"), GROUND_THEMES.NONE);
  assert.equal(normalizeGroundTheme(GROUND_THEMES.FOREST), GROUND_THEMES.FOREST);
  assert.equal(normalizeElevationVariation(-1), 0);
  assert.equal(normalizeElevationVariation(2), 1);
  assert.equal(normalizeElevationVariation("0.42"), 0.42);
  assert.equal(normalizeTerrainVariation(-1), 0);
  assert.equal(normalizeTerrainVariation(2), 1);
  assert.equal(normalizeTerrainVariation("0.42"), 0.42);
  assert.equal(normalizeTerrainVariation("invalid"), 0.5);
  assert.equal(normalizeTerrainDensity(-1), 0);
  assert.equal(normalizeTerrainDensity(2), 1);
  assert.equal(normalizeTerrainDensity("0.25"), 0.25);
  assert.equal(normalizeTerrainDensity("invalid"), 0.5);
  assert.equal(normalizeTerrainSeed("12.8"), 12);
  assert.equal(normalizeTerrainSeed(-1), 0);
  assert.equal(normalizeTerrainSeed("invalid"), 0);
});

test("ground theme groups are scene-only non-selectable environment geometry", () => {
  const group = createGroundThemeGroup({
    theme: GROUND_THEMES.CITY,
    elevationVariation: 0.65,
  });

  assert.equal(group.userData.environment, true);
  assert.equal(group.userData.selectable, false);
  assert.ok(group.children.length > 1, "City theme should generate buildings plus terrain");
  assert.equal(group.children.filter((child) => child.userData.groundSurface === true).length, 1);

  group.traverse((child) => {
    if (child.isMesh) {
      assert.equal(child.userData.environment, true);
      assert.equal(child.userData.selectable, false);
    }
  });
});

test("terrain density scales theme detail geometry", () => {
  const emptyDirt = createGroundThemeGroup({
    theme: GROUND_THEMES.DIRT_ROCKS,
    elevationVariation: 0.4,
    terrainDensity: 0,
  });
  const sparseDirt = createGroundThemeGroup({
    theme: GROUND_THEMES.DIRT_ROCKS,
    elevationVariation: 0.4,
    terrainDensity: 0.25,
  });
  const baselineDirt = createGroundThemeGroup({
    theme: GROUND_THEMES.DIRT_ROCKS,
    elevationVariation: 0.4,
    terrainDensity: 0.5,
  });
  const fullDirt = createGroundThemeGroup({
    theme: GROUND_THEMES.DIRT_ROCKS,
    elevationVariation: 0.4,
    terrainDensity: 1,
  });

  assert.equal(emptyDirt.children.length, 1, "Zero density should leave only the terrain surface");
  assert.ok(sparseDirt.children.length > emptyDirt.children.length);
  assert.ok(baselineDirt.children.length > sparseDirt.children.length);
  assert.ok(fullDirt.children.length > baselineDirt.children.length);
});

test("terrain seed regenerates terrain artifact placement", () => {
  const firstSeed = createGroundThemeGroup({
    theme: GROUND_THEMES.FOREST,
    elevationVariation: 0.8,
    terrainDensity: 0.5,
    terrainSeed: 1,
  });
  const nextSeed = createGroundThemeGroup({
    theme: GROUND_THEMES.FOREST,
    elevationVariation: 0.8,
    terrainDensity: 0.5,
    terrainSeed: 2,
  });

  const firstArtifact = firstSeed.children.find((child) => child.isMesh && child.userData.groundSurface !== true);
  const nextArtifact = nextSeed.children.find((child) => child.isMesh && child.userData.groundSurface !== true);

  assert.ok(firstArtifact);
  assert.ok(nextArtifact);
  assert.notDeepEqual(firstArtifact.position.toArray(), nextArtifact.position.toArray());
});

test("terrain variation changes contextual object size and placement randomness", () => {
  const lowVariation = createGroundThemeGroup({
    theme: GROUND_THEMES.FOREST,
    elevationVariation: 0.8,
    terrainVariation: 0,
    terrainDensity: 0.5,
    terrainSeed: 4,
  });
  const highVariation = createGroundThemeGroup({
    theme: GROUND_THEMES.FOREST,
    elevationVariation: 0.8,
    terrainVariation: 1,
    terrainDensity: 0.5,
    terrainSeed: 4,
  });

  const lowArtifact = lowVariation.children.find((child) => child.isMesh && child.userData.groundSurface !== true);
  const highArtifact = highVariation.children.find((child) => child.isMesh && child.userData.groundSurface !== true);

  assert.ok(lowArtifact);
  assert.ok(highArtifact);
  assert.notDeepEqual(lowArtifact.position.toArray(), highArtifact.position.toArray());
  assert.notDeepEqual(lowArtifact.scale.toArray(), highArtifact.scale.toArray());
});

test("high terrain variation keeps forest trees spatially distributed", () => {
  const forest = createGroundThemeGroup({
    theme: GROUND_THEMES.FOREST,
    elevationVariation: 1,
    terrainVariation: 1,
    terrainDensity: 1,
    terrainSeed: 12,
  });
  const trunks = [];
  forest.traverse((child) => {
    if (child.isMesh && child.geometry?.type === "CylinderGeometry") {
      trunks.push(child.position);
    }
  });

  assert.ok(trunks.length > 70);
  assert.ok(nearestNeighborMinimum(trunks) > 1.25);
});

function nearestNeighborMinimum(points) {
  let minimum = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      minimum = Math.min(minimum, points[i].distanceTo(points[j]));
    }
  }
  return minimum;
}
