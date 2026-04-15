import {
  parseOperationsFromCanonicalModelCode,
  serializeCanonicalModelModule,
} from "../operation/operation-serializer.js";

const DEFAULT_STORAGE_KEY = "3dsketchai:canonical:model:ts";
const DEFAULT_OPS_STORAGE_KEY = "3dsketchai:canonical:model:ops";

export class CanonicalModel {
  constructor({ storageKey = DEFAULT_STORAGE_KEY, opsStorageKey = DEFAULT_OPS_STORAGE_KEY } = {}) {
    this.storageKey = storageKey;
    this.opsStorageKey = opsStorageKey;
    this._operations = [];
  }

  appendCommittedOperation(operation) {
    this._operations.push(structuredClone(operation));
  }

  replaceCommittedOperations(operations) {
    this._operations = operations.map((operation) => structuredClone(operation));
  }

  getOperations() {
    return this._operations.map((operation) => structuredClone(operation));
  }

  toTypeScriptModule() {
    return serializeCanonicalModelModule(this._operations);
  }

  fromTypeScriptModule(code) {
    this._operations = parseOperationsFromCanonicalModelCode(code).map((operation) => structuredClone(operation));
    return this.getOperations();
  }

  persistToLocalStorage(storage = globalThis.localStorage ?? null) {
    if (!storage) {
      return this.toTypeScriptModule();
    }
    const code = this.toTypeScriptModule();
    storage.setItem(this.storageKey, code);
    storage.setItem(this.opsStorageKey, JSON.stringify(this._operations));
    return code;
  }

  loadFromLocalStorage(storage = globalThis.localStorage ?? null) {
    if (!storage) {
      return [];
    }
    const operationsJson = storage.getItem(this.opsStorageKey);
    if (operationsJson) {
      const parsed = JSON.parse(operationsJson);
      this._operations = Array.isArray(parsed) ? parsed.map((operation) => structuredClone(operation)) : [];
      return this.getOperations();
    }

    const code = storage.getItem(this.storageKey);
    if (!code) {
      return [];
    }
    return this.fromTypeScriptModule(code);
  }

  clear(storage = globalThis.localStorage ?? null) {
    this._operations = [];
    if (!storage) {
      return;
    }
    storage.removeItem(this.storageKey);
    storage.removeItem(this.opsStorageKey);
  }
}
