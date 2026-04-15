import { SketchApp } from "./app/sketch-app.js";

const canvas = document.getElementById("viewport");
const overlayElement = document.getElementById("overlay");
const codeElement = document.getElementById("code-view");
const codePanel = document.getElementById("code-panel");
const codeToggle = document.getElementById("code-toggle");
const codeCopyButton = document.getElementById("code-copy");
const codeCompressButton = document.getElementById("code-compress");
const panelTabButtons = Array.from(document.querySelectorAll("[data-panel-page]"));
const gridToggleButton = document.getElementById("grid-toggle");
const groundThemeSelect = document.getElementById("ground-theme");
const terrainVariationInput = document.getElementById("terrain-variation");
const terrainVariationValue = document.getElementById("terrain-variation-value");
const toolGrid = document.getElementById("tool-grid");

if (
  !canvas ||
  !overlayElement ||
  !codeElement ||
  !codePanel ||
  !codeToggle ||
  !codeCopyButton ||
  !codeCompressButton ||
  !gridToggleButton ||
  !groundThemeSelect ||
  !terrainVariationInput ||
  !terrainVariationValue ||
  panelTabButtons.length === 0 ||
  !toolGrid
) {
  throw new Error("Missing required DOM nodes for app bootstrap");
}

const app = new SketchApp({
  canvas,
  overlayElement,
  codeElement,
  codePanel,
  codeToggle,
  codeCopyButton,
  codeCompressButton,
  panelTabButtons,
  gridToggleButton,
  groundThemeSelect,
  terrainVariationInput,
  terrainVariationValue,
  toolGrid,
});

app.start();
