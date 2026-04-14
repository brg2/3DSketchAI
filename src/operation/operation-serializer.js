import { assertValidOperationType, normalizeOperationParams } from "./operation-types.js";

function toLiteral(value) {
  return JSON.stringify(value, null, 2);
}

export function serializeOperationToTypeScript(operation) {
  assertValidOperationType(operation.type);
  const params = normalizeOperationParams(operation.params);

  return [
    "model = applyOperation(model, {",
    `  type: ${toLiteral(operation.type)},`,
    `  targetId: ${toLiteral(operation.targetId)},`,
    `  params: ${toLiteral(params)},`,
    "});",
  ].join("\n");
}

export function serializeOperationsToTypeScript(operations) {
  return operations.map(serializeOperationToTypeScript).join("\n\n");
}
