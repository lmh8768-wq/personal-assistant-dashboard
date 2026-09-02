"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRoutineModule } = require("./helpers/load-routine");

function pad2(n) {
  return String(n).padStart(2, "0");
}
function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function todayStr() {
  return toDateStr(new Date());
}
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateStr(d);
}

test("RoutineStore.isDone/toggleDone: default to today when no date is given — unchanged existing behavior", () => {
  const { window } = loadRoutineModule();
  const item = window.RoutineStore.addItem("routine", "물 마시기");
  assert.equal(window.RoutineStore.isDone("routine", item.id), false);
  window.RoutineStore.toggleDone("routine", item.id);
  assert.equal(window.RoutineStore.isDone("routine", item.id), true);
});

test("RoutineStore.toggleDone with an explicit date: 어제 체크 — the actual feature", () => {
  const { window } = loadRoutineModule();
  const item = window.RoutineStore.addItem("routine", "물 마시기");

  window.RoutineStore.toggleDone("routine", item.id, yesterdayStr());

  assert.equal(window.RoutineStore.isDone("routine", item.id, yesterdayStr()), true, "yesterday should now be done");
  assert.equal(window.RoutineStore.isDone("routine", item.id), false, "today must stay untouched");
  assert.equal(window.RoutineStore.isDone("routine", item.id, todayStr()), false);
});

test("RoutineStore.toggleDone with an explicit date: toggling twice un-checks it again", () => {
  const { window } = loadRoutineModule();
  const item = window.RoutineStore.addItem("routine", "물 마시기");

  window.RoutineStore.toggleDone("routine", item.id, yesterdayStr());
  assert.equal(window.RoutineStore.isDone("routine", item.id, yesterdayStr()), true);
  window.RoutineStore.toggleDone("routine", item.id, yesterdayStr());
  assert.equal(window.RoutineStore.isDone("routine", item.id, yesterdayStr()), false);
});

test("RoutineStore.toggleDone: checking today and yesterday independently doesn't clobber either", () => {
  const { window } = loadRoutineModule();
  const a = window.RoutineStore.addItem("routine", "A");
  const b = window.RoutineStore.addItem("routine", "B");

  window.RoutineStore.toggleDone("routine", a.id); // today
  window.RoutineStore.toggleDone("routine", b.id, yesterdayStr()); // yesterday

  assert.equal(window.RoutineStore.isDone("routine", a.id, todayStr()), true);
  assert.equal(window.RoutineStore.isDone("routine", a.id, yesterdayStr()), false);
  assert.equal(window.RoutineStore.isDone("routine", b.id, yesterdayStr()), true);
  assert.equal(window.RoutineStore.isDone("routine", b.id, todayStr()), false);
});

test("RoutineStore.getRateForDate: a retroactive 어제 check is reflected in that day's rate", () => {
  const { window } = loadRoutineModule();
  const item = window.RoutineStore.addItem("routine", "물 마시기");

  const before = window.RoutineStore.getRateForDate(yesterdayStr());
  assert.equal(before.rate, 0);

  window.RoutineStore.toggleDone("routine", item.id, yesterdayStr());

  const after = window.RoutineStore.getRateForDate(yesterdayStr());
  assert.equal(after.rate, 1);
  // Today's rate is unaffected by a check made against yesterday's date.
  assert.equal(window.RoutineStore.getRateForDate(todayStr()).rate, 0);
});
