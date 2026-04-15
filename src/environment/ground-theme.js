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

export function normalizeGroundTheme(value) {
  return THEME_OPTIONS.has(value) ? value : GROUND_THEMES.NONE;
}

export function normalizeTerrainVariation(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return THREE.MathUtils.clamp(numeric, 0, 1);
}

export function createGroundThemeGroup({ theme = GROUND_THEMES.NONE, terrainVariation = 0 } = {}) {
  const normalizedTheme = normalizeGroundTheme(theme);
  const variation = normalizeTerrainVariation(terrainVariation);
  const group = new THREE.Group();
  group.name = `ground-theme:${normalizedTheme}`;
  group.userData.environment = true;
  group.userData.selectable = false;

  const ground = createTerrainMesh(normalizedTheme, variation);
  group.add(ground);

  if (normalizedTheme === GROUND_THEMES.GRASS) {
    addGrass(group, variation);
  } else if (normalizedTheme === GROUND_THEMES.WATER) {
    addWater(group);
  } else if (normalizedTheme === GROUND_THEMES.DIRT_ROCKS) {
    addRocks(group, variation);
  } else if (normalizedTheme === GROUND_THEMES.FOREST) {
    addGrass(group, variation, 70);
    addForest(group, variation);
  } else if (normalizedTheme === GROUND_THEMES.CITY) {
    addCity(group, variation);
  }

  return group;
}

function createTerrainMesh(theme, variation) {
  const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  const maxHeight = theme === GROUND_THEMES.WATER ? variation * 0.45 : variation * 5.5;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const centerFalloff = THREE.MathUtils.smoothstep(Math.hypot(x, z), 8, 45);
    const height = terrainNoise(x, z) * maxHeight * centerFalloff;
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

function addGrass(group, variation, count = 130) {
  const material = new THREE.MeshStandardMaterial({ color: 0x46a43f, roughness: 1 });
  const geometry = new THREE.ConeGeometry(0.035, 0.34, 5);
  for (let i = 0; i < count; i += 1) {
    const { x, z } = distributedPoint(i, 23, 43);
    if (Math.hypot(x, z) < 3.5) {
      continue;
    }
    const blade = new THREE.Mesh(geometry, material);
    blade.position.set(x, terrainHeightAt(x, z, variation) + 0.16, z);
    blade.rotation.y = seeded(i, 311) * Math.PI;
    blade.scale.y = 0.6 + seeded(i, 719) * 1.5;
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

function addRocks(group, variation) {
  const material = new THREE.MeshStandardMaterial({ color: 0x7d7465, roughness: 1 });
  const geometry = new THREE.DodecahedronGeometry(0.35, 0);
  for (let i = 0; i < 36; i += 1) {
    const { x, z } = distributedPoint(i, 41, 45);
    if (Math.hypot(x, z) < 5) {
      continue;
    }
    const rock = new THREE.Mesh(geometry, material);
    rock.position.set(x, terrainHeightAt(x, z, variation) + 0.18, z);
    const scale = 0.55 + seeded(i, 997) * 1.4;
    rock.scale.set(scale, 0.35 + seeded(i, 577) * 0.9, scale * (0.7 + seeded(i, 809) * 0.7));
    rock.rotation.set(seeded(i, 19) * Math.PI, seeded(i, 29) * Math.PI, seeded(i, 37) * Math.PI);
    rock.castShadow = true;
    rock.receiveShadow = true;
    rock.userData.environment = true;
    rock.userData.selectable = false;
    group.add(rock);
  }
}

function addForest(group, variation) {
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x78512d, roughness: 0.95 });
  const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x2d7d3a, roughness: 0.9 });
  const trunkGeometry = new THREE.CylinderGeometry(0.13, 0.18, 1.25, 7);
  const canopyGeometry = new THREE.ConeGeometry(0.82, 1.8, 8);
  for (let i = 0; i < 42; i += 1) {
    const { x, z } = distributedPoint(i, 67, 44);
    if (Math.hypot(x, z) < 8) {
      continue;
    }
    const y = terrainHeightAt(x, z, variation);
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.set(x, y + 0.62, z);
    trunk.castShadow = true;
    trunk.userData.environment = true;
    trunk.userData.selectable = false;

    const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
    canopy.position.set(x, y + 1.85, z);
    const scale = 0.75 + seeded(i, 401) * 0.65;
    canopy.scale.set(scale, scale, scale);
    canopy.castShadow = true;
    canopy.userData.environment = true;
    canopy.userData.selectable = false;

    group.add(trunk, canopy);
  }
}

function addCity(group, variation) {
  const material = new THREE.MeshStandardMaterial({ color: 0x9aa7b5, roughness: 0.82 });
  for (let ix = -4; ix <= 4; ix += 1) {
    for (let iz = -4; iz <= 4; iz += 1) {
      if (Math.abs(ix) < 2 && Math.abs(iz) < 2) {
        continue;
      }
      const height = 1.2 + seeded(ix * 31 + iz, 173) * 6.5;
      const width = 1.1 + seeded(ix * 19 + iz, 227) * 1.2;
      const depth = 1.1 + seeded(ix * 43 + iz, 271) * 1.2;
      const x = ix * 6 + (seeded(ix, iz + 13) - 0.5) * 1.3;
      const z = iz * 6 + (seeded(ix + 17, iz) - 0.5) * 1.3;
      const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      building.position.set(x, terrainHeightAt(x, z, variation) + height / 2, z);
      building.castShadow = true;
      building.receiveShadow = true;
      building.userData.environment = true;
      building.userData.selectable = false;
      group.add(building);
    }
  }
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

function terrainHeightAt(x, z, variation) {
  const centerFalloff = THREE.MathUtils.smoothstep(Math.hypot(x, z), 8, 45);
  return terrainNoise(x, z) * variation * 5.5 * centerFalloff;
}

function terrainNoise(x, z) {
  return (
    Math.sin(x * 0.13 + z * 0.07) * 0.42 +
    Math.cos(x * 0.05 - z * 0.17) * 0.36 +
    Math.sin((x + z) * 0.21) * 0.22
  );
}

function distributedPoint(index, salt, radius) {
  const angle = seeded(index, salt) * Math.PI * 2;
  const distance = Math.sqrt(seeded(index, salt + 101)) * radius;
  return {
    x: Math.cos(angle) * distance,
    z: Math.sin(angle) * distance,
  };
}

function seeded(a, b) {
  const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}
