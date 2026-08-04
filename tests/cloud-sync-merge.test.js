"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCloudSyncModule } = require("./helpers/load-cloud-sync");

function merge(existing, incoming) {
  const window = loadCloudSyncModule();
  const existingRaw = existing === undefined ? null : JSON.stringify(existing);
  const incomingRaw = incoming === undefined ? null : JSON.stringify(incoming);
  const result = window.__mergeStoredValueForTest(existingRaw, incomingRaw);
  return result == null ? result : JSON.parse(result);
}

test("array union by id: an id only on one side is kept, not dropped — this is the actual bug fix", () => {
  // This is exactly the two-devices-edit-different-things scenario: device A
  // (existing/local) added id 1, device B (incoming/remote) added id 3 —
  // neither device's edit should erase the other's.
  const existing = [
    { id: 1, title: "device A added this" },
    { id: 2, title: "shared, unchanged" },
  ];
  const incoming = [
    { id: 2, title: "shared, unchanged" },
    { id: 3, title: "device B added this" },
  ];

  const merged = merge(existing, incoming);
  const byId = Object.fromEntries(merged.map((item) => [item.id, item]));

  assert.equal(merged.length, 3);
  assert.equal(byId[1].title, "device A added this");
  assert.equal(byId[3].title, "device B added this");
});

test("array merge: a same-id conflict resolves to the incoming (remote) version", () => {
  const existing = [{ id: 1, title: "local edit" }];
  const incoming = [{ id: 1, title: "remote edit" }];

  const merged = merge(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, "remote edit");
});

test("array merge: a same-id item merges per field instead of replacing wholesale — this is the actual bug fix", () => {
  // `memo` exists only on the existing (local) side. Before this fix,
  // byId.set(item.id, item) replaced the whole existing object with
  // incoming's wholesale — memo, which incoming's object doesn't even
  // mention, would have silently vanished even though incoming never said
  // anything about removing it. Field-level merging (via mergeValues,
  // same "incoming wins per shared key" rule the plain-object case
  // already uses) keeps it, since incoming just doesn't have that key.
  const existing = [{ id: 1, date: "2026-08-01", amount: 15000, categoryKey: "food", memo: "점심" }];
  const incoming = [{ id: 1, date: "2026-08-01", amount: 15000, categoryKey: "transport" }];

  const merged = merge(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].categoryKey, "transport", "incoming's explicit change to a shared key still wins");
  assert.equal(merged[0].memo, "점심", "a field only the existing side had must survive, not be dropped wholesale");
});

test("plain-object values merge per field (shallow), incoming wins per key", () => {
  const existing = { naverBlogUrl: "https://a", profileName: "로컬" };
  const incoming = { naverBlogUrl: "https://b", instagramUrl: "https://insta" };

  const merged = merge(existing, incoming);
  assert.deepEqual(merged, {
    naverBlogUrl: "https://b", // incoming wins on the shared key
    profileName: "로컬", // kept — incoming didn't have this key at all
    instagramUrl: "https://insta", // new from incoming
  });
});

test("mismatched shapes (array vs object, or one side unparseable) fall back to the incoming value", () => {
  const window = loadCloudSyncModule();
  assert.equal(window.__mergeStoredValueForTest("not json {{{", '"fallback"'), '"fallback"');
  assert.equal(window.__mergeStoredValueForTest(JSON.stringify([1, 2]), JSON.stringify({ a: 1 })), JSON.stringify({ a: 1 }));
});

test("existing side missing entirely just takes the incoming value as-is", () => {
  const window = loadCloudSyncModule();
  const incomingRaw = JSON.stringify([{ id: 1 }]);
  assert.equal(window.__mergeStoredValueForTest(null, incomingRaw), incomingRaw);
});

test("nested objects merge recursively — this is the actual bug fix (RoutineStore-shaped value)", () => {
  // Regression test: the merge used to be shallow-only, so
  // {...existing, ...incoming} at the top level meant incoming.routine
  // replaced existing.routine WHOLESALE instead of merging item-by-item —
  // a completion recorded on one device (existing) would vanish entirely
  // if the other device's backup/sync (incoming) didn't have it yet.
  const existing = {
    routine: {
      items: [{ id: "a", label: "아침 스트레칭" }],
      history: { "2026-08-01": ["a"] },
    },
    life: { items: [], history: {} },
  };
  const incoming = {
    routine: {
      items: [{ id: "b", label: "물 마시기" }],
      history: { "2026-08-02": ["b"] },
    },
    life: { items: [], history: {} },
  };

  const merged = merge(existing, incoming);

  // Both items survive — neither device's added routine item is dropped.
  const itemIds = merged.routine.items.map((i) => i.id).sort();
  assert.deepEqual(itemIds, ["a", "b"]);
  // Both days' history survive too.
  assert.deepEqual(merged.routine.history["2026-08-01"], ["a"]);
  assert.deepEqual(merged.routine.history["2026-08-02"], ["b"]);
});

test("primitive-valued arrays (e.g. a day's list of completed item ids) union instead of dropping everything", () => {
  // Regression test: the old array-merge assumed every array held objects
  // with an .id field and filtered out anything else — for a plain array of
  // id strings (RoutineStore's history[date] shape), that filtered BOTH
  // sides down to nothing, silently merging to an empty array.
  const existing = { "2026-08-01": ["a", "b"] };
  const incoming = { "2026-08-01": ["b", "c"] };

  const merged = merge(existing, incoming);
  assert.deepEqual([...merged["2026-08-01"]].sort(), ["a", "b", "c"]);
});
