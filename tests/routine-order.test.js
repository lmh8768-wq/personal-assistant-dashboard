"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRoutineModule } = require("./helpers/load-routine");

test("RoutineStore.addItem: stamps a sequential `order` on every new item", () => {
  const { window } = loadRoutineModule();
  const a = window.RoutineStore.addItem("routine", "A");
  const b = window.RoutineStore.addItem("routine", "B");
  const c = window.RoutineStore.addItem("routine", "C");
  assert.equal(a.order, 0);
  assert.equal(b.order, 1);
  assert.equal(c.order, 2);
});

test("RoutineStore.reorderItem: renumbers every item's `order` to match the new position, not just the two that moved", () => {
  const { window } = loadRoutineModule();
  window.RoutineStore.addItem("routine", "A");
  window.RoutineStore.addItem("routine", "B");
  const c = window.RoutineStore.addItem("routine", "C");

  // Drag C to the front.
  window.RoutineStore.reorderItem("routine", c.id, window.RoutineStore.getItems("routine")[0].id, true);

  const byLabel = Object.fromEntries(window.RoutineStore.getItems("routine").map((i) => [i.label, i.order]));
  assert.deepEqual(byLabel, { C: 0, A: 1, B: 2 });
});

test("RoutineStore.getItems/getSnapshot: render order follows the `order` field, not raw array position — the actual bug fix", () => {
  // The real bug this guards against: deep-merge.js's mergeArrays keeps
  // whichever device's OWN array position an item already had (Map.set on
  // an existing key never moves it), so a drag-reorder made on one device
  // was silently undone by another device's next sync merge. Simulates
  // exactly that outcome directly — an underlying array whose raw order
  // does NOT match the `order` field any of its items carry (as a merge
  // would produce) — and checks the render-facing getters still recover
  // the intended order from the field instead of trusting array position.
  const { window, localStorage } = loadRoutineModule();
  window.RoutineStore.addItem("routine", "A"); // order 0
  window.RoutineStore.addItem("routine", "B"); // order 1
  window.RoutineStore.addItem("routine", "C"); // order 2
  // The user's actual intended order (set via reorderItem, which stamps a
  // fresh `order` on everything): C, A, B.
  const items = window.RoutineStore.getItems("routine");
  window.RoutineStore.reorderItem("routine", items[2].id, items[0].id, true);

  // Now simulate a merge reverting the ARRAY's raw position back to
  // insertion order (A, B, C) while leaving each item's own `order` field
  // (C:0, A:1, B:2) untouched — exactly what mergeArrays' Map.set()-in-
  // place behavior does to a reordered array.
  const raw = JSON.parse(localStorage.getItem("assistant.routines.v1"));
  raw.routine.items.sort((x, y) => x.label.localeCompare(y.label)); // A, B, C by raw position
  localStorage.setItem("assistant.routines.v1", JSON.stringify(raw));
  // Writing directly to localStorage (bypassing saveAll()) leaves the
  // in-memory read-cache stale — reset it the same way the real cross-tab
  // "storage" event listener does, so the next read actually re-parses
  // localStorage instead of returning the pre-"merge" cached value.
  window.__resetStoreCaches.forEach((reset) => reset());

  // [...arr] (not the vm-realm array itself) — getItems()/map() run inside
  // the sandbox's vm.Context, so their result is an Array from a DIFFERENT
  // realm than this test file's own Array. deepStrictEqual compares
  // [[Prototype]] too, so it reports a cross-realm array as unequal to an
  // outer-realm literal even when every element matches; spreading into a
  // fresh outer-realm array sidesteps that entirely.
  const renderOrder = [...window.RoutineStore.getItems("routine").map((i) => i.label)];
  assert.deepEqual(renderOrder, ["C", "A", "B"], "getItems() must sort by the `order` field, not the raw (merge-reverted) array position");

  const snapshotOrder = [...window.RoutineStore.getSnapshot().routine.items.map((i) => i.label)];
  assert.deepEqual(snapshotOrder, ["C", "A", "B"], "getSnapshot() must sort the same way getItems() does");
});
