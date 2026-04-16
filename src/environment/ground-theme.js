import * as THREE from "three";

export const GROUND_THEMES = Object.freeze({
  NONE: "none",
  GRASS: "grass",
  WATER: "water",
  DIRT_ROCKS: "dirt-rocks",
  FOREST: "forest",
  CITY: "city",
});

const THEME_OPTIONS = new Set(Object.values(GROUND_THEMES));
const TERRAIN_SIZE = 100;
const TERRAIN_SEGMENTS = 64;
const BASE_TERRAIN_DENSITY = 0.5;
const BASE_TERRAIN_VARIATION = 0.5;

export function normalizeGroundTheme(value) {
  return THEME_OPTIONS.has(value) ? value : GROUND_THEMES.NONE;
}

export function normalizeElevationVariation(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return THREE.MathUtils.clamp(numeric, 0, 1);
}

export function normalizeTerrainVariation(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return BASE_TERRAIN_VARIATION;
  }
  return THREE.MathUtils.clamp(numeric, 0, 1);
}

export function normalizeTerrainDensity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return BASE_TERRAIN_DENSITY;
  }
  return THREE.MathUtils.clamp(numeric, 0, 1);
}

export function normalizeTerrainSeed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

export function createGroundThemeGroup({
  theme = GROUND_THEMES.NONE,
  elevationVariation = 0,
  terrainVariation = BASE_TERRAIN_VARIATION,
  terrainDensity = BASE_TERRAIN_DENSITY,
  terrainSeed = 0,
} = {}) {
  const normalizedTheme = normalizeGroundTheme(theme);
  const elevation = normalizeElevationVariation(elevationVariation);
  const objectVariation = normalizeTerrainVariation(terrainVariation);
  const density = normalizeTerrainDensity(terrainDensity);
  const seed = normalizeTerrainSeed(terrainSeed);
  const group = new THREE.Group();
  group.name = `ground-theme:${normalizedTheme}`;
  group.userData.environment = true;
  group.userData.selectable = false;

  const ground = createTerrainMesh(normalizedTheme, elevation, seed);
  group.add(ground);

  if (normalizedTheme === GROUND_THEMES.GRASS) {
    addGrass(group, elevation, density, seed, objectVariation);
  } else if (normalizedTheme === GROUND_THEMES.WATER) {
    addWater(group);
  } else if (normalizedTheme === GROUND_THEMES.DIRT_ROCKS) {
    addRocks(group, elevation, density, seed, objectVariation);
  } else if (normalizedTheme === GROUND_THEMES.FOREST) {
    addGrass(group, elevation, density, seed, objectVariation, 70);
    addForest(group, elevation, density, seed, objectVariation);
  } else if (normalizedTheme === GROUND_THEMES.CITY) {
    addCity(group, elevation, density, seed, objectVariation);
  }

  return group;
}

function createTerrainMesh(theme, elevation, seed) {
  const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  const maxHeight = theme === GROUND_THEMES.WATER ? elevation * 0.45 : elevation * 5.5;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const centerFalloff = THREE.MathUtils.smoothstep(Math.hypot(x, z), 8, 45);
    const height = terrainNoise(x, z, seed) * maxHeight * centerFalloff;
    position.setY(i, height - 0.001);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: themeColor(theme),
    roughness: theme === GROUND_THEMES.WATER ? 0.38 : 1,
    metalness: 0,
    transparent: theme === GROUND_THEMES.WATER,
    opacity: theme === GROUND_THEMES.WATER ? 0.72 : 1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.userData.environment = true;
  mesh.userData.selectable = false;
  mesh.userData.groundSurface = true;
  return mesh;
}

function addGrass(group, elevation, density, seed, objectVariation, baseCount = 130) {
  const material = new THREE.MeshStandardMaterial({ color: 0x46a43f, roughness: 1 });
  const geometry = new THREE.ConeGeometry(0.035, 0.34, 5);
  const count = detailCount(baseCount, density);
  for (let i = 0; i < count; i += 1) {
    const { x, z } = distributedPoint(i, 23, 43, seed, objectVariation, count);
    if (Math.hypot(x, z) < 3.5) {
      continue;
    }
    const blade = new THREE.Mesh(geometry, material);
    blade.position.set(x, terrainHeightAt(x, z, elevation, seed) + 0.16, z);
    blade.rotation.y = variedUnit(seeded(i, 311, seed), 0.5, objectVariation) * Math.PI;
    blade.scale.y = variedRange(0.6, 1.5, seeded(i, 719, seed), objectVariation);
    blade.castShadow = true;
    blade.userData.environment = true;
    blade.userData.selectable = false;
    group.add(blade);
  }
}

function addWater(group) {
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 32, 32),
    new THREE.MeshStandardMaterial({
      color: 0x58b7dc,
      roughness: 0.18,
      metalness: 0.04,
      transparent: true,
      opacity: 0.42,
    }),
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.035;
  surface.receiveShadow = true;
  surface.userData.environment = true;
  surface.userData.selectable = false;
  group.add(surface);
}

function addRocks(group, elevation, density, seed, objectVariation) {
  const material = new THREE.MeshStandardMaterial({ color: 0x7d7465, roughness: 1 });
  const geometry = new THREE.DodecahedronGeometry(0.35, 0);
  const count = detailCount(36, density);
  for (let i = 0; i < count; i += 1) {
    const { x, z } = distributedPoint(i, 41, 45, seed, objectVariation, count);
    if (Math.hypot(x, z) < 5) {
      continue;
    }
    const rock = new THREE.Mesh(geometry, material);
    rock.position.set(x, terrainHeightAt(x, z, elevation, seed) + 0.18, z);
    const scale = variedRange(0.55, 1.4, seeded(i, 997, seed), objectVariation);
    rock.scale.set(
      scale,
      variedRange(0.35, 0.9, seeded(i, 577, seed), objectVariation),
      scale * variedRange(0.7, 0.7, seeded(i, 809, seed), objectVariation),
    );
    rock.rotation.set(
      variedUnit(seeded(i, 19, seed), 0.5, objectVariation) * Math.PI,
      variedUnit(seeded(i, 29, seed), 0.5, objectVariation) * Math.PI,
      variedUnit(seeded(i, 37, seed), 0.5, objectVariation) * Math.PI,
    );
    rock.castShadow = true;
    rock.receiveShadow = true;
    rock.userData.environment = true;
    rock.userData.selectable = false;
    group.add(rock);
  }
}

function addForest(group, elevation, density, seed, objectVariation) {
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x78512d, roughness: 0.95 });
  const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x2d7d3a, roughness: 0.9 });
  const trunkGeometry = new THREE.CylinderGeometry(0.13, 0.18, 1.25, 7);
  const canopyGeometry = new THREE.ConeGeometry(0.82, 1.8, 8);
  const count = detailCount(42, density);
  for (let i = 0; i < count; i += 1) {
    const { x, z } = distributedPoint(i, 67, 44, seed, objectVariation, count);
    if (Math.hypot(x, z) < 8) {
      continue;
    }
    const y = terrainHeightAt(x, z, elevation, seed);
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.set(x, y + 0.62, z);
    trunk.castShadow = true;
    trunk.userData.environment = true;
    trunk.userData.selectable = false;

    const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
    canopy.position.set(x, y + 1.85, z);
    const scale = variedRange(0.75, 0.65, seeded(i, 401, seed), objectVariation);
    canopy.scale.set(scale, scale, scale);
    canopy.castShadow = true;
    canopy.userData.environment = true;
    canopy.userData.selectable = false;

    group.add(trunk, canopy);
  }
}

function addCity(group, elevation, density, seed, objectVariation) {
  const material = new THREE.MeshStandardMaterial({ color: 0x9aa7b5, roughness: 0.82 });
  const buildingCount = detailCount(72, density);
  const slots = [];
  let slotIndex = 0;
  for (let layer = 0; layer < Math.ceil(buildingCount / 72); layer += 1) {
    for (let ix = -4; ix <= 4; ix += 1) {
      for (let iz = -4; iz <= 4; iz += 1) {
        if (Math.abs(ix) < 2 && Math.abs(iz) < 2) {
          continue;
        }
        slots.push({ ix, iz, layer, order: variedUnit(seeded(slotIndex, 613, seed), slotIndex / 72, objectVariation) });
        slotIndex += 1;
      }
    }
  }

  slots.sort((a, b) => a.layer - b.layer || a.order - b.order);
  for (let i = 0; i < buildingCount; i += 1) {
    const { ix, iz, layer } = slots[i];
    const layerSalt = layer * 1009;
    const height = variedRange(1.2, 6.5, seeded(ix * 31 + iz + layerSalt, 173, seed), objectVariation);
    const width = variedRange(1.1, 1.2, seeded(ix * 19 + iz + layerSalt, 227, seed), objectVariation);
    const depth = variedRange(1.1, 1.2, seeded(ix * 43 + iz + layerSalt, 271, seed), objectVariation);
    const layerOffsetRadius = layer === 0 ? 0 : 1.9;
    const layerOffsetAngle = variedUnit(seeded(ix * 89 + iz + layerSalt, 389, seed), 0.5, objectVariation) * Math.PI * 2;
    const xJitter = variedCentered(seeded(ix, iz + 13 + layerSalt, seed), objectVariation) * 1.3;
    const zJitter = variedCentered(seeded(ix + 17 + layerSalt, iz, seed), objectVariation) * 1.3;
    const x = ix * 6 + xJitter + Math.cos(layerOffsetAngle) * layerOffsetRadius;
    const z = iz * 6 + zJitter + Math.sin(layerOffsetAngle) * layerOffsetRadius;
    const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    building.position.set(x, terrainHeightAt(x, z, elevation, seed) + height / 2, z);
    building.castShadow = true;
    building.receiveShadow = true;
    building.userData.environment = true;
    building.userData.selectable = false;
    group.add(building);
  }
}

function detailCount(baseCount, density) {
  const normalized = normalizeTerrainDensity(density);
  if (normalized <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(baseCount * (normalized / BASE_TERRAIN_DENSITY)));
}

function themeColor(theme) {
  switch (theme) {
    case GROUND_THEMES.GRASS:
    case GROUND_THEMES.FOREST:
      return 0x8ccf67;
    case GROUND_THEMES.WATER:
      return 0x7dd3ed;
    case GROUND_THEMES.DIRT_ROCKS:
      return 0xb48a61;
    case GROUND_THEMES.CITY:
      return 0xd2d6db;
    default:
      return 0xf3f6fa;
  }
}

function terrainHeightAt(x, z, elevation, seed) {
  const centerFalloff = THREE.MathUtils.smoothstep(Math.hypot(x, z), 8, 45);
  return terrainNoise(x, z, seed) * elevation * 5.5 * centerFalloff;
}

function terrainNoise(x, z, seed = 0) {
  const offsetX = seed === 0 ? 0 : seeded(seed, 11) * 31;
  const offsetZ = seed === 0 ? 0 : seeded(seed, 17) * 31;
  return (
    Math.sin((x + offsetX) * 0.13 + (z + offsetZ) * 0.07) * 0.42 +
    Math.cos((x + offsetX) * 0.05 - (z + offsetZ) * 0.17) * 0.36 +
    Math.sin((x + z + offsetX - offsetZ) * 0.21) * 0.22
  );
}

function distributedPoint(index, salt, radius, seed, objectVariation, count) {
  const normalizedCount = Math.max(1, count);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const seedRotation = seeded(salt, 53, seed) * Math.PI * 2;
  const baseAngle = index * goldenAngle + seedRotation;
  const baseDistance = Math.sqrt((index + 0.5) / normalizedCount) * radius;
  const variation = normalizeTerrainVariation(objectVariation);
  const radialCellSize = radius / Math.sqrt(normalizedCount);
  const angleJitter = (seeded(index, salt + 211, seed) - 0.5) * goldenAngle * 0.18 * variation;
  const distanceJitter = (seeded(index, salt + 307, seed) - 0.5) * radialCellSize * 0.32 * variation;
  const angle = baseAngle + angleJitter;
  const distance = THREE.MathUtils.clamp(baseDistance + distanceJitter, 0, radius);
  return {
    x: Math.cos(angle) * distance,
    z: Math.sin(angle) * distance,
  };
}

function variedRange(base, span, randomUnit, objectVariation, min = 0.05) {
  const mean = base + span * 0.5;
  return Math.max(min, mean + variedCentered(randomUnit, objectVariation) * span);
}

function variedCentered(randomUnit, objectVariation) {
  return (randomUnit - 0.5) * terrainVariationAmount(objectVariation);
}

function variedUnit(randomUnit, stableUnit, objectVariation) {
  const amount = terrainVariationAmount(objectVariation);
  return THREE.MathUtils.clamp(stableUnit + (randomUnit - stableUnit) * amount, 0, 1);
}

function terrainVariationAmount(objectVariation) {
  return normalizeTerrainVariation(objectVariation) / BASE_TERRAIN_VARIATION;
}

function seeded(a, b, seed = 0) {
  const value = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}
