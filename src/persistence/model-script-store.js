const DEFAULT_DB_NAME = "3dsketchai";
const DEFAULT_STORE_NAME = "modelScripts";
const DEFAULT_KEY = "canonicalModelScript";
const FALLBACK_STORAGE_KEY = "3dsketchai:indexeddb-fallback:model-script";
const DB_VERSION = 2;
const REQUIRED_STORES = ["modelScripts", "appSession"];

export class ModelScriptStore {
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

  async saveScript(code) {
    if (!this._canUseIndexedDB()) {
      this._saveFallback(code);
      return;
    }

    const db = await this._openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      store.put(code, this.recordKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed to write script to IndexedDB"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB write transaction aborted"));
    });
  }

  async loadScript() {
    if (!this._canUseIndexedDB()) {
      return this._loadFallback();
    }

    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(this.recordKey);
      request.onsuccess = () => {
        const value = request.result;
        resolve(typeof value === "string" && value.trim().length > 0 ? value : null);
      };
      request.onerror = () => reject(request.error || new Error("Failed to read script from IndexedDB"));
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
      tx.onerror = () => reject(tx.error || new Error("Failed to clear script from IndexedDB"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB clear transaction aborted"));
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
