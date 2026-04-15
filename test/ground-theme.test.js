import test from "node:test";
import assert from "node:assert/strict";
import {
  GROUND_THEMES,
  createGroundThemeGroup,
  normalizeGroundTheme,
  normalizeTerrainVariation,
} from "../src/environment/ground-theme.js";

test("ground theme normalizers preserve safe defaults", () => {
  assert.equal(normalizeGroundTheme("unknown"), GROUND_THEMES.NONE);
  assert.equal(normalizeGroundTheme(GROUND_THEMES.FOREST), GROUND_THEMES.FOREST);
  assert.equal(normalizeTerrainVariation(-1), 0);
  assert.equal(normalizeTerrainVariation(2), 1);
  assert.equal(normalizeTerrainVariation("0.42"), 0.42);
});

test("ground theme groups are scene-only non-selectable environment geometry", () => {
  const group = createGroundThemeGroup({
    theme: GROUND_THEMES.CITY,
    terrainVariation: 0.65,
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
