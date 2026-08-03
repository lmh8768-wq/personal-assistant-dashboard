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
  // store.js reads window.ScheduleRecurrence at top-level (as soon as its
  // schedule IIFE runs), so that script has to execute in the sandbox first
  // — same load order index.html uses for the real app.
  const recurrenceCode = fs.readFileSync(
    path.join(__dirname, "..", "..", "scripts", "schedule-recurrence.js"),
    "utf8"
  );
  const code = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "store.js"), "utf8");
  const localStorage = createMemoryStorage();
  const windowObj = {};
  const sandbox = {
    localStorage,
    console,
    window: windowObj,
    // schedule-recurrence.js's UMD wrapper does
    // `typeof self !== "undefined" ? self : this` to decide where to attach
    // itself when there's no `module.exports` (real browsers always have
    // `self`, aliased to `window` in the main thread) — aliasing the same
    // object here means it lands on this sandbox's `window` too, instead of
    // wherever bare `this` would resolve to inside a vm context.
    self: windowObj,
  };
  vm.createContext(sandbox);
  vm.runInContext(recurrenceCode, sandbox, { filename: "scripts/schedule-recurrence.js" });
  vm.runInContext(code, sandbox, { filename: "scripts/store.js" });
  return sandbox.window;
}

module.exports = { loadStoreModule, createMemoryStorage };
