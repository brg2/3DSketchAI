import { featureGraphSchema } from "../feature/feature-parameters.js";

export function assembleAiPromptContext({
  graphJson,
  featureGraph = [],
  parameters = [],
  selection = null,
  provenance = null,
  view = null,
  prompt = "",
} = {}) {
  return {
    kind: "3dsai.feature_graph_edit_context",
    schema: featureGraphSchema(),
    featureGraph: graphJson ? JSON.parse(graphJson) : {
      parameters: structuredClone(parameters),
      features: structuredClone(featureGraph),
    },
    selection: selection ? structuredClone(selection) : null,
    provenance: provenance ? structuredClone(provenance) : null,
    view: view ? structuredClone(view) : null,
    userPrompt: String(prompt ?? ""),
    outputContract: {
      kind: "feature_graph_patch",
      instructions: [
        "Return only a machine-applicable feature graph patch.",
        "Do not edit meshes, viewer geometry, or exported model files.",
        "Prefer small diffs against the current feature graph.",
      ],
    },
  };
}

export function aiSystemPrompt() {
  return [
    "You edit 3D Sketch AI models only by producing feature graph patches.",
    "The feature graph is the sole source of truth.",
    "Never output mesh edits, viewer mutations, or raw provider secrets.",
    "Return JSON with an operations array.",
  ].join("\n");
}
