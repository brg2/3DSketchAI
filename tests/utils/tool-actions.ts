import { expect, type Page } from "@playwright/test";
import { expectFeatureGraphIntegrity } from "./feature-graph";
import { getDragPath, performDrag, waitForRenderCompletion } from "./interaction";
import { activateTool, selectFace, selectObject } from "./selection";

export type ToolAction = {
  id: string;
  tool: "Move" | "Rotate" | "Push/Pull";
  toolType: "move" | "rotate" | "push_pull";
  selectionType: "object" | "face";
  faceIndex?: number;
  worldDelta?: { x: number; y: number; z: number };
  screenDelta?: { x: number; y: number };
  modifiers?: string[];
};

export const STACKED_TOOL_ACTIONS: ToolAction[] = [
  {
    id: "move-object",
    tool: "Move",
    toolType: "move",
    selectionType: "object",
    worldDelta: { x: 0.5, y: 0, z: 0 },
  },
  {
    id: "move-face",
    tool: "Move",
    toolType: "move",
    selectionType: "face",
    faceIndex: 1,
    worldDelta: { x: 0.3, y: 0, z: 0 },
  },
  {
    id: "rotate-object",
    tool: "Rotate",
    toolType: "rotate",
    selectionType: "object",
    screenDelta: { x: 40, y: 0 },
  },
  {
    id: "rotate-face",
    tool: "Rotate",
    toolType: "rotate",
    selectionType: "face",
    faceIndex: 0,
    screenDelta: { x: 30, y: 0 },
  },
  {
    id: "pushpull-face",
    tool: "Push/Pull",
    toolType: "push_pull",
    selectionType: "face",
    faceIndex: 0,
    worldDelta: { x: 0, y: 0.3, z: 0 },
  },
  {
    id: "pushpull-object",
    tool: "Push/Pull",
    toolType: "push_pull",
    selectionType: "object",
    faceIndex: 0,
    worldDelta: { x: 0, y: 0.3, z: 0 },
  },
];

export async function applyToolAction(page: Page, action: ToolAction) {
  if (action.selectionType === "face") {
    await selectFace(page, "cube", action.faceIndex ?? 0);
  } else {
    await selectObject(page, "cube");
  }

  await activateTool(page, action.tool);
  const drag = await getDragPath(page, {
    objectName: "cube",
    faceIndex: action.faceIndex,
    worldDelta: action.worldDelta,
    screenDelta: action.screenDelta,
  });
  expect(drag, `drag path for ${action.id}`).toBeTruthy();
  await performDrag(page, {
    ...drag!,
    modifiers: action.modifiers ?? [],
  });
  await waitForRenderCompletion(page);
  return expectFeatureGraphIntegrity(page);
}

export function twoStepWorkflows() {
  const workflows: ToolAction[][] = [];
  for (const first of STACKED_TOOL_ACTIONS) {
    for (const second of STACKED_TOOL_ACTIONS) {
      workflows.push([first, second]);
    }
  }
  return workflows;
}

export function threeStepWorkflows() {
  return twoStepWorkflows().map(([first, second]) => [
    first,
    second,
    STACKED_TOOL_ACTIONS.find((action) => action.toolType === first.toolType && action.selectionType === first.selectionType) ?? first,
  ]);
}
