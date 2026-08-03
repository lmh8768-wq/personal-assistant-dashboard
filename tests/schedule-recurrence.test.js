"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadStoreModule } = require("./helpers/load-store");

function freshScheduleStore() {
  return loadStoreModule().ScheduleStore;
}

test("no-repeat item only occurs on its own date", () => {
  const store = freshScheduleStore();
  store.add({ title: "일회성", date: "2026-08-10", repeat: { type: "none" } });

  assert.equal(store.getOccurrences("2026-08-09").length, 0);
  assert.equal(store.getOccurrences("2026-08-10").length, 1);
  assert.equal(store.getOccurrences("2026-08-11").length, 0);
});

test("daily repeat occurs every day from its anchor date onward, never before", () => {
  const store = freshScheduleStore();
  store.add({ title: "매일", date: "2026-08-10", repeat: { type: "daily" } });

  assert.equal(store.getOccurrences("2026-08-09").length, 0);
  assert.equal(store.getOccurrences("2026-08-10").length, 1);
  assert.equal(store.getOccurrences("2026-09-15").length, 1);
});

test("weekdays repeat skips Saturday/Sunday", () => {
  const store = freshScheduleStore();
  // 2026-08-10 is a Monday
  store.add({ title: "평일만", date: "2026-08-10", repeat: { type: "weekdays" } });

  assert.equal(store.getOccurrences("2026-08-14").length, 1); // Friday
  assert.equal(store.getOccurrences("2026-08-15").length, 0); // Saturday
  assert.equal(store.getOccurrences("2026-08-16").length, 0); // Sunday
  assert.equal(store.getOccurrences("2026-08-17").length, 1); // Monday
});

test("every10days repeat only lands on exact 10-day multiples from the anchor", () => {
  const store = freshScheduleStore();
  store.add({ title: "열흘마다", date: "2026-08-01", repeat: { type: "every10days" } });

  assert.equal(store.getOccurrences("2026-08-11").length, 1);
  assert.equal(store.getOccurrences("2026-08-05").length, 0);
  assert.equal(store.getOccurrences("2026-08-21").length, 1);
});

test("weekly repeat recurs on the same weekday", () => {
  const store = freshScheduleStore();
  // 2026-08-10 is a Monday
  store.add({ title: "매주", date: "2026-08-10", repeat: { type: "weekly" } });

  assert.equal(store.getOccurrences("2026-08-17").length, 1); // next Monday
  assert.equal(store.getOccurrences("2026-08-18").length, 0); // Tuesday
});

test("monthly repeat recurs on the same day-of-month", () => {
  const store = freshScheduleStore();
  store.add({ title: "매달", date: "2026-01-15", repeat: { type: "monthly" } });

  assert.equal(store.getOccurrences("2026-03-15").length, 1);
  assert.equal(store.getOccurrences("2026-03-16").length, 0);
});

test("yearly repeat recurs on the same month/day", () => {
  const store = freshScheduleStore();
  store.add({ title: "매년", date: "2026-05-05", repeat: { type: "yearly" } });

  assert.equal(store.getOccurrences("2027-05-05").length, 1);
  assert.equal(store.getOccurrences("2027-05-06").length, 0);
});

test("repeat.until stops occurrences after that date", () => {
  const store = freshScheduleStore();
  store.add({ title: "종료일 있음", date: "2026-08-01", repeat: { type: "daily", until: "2026-08-05" } });

  assert.equal(store.getOccurrences("2026-08-05").length, 1);
  assert.equal(store.getOccurrences("2026-08-06").length, 0);
});

test("excludedDates removes a single occurrence without affecting the rest of the series", () => {
  const store = freshScheduleStore();
  const item = store.add({ title: "매일", date: "2026-08-01", repeat: { type: "daily" }, excludedDates: [] });
  store.excludeOccurrence(item.id, "2026-08-10");

  assert.equal(store.getOccurrences("2026-08-09").length, 1);
  assert.equal(store.getOccurrences("2026-08-10").length, 0);
  assert.equal(store.getOccurrences("2026-08-11").length, 1);
});

test("toggleCompleted marks and unmarks a specific occurrence date", () => {
  const store = freshScheduleStore();
  const item = store.add({ title: "할일", date: "2026-08-01", repeat: { type: "daily" } });

  store.toggleCompleted(item.id, "2026-08-05");
  let [occurrence] = store.getOccurrences("2026-08-05");
  assert.ok(occurrence.completedDates.includes("2026-08-05"));

  store.toggleCompleted(item.id, "2026-08-05");
  [occurrence] = store.getOccurrences("2026-08-05");
  assert.ok(!occurrence.completedDates.includes("2026-08-05"));
});
