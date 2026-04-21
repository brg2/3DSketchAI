import { expect, test } from "./fixtures";
import { expectBoundsExpanded, expectCanvasSnapshot, expectClose } from "../utils/assertions";
import { countType, expectFeatureGraphIntegrity, featureTypes, getFeatureGraph } from "../utils/feature-graph";
import { applyToolAction, STACKED_TOOL_ACTIONS, threeStepWorkflows, twoStepWorkflows } from "../utils/tool-actions";
import { loadKnownScene } from "../utils/selection";

function workflowSnapshotName(prefix: string, workflow: { id: string }[]) {
  return `feature-graph-${prefix}-${workflow.map((action) => action.id).join("-then-")}.png`;
}

test.describe("stacked tool feature graph workflows", () => {
  test.beforeEach(async ({ page }) => {
    await loadKnownScene(page);
    await expectFeatureGraphIntegrity(page);
  });

  for (const workflow of twoStepWorkflows()) {
    test(`2-step feature graph: ${workflow.map((action) => action.id).join(" -> ")}`, async ({ page }) => {
      const before = await getFeatureGraph(page);

      for (const action of workflow) {
        await applyToolAction(page, action);
        const graph = await getFeatureGraph(page);
        expect(graph.featureCount).toBeGreaterThanOrEqual(1);
        expect(graph.featureCount).toBeLessThanOrEqual(before.featureCount + workflow.length);
        expect(featureTypes(graph)).toContain("create_primitive");
      }

      await expectCanvasSnapshot(page, workflowSnapshotName("2-step", workflow));
    });
  }

  for (const workflow of threeStepWorkflows()) {
    test(`3-step feature graph: ${workflow.map((action) => action.id).join(" -> ")}`, async ({ page }) => {
      for (const action of workflow) {
        await applyToolAction(page, action);
        const graph = await getFeatureGraph(page);
        expect(graph.featureCount).toBeGreaterThanOrEqual(1);
        expect(graph.featureCount).toBeLessThanOrEqual(4);
        expect(featureTypes(graph)).toContain("create_primitive");
      }

      await expectCanvasSnapshot(page, workflowSnapshotName("3-step", workflow));
    });
  }
});

test.describe("required stacked feature graph examples", () => {
  test.beforeEach(async ({ page }) => {
    await loadKnownScene(page);
  });

  test("repeated move(object) modifies the primitive instead of stacking move features", async ({ page }) => {
    const moveObject = STACKED_TOOL_ACTIONS.find((action) => action.id === "move-object")!;

    const afterFirst = await applyToolAction(page, moveObject);
    expect(afterFirst.featureCount).toBe(1);
    expect(countType(afterFirst, "move")).toBe(0);
    expect(afterFirst.features[0].type).toBe("create_primitive");
    expect(afterFirst.features[0].params.position).toMatchObject({ x: 0.5, y: 0, z: 0 });

    const afterSecond = await applyToolAction(page, moveObject);
    expect(afterSecond.featureCount).toBe(1);
    expect(countType(afterSecond, "move")).toBe(0);
    expect(afterSecond.features[0].type).toBe("create_primitive");
    expect(afterSecond.features[0].params.position).toMatchObject({ x: 1, y: 0, z: 0 });

    await expectCanvasSnapshot(page, "feature-graph-repeated-move-object.png");
  });

  test("push/pull(face) -> move(object) -> push/pull(face again) preserves references and dependencies", async ({ page }) => {
    const pushPullFace = STACKED_TOOL_ACTIONS.find((action) => action.id === "pushpull-face")!;
    const moveObject = STACKED_TOOL_ACTIONS.find((action) => action.id === "move-object")!;
    const before = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));

    const afterPushPull = await applyToolAction(page, pushPullFace);
    expect(afterPushPull.featureCount).toBe(1);
    expect(afterPushPull.features[0].type).toBe("create_primitive");
    expect(afterPushPull.features[0].params.size).toMatchObject({ x: 1, y: 1.3, z: 1 });

    const afterMove = await applyToolAction(page, moveObject);
    expect(afterMove.featureCount).toBe(1);
    expect(afterMove.features[0].type).toBe("create_primitive");
    expect(afterMove.features[0].params.position).toMatchObject({ x: 0.5, y: 0.15, z: 0 });

    const afterSecondPushPull = await applyToolAction(page, pushPullFace);
    expect(afterSecondPushPull.featureCount).toBe(1);
    expect(countType(afterSecondPushPull, "push_pull")).toBe(0);
    expect(afterSecondPushPull.features[0].type).toBe("create_primitive");
    expect(afterSecondPushPull.features[0].params.size).toMatchObject({ x: 1, y: 1.6, z: 1 });
    expect(afterSecondPushPull.features[0].params.position).toMatchObject({ x: 0.5, y: 0.3, z: 0 });

    const after = await page.evaluate(() => window.__TEST_API__.getObjectByName("cube"));
    expectBoundsExpanded(before.mesh.worldBounds, after.mesh.worldBounds, "y", 0.5);
    expectClose(after.position.x, 0.5);
    await expectCanvasSnapshot(page, "feature-graph-pushpull-move-pushpull.png");
  });
});
