"use strict";
// api/*.js each do `const admin = require("firebase-admin");` at module
// load time and talk to a real Firestore project — there's no test project
// to point them at, so this injects a fake into Node's require cache
// BEFORE an api/*.js file is first required. Since both this file and
// api/*.js resolve "firebase-admin" from the same project node_modules,
// require.resolve() here finds the exact cache key api/*.js's own require
// call will look up, and gets the fake back instead of loading the real SDK.
function installFakeFirebaseAdmin() {
  const adminPath = require.resolve("firebase-admin");

  const firestoreOps = [];
  const fakeDoc = {
    set: async (data) => {
      firestoreOps.push({ op: "set", data });
    },
    delete: async () => {
      firestoreOps.push({ op: "delete" });
    },
  };
  const fakeCollection = { doc: () => fakeDoc };
  const fakeUserDoc = { collection: () => fakeCollection };
  const fakeUsersCollection = { doc: () => fakeUserDoc };
  const fakeDb = { collection: () => fakeUsersCollection };

  let verifyIdTokenImpl = async () => ({ uid: "test-uid" });

  const fakeAdmin = {
    apps: [],
    initializeApp: () => {
      fakeAdmin.apps.push({});
    },
    credential: { cert: () => ({}) },
    auth: () => ({ verifyIdToken: (token) => verifyIdTokenImpl(token) }),
    firestore: () => fakeDb,
  };
  fakeAdmin.firestore.FieldValue = { serverTimestamp: () => "TIMESTAMP" };

  require.cache[adminPath] = {
    id: adminPath,
    filename: adminPath,
    loaded: true,
    exports: fakeAdmin,
  };

  return {
    firestoreOps,
    setVerifyIdTokenImpl(fn) {
      verifyIdTokenImpl = fn;
    },
  };
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

module.exports = { installFakeFirebaseAdmin, makeRes };
