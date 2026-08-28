// Same vm-sandbox idea as load-store.js (which this reuses createMemoryStorage
// from) — exercise.js is a plain browser <script> that expects store.js's
// window.createEntityStore/window.__resetStoreCaches/window.DeletionTombstones
// to already exist (same load order index.html uses: schedule-recurrence.js,
// then store.js, then exercise.js), and expects schedule-recurrence.js for
// store.js's own top-level window.ScheduleRecurrence read. None of the three
// touch `document` at their top level (only inside functions exercise.js's
// init()/onShow()/event handlers call, which this helper never calls), so a
// localStorage-only sandbox with no DOM is enough to exercise the pure data
// logic (BodyPartStore, ExerciseLogStore, BodyPartRoutineStore,
// migrateBodyPartsToKeys).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createMemoryStorage } = require("./load-store");

function readScript(name) {
  return fs.readFileSync(path.join(__dirname, "..", "..", "scripts", name), "utf8");
}

function loadExerciseModule() {
  const localStorage = createMemoryStorage();
  // store.js declares createEntityStore/createKeyedStore as bare top-level
  // functions (not window.createEntityStore = ...) — in a real browser that
  // still ends up reachable as window.createEntityStore because
  // window === globalThis there, which is exactly what exercise.js's own
  // `window.createEntityStore(...)`/`window.createKeyedStore(...)` calls
  // rely on. A vm context's global object is whatever's passed to
  // createContext(), so `window` has to BE that same object (not a
  // separate stub, unlike load-store.js/load-weather.js, neither of which
  // has this cross-script bare-top-level-function dependency) for that to
  // hold here too.
  const sandbox = { localStorage, console, addEventListener: () => {} };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readScript("schedule-recurrence.js"), sandbox, { filename: "scripts/schedule-recurrence.js" });
  vm.runInContext(readScript("store.js"), sandbox, { filename: "scripts/store.js" });
  vm.runInContext(readScript("exercise.js"), sandbox, { filename: "scripts/exercise.js" });
  return sandbox.window;
}

module.exports = { loadExerciseModule };
