export class ModelExecutor {
  constructor({ executeModelCode } = {}) {
    this._executeModelCode =
      executeModelCode ||
      (async ({ code, operations }) => ({
        kind: "exact_geometry",
        operationCount: operations.length,
        code,
      }));
  }

  async executeCanonicalModel(canonicalModel) {
    const entries = canonicalModel.getEntries();
    const operations = entries.map((entry) => entry.operation);
    const code = canonicalModel.toTypeScriptModule();

    return this._executeModelCode({ code, operations });
  }
}
