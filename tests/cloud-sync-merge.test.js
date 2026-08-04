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

test("array merge: key-identified items (CategoryStore's {key,label,color} shape) dedupe by key, not by reference — the actual bug fix", () => {
  // Regression test: identity used to be "has an .id field" only. Category
  // objects have no .id (only .key), so a category array fell through to
  // the primitive-array union path, which dedupes by object *reference* —
  // two category objects representing the same key (one from each side)
  // are different references, so nothing deduped and a merge-mode import
  // just concatenated both, producing visible duplicate categories.
  const existing = [{ key: "food", label: "식비", color: "#f97316" }];
  const incoming = [{ key: "food", label: "식비", color: "#f97316" }];

  const merged = merge(existing, incoming);
  assert.equal(merged.length, 1);
});

test("array merge: a same-key conflict merges per field, same as same-id conflicts do", () => {
  const existing = [{ key: "food", label: "식비 (수정됨)", color: "#f97316" }];
  const incoming = [{ key: "food", label: "식비", color: "#22c55e" }];

  const merged = merge(existing, incoming);
  assert.equal(merged.length, 1);
  // incoming wins per shared key, same semantics as the id-keyed case.
  assert.equal(merged[0].color, "#22c55e");
});

test("array merge: items with no id/key on either side are kept as-is, not dropped", () => {
  // Regression test: a mixed array (some items identified, some not) used
  // to silently drop every item without an id — this covers a category
  // array containing a malformed entry with no key.
  const existing = [{ key: "food", label: "식비" }, { label: "이름 없는 항목" }];
  const incoming = [{ key: "food", label: "식비" }];

  const merged = merge(existing, incoming);
  assert.equal(merged.length, 2);
  assert.ok(merged.some((item) => item.label === "이름 없는 항목"));
});

test("mergeValues: a nested field synced as null doesn't wipe the existing nested object/array — the actual bug fix", () => {
  // A nested field explicitly synced as null used to fall through to
  // "incoming wins" and replace real nested data with null outright — the
  // top-level values here are both plain objects (so the merge wrapper
  // actually calls into DeepMerge.mergeValues, unlike a bare top-level
  // null/undefined, which the wrapper short-circuits before ever reaching
  // DeepMerge at all).
  const existing = { profile: { a: 1, b: 2 }, tags: [{ id: 1, title: "keep me" }] };
  const incoming = { profile: null, tags: null };

  const merged = merge(existing, incoming);
  assert.deepEqual(merged.profile, existing.profile);
  assert.deepEqual(merged.tags, existing.tags);
});
