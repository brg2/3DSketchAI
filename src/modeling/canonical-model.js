import {
  serializeCanonicalModelModule,
} from "../operation/operation-serializer.js";
import { FeatureStore, operationFromFeature } from "../feature/feature-store.js";
import { normalizeParameters } from "../feature/feature-parameters.js";

const DEFAULT_STORAGE_KEY = "3dsketchai:canonical:model:ts";
const DEFAULT_OPS_STORAGE_KEY = "3dsketchai:canonical:model:ops";

export class CanonicalModel {
  constructor({ storageKey = DEFAULT_STORAGE_KEY, opsStorageKey = DEFAULT_OPS_STORAGE_KEY } = {}) {
    this.storageKey = storageKey;
    this.opsStorageKey = opsStorageKey;
    this._features = new FeatureStore();
    this._parameters = [];
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

  replaceParameters(parameters) {
    this._parameters = normalizeParameters(parameters);
  }

  replaceGraph({ features, parameters = [] }) {
    this._features.replaceFeatures(features);
    this._parameters = normalizeParameters(parameters);
  }

  getOperations() {
    const parameters = this.getParameters();
    return this.getFeatures().map((feature) => operationFromFeature(feature, { parameters }));
  }

  getFeatures() {
    return this._features.getFeatures();
  }

  getParameters() {
    return this._parameters.map((parameter) => structuredClone(parameter));
  }

  toTypeScriptModule() {
    return serializeCanonicalModelModule(this.getOperations(), { parameters: this.getParameters() });
  }

  toFeatureGraphJSON() {
    return JSON.stringify({ parameters: this.getParameters(), features: this.getFeatures() }, null, 2);
  }

  fromFeatureGraphJSON(json) {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    const features = Array.isArray(parsed) ? parsed : parsed?.features;
    const parameters = Array.isArray(parsed) ? [] : parsed?.parameters ?? [];
    if (!Array.isArray(features)) {
      throw new Error("Feature graph JSON must contain a features array");
    }
    this.replaceGraph({ features, parameters });
    return this.getFeatures();
  }

  persistToLocalStorage(storage = globalThis.localStorage ?? null) {
    if (!storage) {
      return this.toFeatureGraphJSON();
    }
    const graphJson = this.toFeatureGraphJSON();
    storage.setItem(this.storageKey, graphJson);
    storage.setItem(this.opsStorageKey, JSON.stringify({ parameters: this.getParameters(), features: this.getFeatures() }));
    return graphJson;
  }

  loadFromLocalStorage(storage = globalThis.localStorage ?? null) {
    if (!storage) {
      return [];
    }
    const operationsJson = storage.getItem(this.opsStorageKey);
    if (operationsJson) {
      const parsed = JSON.parse(operationsJson);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.features)) {
        this.replaceGraph({ features: parsed.features, parameters: parsed.parameters ?? [] });
      } else if (Array.isArray(parsed) && parsed.every((entry) => entry?.target && Array.isArray(entry.dependsOn))) {
        this.replaceGraph({ features: parsed, parameters: [] });
      } else {
        this._features.replaceOperations(Array.isArray(parsed) ? parsed : []);
        this._parameters = [];
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
    this._parameters = [];
    if (!storage) {
      return;
    }
    storage.removeItem(this.storageKey);
    storage.removeItem(this.opsStorageKey);
  }
}
