"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadWeatherModule } = require("./helpers/load-weather");

test("weather location: a freshly-saved location is returned as-is", () => {
  const { window } = loadWeatherModule();
  const { loadLocation, saveLocation } = window.__weatherLocationForTest;

  saveLocation({ lat: 37.5, lon: 127.0 });
  const loaded = loadLocation();

  assert.equal(loaded.lat, 37.5);
  assert.equal(loaded.lon, 127.0);
});

test("weather location: no saved location returns null", () => {
  const { window } = loadWeatherModule();
  assert.equal(window.__weatherLocationForTest.loadLocation(), null);
});

test("weather location: a location older than 24h is treated as expired — this is the actual bug fix", () => {
  const { window, localStorage } = loadWeatherModule();
  const { loadLocation } = window.__weatherLocationForTest;
  const STALE_AT = Date.now() - 25 * 60 * 60 * 1000; // 25h old, past the 24h TTL

  // Seed directly (bypassing saveLocation, which always stamps "now") to
  // simulate a location saved a day+ ago.
  localStorage.setItem("weatherLocation.v1", JSON.stringify({ lat: 1, lon: 2, at: STALE_AT }));

  assert.equal(loadLocation(), null, "a stale cached location must not be returned — the app should re-request geolocation");
});

test("weather location: a location just under 24h old is still considered fresh", () => {
  const { window, localStorage } = loadWeatherModule();
  const { loadLocation } = window.__weatherLocationForTest;
  const NEARLY_STALE_AT = Date.now() - 23 * 60 * 60 * 1000; // 23h old, still within the 24h TTL

  localStorage.setItem("weatherLocation.v1", JSON.stringify({ lat: 3, lon: 4, at: NEARLY_STALE_AT }));

  const loaded = loadLocation();
  assert.ok(loaded);
  assert.equal(loaded.lat, 3);
  assert.equal(loaded.lon, 4);
});

test("weather location: a legacy entry with no `at` field (saved before this fix) is treated as expired, not crashing", () => {
  const { window, localStorage } = loadWeatherModule();
  const { loadLocation } = window.__weatherLocationForTest;

  localStorage.setItem("weatherLocation.v1", JSON.stringify({ lat: 5, lon: 6 })); // no `at`

  assert.equal(loadLocation(), null);
});
