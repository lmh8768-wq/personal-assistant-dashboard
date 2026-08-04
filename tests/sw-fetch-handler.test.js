"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSwModule, makeResponse, makeFetchEvent } = require("./helpers/load-sw");

test("sw.js: a successful response gets cached", async () => {
  const { listeners, store } = loadSwModule({
    fetchImpl: async () => makeResponse({ ok: true, status: 200, body: "fresh content" }),
  });
  const request = { method: "GET", url: "http://localhost/index.html", mode: "navigate" };
  const event = makeFetchEvent(request);

  listeners.fetch(event);
  const response = await event.getResponsePromise();

  assert.equal(response.body, "fresh content");
  // put() is fired-and-forgotten inside the handler (not awaited before
  // respondWith resolves) — give the microtask queue a turn.
  await new Promise((r) => setImmediate(r));
  assert.equal(store.get(request.url).body, "fresh content");
});

test("sw.js: an error response (404/500) is NOT cached — this is the actual bug fix", async () => {
  const { listeners, store } = loadSwModule({
    fetchImpl: async () => makeResponse({ ok: false, status: 500, body: "server error" }),
  });
  const request = { method: "GET", url: "http://localhost/api/flaky", mode: "" };
  const event = makeFetchEvent(request);

  listeners.fetch(event);
  const response = await event.getResponsePromise();

  assert.equal(response.status, 500); // still returned to the page this one time
  await new Promise((r) => setImmediate(r));
  assert.equal(store.has(request.url), false, "a 500 response must not be written to the cache");
});

test("sw.js: offline + already cached — serves the cached response instead of failing", async () => {
  const cachedResponse = makeResponse({ ok: true, status: 200, body: "cached content" });
  const { listeners } = loadSwModule({
    fetchImpl: async () => {
      throw new Error("network down");
    },
    seedCache: { "http://localhost/scripts/store.js": cachedResponse },
  });
  const request = { method: "GET", url: "http://localhost/scripts/store.js", mode: "" };
  const event = makeFetchEvent(request);

  listeners.fetch(event);
  const response = await event.getResponsePromise();
  assert.equal(response.body, "cached content");
});

test("sw.js: offline + never-cached page navigation falls back to the app shell — this is the actual bug fix", async () => {
  const shellResponse = makeResponse({ ok: true, status: 200, body: "app shell" });
  const { listeners } = loadSwModule({
    fetchImpl: async () => {
      throw new Error("network down");
    },
    seedCache: { "/index.html": shellResponse },
  });
  const request = { method: "GET", url: "http://localhost/some/never-visited/route", mode: "navigate" };
  const event = makeFetchEvent(request);

  listeners.fetch(event);
  const response = await event.getResponsePromise();
  assert.equal(response.body, "app shell");
});

test("sw.js: offline + never-cached non-navigation request rejects (nothing sensible to substitute)", async () => {
  const { listeners } = loadSwModule({
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  const request = { method: "GET", url: "http://localhost/scripts/never-cached.js", mode: "" };
  const event = makeFetchEvent(request);

  listeners.fetch(event);
  await assert.rejects(() => event.getResponsePromise());
});

test("sw.js: cross-origin and non-GET requests are ignored entirely (never intercepted)", async () => {
  const { listeners } = loadSwModule();
  const crossOrigin = { method: "GET", url: "https://api.open-meteo.com/v1/forecast", mode: "" };
  const post = { method: "POST", url: "http://localhost/api/whatever", mode: "" };

  const event1 = makeFetchEvent(crossOrigin);
  listeners.fetch(event1);
  assert.equal(event1.getResponsePromise(), null, "cross-origin request should not be intercepted");

  const event2 = makeFetchEvent(post);
  listeners.fetch(event2);
  assert.equal(event2.getResponsePromise(), null, "non-GET request should not be intercepted");
});
