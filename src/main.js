import { SketchApp } from "./app/sketch-app.js";

const canvas = document.getElementById("viewport");
const overlayElement = document.getElementById("overlay");
const codeElement = document.getElementById("code-view");
const codePanel = document.getElementById("code-panel");
const codeToggle = document.getElementById("code-toggle");
const codeCopyButton = document.getElementById("code-copy");
const codeCompressButton = document.getElementById("code-compress");
const docNameElement = document.getElementById("doc-name");
const modelOpenButton = document.getElementById("model-open");
const modelOpenInput = document.getElementById("model-open-input");
const modelSaveButton = document.getElementById("model-save");
const exportToggleButton = document.getElementById("export-toggle");
const exportMenu = document.getElementById("export-menu");
const panelTabButtons = Array.from(document.querySelectorAll("[data-panel-page]"));
const gridToggleButton = document.getElementById("grid-toggle");
const groundEffectsToggleButton = document.getElementById("ground-effects-toggle");
const devConsoleToggleButton = document.getElementById("dev-console-toggle");
const groundRegenerateButton = document.getElementById("ground-regenerate");
const groundThemeSelect = document.getElementById("ground-theme");
const elevationVariationInput = document.getElementById("elevation-variation");
const elevationVariationValue = document.getElementById("elevation-variation-value");
const terrainVariationInput = document.getElementById("terrain-variation");
const terrainVariationValue = document.getElementById("terrain-variation-value");
const terrainDensityInput = document.getElementById("terrain-density");
const terrainDensityValue = document.getElementById("terrain-density-value");
const sidebarElement = document.querySelector(".sidebar");
const sidebarScrollElement = document.querySelector(".sidebar-scroll-content");
const toolGrid = document.getElementById("tool-grid");
const welcomeDialog = document.getElementById("welcome-dialog");
const welcomeContinueButton = document.getElementById("welcome-continue");
const welcomeCloseButton = document.getElementById("welcome-close");

const WELCOME_STORAGE_KEY = "3dsai.welcomeAcknowledged.v1";

if (
  !canvas ||
  !overlayElement ||
  !codeElement ||
  !codePanel ||
  !codeToggle ||
  !codeCopyButton ||
  !codeCompressButton ||
  !docNameElement ||
  !modelOpenButton ||
  !modelOpenInput ||
  !modelSaveButton ||
  !exportToggleButton ||
  !exportMenu ||
  !gridToggleButton ||
  !groundEffectsToggleButton ||
  !devConsoleToggleButton ||
  !groundRegenerateButton ||
  !groundThemeSelect ||
  !elevationVariationInput ||
  !elevationVariationValue ||
  !terrainVariationInput ||
  !terrainVariationValue ||
  !terrainDensityInput ||
  !terrainDensityValue ||
  !sidebarElement ||
  !sidebarScrollElement ||
  panelTabButtons.length === 0 ||
  !toolGrid ||
  !welcomeDialog ||
  !welcomeContinueButton ||
  !welcomeCloseButton
) {
  throw new Error("Missing required DOM nodes for app bootstrap");
}

function hasSeenWelcomeDialog() {
  try {
    return window.localStorage?.getItem(WELCOME_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistWelcomeDialogAcknowledgement() {
  try {
    window.localStorage?.setItem(WELCOME_STORAGE_KEY, "1");
  } catch {
    // If browser storage is unavailable, closing the dialog should still unblock the app.
  }
}

function closeWelcomeDialog() {
  persistWelcomeDialogAcknowledgement();
  if (welcomeDialog.open) {
    welcomeDialog.close();
  }
  document.body.classList.remove("welcome-modal-open");
}

function maybeShowWelcomeDialog() {
  if (hasSeenWelcomeDialog()) {
    return;
  }

  document.body.classList.add("welcome-modal-open");
  if (typeof welcomeDialog.showModal === "function") {
    welcomeDialog.showModal();
  } else {
    welcomeDialog.setAttribute("open", "");
  }
  welcomeContinueButton.focus();
}

welcomeContinueButton.addEventListener("click", closeWelcomeDialog);
welcomeCloseButton.addEventListener("click", closeWelcomeDialog);
welcomeDialog.addEventListener("cancel", () => {
  persistWelcomeDialogAcknowledgement();
  document.body.classList.remove("welcome-modal-open");
});
welcomeDialog.addEventListener("close", () => {
  document.body.classList.remove("welcome-modal-open");
});

const app = new SketchApp({
  canvas,
  overlayElement,
  codeElement,
  codePanel,
  codeToggle,
  codeCopyButton,
  codeCompressButton,
  docNameElement,
  modelOpenButton,
  modelOpenInput,
  modelSaveButton,
  exportToggleButton,
  exportMenu,
  panelTabButtons,
  gridToggleButton,
  groundEffectsToggleButton,
  devConsoleToggleButton,
  groundRegenerateButton,
  groundThemeSelect,
  elevationVariationInput,
  elevationVariationValue,
  terrainVariationInput,
  terrainVariationValue,
  terrainDensityInput,
  terrainDensityValue,
  sidebarElement,
  sidebarScrollElement,
  toolGrid,
});

app.start()
  .then(() => {
    requestAnimationFrame(() => {
      document.body.classList.remove("app-loading");
      maybeShowWelcomeDialog();
    });
  })
  .catch((error) => {
    console.error("Failed to start app", error);
    const loadingStatus = document.querySelector("[data-loading-status]");
    if (loadingStatus) {
      loadingStatus.textContent = "Unable to load";
    }
  });
