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
  const code = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "cloud-sync.js"), "utf8");
  const localStorage = createMemoryStorage();
  const noopEl = { hidden: false, textContent: "", className: "" };
  const sandbox = {
    localStorage,
    console,
    window: { addEventListener: () => {} },
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
  vm.runInContext(code, sandbox, { filename: "scripts/cloud-sync.js" });
  return sandbox.window;
}

module.exports = { loadCloudSyncModule };
