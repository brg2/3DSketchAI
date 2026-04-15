const DEFAULT_LIMIT = 100;

export class ModelScriptHistory {
  constructor({ limit = DEFAULT_LIMIT, entries = [], index = -1 } = {}) {
    this.limit = normalizeLimit(limit);
    this.entries = [];
    this.index = -1;
    this.restore({ entries, index, limit: this.limit });
  }

  push(script, { label = "Model Change", timestamp = Date.now() } = {}) {
    if (!isUsableScript(script)) {
      return this.current();
    }

    const current = this.current();
    if (current?.script === script) {
      return current;
    }

    const nextEntries = this.entries.slice(0, this.index + 1);
    nextEntries.push({
      script,
      label: String(label || "Model Change"),
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    });

    while (nextEntries.length > this.limit) {
      nextEntries.shift();
    }

    this.entries = nextEntries;
    this.index = this.entries.length - 1;
    return this.current();
  }

  reset(script, options = {}) {
    this.entries = [];
    this.index = -1;
    return this.push(script, options);
  }

  replaceCurrent(script, { label, timestamp = Date.now() } = {}) {
    if (!isUsableScript(script)) {
      return this.current();
    }

    if (this.index < 0) {
      return this.push(script, { label, timestamp });
    }

    this.entries[this.index] = {
      script,
      label: String(label || this.entries[this.index]?.label || "Model Change"),
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    };
    return this.current();
  }

  undo() {
    if (!this.canUndo()) {
      return null;
    }
    this.index -= 1;
    return this.current();
  }

  redo() {
    if (!this.canRedo()) {
      return null;
    }
    this.index += 1;
    return this.current();
  }

  canUndo() {
    return this.index > 0;
  }

  canRedo() {
    return this.index >= 0 && this.index < this.entries.length - 1;
  }

  current() {
    return this.entries[this.index] ?? null;
  }

  snapshot() {
    return {
      version: 1,
      limit: this.limit,
      index: this.index,
      entries: this.entries.map((entry) => ({ ...entry })),
    };
  }

  restore(snapshot = {}) {
    const restoredEntries = Array.isArray(snapshot.entries)
      ? snapshot.entries
          .filter((entry) => entry && isUsableScript(entry.script))
          .map((entry) => ({
            script: entry.script,
            label: String(entry.label || "Model Change"),
            timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
          }))
      : [];

    this.limit = normalizeLimit(snapshot.limit ?? this.limit);
    while (restoredEntries.length > this.limit) {
      restoredEntries.shift();
    }

    this.entries = restoredEntries;
    const requestedIndex = Number.isInteger(snapshot.index) ? snapshot.index : restoredEntries.length - 1;
    this.index = restoredEntries.length === 0 ? -1 : Math.min(Math.max(requestedIndex, 0), restoredEntries.length - 1);
    return this.current();
  }
}

function normalizeLimit(limit) {
  return Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
}

function isUsableScript(script) {
  return typeof script === "string" && script.trim().length > 0;
}
