"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { installFakeWebPush } = require("./helpers/mock-web-push");

process.env.FIREBASE_SERVICE_ACCOUNT = "{}";
process.env.CRON_SECRET = "test-secret";
process.env.VAPID_SUBJECT_EMAIL = "test@example.com";
process.env.VAPID_PUBLIC_KEY = "pub";
process.env.VAPID_PRIVATE_KEY = "priv";

// This endpoint's Firestore usage shape (query every user, then query each
// user's subscriptions subcollection) doesn't fit mock-firebase-admin.js's
// single-doc save/delete shape, so it gets its own small fake here rather
// than overloading that helper for two different access patterns.
function installFakeAdminWithUsers(users) {
  const adminPath = require.resolve("firebase-admin");
  const deletedSubIds = [];

  function makeSubDoc(user, sub) {
    return {
      data: () => ({ subscription: sub.subscription }),
      ref: { delete: async () => deletedSubIds.push(`${user.id}:${sub.id}`) },
    };
  }

  function makeUserDoc(user) {
    return {
      id: user.id,
      data: () => ({ payload: user.payload }),
      ref: {
        collection: () => ({
          get: async () => ({ docs: user.subscriptions.map((sub) => makeSubDoc(user, sub)) }),
        }),
      },
    };
  }

  const fakeAdmin = {
    apps: [],
    initializeApp: () => fakeAdmin.apps.push({}),
    credential: { cert: () => ({}) },
    auth: () => ({ verifyIdToken: async () => ({ uid: "unused" }) }),
    firestore: () => ({
      collection: () => ({
        get: async () => ({ docs: users.map(makeUserDoc) }),
      }),
    }),
  };
  fakeAdmin.firestore.FieldValue = { serverTimestamp: () => "TIMESTAMP" };

  require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: fakeAdmin };
  return { deletedSubIds };
}

function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

test("send-daily-notifications: parallel per-user/per-subscription sends still aggregate sent/removed/failed correctly — the actual bug fix", async () => {
  // 2 users: one with a subscription that succeeds and one that's gone
  // (404 -> should be deleted + counted as removed), the other with data
  // shaped badly enough to throw (-> counted as failed, doesn't abort the
  // other user's processing since everything now runs via Promise.all
  // instead of a sequential for-loop that could throw out of the whole thing).
  const users = [
    {
      id: "user-a",
      payload: JSON.stringify({ "assistant.schedules.v1": JSON.stringify([]) }),
      subscriptions: [
        { id: "sub-ok", subscription: { endpoint: "https://push.example/ok", keys: { p256dh: "p", auth: "a" } } },
        { id: "sub-gone", subscription: { endpoint: "https://push.example/gone", keys: { p256dh: "p", auth: "a" } } },
      ],
    },
    {
      id: "user-bad-data",
      payload: "not valid json{{{",
      subscriptions: [],
    },
  ];
  const { deletedSubIds } = installFakeAdminWithUsers(users);
  installFakeWebPush(async (subscription) => {
    if (subscription.endpoint.endsWith("/gone")) {
      const err = new Error("gone");
      err.statusCode = 410;
      throw err;
    }
    return undefined; // success
  });

  delete require.cache[require.resolve("../api/send-daily-notifications.js")];
  const handler = require("../api/send-daily-notifications.js");

  const res = makeRes();
  await handler({ method: "POST", headers: { authorization: "Bearer test-secret" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sent, 1);
  assert.equal(res.body.removed, 1);
  assert.equal(res.body.failed, 1);
  assert.deepEqual(deletedSubIds, ["user-a:sub-gone"]);
});

test("send-daily-notifications: a malformed subscription (missing keys, saved before save-subscription.js validated them) is deleted without ever attempting a send — the actual bug fix", async () => {
  // Before this fix, a subscription doc missing subscription.keys made
  // webpush.sendNotification throw a plain validation error with no
  // statusCode — the 404/410-only cleanup didn't recognize that as
  // "gone", so it was never deleted and re-logged the same failure on
  // every single daily cron run forever. This asserts it's caught and
  // deleted proactively instead, without webpush ever being called for it.
  const users = [
    {
      id: "user-legacy",
      payload: JSON.stringify({ "assistant.schedules.v1": JSON.stringify([]) }),
      subscriptions: [
        { id: "sub-no-keys", subscription: { endpoint: "https://push.example/legacy" } },
        { id: "sub-null", subscription: null },
      ],
    },
  ];
  const { deletedSubIds } = installFakeAdminWithUsers(users);
  let sendAttempted = false;
  installFakeWebPush(async () => {
    sendAttempted = true;
    return undefined;
  });

  delete require.cache[require.resolve("../api/send-daily-notifications.js")];
  const handler = require("../api/send-daily-notifications.js");

  const res = makeRes();
  await handler({ method: "POST", headers: { authorization: "Bearer test-secret" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sent, 0);
  assert.equal(res.body.removed, 2);
  assert.equal(sendAttempted, false, "a malformed subscription must never reach webpush.sendNotification");
  assert.deepEqual(deletedSubIds.sort(), ["user-legacy:sub-no-keys", "user-legacy:sub-null"]);
});

test("send-daily-notifications: rejects requests without the correct CRON_SECRET", async () => {
  installFakeAdminWithUsers([]);
  installFakeWebPush(async () => undefined);
  delete require.cache[require.resolve("../api/send-daily-notifications.js")];
  const handler = require("../api/send-daily-notifications.js");

  const res = makeRes();
  await handler({ method: "POST", headers: { authorization: "Bearer wrong-secret" } }, res);
  assert.equal(res.statusCode, 401);
});
