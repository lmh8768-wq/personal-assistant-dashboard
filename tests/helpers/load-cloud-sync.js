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
  const windowObj = { addEventListener: () => {} };
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
function loadCloudSyncModuleWithFakeFirebase({ docExists, docPayload, seedLocalStorage } = {}) {
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

  const fakeDocRef = {
    onSnapshot: (onNext) => {
      snapshotCallback = onNext;
      return () => {};
    },
    set: (data) => {
      setCalls.push(data);
      return Promise.resolve();
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
    location: { reload: () => {} },
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

  return { window: sandbox.window, localStorage, setCalls, toastMessages };
}

module.exports = { loadCloudSyncModule, loadCloudSyncModuleWithFakeFirebase };
