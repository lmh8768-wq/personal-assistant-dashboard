"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCloudSyncModule, loadCloudSyncModuleWithFakeFirebase } = require("./helpers/load-cloud-sync");

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

test("startListening: refuses an anomalously-empty first-pull payload instead of wiping real local data — the actual bug fix", () => {
  // The exact class of bug that once wiped a user's data: some earlier
  // issue (e.g. a push racing ahead of the very first pull) could leave
  // the server holding an empty payload ("{}"), and every device that
  // logs in afterward used to blindly apply that emptiness via
  // applyRemoteData's full-replace, losing everything — even though the
  // device itself still had real, untouched local data the whole time.
  const seedLocalStorage = {
    "assistant.schedules.v1": JSON.stringify([{ id: "sc_1", title: "중요한 일정", date: "2026-08-01", repeat: { type: "none" } }]),
    "assistant.categories.v1": JSON.stringify([{ key: "appointment", label: "약속", color: "#60a5fa" }]),
  };

  const { localStorage, setCalls, toastMessages } = loadCloudSyncModuleWithFakeFirebase({
    docExists: true,
    docPayload: "{}", // the anomalous empty server state
    seedLocalStorage,
  });

  // Local data must survive untouched.
  assert.equal(localStorage.getItem("assistant.schedules.v1"), seedLocalStorage["assistant.schedules.v1"]);
  assert.equal(localStorage.getItem("assistant.categories.v1"), seedLocalStorage["assistant.categories.v1"]);

  // The local (real) copy must have been re-pushed to the server instead
  // of silently accepting the empty one.
  assert.equal(setCalls.length, 1);
  const pushedPayload = JSON.parse(setCalls[0].payload);
  assert.deepEqual(
    JSON.parse(pushedPayload["assistant.schedules.v1"]),
    JSON.parse(seedLocalStorage["assistant.schedules.v1"])
  );

  // The user should be told something unusual happened, not left to
  // silently lose data with no explanation.
  assert.ok(toastMessages.some((m) => m.includes("비어있어서")), "expected a warning toast about the empty server payload");
});

test("startListening: a genuinely empty local device still accepts an empty-looking remote payload (no false alarm)", () => {
  // The guard must only fire when LOCAL has real data to protect — a
  // brand-new device with nothing local yet should still be able to pull
  // down whatever's on the server (including a legitimately near-empty
  // account) without the guard getting in the way.
  const { localStorage, setCalls } = loadCloudSyncModuleWithFakeFirebase({
    docExists: true,
    docPayload: JSON.stringify({ "assistant.schedules.v1": JSON.stringify([{ id: "sc_1", title: "서버 일정" }]) }),
    seedLocalStorage: {},
  });

  assert.equal(JSON.parse(localStorage.getItem("assistant.schedules.v1"))[0].title, "서버 일정");
  assert.equal(setCalls.length, 0, "a normal pull shouldn't trigger a re-push");
});

test("startListening: a real (non-empty) remote payload still applies normally, unaffected by the guard", () => {
  const remotePayload = {
    "assistant.schedules.v1": JSON.stringify([{ id: "sc_remote", title: "서버에서 온 일정" }]),
  };
  const { localStorage, setCalls } = loadCloudSyncModuleWithFakeFirebase({
    docExists: true,
    docPayload: JSON.stringify(remotePayload),
    seedLocalStorage: {
      "assistant.schedules.v1": JSON.stringify([{ id: "sc_local", title: "로컬에 있던 일정" }]),
    },
  });

  // Normal first-pull behavior (full replace) is unchanged when the
  // remote payload is real.
  assert.equal(JSON.parse(localStorage.getItem("assistant.schedules.v1"))[0].id, "sc_remote");
  assert.equal(setCalls.length, 0, "a normal pull with real remote data shouldn't trigger a re-push");
});

test("startListening: sweeps the orphaned assistant.weatherCache.v1/weatherLocation.v1 keys and re-pushes without them — the actual bug fix", () => {
  // weather.js used to write its cache under these assistant.*-prefixed
  // names (fixed by renaming them out of the synced namespace), but never
  // deleted the old keys — they just sit there forever, still picked up by
  // collectLocalState() and re-uploaded on every push. Simulates the worst
  // case: this device has none of the legacy keys locally, but the SERVER
  // still has one from a stale push, so the first pull re-imports it before
  // the cleanup has a chance to remove it again.
  const remotePayload = {
    "assistant.schedules.v1": JSON.stringify([{ id: "sc_remote", title: "서버 일정" }]),
    "assistant.weatherCache.v1": JSON.stringify({ weather: { temp: 20 }, fetchedAt: 1234 }),
  };
  const { localStorage, setCalls } = loadCloudSyncModuleWithFakeFirebase({
    docExists: true,
    docPayload: JSON.stringify(remotePayload),
    seedLocalStorage: {},
  });

  assert.equal(localStorage.getItem("assistant.weatherCache.v1"), null, "the legacy key must not survive locally");
  assert.equal(setCalls.length, 1, "the cleanup removal must trigger exactly one re-push");
  const pushedPayload = JSON.parse(setCalls[0].payload);
  assert.ok(
    !("assistant.weatherCache.v1" in pushedPayload),
    "the re-push must not carry the legacy key back up to the server"
  );
  assert.equal(JSON.parse(pushedPayload["assistant.schedules.v1"])[0].id, "sc_remote", "real data survives the cleanup");
});

test("pushToCloud: a local change that arrives while a previous push is still in flight is not lost — the actual bug fix", async () => {
  // The pushInFlight guard defers a second push attempt while the first is
  // still on the network, but used to leave pushPending stuck at true and
  // then have the FIRST push's success handler unconditionally clear the
  // durable pending marker anyway — the second (newer) change's data was
  // never uploaded, and nothing was left to ever retry it once the pending
  // marker was gone. A reload right after would silently pull the server's
  // copy (missing the second change) over the top of it.
  const { localStorage, setCalls, pendingPushes } = loadCloudSyncModuleWithFakeFirebase({
    docExists: true,
    docPayload: JSON.stringify({ "assistant.schedules.v1": JSON.stringify([]) }),
    seedLocalStorage: {},
    controlledPush: true,
  });

  // Edit A: triggers push A, which stays pending (network hasn't "responded" yet).
  localStorage.setItem("assistant.schedules.v1", JSON.stringify([{ id: "a" }]));
  assert.equal(pendingPushes.length, 1, "edit A should have started one push");

  // Edit B arrives while push A is still in flight — its own push attempt
  // must defer (pushInFlight), not fire a second concurrent write.
  localStorage.setItem("assistant.schedules.v1", JSON.stringify([{ id: "a" }, { id: "b" }]));
  assert.equal(pendingPushes.length, 1, "edit B's push must defer instead of racing push A");

  // Push A "resolves" (server confirms). The success handler runs as a
  // microtask, not synchronously — wait for it.
  pendingPushes[0].resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(pendingPushes.length, 2, "edit B must be pushed immediately once push A clears, not silently dropped");
  const secondPayload = JSON.parse(pendingPushes.length > 1 ? setCalls[1].payload : "{}");
  assert.deepEqual(
    JSON.parse(secondPayload["assistant.schedules.v1"]),
    [{ id: "a" }, { id: "b" }],
    "the retried push must carry edit B's data, not stale data from before it"
  );

  // Resolve push B too, and confirm the durable pending marker finally clears.
  pendingPushes[1].resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(localStorage.getItem("__cloudSync.pendingPush"), null, "pending marker should clear once everything is actually confirmed");
});

test("snapshot(update) from another device: a no-op merge does not reload/re-push — the infinite ping-pong bug fix", () => {
  // Two devices (or two browsers/tabs with different persisted DEVICE_IDs)
  // signed into the same account, already holding identical data, used to
  // ping-pong forever: this device's push landed as "from another device"
  // on the other one, which unconditionally merged + markPending + reloaded
  // + re-pushed regardless of whether the merge actually changed anything —
  // which this device then saw as yet another "from another device" update,
  // and reacted to the exact same way, forever. A merge that changes
  // nothing must not reload or re-push.
  const schedules = JSON.stringify([{ id: "sc1", title: "일정" }]);
  const { localStorage, setCalls, reloadCalls, triggerRemoteUpdate } = loadCloudSyncModuleWithFakeFirebase({
    docExists: true,
    docPayload: JSON.stringify({ "assistant.schedules.v1": schedules }),
    seedLocalStorage: { "assistant.schedules.v1": schedules },
  });
  assert.equal(setCalls.length, 0, "sanity: first pull with matching local/remote data shouldn't push");

  // A remote update from a different device, carrying the exact same data
  // this device already has.
  triggerRemoteUpdate(JSON.stringify({ "assistant.schedules.v1": schedules }));

  assert.equal(reloadCalls.length, 0, "a no-op merge must not reload the page");
  assert.equal(localStorage.getItem("__cloudSync.pendingPush"), null, "a no-op merge must not arm the pending-push marker");
});

test("snapshot(update) from another device: a genuine remote change still merges, marks pending, and reloads", () => {
  const localSchedules = JSON.stringify([{ id: "sc1", title: "로컬 일정" }]);
  const { localStorage, reloadCalls, triggerRemoteUpdate } = loadCloudSyncModuleWithFakeFirebase({
    docExists: true,
    docPayload: JSON.stringify({ "assistant.schedules.v1": localSchedules }),
    seedLocalStorage: { "assistant.schedules.v1": localSchedules },
  });

  // A remote update from a different device, adding a NEW schedule this
  // device doesn't have yet.
  const remoteSchedules = JSON.stringify([{ id: "sc1", title: "로컬 일정" }, { id: "sc2", title: "다른 기기 일정" }]);
  triggerRemoteUpdate(JSON.stringify({ "assistant.schedules.v1": remoteSchedules }));

  assert.equal(reloadCalls.length, 1, "a real merge change must still reload so every view re-renders");
  assert.equal(localStorage.getItem("__cloudSync.pendingPush"), "1", "the merged result must be armed for re-push");
  assert.equal(JSON.parse(localStorage.getItem("assistant.schedules.v1")).length, 2, "the merge itself must still have applied");
});

test("snapshot(update) from another device: a deleted item is not resurrected by a stale remote copy that still has it — the actual bug fix (deletion tombstones)", () => {
  // The real reported bug: delete a schedule, then a merge against ANY
  // remote snapshot that still has it (a second device that hasn't caught
  // up to the deletion yet) used to silently add it right back, since a
  // plain union-by-id merge can't tell "deleted" apart from "the other
  // side just hasn't synced this yet" when an id is missing from one side.
  const tombstones = JSON.stringify([{ id: "sc1", deletedAt: Date.now() }]);
  const { localStorage, triggerRemoteUpdate } = loadCloudSyncModuleWithFakeFirebase({
    docExists: true,
    docPayload: JSON.stringify({
      "assistant.schedules.v1": JSON.stringify([]),
      "assistant.deletionTombstones.v1": tombstones,
    }),
    seedLocalStorage: {
      "assistant.schedules.v1": JSON.stringify([]),
      "assistant.deletionTombstones.v1": tombstones,
    },
  });

  // A remote update from a different device carrying a STALE copy that
  // still has the deleted item — e.g. that device hasn't pulled the
  // deletion yet.
  const staleRemoteSchedules = JSON.stringify([{ id: "sc1", title: "삭제된 일정" }]);
  triggerRemoteUpdate(
    JSON.stringify({
      "assistant.schedules.v1": staleRemoteSchedules,
      "assistant.deletionTombstones.v1": tombstones,
    })
  );

  const merged = JSON.parse(localStorage.getItem("assistant.schedules.v1"));
  assert.equal(merged.length, 0, "a tombstoned id must not be resurrected by a stale remote copy");
});

test("snapshot(update): a tombstoned NESTED node (buried inside a surviving parent's own children) is not resurrected — the actual bug fix", () => {
  // The real reported bug: practice.js's 커리큘럼 and study.js's 학업 목표
  // are trees (a goal can have children, which can have their own
  // children), not a flat list — the old tombstone filter only ever
  // stripped a matching id out of the TOP-LEVEL array, so deleting a
  // nested goal (buried inside a parent that itself survives) did nothing
  // to protect it: a stale remote copy that still had the parent's
  // children array un-pruned merged the deleted goal right back in.
  const tombstones = JSON.stringify([{ id: "curr_child", deletedAt: Date.now() }]);
  const localCurriculum = JSON.stringify([
    { id: "curr_parent", label: "부모", done: false, children: [] },
  ]);
  const { localStorage, triggerRemoteUpdate } = loadCloudSyncModuleWithFakeFirebase({
    docExists: true,
    docPayload: JSON.stringify({
      "assistant.practiceCurriculum.v1": localCurriculum,
      "assistant.deletionTombstones.v1": tombstones,
    }),
    seedLocalStorage: {
      "assistant.practiceCurriculum.v1": localCurriculum,
      "assistant.deletionTombstones.v1": tombstones,
    },
  });

  // A remote update carrying a STALE copy where the parent still has the
  // deleted child nested inside it — e.g. another device that hasn't
  // pulled the deletion yet.
  const staleRemoteCurriculum = JSON.stringify([
    {
      id: "curr_parent",
      label: "부모",
      done: false,
      children: [{ id: "curr_child", label: "삭제된 자식", done: false, children: [] }],
    },
  ]);
  triggerRemoteUpdate(
    JSON.stringify({
      "assistant.practiceCurriculum.v1": staleRemoteCurriculum,
      "assistant.deletionTombstones.v1": tombstones,
    })
  );

  const merged = JSON.parse(localStorage.getItem("assistant.practiceCurriculum.v1"));
  assert.equal(merged.length, 1, "the surviving parent must not be dropped");
  assert.equal(merged[0].children.length, 0, "a tombstoned nested child must not be resurrected by a stale remote copy");
});

test("snapshot(update): a tombstoned item is stripped even when the whole payload isn't a top-level array — the actual bug fix (study.js's {years: [...]} shape)", () => {
  // study.js's GoalStore stores {years: [...]}, not an array at the top
  // level — the old filter's `Array.isArray(incoming)` check meant it
  // never even looked at this store's data at all, so NOTHING in it was
  // ever tombstone-protected, not even a deleted top-level year.
  const tombstones = JSON.stringify([{ id: "year_2026", deletedAt: Date.now() }]);
  const localGoals = JSON.stringify({ years: [] });
  const { localStorage, triggerRemoteUpdate } = loadCloudSyncModuleWithFakeFirebase({
    docExists: true,
    docPayload: JSON.stringify({
      "assistant.academicGoals.v1": localGoals,
      "assistant.deletionTombstones.v1": tombstones,
    }),
    seedLocalStorage: {
      "assistant.academicGoals.v1": localGoals,
      "assistant.deletionTombstones.v1": tombstones,
    },
  });

  const staleRemoteGoals = JSON.stringify({
    years: [{ id: "year_2026", label: "2026", periods: [] }],
  });
  triggerRemoteUpdate(
    JSON.stringify({
      "assistant.academicGoals.v1": staleRemoteGoals,
      "assistant.deletionTombstones.v1": tombstones,
    })
  );

  const merged = JSON.parse(localStorage.getItem("assistant.academicGoals.v1"));
  assert.equal(merged.years.length, 0, "a tombstoned year must not be resurrected by a stale remote copy");
});

test("snapshot(update): a tombstoned key-identified item (CategoryStore's {key,...} shape, no id field) is stripped too — the actual bug fix", () => {
  // CategoryStore/LedgerCategoryStore/BodyPartStore items have no `id`
  // field at all, only `key` — the old filter checked `item.id` exclusively
  // (always undefined for these), so a deleted category could never match
  // a tombstone no matter what.
  const tombstones = JSON.stringify([{ id: "cat_old", deletedAt: Date.now() }]);
  const localCategories = JSON.stringify([]);
  const { localStorage, triggerRemoteUpdate } = loadCloudSyncModuleWithFakeFirebase({
    docExists: true,
    docPayload: JSON.stringify({
      "assistant.categories.v1": localCategories,
      "assistant.deletionTombstones.v1": tombstones,
    }),
    seedLocalStorage: {
      "assistant.categories.v1": localCategories,
      "assistant.deletionTombstones.v1": tombstones,
    },
  });

  const staleRemoteCategories = JSON.stringify([{ key: "cat_old", label: "삭제된 카테고리", color: "#000" }]);
  triggerRemoteUpdate(
    JSON.stringify({
      "assistant.categories.v1": staleRemoteCategories,
      "assistant.deletionTombstones.v1": tombstones,
    })
  );

  const merged = JSON.parse(localStorage.getItem("assistant.categories.v1"));
  assert.equal(merged.length, 0, "a tombstoned key-identified item must not be resurrected by a stale remote copy");
});
