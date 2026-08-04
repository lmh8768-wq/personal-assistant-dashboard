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

test("getAll/getById return every schedule and look one up by id, unknown id gives null", () => {
  const store = freshScheduleStore();
  const a = store.add({ title: "A", date: "2026-08-01", repeat: { type: "none" } });
  const b = store.add({ title: "B", date: "2026-08-02", repeat: { type: "none" } });

  assert.equal(
    store.getAll().map((s) => s.id).sort().join(","),
    [a.id, b.id].sort().join(",")
  );
  assert.equal(store.getById(a.id).title, "A");
  assert.equal(store.getById("no-such-id"), null);
});

test("update patches an existing schedule and returns it, unknown id is a no-op returning null", () => {
  const store = freshScheduleStore();
  const item = store.add({ title: "원래 제목", date: "2026-08-01", repeat: { type: "none" } });

  const updated = store.update(item.id, { title: "바뀐 제목" });
  assert.equal(updated.title, "바뀐 제목");
  assert.equal(store.getById(item.id).title, "바뀐 제목");

  assert.equal(store.update("no-such-id", { title: "x" }), null);
});

test("remove deletes a schedule; removing an unknown id leaves the rest untouched", () => {
  const store = freshScheduleStore();
  const item = store.add({ title: "삭제 대상", date: "2026-08-01", repeat: { type: "none" } });
  store.add({ title: "남아있음", date: "2026-08-02", repeat: { type: "none" } });

  store.remove(item.id);
  assert.equal(store.getById(item.id), null);
  assert.equal(store.getAll().length, 1);

  store.remove("no-such-id");
  assert.equal(store.getAll().length, 1);
});

test("countOccurrences counts how many schedules land on a date, independent of getOccurrences' enrichment", () => {
  const store = freshScheduleStore();
  store.add({ title: "매일", date: "2026-08-01", repeat: { type: "daily" } });
  store.add({ title: "일회성-다른날", date: "2026-08-20", repeat: { type: "none" } });

  assert.equal(store.countOccurrences("2026-08-10"), 1);
  assert.equal(store.countOccurrences("2026-08-20"), 2);
  assert.equal(store.countOccurrences("2025-01-01"), 0);
});

test("includeOccurrence reverses a prior excludeOccurrence for that date only", () => {
  const store = freshScheduleStore();
  const item = store.add({ title: "매일", date: "2026-08-01", repeat: { type: "daily" }, excludedDates: [] });

  store.excludeOccurrence(item.id, "2026-08-10");
  assert.equal(store.getOccurrences("2026-08-10").length, 0);

  store.includeOccurrence(item.id, "2026-08-10");
  assert.equal(store.getOccurrences("2026-08-10").length, 1);
  // Other excluded-then-included calls on a date that was never excluded
  // must not throw or add anything odd.
  store.includeOccurrence(item.id, "2026-08-11");
  assert.equal(store.getOccurrences("2026-08-11").length, 1);
});

test("setOccurrenceOverride patches a single occurrence without touching the series definition or other occurrences", () => {
  const store = freshScheduleStore();
  const item = store.add({ title: "매일 회의", date: "2026-08-01", repeat: { type: "daily" } });

  store.setOccurrenceOverride(item.id, "2026-08-05", { title: "특별 회의" });

  const [overridden] = store.getOccurrences("2026-08-05");
  assert.equal(overridden.title, "특별 회의");

  const [untouched] = store.getOccurrences("2026-08-06");
  assert.equal(untouched.title, "매일 회의");
  // The stored series definition itself keeps its original title.
  assert.equal(store.getById(item.id).title, "매일 회의");
});

test("splitSeriesFrom on the anchor date just patches the whole series in place", () => {
  const store = freshScheduleStore();
  const item = store.add({ title: "원래", date: "2026-08-01", repeat: { type: "daily" } });

  const result = store.splitSeriesFrom(item.id, "2026-08-01", { title: "바뀜" });

  assert.equal(result.id, item.id);
  assert.equal(store.getAll().length, 1);
  assert.equal(store.getById(item.id).title, "바뀜");
});

test("splitSeriesFrom mid-series caps the original at the day before and starts a new series with the patch — the actual bug fix this coverage protects", () => {
  const store = freshScheduleStore();
  const item = store.add({ title: "원래", date: "2026-08-01", repeat: { type: "daily" } });
  store.toggleCompleted(item.id, "2026-08-03"); // before the split — should stay on the original
  store.toggleCompleted(item.id, "2026-08-12"); // on/after the split — should move to the new series
  store.excludeOccurrence(item.id, "2026-08-15"); // on/after the split — should move too

  const newItem = store.splitSeriesFrom(item.id, "2026-08-10", { title: "바뀐 이후" });

  assert.notEqual(newItem.id, item.id);
  assert.equal(newItem.date, "2026-08-10");
  assert.equal(newItem.title, "바뀐 이후");
  assert.ok(newItem.completedDates.includes("2026-08-12"));
  assert.ok(newItem.excludedDates.includes("2026-08-15"));

  // Original series never occurs on/after the split date anymore.
  assert.equal(store.getOccurrences("2026-08-09").length, 1);
  assert.equal(store.getOccurrences("2026-08-09")[0].title, "원래");
  assert.equal(store.getOccurrences("2026-08-10").filter((o) => o.id === item.id).length, 0);

  // The new series covers from the split date onward, under the patched title.
  assert.equal(store.getOccurrences("2026-08-10")[0].title, "바뀐 이후");
  assert.equal(store.getOccurrences("2026-08-20")[0].title, "바뀐 이후");

  const original = store.getById(item.id);
  assert.ok(original.completedDates.includes("2026-08-03"));
  assert.ok(!original.completedDates.includes("2026-08-12"));
});
