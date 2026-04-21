export const SKY_THEMES = Object.freeze({
  CLEAR_NOON: "clearNoon",
  GOLDEN_HOUR: "goldenHour",
  OVERCAST: "overcast",
  RAINSTORM: "rainstorm",
  NIGHT_SKY: "nightSky",
});

export const SKY_THEME_ORDER = Object.freeze([
  SKY_THEMES.CLEAR_NOON,
  SKY_THEMES.GOLDEN_HOUR,
  SKY_THEMES.OVERCAST,
  SKY_THEMES.RAINSTORM,
  SKY_THEMES.NIGHT_SKY,
]);

export const SKY_THEME_LABEL = Object.freeze({
  [SKY_THEMES.CLEAR_NOON]: "Clear Noon",
  [SKY_THEMES.GOLDEN_HOUR]: "Golden Hour",
  [SKY_THEMES.OVERCAST]: "Overcast",
  [SKY_THEMES.RAINSTORM]: "Rainstorm",
  [SKY_THEMES.NIGHT_SKY]: "Night Sky",
});

export function normalizeSkyTheme(value) {
  const theme = String(value ?? "");
  return SKY_THEME_ORDER.includes(theme) ? theme : SKY_THEMES.CLEAR_NOON;
}

export function skyThemePreset(theme) {
  const key = normalizeSkyTheme(theme);
  return SKY_THEME_PRESETS[key] ?? SKY_THEME_PRESETS[SKY_THEMES.CLEAR_NOON];
}

// Note: sky gradient colors live in CSS (theme tokens). These presets are for the
// Three.js atmosphere (lights/fog/grid) and selection feedback materials.
export const SKY_THEME_PRESETS = Object.freeze({
  [SKY_THEMES.CLEAR_NOON]: {
    uiLabel: SKY_THEME_LABEL[SKY_THEMES.CLEAR_NOON],
    grid: { major: 0x90a4ba, minor: 0xc9d5e1 },
    fog: { color: 0xdbe7f4, near: 38, far: 160 },
    lights: {
      hemiSky: 0xffffff,
      hemiGround: 0xdbe7f4,
      hemiIntensity: 0.78,
      ambient: 0xffffff,
      ambientIntensity: 0.22,
      key: 0xffffff,
      keyIntensity: 1.15,
      keyPos: [18, 28, 14],
    },
    objects: {
      idle: { color: 0x7aa2f7, emissive: 0x000000 },
      hover: { color: 0x7dc8ff, emissive: 0x1d4468 },
      selected: { color: 0x7dc8ff, emissive: 0x183a5b },
      preselect: 0x7dc8ff,
    },
    skyMotion: { horizonBasePct: 58, horizonPitchScale: 12, angleYawOffsetDeg: 22 },
  },

  [SKY_THEMES.GOLDEN_HOUR]: {
    uiLabel: SKY_THEME_LABEL[SKY_THEMES.GOLDEN_HOUR],
    grid: { major: 0xb88f6b, minor: 0xe5cbb1 },
    fog: { color: 0xffe0b0, near: 34, far: 150 },
    lights: {
      hemiSky: 0xfff1d8,
      hemiGround: 0xf3d1b0,
      hemiIntensity: 0.8,
      ambient: 0xfff6e6,
      ambientIntensity: 0.24,
      key: 0xffd1a0,
      keyIntensity: 1.25,
      keyPos: [22, 18, 10],
    },
    objects: {
      idle: { color: 0x7aa2f7, emissive: 0x000000 },
      hover: { color: 0xffd6a2, emissive: 0x5a2b11 },
      selected: { color: 0xffd6a2, emissive: 0x4c240e },
      preselect: 0xffd6a2,
    },
    skyMotion: { horizonBasePct: 56, horizonPitchScale: 14, angleYawOffsetDeg: -18 },
  },

  [SKY_THEMES.OVERCAST]: {
    uiLabel: SKY_THEME_LABEL[SKY_THEMES.OVERCAST],
    grid: { major: 0x7e909c, minor: 0xc5d0d7 },
    fog: { color: 0xcfd8df, near: 30, far: 130 },
    lights: {
      hemiSky: 0xeef4f8,
      hemiGround: 0xbfcad3,
      hemiIntensity: 0.88,
      ambient: 0xf7fbff,
      ambientIntensity: 0.28,
      key: 0xd9e4ec,
      keyIntensity: 0.95,
      keyPos: [12, 18, 22],
    },
    objects: {
      idle: { color: 0x7aa2f7, emissive: 0x000000 },
      hover: { color: 0x7bf0e0, emissive: 0x103a39 },
      selected: { color: 0x7bf0e0, emissive: 0x0d3332 },
      preselect: 0x7bf0e0,
    },
    skyMotion: { horizonBasePct: 60, horizonPitchScale: 10, angleYawOffsetDeg: 10 },
  },

  [SKY_THEMES.RAINSTORM]: {
    uiLabel: SKY_THEME_LABEL[SKY_THEMES.RAINSTORM],
    grid: { major: 0x3a566f, minor: 0x274155 },
    fog: { color: 0x1a2e40, near: 26, far: 105 },
    lights: {
      hemiSky: 0xaed2f0,
      hemiGround: 0x09121b,
      hemiIntensity: 0.58,
      ambient: 0xd5eaff,
      ambientIntensity: 0.12,
      key: 0xb7e5ff,
      keyIntensity: 1.05,
      keyPos: [10, 30, 10],
    },
    objects: {
      idle: { color: 0xa5c2ff, emissive: 0x000000 },
      hover: { color: 0x52d7ff, emissive: 0x123e5a },
      selected: { color: 0x52d7ff, emissive: 0x0f334a },
      preselect: 0x52d7ff,
    },
    skyMotion: { horizonBasePct: 64, horizonPitchScale: 12, angleYawOffsetDeg: 34 },
  },

  [SKY_THEMES.NIGHT_SKY]: {
    uiLabel: SKY_THEME_LABEL[SKY_THEMES.NIGHT_SKY],
    grid: { major: 0x2f4863, minor: 0x1d3247 },
    fog: { color: 0x07101c, near: 24, far: 125 },
    lights: {
      hemiSky: 0x9ac6ff,
      hemiGround: 0x02060c,
      hemiIntensity: 0.42,
      ambient: 0xa9d0ff,
      ambientIntensity: 0.08,
      key: 0xb8fff1,
      keyIntensity: 0.95,
      keyPos: [16, 26, -12],
    },
    objects: {
      idle: { color: 0xcfe0ff, emissive: 0x000000 },
      hover: { color: 0x68f0d2, emissive: 0x0c2f2a },
      selected: { color: 0x68f0d2, emissive: 0x092521 },
      preselect: 0x68f0d2,
    },
    skyMotion: { horizonBasePct: 66, horizonPitchScale: 16, angleYawOffsetDeg: -10 },
  },
});

