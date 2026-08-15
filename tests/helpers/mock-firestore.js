"use strict";
// api/kakao-*.js each read/write several independent top-level collections
// (users, kakaoLinkCodes, kakaoLinks, kakaoUserLinks) with plain
// get/set/delete on a single doc — a different shape than either existing
// fake (mock-firebase-admin.js's single fixed doc path, or
// api-send-daily-notifications.test.js's query-a-whole-collection shape).
// A generic in-memory store keyed by "collection/id" covers all of them
// with one small fake instead of three bespoke ones.
function installFakeFirestoreAdmin() {
  const adminPath = require.resolve("firebase-admin");
  const store = new Map(); // "collection/id" -> data object

  function pathKey(collection, id) {
    return `${collection}/${id}`;
  }

  function makeDocRef(collection, id) {
    const key = pathKey(collection, id);
    return {
      id,
      get: async () => {
        const data = store.get(key);
        return {
          exists: data !== undefined,
          id,
          data: () => (data === undefined ? undefined : { ...data }),
        };
      },
      set: async (data) => {
        store.set(key, { ...data });
      },
      delete: async () => {
        store.delete(key);
      },
    };
  }

  function makeCollectionRef(collection) {
    return { doc: (id) => makeDocRef(collection, id) };
  }

  let verifyIdTokenImpl = async () => ({ uid: "test-uid" });

  // Real Firestore transactions serialize concurrent get/set — tests here
  // only exercise single-request handlers (no real concurrency), so a
  // transaction is just get/set run through the same doc refs, sufficient
  // to exercise the read-modify-write code path without simulating actual
  // optimistic-concurrency retries.
  const fakeDb = {
    collection: makeCollectionRef,
    runTransaction: async (fn) => fn({ get: (ref) => ref.get(), set: (ref, data) => ref.set(data) }),
  };

  const fakeAdmin = {
    apps: [],
    initializeApp: () => fakeAdmin.apps.push({}),
    credential: { cert: () => ({}) },
    auth: () => ({ verifyIdToken: (token) => verifyIdTokenImpl(token) }),
    firestore: () => fakeDb,
  };
  fakeAdmin.firestore.FieldValue = { serverTimestamp: () => "TIMESTAMP" };

  require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: fakeAdmin };

  return {
    store,
    setVerifyIdTokenImpl(fn) {
      verifyIdTokenImpl = fn;
    },
    seed(collection, id, data) {
      store.set(pathKey(collection, id), { ...data });
    },
    read(collection, id) {
      const data = store.get(pathKey(collection, id));
      return data === undefined ? undefined : { ...data };
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

module.exports = { installFakeFirestoreAdmin, makeRes };
