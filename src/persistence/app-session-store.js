const DEFAULT_DB_NAME = "3dsketchai";
const DEFAULT_STORE_NAME = "appSession";
const DEFAULT_KEY = "sessionState";
const FALLBACK_STORAGE_KEY = "3dsketchai:indexeddb-fallback:app-session";
const DB_VERSION = 2;
const REQUIRED_STORES = ["modelScripts", "appSession"];

export class AppSessionStore {
  constructor({
    dbName = DEFAULT_DB_NAME,
    storeName = DEFAULT_STORE_NAME,
    recordKey = DEFAULT_KEY,
    indexedDBImpl = globalThis.indexedDB,
    fallbackStorage = globalThis.localStorage,
  } = {}) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.recordKey = recordKey;
    this.indexedDB = indexedDBImpl;
    this.fallbackStorage = fallbackStorage;
    this._dbPromise = null;
  }

  async saveState(state) {
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error("App session state must be an object");
    }

    if (!this._canUseIndexedDB()) {
      this._saveFallback(state);
      return;
    }

    const db = await this._openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).put(state, this.recordKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to write app session state to IndexedDB"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB app session write transaction aborted"));
    });
  }

  async loadState() {
    if (!this._canUseIndexedDB()) {
      return this._loadFallback();
    }

    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const request = tx.objectStore(this.storeName).get(this.recordKey);
      request.onsuccess = () => {
        const value = request.result;
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          resolve(null);
          return;
        }
        resolve(value);
      };
      request.onerror = () => reject(request.error || new Error("Failed to read app session state from IndexedDB"));
    });
  }

  async clear() {
    if (!this._canUseIndexedDB()) {
      this._clearFallback();
      return;
    }

    const db = await this._openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).delete(this.recordKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to clear app session state from IndexedDB"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB app session clear transaction aborted"));
    });
  }

  _canUseIndexedDB() {
    return Boolean(this.indexedDB && typeof this.indexedDB.open === "function");
  }

  _openDb() {
    if (this._dbPromise) {
      return this._dbPromise;
    }

    this._dbPromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const storeName of REQUIRED_STORES) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
    });

    return this._dbPromise;
  }

  _saveFallback(state) {
    if (!this.fallbackStorage) {
      return;
    }
    this.fallbackStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(state));
  }

  _loadFallback() {
    if (!this.fallbackStorage) {
      return null;
    }
    const raw = this.fallbackStorage.getItem(FALLBACK_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  _clearFallback() {
    if (!this.fallbackStorage) {
      return;
    }
    this.fallbackStorage.removeItem(FALLBACK_STORAGE_KEY);
  }
}
