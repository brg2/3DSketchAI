import test from "node:test";
import assert from "node:assert/strict";
import { ModelScriptHistory } from "../src/modeling/model-script-history.js";
import { ModelScriptHistoryStore } from "../src/persistence/model-script-history-store.js";

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

test("model script history navigates script snapshots without duplicating identical states", () => {
  const history = new ModelScriptHistory({ limit: 3 });

  history.push("export const main = (_r, _sai) => null;", { label: "empty" });
  history.push("export const main = (r, _sai) => r.makeBox([0,0,0], [1,1,1]);", { label: "cube" });
  history.push("export const main = (r, _sai) => r.makeBox([0,0,0], [1,1,1]);", { label: "duplicate" });

  assert.equal(history.snapshot().entries.length, 2);
  assert.equal(history.canUndo(), true);
  assert.equal(history.canRedo(), false);

  const undone = history.undo();
  assert.match(undone.script, /null/);
  assert.equal(history.canRedo(), true);

  const redone = history.redo();
  assert.match(redone.script, /makeBox/);
});

test("model script history truncates redo states when a new model change is pushed", () => {
  const history = new ModelScriptHistory();

  history.push("script-a");
  history.push("script-b");
  history.push("script-c");
  assert.equal(history.undo().script, "script-b");

  history.push("script-d");
  assert.equal(history.current().script, "script-d");
  assert.equal(history.canRedo(), false);
  assert.deepEqual(
    history.snapshot().entries.map((entry) => entry.script),
    ["script-a", "script-b", "script-d"],
  );
});

test("model script history store saves and loads snapshots through fallback storage", async () => {
  const fallbackStorage = createMemoryStorage();
  const store = new ModelScriptHistoryStore({
    indexedDBImpl: null,
    fallbackStorage,
  });
  const snapshot = {
    version: 1,
    limit: 100,
    index: 1,
    entries: [
      { script: "script-a", label: "A", timestamp: 1 },
      { script: "script-b", label: "B", timestamp: 2 },
    ],
  };

  await store.saveHistory(snapshot);
  assert.deepEqual(await store.loadHistory(), snapshot);

  await store.clear();
  assert.equal(await store.loadHistory(), null);
});
