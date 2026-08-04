// Same idea as load-store.js/load-cloud-sync.js: scripts/weather.js is a
// plain browser <script>, not a CommonJS module. Only window.__weatherLocationForTest's
// loadLocation()/saveLocation() are exercised by tests, and neither touches
// document/navigator, so a minimal localStorage-only sandbox is enough —
// no need to stub out geolocation or fetch just to reach these two
// functions.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createMemoryStorage } = require("./load-store");

function loadWeatherModule() {
  const code = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "weather.js"), "utf8");
  const localStorage = createMemoryStorage();
  const windowObj = {
    safeSetLocalStorage(key, value) {
      localStorage.setItem(key, value);
      return true;
    },
  };
  const sandbox = { localStorage, console, window: windowObj };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "scripts/weather.js" });
  // Both returned: tests mostly go through window.__weatherLocationForTest,
  // but a couple need to seed a raw value directly (e.g. an entry with no
  // `at` field, simulating data saved before this fix existed) — something
  // saveLocation(), which always stamps the current time, can't produce.
  return { window: sandbox.window, localStorage };
}

module.exports = { loadWeatherModule };
