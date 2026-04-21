export const SKY_THEMES = Object.freeze({
  CLEAR_NOON: "clearNoon",
  GOLDEN_HOUR: "goldenHour",
  OVERCAST: "overcast",
  RAINSTORM: "rainstorm",
  NIGHT_SKY: "nightSky",
  SOLID_COLOR: "solidColor",
});

export const SKY_THEME_ORDER = Object.freeze([
  SKY_THEMES.CLEAR_NOON,
  SKY_THEMES.GOLDEN_HOUR,
  SKY_THEMES.OVERCAST,
  SKY_THEMES.RAINSTORM,
  SKY_THEMES.NIGHT_SKY,
  SKY_THEMES.SOLID_COLOR,
]);

export const SKY_THEME_LABEL = Object.freeze({
  [SKY_THEMES.CLEAR_NOON]: "Clear Noon",
  [SKY_THEMES.GOLDEN_HOUR]: "Golden Hour",
  [SKY_THEMES.OVERCAST]: "Overcast",
  [SKY_THEMES.RAINSTORM]: "Rainstorm",
  [SKY_THEMES.NIGHT_SKY]: "Night Sky",
  [SKY_THEMES.SOLID_COLOR]: "Solid Color",
});

export const DEFAULT_SOLID_SKY_COLOR = "#7aa7e8";

const HEX_WHITE_RGB = { r: 255, g: 255, b: 255 };
const HEX_BLACK_RGB = { r: 0, g: 0, b: 0 };

export function normalizeSkyTheme(value) {
  const theme = String(value ?? "");
  return SKY_THEME_ORDER.includes(theme) ? theme : SKY_THEMES.CLEAR_NOON;
}

export function normalizeSkyColor(value, fallback = DEFAULT_SOLID_SKY_COLOR) {
  const normalizedFallback = normalizeHexColor(fallback, DEFAULT_SOLID_SKY_COLOR);
  const normalized = normalizeHexColor(value, normalizedFallback);
  return normalized ?? normalizedFallback;
}

export function skyThemePreset(theme, { solidColor = DEFAULT_SOLID_SKY_COLOR } = {}) {
  const key = normalizeSkyTheme(theme);
  if (key === SKY_THEMES.SOLID_COLOR) {
    return buildSolidSkyThemePreset(solidColor);
  }
  return SKY_THEME_PRESETS[key] ?? SKY_THEME_PRESETS[SKY_THEMES.CLEAR_NOON];
}

export function buildSolidSkyThemeCssTokens(solidColor) {
  const color = normalizeSkyColor(solidColor);
  const rgb = hexToRgb(color);
  const lightness = relativeLuminance(rgb);
  const isLight = lightness > 0.55;

  const bg = mixRgb(rgb, isLight ? HEX_WHITE_RGB : HEX_BLACK_RGB, isLight ? 0.82 : 0.18);
  const panel = mixRgb(rgb, isLight ? HEX_WHITE_RGB : HEX_BLACK_RGB, isLight ? 0.9 : 0.24);
  const chrome = mixRgb(rgb, isLight ? HEX_WHITE_RGB : HEX_BLACK_RGB, isLight ? 0.94 : 0.3);
  const line = mixRgb(rgb, isLight ? HEX_BLACK_RGB : HEX_WHITE_RGB, isLight ? 0.14 : 0.22);
  const lineStrong = mixRgb(rgb, isLight ? HEX_BLACK_RGB : HEX_WHITE_RGB, isLight ? 0.24 : 0.34);
  const accentSoft = mixRgb(rgb, HEX_WHITE_RGB, 0.86);
  const controlHoverBg = mixRgb(chrome, HEX_WHITE_RGB, isLight ? 0.72 : 0.2);
  const controlActiveBg = mixRgb(rgb, HEX_WHITE_RGB, 0.82);
  const menuBg = chrome;
  const text = isLight ? "#132131" : "#edf4ff";
  const muted = isLight ? rgbToCss(mixRgb(rgb, HEX_BLACK_RGB, 0.42)) : rgbToCss(mixRgb(rgb, HEX_WHITE_RGB, 0.36));
  const viewportBorder = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isLight ? "0.2" : "0.3"})`;

  return {
    bg: rgbToCss(bg),
    panel: rgbToCss(panel),
    panelRgb: rgbToRgbString(panel),
    chrome: rgbToCss(chrome),
    chromeRgb: rgbToRgbString(chrome),
    line: rgbToCss(line),
    lineStrong: rgbToCss(lineStrong),
    text,
    muted,
    accent: color,
    accentSoft: rgbToCss(accentSoft),
    controlBg: rgbToCss(panel),
    controlHoverBg: rgbToCss(controlHoverBg),
    controlActiveBg: rgbToCss(controlActiveBg),
    menuBg: rgbToCss(menuBg),
    viewportBorder,
    skySolid: color,
  };
}

function buildSolidSkyThemePreset(solidColor) {
  const color = normalizeSkyColor(solidColor);
  const rgb = hexToRgb(color);
  const lightness = relativeLuminance(rgb);
  const isLight = lightness > 0.55;
  const baseSky = mixHex(color, isLight ? "#ffffff" : "#08111f", isLight ? 0.08 : 0.12);
  const fogColor = mixHex(color, isLight ? "#ffffff" : "#0d1724", isLight ? 0.18 : 0.18);
  const groundMix = isLight ? 0.82 : 0.72;

  return {
    uiLabel: SKY_THEME_LABEL[SKY_THEMES.SOLID_COLOR],
    solidColor: color,
    grid: {
      major: hexToInt(mixHex(color, isLight ? "#1d3144" : "#d8e7f6", isLight ? 0.76 : 0.58)),
      minor: hexToInt(mixHex(color, isLight ? "#5d7188" : "#a8bdd6", isLight ? 0.9 : 0.72)),
    },
    fog: { color: hexToInt(fogColor), near: 34, far: 150 },
    lights: {
      hemiSky: hexToInt(baseSky),
      hemiGround: hexToInt(mixHex(color, isLight ? "#edf4fb" : "#09111a", groundMix)),
      hemiIntensity: isLight ? 0.84 : 0.66,
      ambient: hexToInt(mixHex(color, isLight ? "#ffffff" : "#0c1420", isLight ? 0.04 : 0.08)),
      ambientIntensity: isLight ? 0.26 : 0.14,
      key: hexToInt(mixHex(color, isLight ? "#ffffff" : "#d7f6ff", isLight ? 0.28 : 0.18)),
      keyIntensity: isLight ? 1.05 : 1,
      keyPos: isLight ? [18, 24, 16] : [16, 26, 14],
    },
    objects: {
      idle: { color: 0x7aa2f7, emissive: 0x000000 },
      hover: { color: 0x7dc8ff, emissive: 0x1d4468 },
      selected: { color: 0x7dc8ff, emissive: 0x183a5b },
      preselect: 0x7dc8ff,
    },
    skyMotion: null,
  };
}

// Note: sky gradient colors live in CSS (theme tokens). These presets are for the
// Three.js atmosphere (lights/fog/grid) and selection feedback materials.
const SKY_THEME_PRESETS = Object.freeze({
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

function normalizeHexColor(value, fallback = DEFAULT_SOLID_SKY_COLOR) {
  const candidate = String(value ?? "").trim().toLowerCase();
  if (candidate.length === 0) {
    return normalizeHexColor(fallback, DEFAULT_SOLID_SKY_COLOR);
  }

  const prefixed = candidate.startsWith("#") ? candidate : `#${candidate}`;
  if (/^#[0-9a-f]{3}$/.test(prefixed)) {
    const [r, g, b] = prefixed.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{6}$/.test(prefixed)) {
    return prefixed;
  }
  return normalizeHexColor(fallback, DEFAULT_SOLID_SKY_COLOR);
}

function buildRgb(value) {
  return {
    r: value.r,
    g: value.g,
    b: value.b,
  };
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex);
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function hexToInt(hex) {
  return Number.parseInt(normalizeHexColor(hex).slice(1), 16);
}

function rgbToCss(rgb) {
  return `rgb(${rgb.r} ${rgb.g} ${rgb.b})`;
}

function rgbToRgbString(rgb) {
  return `${rgb.r} ${rgb.g} ${rgb.b}`;
}

function mixRgb(a, b, amount) {
  const t = clamp01(amount);
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function mixHex(a, b, amount) {
  return rgbToHex(mixRgb(hexToRgb(a), hexToRgb(b), amount));
}

function rgbToHex(rgb) {
  return `#${[rgb.r, rgb.g, rgb.b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance(rgb) {
  const linear = (channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const r = linear(rgb.r);
  const g = linear(rgb.g);
  const b = linear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}
