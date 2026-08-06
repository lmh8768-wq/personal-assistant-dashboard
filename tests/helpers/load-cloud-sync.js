// Same idea as load-store.js: scripts/cloud-sync.js is a plain browser
// <script>, not a CommonJS module. Its init() (called unconditionally at
// the bottom of the file) takes the "firebase SDK not loaded" branch when
// `firebase` isn't defined — exactly the case here — which only touches
// localStorage and a couple of document.getElementById calls, so a minimal
// document stub is enough to load the file without a real DOM or network.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createMemoryStorage } = require("./load-store");

function loadCloudSyncModule() {
  // cloud-sync.js's per-key merge now delegates to window.DeepMerge (see
  // scripts/deep-merge.js) — has to be loaded into the sandbox first, same
  // load order index.html uses for the real app.
  const deepMergeCode = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "deep-merge.js"), "utf8");
  const code = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "cloud-sync.js"), "utf8");
  const localStorage = createMemoryStorage();
  const noopEl = { hidden: false, textContent: "", className: "" };
  // store.js's real DeletionTombstones isn't loaded in this sandbox (it
  // pulls in schedule-recurrence.js and the rest of store.js's dependency
  // chain, which these cloud-sync-only tests don't need) — a stub with the
  // same shape is enough since these tests exercise cloud-sync.js's own
  // merge/filter logic, not the tombstone store itself (see
  // store-crud.test.js for that).
  const windowObj = {
    addEventListener: () => {},
    DeletionTombstones: { KEY: "assistant.deletionTombstones.v1", has: () => false, record: () => {}, forget: () => {} },
  };
  const sandbox = {
    localStorage,
    console,
    window: windowObj,
    document: {
      getElementById: () => noopEl,
      addEventListener: () => {},
    },
    setInterval: () => 0, // don't actually start the 1.5s poller in tests
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    location: { reload: () => {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(deepMergeCode, sandbox, { filename: "scripts/deep-merge.js" });
  vm.runInContext(code, sandbox, { filename: "scripts/cloud-sync.js" });
  return sandbox.window;
}

// A fake `firebase` global, minimal enough to drive cloud-sync.js's real
// init()/startListening() sync-lifecycle logic end to end (not just the
// pure mergeStoredValue transform loadCloudSyncModule() alone can reach) —
// needed to test the first-pull anomalous-empty-payload guard, which lives
// inside the onSnapshot callback wiring itself. setCall()/getSetCalls()
// let a test inspect what startListening pushed back to "the server".
function loadCloudSyncModuleWithFakeFirebase({ docExists, docPayload, seedLocalStorage, controlledPush } = {}) {
  const deepMergeCode = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "deep-merge.js"), "utf8");
  const code = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "cloud-sync.js"), "utf8");
  const localStorage = createMemoryStorage();
  // Seeded BEFORE the module runs and the fake auth/snapshot events fire
  // below, so startListening()'s first-snapshot handler sees this as the
  // device's already-existing local state — same as a real returning user.
  Object.entries(seedLocalStorage || {}).forEach(([key, value]) => localStorage.setItem(key, value));
  const domEls = {
    authGate: { hidden: false },
    authLoading: { hidden: false },
    authLoginForm: { hidden: true, addEventListener: () => {} },
    authError: { textContent: "" },
    authOfflineBtn: { hidden: true, addEventListener: () => {} },
    appRoot: { hidden: true },
    syncStatus: { hidden: true, className: "" },
    syncStatusText: { textContent: "" },
  };

  let snapshotCallback = null;
  const setCalls = [];
  const toastMessages = [];
  const reloadCalls = [];
  // Only populated when controlledPush is set — each entry is the
  // {resolve, reject} pair for one .set() call, left pending until the test
  // explicitly settles it, so a test can simulate a slow network write
  // (push A still "in flight" when a second local change tries to push).
  const pendingPushes = [];

  const fakeDocRef = {
    onSnapshot: (onNext) => {
      snapshotCallback = onNext;
      return () => {};
    },
    set: (data) => {
      setCalls.push(data);
      if (!controlledPush) return Promise.resolve();
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      pendingPushes.push({ resolve, reject });
      return promise;
    },
    collection: () => ({}),
  };

  const fakeFirebase = {
    initializeApp: () => {},
    auth: Object.assign(
      () => ({
        setPersistence: () => Promise.resolve(),
        onAuthStateChanged: (cb) => {
          fakeFirebase._authCallback = cb;
        },
        signInWithEmailAndPassword: () => Promise.resolve(),
        currentUser: { uid: "test-uid" },
      }),
      { Auth: { Persistence: { LOCAL: "LOCAL" } } }
    ),
    firestore: Object.assign(
      () => ({
        collection: () => ({ doc: () => fakeDocRef }),
        enablePersistence: () => Promise.resolve(),
      }),
      { FieldValue: { serverTimestamp: () => "TIMESTAMP" } }
    ),
  };

  const windowObj = {
    addEventListener: () => {},
    Toast: { show: (msg) => toastMessages.push(msg) },
    // See loadCloudSyncModule's own comment on this same stub.
    DeletionTombstones: { KEY: "assistant.deletionTombstones.v1", has: () => false, record: () => {}, forget: () => {} },
  };

  const sandbox = {
    localStorage,
    console,
    window: windowObj,
    firebase: fakeFirebase,
    document: {
      getElementById: (id) => domEls[id] || { hidden: false, textContent: "", className: "", addEventListener: () => {} },
      addEventListener: () => {},
    },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn) => {
      fn(); // run "debounced" callbacks immediately — tests don't need real timing
      return 0;
    },
    clearTimeout: () => {},
    location: { reload: () => reloadCalls.push(true) },
  };
  vm.createContext(sandbox);
  vm.runInContext(deepMergeCode, sandbox, { filename: "scripts/deep-merge.js" });
  vm.runInContext(code, sandbox, { filename: "scripts/cloud-sync.js" });

  // Drive the same lifecycle real sign-in triggers: auth state change ->
  // startListening() -> onSnapshot attaches -> deliver the first snapshot.
  fakeFirebase._authCallback({ uid: "test-uid", email: "test@example.com" });
  snapshotCallback({
    exists: docExists,
    data: () => ({ payload: docPayload }),
    metadata: { fromCache: false },
  });

  // Lets a test simulate a later snapshot arriving from a DIFFERENT device
  // (real cloud-sync.js only skips "own echo" when updatedBy === its own
  // DEVICE_ID) — used to exercise the merge/reload branch in the listener's
  // non-first-snapshot path.
  const triggerRemoteUpdate = (payload, updatedBy = "OTHER_DEVICE_ID") =>
    snapshotCallback({
      exists: true,
      data: () => ({ payload, updatedBy }),
      metadata: { fromCache: false },
    });

  return { window: sandbox.window, localStorage, setCalls, toastMessages, pendingPushes, reloadCalls, triggerRemoteUpdate };
}

module.exports = { loadCloudSyncModule, loadCloudSyncModuleWithFakeFirebase };
