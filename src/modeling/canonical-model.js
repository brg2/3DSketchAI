import {
  serializeCanonicalModelModule,
} from "../operation/operation-serializer.js";
import { FeatureStore } from "../feature/feature-store.js";

const DEFAULT_STORAGE_KEY = "3dsketchai:canonical:model:ts";
const DEFAULT_OPS_STORAGE_KEY = "3dsketchai:canonical:model:ops";

export class CanonicalModel {
  constructor({ storageKey = DEFAULT_STORAGE_KEY, opsStorageKey = DEFAULT_OPS_STORAGE_KEY } = {}) {
    this.storageKey = storageKey;
    this.opsStorageKey = opsStorageKey;
    this._features = new FeatureStore();
  }

  appendCommittedOperation(operation) {
    this._features.appendOperation(operation);
  }

  appendFeature(feature) {
    this._features.appendFeature(feature);
  }

  replaceCommittedOperations(operations) {
    this._features.replaceOperations(operations);
  }

  replaceFeatures(features) {
    this._features.replaceFeatures(features);
  }

  getOperations() {
    return this._features.getOperations();
  }

  getFeatures() {
    return this._features.getFeatures();
  }

  toTypeScriptModule() {
    return serializeCanonicalModelModule(this.getOperations());
  }

  toFeatureGraphJSON() {
    return JSON.stringify({ features: this.getFeatures() }, null, 2);
  }

  fromFeatureGraphJSON(json) {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    const features = Array.isArray(parsed) ? parsed : parsed?.features;
    if (!Array.isArray(features)) {
      throw new Error("Feature graph JSON must contain a features array");
    }
    this._features.replaceFeatures(features);
    return this.getFeatures();
  }

  persistToLocalStorage(storage = globalThis.localStorage ?? null) {
    if (!storage) {
      return this.toFeatureGraphJSON();
    }
    const graphJson = this.toFeatureGraphJSON();
    storage.setItem(this.storageKey, graphJson);
    storage.setItem(this.opsStorageKey, JSON.stringify(this.getFeatures()));
    return graphJson;
  }

  loadFromLocalStorage(storage = globalThis.localStorage ?? null) {
    if (!storage) {
      return [];
    }
    const operationsJson = storage.getItem(this.opsStorageKey);
    if (operationsJson) {
      const parsed = JSON.parse(operationsJson);
      if (Array.isArray(parsed) && parsed.every((entry) => entry?.target && Array.isArray(entry.dependsOn))) {
        this._features.replaceFeatures(parsed);
      } else {
        this._features.replaceOperations(Array.isArray(parsed) ? parsed : []);
      }
      return this.getOperations();
    }

    const code = storage.getItem(this.storageKey);
    if (!code) {
      return [];
    }
    return this.fromFeatureGraphJSON(code);
  }

  clear(storage = globalThis.localStorage ?? null) {
    this._features.clear();
    if (!storage) {
      return;
    }
    storage.removeItem(this.storageKey);
    storage.removeItem(this.opsStorageKey);
  }
}
