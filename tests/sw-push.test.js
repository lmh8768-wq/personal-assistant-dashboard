"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSwModule } = require("./helpers/load-sw");

function makeExtendableEvent(extra = {}) {
  const waitUntilPromises = [];
  return {
    ...extra,
    waitUntil(promise) {
      waitUntilPromises.push(promise);
    },
    getWaitUntilPromises: () => waitUntilPromises,
  };
}

test("notificationclick: focuses AND navigates an already-open client to the notification's target — the actual bug fix", async () => {
  const navigateCalls = [];
  const fakeClient = {
    focus: async () => {},
    navigate: async (url) => navigateCalls.push(url),
  };
  const { listeners } = loadSwModule({ clientList: [fakeClient] });

  const event = makeExtendableEvent({
    notification: { close: () => {}, data: { url: "/index.html#ledger" } },
  });
  listeners.notificationclick(event);
  await Promise.all(event.getWaitUntilPromises());

  assert.deepEqual(navigateCalls, ["http://localhost/index.html#ledger"]);
});

test("notificationclick: opens a new window when no client is already open", async () => {
  const { listeners } = loadSwModule({ clientList: [] });
  const event = makeExtendableEvent({
    notification: { close: () => {}, data: { url: "/index.html#schedule" } },
  });
  listeners.notificationclick(event);
  const results = await Promise.all(event.getWaitUntilPromises());
  assert.deepEqual(results[0], { url: "/index.html#schedule" });
});

test("pushsubscriptionchange: resubscribes and posts the new subscription to open clients — the actual bug fix", async () => {
  const posted = [];
  const fakeClient = { postMessage: (msg) => posted.push(msg) };
  const { listeners } = loadSwModule({
    clientList: [fakeClient],
    subscribeImpl: async () => ({ toJSON: () => ({ endpoint: "https://push.example/rotated" }) }),
  });

  const event = makeExtendableEvent();
  listeners.pushsubscriptionchange(event);
  await Promise.all(event.getWaitUntilPromises());

  assert.equal(posted.length, 1);
  assert.equal(posted[0].type, "push-subscription-changed");
  assert.equal(posted[0].subscription.endpoint, "https://push.example/rotated");
});

test("pushsubscriptionchange: a resubscribe failure doesn't throw unhandled", async () => {
  const { listeners } = loadSwModule({
    clientList: [],
    subscribeImpl: async () => {
      throw new Error("push service unreachable");
    },
  });

  const event = makeExtendableEvent();
  listeners.pushsubscriptionchange(event);
  // Must not reject — the handler's own .catch() should absorb this.
  await assert.doesNotReject(Promise.all(event.getWaitUntilPromises()));
});
