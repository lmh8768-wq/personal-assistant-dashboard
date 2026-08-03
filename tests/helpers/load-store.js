// scripts/store.js is a plain browser <script> (IIFEs assigning to
// window.*), not a CommonJS/ESM module — there's no bundler in this repo to
// make it importable directly. This loads it into a small vm sandbox with
// an in-memory localStorage + window stub, close enough to the real
// browser globals it actually touches, and hands back that sandbox's
// `window` so tests can call e.g. window.ScheduleStore.getOccurrences(...).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    clear() {
      data.clear();
    },
    get length() {
      return data.size;
    },
    key(i) {
      return [...data.keys()][i] ?? null;
    },
  };
}

function loadStoreModule() {
  const code = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "store.js"), "utf8");
  const localStorage = createMemoryStorage();
  const sandbox = {
    localStorage,
    console,
    window: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "scripts/store.js" });
  return sandbox.window;
}

module.exports = { loadStoreModule, createMemoryStorage };
