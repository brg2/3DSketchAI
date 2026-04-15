import test from "node:test";
import assert from "node:assert/strict";
import { AppSessionStore } from "../src/persistence/app-session-store.js";

function createMemoryStorage() {
  const map = new Map();
  return {
    setItem(key, value) {
      map.set(key, String(value));
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test("app session store saves and loads state via fallback storage", async () => {
  const fallbackStorage = createMemoryStorage();
  const store = new AppSessionStore({
    indexedDBImpl: null,
    fallbackStorage,
  });

  const state = {
    version: 1,
    camera: {
      position: { x: 1, y: 2, z: 3 },
      target: { x: 0, y: 0, z: 0 },
      zoom: 1,
    },
    ui: { activeTool: "move", selectionMode: "face", codeCollapsed: false },
  };

  await store.saveState(state);
  const loaded = await store.loadState();
  assert.deepEqual(loaded, state);
});

test("app session store clear removes persisted fallback state", async () => {
  const fallbackStorage = createMemoryStorage();
  const store = new AppSessionStore({
    indexedDBImpl: null,
    fallbackStorage,
  });

  await store.saveState({ version: 1 });
  assert.deepEqual(await store.loadState(), { version: 1 });

  await store.clear();
  assert.equal(await store.loadState(), null);
});
