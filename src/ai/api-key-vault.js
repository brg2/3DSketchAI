const DEFAULT_DB_NAME = "3dsketchai";
const DEFAULT_STORE_NAME = "aiProviderKeys";
const FALLBACK_PREFIX = "3dsai:ai-key-vault:";

export class ApiKeyVault {
  constructor({
    dbName = DEFAULT_DB_NAME,
    storeName = DEFAULT_STORE_NAME,
    indexedDBImpl = null,
    storage = globalThis.localStorage,
    cryptoImpl = globalThis.crypto,
    origin = globalThis.location?.origin ?? "local",
  } = {}) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.indexedDB = indexedDBImpl;
    this.storage = storage;
    this.crypto = cryptoImpl;
    this.origin = origin;
    this._dbPromise = null;
  }

  async saveKey(provider, apiKey) {
    const record = await this._encrypt(String(apiKey ?? ""));
    await this._put(provider, record);
  }

  async loadKey(provider) {
    const record = await this._get(provider);
    if (!record) {
      return null;
    }
    return this._decrypt(record);
  }

  async removeKey(provider) {
    await this._delete(provider);
  }

  async hasKey(provider) {
    return Boolean(await this._get(provider));
  }

  async _encrypt(value) {
    if (!this.crypto?.subtle || typeof this.crypto.getRandomValues !== "function") {
      throw new Error("Encrypted API key storage requires WebCrypto");
    }
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const key = await this._key();
    const bytes = new TextEncoder().encode(value);
    const cipher = await this.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
    return {
      version: 1,
      origin: this.origin,
      iv: arrayBufferToBase64(iv),
      cipherText: arrayBufferToBase64(cipher),
      securityBoundary: "Encrypted at rest locally; runtime exposure depends on app-origin and loaded-JavaScript integrity.",
    };
  }

  async _decrypt(record) {
    if (record.origin !== this.origin) {
      throw new Error("API key record belongs to a different origin");
    }
    const key = await this._key();
    const plain = await this.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToUint8Array(record.iv) },
      key,
      base64ToUint8Array(record.cipherText),
    );
    return new TextDecoder().decode(plain);
  }

  async _key() {
    const material = new TextEncoder().encode(`3dsai:${this.origin}:provider-key-vault:v1`);
    const digest = await this.crypto.subtle.digest("SHA-256", material);
    return this.crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  async _put(provider, record) {
    if (!this.indexedDB?.open) {
      this.storage?.setItem?.(FALLBACK_PREFIX + provider, JSON.stringify(record));
      return;
    }
    const db = await this._openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).put(record, provider);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async _get(provider) {
    if (!this.indexedDB?.open) {
      const raw = this.storage?.getItem?.(FALLBACK_PREFIX + provider);
      return raw ? JSON.parse(raw) : null;
    }
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const request = tx.objectStore(this.storeName).get(provider);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async _delete(provider) {
    if (!this.indexedDB?.open) {
      this.storage?.removeItem?.(FALLBACK_PREFIX + provider);
      return;
    }
    const db = await this._openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      tx.objectStore(this.storeName).delete(provider);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  _openDb() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.dbName, 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const storeName of ["modelScripts", "appSession", this.storeName]) {
          if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this._dbPromise;
  }
}

function arrayBufferToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUint8Array(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
