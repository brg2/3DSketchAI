const DRAG_TOOLS = new Set(["move", "rotate", "scale", "pushPull"]);

export class ToolStateMachine {
  constructor() {
    this.activeTool = "select";
    this.dragState = null;
  }

  setActiveTool(tool) {
    this.activeTool = tool;
  }

  canStartDrag() {
    return DRAG_TOOLS.has(this.activeTool);
  }

  startDrag({ pointerDown, selection, context = null }) {
    this.dragState = {
      pointerDown,
      pointerCurrent: pointerDown,
      selection,
      context,
    };
  }

  updateDrag(pointerCurrent) {
    if (!this.dragState) {
      return null;
    }

    this.dragState.pointerCurrent = pointerCurrent;
    return {
      dx: pointerCurrent.x - this.dragState.pointerDown.x,
      dy: pointerCurrent.y - this.dragState.pointerDown.y,
      selection: this.dragState.selection,
      context: this.dragState.context,
    };
  }

  endDrag() {
    const state = this.dragState;
    this.dragState = null;
    return state;
  }

  clearDrag() {
    this.dragState = null;
  }
}
