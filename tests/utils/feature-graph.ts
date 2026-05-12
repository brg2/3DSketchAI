import { expect, type Page } from "@playwright/test";

export type FeatureGraphSnapshot = {
  featureCount: number;
  parameters: Array<{ name: string; value: number; min?: number; max?: number; step?: number; label?: string; unit?: string }>;
  features: Array<{
    id: string;
    type: string;
    dependsOn: string[];
    children: string[];
    target: {
      objectId: string | null;
      selection: null | {
        mode?: string;
        objectId?: string;
        selector?: {
          featureId?: string;
          role?: string;
        };
      };
    };
    params: Record<string, unknown>;
  }>;
};

export async function getFeatureGraph(page: Page): Promise<FeatureGraphSnapshot> {
  return page.evaluate(() => window.__TEST_API__.getFeatureGraph());
}

export async function expectFeatureGraphIntegrity(page: Page) {
  const graph = await getFeatureGraph(page);
  const ids = new Set(graph.features.map((feature) => feature.id));

  expect(graph.featureCount).toBe(graph.features.length);
  expect(ids.size).toBe(graph.features.length);

  for (const feature of graph.features) {
    expect(feature.id).toMatch(/^feature_\d+$/);
    expect(feature.type).toMatch(/^(create_primitive|move|rotate|push_pull|sketch_split|group|component)$/);
    expect(Array.isArray(feature.dependsOn)).toBe(true);
    expect(Array.isArray(feature.children)).toBe(true);
    for (const dependencyId of feature.dependsOn) {
      expect(ids.has(dependencyId), `${feature.id} depends on missing ${dependencyId}`).toBe(true);
    }
    for (const childId of feature.children) {
      expect(ids.has(childId), `${feature.id} references missing child ${childId}`).toBe(true);
      const child = graph.features.find((entry) => entry.id === childId);
      expect(child?.dependsOn).toContain(feature.id);
    }
    if (feature.type !== "create_primitive" && feature.target.objectId !== null) {
      expect(feature.target.objectId, `${feature.id} has no object target`).toBe("cube");
    }
    const selectorFeatureId = feature.target.selection?.selector?.featureId;
    if (selectorFeatureId) {
      expect(ids.has(selectorFeatureId), `${feature.id} selector references missing ${selectorFeatureId}`).toBe(true);
    }
  }

  expectNoRedundantFeatureStacking(graph);
  return graph;
}

export function expectNoRedundantFeatureStacking(graph: FeatureGraphSnapshot) {
  const signatures = new Map<string, string>();
  const indexes = new Map(graph.features.map((feature, index) => [feature.id, index]));
  for (let index = 0; index < graph.features.length; index += 1) {
    const feature = graph.features[index];
    const signature = redundantStackSignature(feature);
    if (!signature) {
      continue;
    }
    const existingId = signatures.get(signature);
    if (existingId) {
      const existingIndex = indexes.get(existingId) ?? -1;
      const intervening = graph.features.slice(existingIndex + 1, index);
      const targetId = feature.target.objectId;
      const hasInterveningTargetFeature = intervening.some((entry) => (
        targetId &&
        entry.target.objectId === targetId &&
        entry.type !== "group" &&
        entry.type !== "component"
      ));
      expect(
        hasInterveningTargetFeature,
        `redundant feature stack: ${existingId} and ${feature.id} share ${signature}`,
      ).toBe(true);
    }
    signatures.set(signature, feature.id);
  }
}

export function featureTypes(graph: FeatureGraphSnapshot) {
  return graph.features.map((feature) => feature.type);
}

export function countType(graph: FeatureGraphSnapshot, type: string) {
  return graph.features.filter((feature) => feature.type === type).length;
}

function redundantStackSignature(feature: FeatureGraphSnapshot["features"][number]) {
  const objectId = feature.target.objectId ?? "none";
  if (feature.type === "move") {
    const subshape = feature.params.subshapeMove as undefined | { mode?: string; faceAxis?: string; faceSign?: number };
    if (!subshape) {
      return `move:object:${objectId}`;
    }
    if (subshape.mode === "face") {
      return `move:face:${objectId}:${subshape.faceAxis}:${Math.sign(subshape.faceSign ?? 1) || 1}`;
    }
    return null;
  }

  if (feature.type === "rotate") {
    const faceTilts = feature.params.faceTilts as undefined | Array<{ faceAxis?: string; faceSign?: number; hingeAxis?: string; hingeSideAxis?: string }>;
    if (Array.isArray(faceTilts) && faceTilts.length > 0) {
      const tilt = faceTilts[0];
      return `rotate:face:${objectId}:${tilt.faceAxis}:${Math.sign(tilt.faceSign ?? 1) || 1}:${tilt.hingeAxis}:${tilt.hingeSideAxis}`;
    }
    return `rotate:object:${objectId}`;
  }

  if (feature.type === "push_pull") {
    const profile = feature.params.profile as undefined | { objectId?: string };
    if (profile?.objectId) {
      return `push_pull:profile:${objectId}:${profile.objectId}`;
    }
    return `push_pull:${objectId}:${feature.params.faceAxis}:${Math.sign((feature.params.faceSign as number | undefined) ?? 1) || 1}`;
  }

  return null;
}
