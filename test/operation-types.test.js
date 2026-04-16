import test from "node:test";
import assert from "node:assert/strict";
import { createOperation, createOperationId, OPERATION_TYPES } from "../src/operation/operation-types.js";

test("operation ids do not require crypto.randomUUID", () => {
  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues(bytes) {
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = index;
        }
        return bytes;
      },
    },
  });

  try {
    const id = createOperationId();
    assert.match(id, /^[0-9a-f-]{36}$/);

    const operation = createOperation({
      type: OPERATION_TYPES.MOVE,
      targetId: "obj_1",
      params: { delta: { x: 0, y: 0, z: 0 } },
    });
    assert.equal(operation.id, "00010203-0405-4607-8809-0a0b0c0d0e0f");
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  }
});
