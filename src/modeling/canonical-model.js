export class CanonicalModel {
  constructor() {
    this._entries = [];
  }

  appendCommittedOperation(operation, operationCode) {
    this._entries.push({
      operation: {
        type: operation.type,
        targetId: operation.targetId,
        params: { ...operation.params },
      },
      operationCode,
    });
  }

  getEntries() {
    return this._entries.map((entry) => ({
      operation: {
        type: entry.operation.type,
        targetId: entry.operation.targetId,
        params: { ...entry.operation.params },
      },
      operationCode: entry.operationCode,
    }));
  }

  toTypeScriptModule() {
    const body = this._entries.map((entry) => entry.operationCode).join("\n\n");

    return [
      "export function buildModel(seedModel, applyOperation) {",
      "  let model = seedModel;",
      body ? `\n${indentLines(body, 2)}\n` : "",
      "  return model;",
      "}",
    ].join("\n");
  }
}

function indentLines(text, spaces) {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
