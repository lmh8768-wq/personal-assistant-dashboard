// sw.js runs in a ServiceWorkerGlobalScope, not Node — this loads it into a
// vm sandbox with fake `self`/`caches`/`fetch` so its fetch-handler logic
// (which caching decisions to make, when to fall back to the app shell) is
// testable without a real browser or an actual service worker registration.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { URL } = require("node:url");

function loadSwModule({ fetchImpl, seedCache, clientList, subscribeImpl } = {}) {
  const code = fs.readFileSync(path.join(__dirname, "..", "..", "sw.js"), "utf8");
  const listeners = {};
  const store = new Map();
  if (seedCache) {
    Object.entries(seedCache).forEach(([url, response]) => store.set(url, response));
  }

  const cache = {
    match: async (reqOrUrl) => store.get(typeof reqOrUrl === "string" ? reqOrUrl : reqOrUrl.url),
    put: async (reqOrUrl, response) => {
      store.set(typeof reqOrUrl === "string" ? reqOrUrl : reqOrUrl.url, response);
    },
    add: async () => {},
  };
  const cachesObj = {
    open: async () => cache,
    // sw.js's fetch handler calls the top-level caches.match(), which
    // searches across all caches — the single fake `store` map underneath
    // is good enough to stand in for that here.
    match: (reqOrUrl) => cache.match(reqOrUrl),
    keys: async () => ["assistant-shell-test"],
    delete: async () => true,
  };

  const selfObj = {
    addEventListener: (type, handler) => {
      listeners[type] = handler;
    },
    location: { origin: "http://localhost" },
    skipWaiting: () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => clientList || [],
      openWindow: async (url) => ({ url }),
    },
    registration: {
      showNotification: async () => {},
      pushManager: {
        subscribe: subscribeImpl || (async () => ({ toJSON: () => ({ endpoint: "https://push.example/new" }) })),
      },
    },
  };

  const sandbox = {
    self: selfObj,
    caches: cachesObj,
    fetch: fetchImpl || (async () => makeResponse({ ok: true, status: 200 })),
    console,
    URL,
    Promise,
    atob,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "sw.js" });

  return { listeners, store };
}

// A minimal fetch Response stand-in — just what sw.js's handler touches
// (ok, status, clone()).
function makeResponse({ ok, status, body }) {
  const response = { ok, status, body: body ?? null };
  response.clone = () => ({ ...response });
  return response;
}

// A minimal FetchEvent stand-in. Needs a real waitUntil() (even if it's
// just a no-op collector) — without one, sw.js's `event.waitUntil(...)`
// call throws (not a function), and that throw was, by sheer microtask-
// ordering luck, getting silently absorbed by the handler's own offline-
// fallback .catch() in a way that happened to still resolve to the right
// response — passing the test for the wrong reason instead of actually
// exercising the real waitUntil code path.
function makeFetchEvent(request) {
  let responded = null;
  const waitUntilPromises = [];
  return {
    request,
    respondWith(promise) {
      responded = promise;
    },
    waitUntil(promise) {
      waitUntilPromises.push(promise);
    },
    getResponsePromise: () => responded,
    getWaitUntilPromises: () => waitUntilPromises,
  };
}

module.exports = { loadSwModule, makeResponse, makeFetchEvent };
