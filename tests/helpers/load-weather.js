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
  // weather.js reads window.WeatherCalc at top-level (as soon as its IIFE
  // runs), so that script has to execute in the sandbox first — same load
  // order index.html uses for the real app (see store.js's own
  // schedule-recurrence.js preload in load-store.js for the same reason).
  const calcCode = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "weather-calc.js"), "utf8");
  const code = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "weather.js"), "utf8");
  const localStorage = createMemoryStorage();
  const windowObj = {
    safeSetLocalStorage(key, value) {
      localStorage.setItem(key, value);
      return true;
    },
  };
  const sandbox = { localStorage, console, window: windowObj, self: windowObj };
  vm.createContext(sandbox);
  vm.runInContext(calcCode, sandbox, { filename: "scripts/weather-calc.js" });
  vm.runInContext(code, sandbox, { filename: "scripts/weather.js" });
  // Both returned: tests mostly go through window.__weatherLocationForTest,
  // but a couple need to seed a raw value directly (e.g. an entry with no
  // `at` field, simulating data saved before this fix existed) — something
  // saveLocation(), which always stamps the current time, can't produce.
  return { window: sandbox.window, localStorage };
}

module.exports = { loadWeatherModule };
