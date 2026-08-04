"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { installFakeFirebaseAdmin, makeRes } = require("./helpers/mock-firebase-admin");

process.env.FIREBASE_SERVICE_ACCOUNT = "{}";
// api/*.js each capture their own `const admin = require("firebase-admin")`
// reference exactly once, at first require — re-installing the fake later
// wouldn't reach that already-bound reference, so install exactly once
// here and mutate this same mock's behavior (setVerifyIdTokenImpl) for any
// test that needs different auth behavior, rather than re-installing.
const mock = installFakeFirebaseAdmin();

const saveSubscription = require("../api/save-subscription.js");
const deleteSubscription = require("../api/delete-subscription.js");

test("save-subscription: a non-string endpoint is rejected with 400 instead of crashing Buffer.from() uncaught — the actual bug fix", async () => {
  const req = {
    method: "POST",
    body: { idToken: "x", subscription: { endpoint: 12345, keys: { p256dh: "a", auth: "b" } } },
  };
  const res = makeRes();
  await saveSubscription(req, res);
  assert.equal(res.statusCode, 400);
});

test("save-subscription: missing subscription.keys is rejected with 400 — the actual bug fix", async () => {
  // Previously accepted, then failed permanently in the daily cron with no
  // cleanup path (web-push's missing-keys error has no statusCode, so the
  // 404/410-only removal logic never recognized it as stale).
  const req = {
    method: "POST",
    body: { idToken: "x", subscription: { endpoint: "https://push.example/abc" } },
  };
  const res = makeRes();
  await saveSubscription(req, res);
  assert.equal(res.statusCode, 400);
});

test("save-subscription: a well-formed request saves successfully", async () => {
  const req = {
    method: "POST",
    body: {
      idToken: "x",
      subscription: { endpoint: "https://push.example/abc", keys: { p256dh: "a", auth: "b" } },
    },
  };
  const res = makeRes();
  await saveSubscription(req, res);
  assert.equal(res.statusCode, 200);
});

test("save-subscription: non-POST is rejected with 405", async () => {
  const res = makeRes();
  await saveSubscription({ method: "GET", body: {} }, res);
  assert.equal(res.statusCode, 405);
});

test("delete-subscription: a non-string endpoint is rejected with 400 instead of crashing Buffer.from() uncaught — the actual bug fix", async () => {
  const req = { method: "POST", body: { idToken: "x", endpoint: { not: "a string" } } };
  const res = makeRes();
  await deleteSubscription(req, res);
  assert.equal(res.statusCode, 400);
});

test("delete-subscription: a well-formed request succeeds", async () => {
  const req = { method: "POST", body: { idToken: "x", endpoint: "https://push.example/abc" } };
  const res = makeRes();
  await deleteSubscription(req, res);
  assert.equal(res.statusCode, 200);
});

test("delete-subscription: an invalid idToken is rejected with 401", async () => {
  mock.setVerifyIdTokenImpl(async () => {
    throw new Error("invalid token");
  });
  try {
    const res = makeRes();
    await deleteSubscription({ method: "POST", body: { idToken: "bad", endpoint: "https://push.example/abc" } }, res);
    assert.equal(res.statusCode, 401);
  } finally {
    mock.setVerifyIdTokenImpl(async () => ({ uid: "test-uid" }));
  }
});
