export class Overlay {
  constructor({ element }) {
    this.element = element;
  }

  setVisible(visible) {
    this.element.hidden = !visible;
    if (!visible) {
      this.element.innerHTML = "";
    }
  }

  render({ tool, selectionMode, selectedIds, hoveredId, previewing, exactBackend, operationCount }) {
    this.setVisible(true);

    const selectedText = selectedIds.length > 0 ? selectedIds.join(", ") : "none";
    const hoveredText = hoveredId ?? "none";

    this.element.innerHTML = [
      `<div><strong>Tool:</strong> ${tool}</div>`,
      `<div><strong>Selection mode:</strong> ${selectionMode}</div>`,
      `<div><strong>Selected:</strong> ${selectedText}</div>`,
      `<div><strong>Hover:</strong> ${hoveredText}</div>`,
      `<div><strong>Preview active:</strong> ${previewing ? "yes" : "no"}</div>`,
      `<div><strong>Exact backend:</strong> ${exactBackend}</div>`,
      `<div><strong>Committed ops:</strong> ${operationCount}</div>`,
      `<div style="margin-top:8px;color:#9da7b3;">Drag for move/rotate/scale/push-pull. Shift+click to multi-select for group/component.</div>`,
    ].join("");
  }
}
