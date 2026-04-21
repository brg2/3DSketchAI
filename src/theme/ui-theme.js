export const UI_THEME_MODES = Object.freeze({
  AUTO: "auto",
  LIGHT: "light",
  DARK: "dark",
});

export const UI_THEME_MODE_ORDER = Object.freeze([
  UI_THEME_MODES.AUTO,
  UI_THEME_MODES.LIGHT,
  UI_THEME_MODES.DARK,
]);

export const UI_THEME_LABEL = Object.freeze({
  [UI_THEME_MODES.AUTO]: "Automatic",
  [UI_THEME_MODES.LIGHT]: "Light",
  [UI_THEME_MODES.DARK]: "Dark",
});

export function normalizeUiThemeMode(value) {
  const mode = String(value ?? "");
  return UI_THEME_MODE_ORDER.includes(mode) ? mode : UI_THEME_MODES.AUTO;
}

export function resolveUiThemeMode(mode, prefersDark = false) {
  const normalized = normalizeUiThemeMode(mode);
  if (normalized === UI_THEME_MODES.LIGHT) {
    return UI_THEME_MODES.LIGHT;
  }
  if (normalized === UI_THEME_MODES.DARK) {
    return UI_THEME_MODES.DARK;
  }
  return prefersDark ? UI_THEME_MODES.DARK : UI_THEME_MODES.LIGHT;
}
