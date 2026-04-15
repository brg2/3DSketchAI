import { ModelScriptStore } from "./model-script-store.js";

const DEFAULT_KEY = "canonicalModelHistory";
const FALLBACK_STORAGE_KEY = "3dsketchai:indexeddb-fallback:model-script-history";

export class ModelScriptHistoryStore extends ModelScriptStore {
  constructor(options = {}) {
    super({
      ...options,
      recordKey: options.recordKey ?? DEFAULT_KEY,
    });
    this.fallbackStorage = options.fallbackStorage ?? globalThis.localStorage;
  }

  async saveHistory(snapshot) {
    const serialized = JSON.stringify(snapshot);
    await this.saveScript(serialized);
  }

  async loadHistory() {
    const raw = await this.loadScript();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  _saveFallback(code) {
    if (!this.fallbackStorage) {
      return;
    }
    this.fallbackStorage.setItem(FALLBACK_STORAGE_KEY, code);
  }

  _loadFallback() {
    if (!this.fallbackStorage) {
      return null;
    }
    const code = this.fallbackStorage.getItem(FALLBACK_STORAGE_KEY);
    return typeof code === "string" && code.trim().length > 0 ? code : null;
  }

  _clearFallback() {
    if (!this.fallbackStorage) {
      return;
    }
    this.fallbackStorage.removeItem(FALLBACK_STORAGE_KEY);
  }
}
