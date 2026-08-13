// scripts/routine.js is a plain browser <script> like scripts/store.js —
// loads it (after store.js, whose window.safeSetLocalStorage/
// DeletionTombstones/__resetStoreCaches it depends on) into the same kind
// of vm sandbox load-store.js uses, close enough to the real browser
// globals RoutineStore itself actually touches (routine.js's DOM-rendering
// functions are never invoked here, so no `document` stub is needed).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createMemoryStorage } = require("./load-store");

function loadRoutineModule() {
  const recurrenceCode = fs.readFileSync(
    path.join(__dirname, "..", "..", "scripts", "schedule-recurrence.js"),
    "utf8"
  );
  const storeCode = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "store.js"), "utf8");
  const routineCode = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "routine.js"), "utf8");
  const localStorage = createMemoryStorage();
  const windowObj = { addEventListener: () => {} };
  const sandbox = { localStorage, console, window: windowObj, self: windowObj };
  vm.createContext(sandbox);
  vm.runInContext(recurrenceCode, sandbox, { filename: "scripts/schedule-recurrence.js" });
  vm.runInContext(storeCode, sandbox, { filename: "scripts/store.js" });
  vm.runInContext(routineCode, sandbox, { filename: "scripts/routine.js" });
  return { window: sandbox.window, localStorage };
}

module.exports = { loadRoutineModule };
