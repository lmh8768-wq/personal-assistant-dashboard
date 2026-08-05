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
  const base = {
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
  // Real browser localStorage exposes every stored key as an enumerable
  // own property (`for...in localStorage`, `Object.keys(localStorage)`) —
  // both cloud-sync.js (collectLocalState) and settings.js (backup/export)
  // rely on that to walk all "assistant.*" keys. A plain object backed by
  // a private Map has none of that: for...in only sees getItem/setItem/etc,
  // so any test seeding this mock would silently make those code paths see
  // zero keys. The proxy makes stored entries show up as real own keys.
  return new Proxy(base, {
    ownKeys(target) {
      return [...new Set([...data.keys(), ...Reflect.ownKeys(target)])];
    },
    getOwnPropertyDescriptor(target, prop) {
      if (data.has(prop)) {
        return { enumerable: true, configurable: true, writable: false, value: data.get(prop) };
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    get(target, prop, receiver) {
      if (typeof prop === "string" && data.has(prop) && !(prop in target)) {
        return data.get(prop);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function buildSandbox() {
  // store.js reads window.ScheduleRecurrence at top-level (as soon as its
  // schedule IIFE runs), so that script has to execute in the sandbox first
  // — same load order index.html uses for the real app.
  const recurrenceCode = fs.readFileSync(
    path.join(__dirname, "..", "..", "scripts", "schedule-recurrence.js"),
    "utf8"
  );
  const code = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "store.js"), "utf8");
  const localStorage = createMemoryStorage();
  // store.js registers a "storage" listener (cross-tab cache invalidation)
  // at load time now — capture it (instead of a bare no-op stub) so a test
  // can fire a fake cross-tab storage event and verify the real listener
  // body actually runs, not just simulate what it's supposed to do.
  const storageListeners = [];
  const windowObj = {
    addEventListener: (type, fn) => {
      if (type === "storage") storageListeners.push(fn);
    },
  };
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
  // Exposed for tests only (real app code never reads this) — see the
  // addEventListener capture above.
  windowObj.__testStorageListeners = storageListeners;
  return sandbox;
}

function loadStoreModule() {
  return buildSandbox().window;
}

// Same as loadStoreModule(), but also hands back the sandbox's localStorage
// so a test can seed a raw (possibly legacy/malformed) value BEFORE the
// store's first read — needed for cases loadStoreModule() alone can't
// reach, like CategoryStore's old-scheme migration or a corrupted
// non-array value in storage.
function loadStoreModuleWithStorage() {
  const sandbox = buildSandbox();
  return { window: sandbox.window, localStorage: sandbox.localStorage };
}

module.exports = { loadStoreModule, loadStoreModuleWithStorage, createMemoryStorage };
