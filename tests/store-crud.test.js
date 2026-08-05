"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadStoreModule, loadStoreModuleWithStorage } = require("./helpers/load-store");

test("LedgerEntryStore: add/update/remove/restore round-trip", () => {
  const window = loadStoreModule();
  const store = window.LedgerEntryStore;

  const entry = store.add({ date: "2026-08-01", amount: 12000, categoryKey: "food", type: "expense" });
  assert.ok(entry.id);
  assert.equal(store.getAll().length, 1);

  const updated = store.update(entry.id, { amount: 15000 });
  assert.equal(updated.amount, 15000);
  assert.equal(store.getAll()[0].amount, 15000);

  const removed = store.remove(entry.id);
  assert.equal(store.getAll().length, 0);
  assert.equal(removed.item.id, entry.id);

  store.restore(removed.item, removed.index);
  assert.equal(store.getAll().length, 1);
  assert.equal(store.getAll()[0].amount, 15000);
});

test("LedgerEntryStore: the 999,999,999,999 amount cap is enforced in the store itself, not just the UI — the actual bug fix", () => {
  const window = loadStoreModule();
  const store = window.LedgerEntryStore;

  const entry = store.add({ date: "2026-08-01", amount: 5_000_000_000_000, categoryKey: "food", type: "expense" });
  assert.equal(entry.amount, 999999999999);
  assert.equal(store.getAll()[0].amount, 999999999999);

  const updated = store.update(entry.id, { amount: 9_000_000_000_000 });
  assert.equal(updated.amount, 999999999999);
});

test("restore() clamps a negative index to the start instead of letting splice() count it from the array's end — the actual bug fix", () => {
  // With only Math.min(index, length) clamping the upper bound, a small
  // negative index (e.g. -1, with a 2-item array) wasn't clamped at all —
  // Array.prototype.splice treats a negative start as "count from the end"
  // (max(length + start, 0)), so it silently inserted one slot away from
  // the front instead of AT the front like index 0 would. Math.max(0, ...)
  // now clamps it to a real 0 first, so it lands at the front either way.
  const window = loadStoreModule();

  // createEntityStore-backed (LedgerEntryStore).
  const ledger = window.LedgerEntryStore;
  ledger.add({ date: "2026-08-01", amount: 1000, categoryKey: "food", type: "expense" });
  ledger.add({ date: "2026-08-02", amount: 2000, categoryKey: "food", type: "expense" });
  const removedEntry = { date: "2026-08-03", amount: 3000, categoryKey: "food", type: "expense", id: "exp_test" };
  ledger.restore(removedEntry, -1);
  assert.equal(ledger.getAll()[0].id, "exp_test");

  // createKeyedStore-backed (CategoryStore).
  const categories = window.CategoryStore;
  categories.add("첫 카테고리", "#111111");
  categories.add("둘째 카테고리", "#222222");
  const removedCategory = { key: "cat_test", label: "복원된 카테고리", color: "#333333" };
  categories.restore(removedCategory, -1);
  assert.equal(categories.getAll()[0].key, "cat_test");
});

test("LedgerEntryStore: update/remove on an unknown id is a no-op, not a throw", () => {
  const window = loadStoreModule();
  const store = window.LedgerEntryStore;

  assert.equal(store.update("nope", { amount: 1 }), null);
  assert.equal(store.remove("nope"), null);
});

test("VongoleRecipeStore and VongoleCollectedRecipeStore are independent (same factory, separate storage keys)", () => {
  const window = loadStoreModule();

  const success = window.VongoleRecipeStore.add({ title: "대성공", content: "내용1" });
  window.VongoleCollectedRecipeStore.add({ title: "수집", content: "내용2" });

  assert.equal(window.VongoleRecipeStore.getAll().length, 1);
  assert.equal(window.VongoleCollectedRecipeStore.getAll().length, 1);
  assert.equal(window.VongoleRecipeStore.getAll()[0].title, "대성공");

  window.VongoleRecipeStore.remove(success.id);
  assert.equal(window.VongoleRecipeStore.getAll().length, 0);
  // the collected-recipes store must be untouched by removing from the success store
  assert.equal(window.VongoleCollectedRecipeStore.getAll().length, 1);
});

test("LedgerCategoryStore: expense and income categories are filtered separately, budgets default to 0", () => {
  const window = loadStoreModule();
  const store = window.LedgerCategoryStore;

  const expense = store.add("식비", "#f97316", "expense");
  const income = store.add("용돈", "#38bdf8", "income");

  assert.equal(expense.budget, 0);
  assert.equal(store.getByType("expense").some((c) => c.key === expense.key), true);
  assert.equal(store.getByType("income").some((c) => c.key === income.key), true);
  assert.equal(store.getByType("expense").some((c) => c.key === income.key), false);
});

test("CategoryStore: add/remove/restore round-trip, freely addable like ledger categories", () => {
  const window = loadStoreModule();
  const store = window.CategoryStore;

  const before = store.getAll().length;
  const created = store.add("커스텀", "#123456");
  assert.equal(store.getAll().length, before + 1);

  const removed = store.remove(created.key);
  assert.equal(store.getAll().length, before);
  assert.equal(removed.item.key, created.key);

  store.restore(removed.item, removed.index);
  assert.equal(store.getAll().length, before + 1);
});

test("CategoryStore/LedgerCategoryStore: add() on first-ever use doesn't corrupt the DEFAULTS fallback", () => {
  // Regression test: loadCategories()/load() used to return the literal
  // DEFAULTS array when localStorage was still empty. add()'s push() then
  // mutated that same array in place, permanently shifting what
  // DEFAULTS[DEFAULTS.length - 1] pointed to (CategoryStore's fallback for
  // an unknown key) for the rest of the page's lifetime.
  const window = loadStoreModule();

  window.CategoryStore.add("첫 카테고리", "#123456");
  const fallback = window.CategoryStore.getByKey("does-not-exist");
  assert.equal(fallback.key, "etc");

  window.LedgerCategoryStore.add("첫 지출", "#654321", "expense");
  assert.equal(window.LedgerCategoryStore.getByKey("does-not-exist"), null);
});

test("CategoryStore: only migrates the old 5-category scheme when truly unmodified — the actual bug fix", () => {
  const { window, localStorage } = loadStoreModuleWithStorage();

  // A user under the old scheme could only relabel/recolor one of the 5
  // fixed categories (add/remove didn't exist yet) — here "personal" was
  // relabeled. The old (key-only) check would still treat this as
  // "unmodified" and silently overwrite it with the new DEFAULTS.
  const customized = [
    { key: "work", label: "업무", color: "#60a5fa" },
    { key: "personal", label: "나만의 시간", color: "#60a5fa" },
    { key: "health", label: "건강", color: "#f87171" },
    { key: "study", label: "공부", color: "#4ade80" },
    { key: "etc", label: "기타", color: "#94a3b8" },
  ];
  localStorage.setItem("assistant.categories.v1", JSON.stringify(customized));

  const categories = window.CategoryStore.getAll();
  assert.equal(categories.find((c) => c.key === "personal")?.label, "나만의 시간");
});

test("CategoryStore: a truly-untouched old-scheme set still migrates to the new defaults", () => {
  const { window, localStorage } = loadStoreModuleWithStorage();

  const untouched = [
    { key: "work", label: "업무", color: "#60a5fa" },
    { key: "personal", label: "개인", color: "#a78bfa" },
    { key: "health", label: "건강", color: "#f87171" },
    { key: "study", label: "공부", color: "#4ade80" },
    { key: "etc", label: "기타", color: "#94a3b8" },
  ];
  localStorage.setItem("assistant.categories.v1", JSON.stringify(untouched));

  const categories = window.CategoryStore.getAll();
  assert.ok(categories.some((c) => c.key === "appointment"));
  assert.ok(!categories.some((c) => c.key === "work"));
});

test("CategoryStore: a failed write during old-scheme migration doesn't poison the in-memory cache — the actual bug fix", () => {
  const { window, localStorage } = loadStoreModuleWithStorage();
  const untouched = [
    { key: "work", label: "업무", color: "#60a5fa" },
    { key: "personal", label: "개인", color: "#a78bfa" },
    { key: "health", label: "건강", color: "#f87171" },
    { key: "study", label: "공부", color: "#4ade80" },
    { key: "etc", label: "기타", color: "#94a3b8" },
  ];
  localStorage.setItem("assistant.categories.v1", JSON.stringify(untouched));

  const realSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = () => {
    throw new Error("quota exceeded");
  };
  window.CategoryStore.getAll(); // triggers the migration write, which fails
  localStorage.setItem = realSetItem;

  // The write never actually landed, so the raw persisted value must still
  // be the old un-migrated array.
  const persisted = JSON.parse(localStorage.getItem("assistant.categories.v1"));
  assert.equal(persisted.length, 5, "a failed write must not be treated as if it landed");

  // A later read (storage healthy again) must retry the migration instead
  // of serving a cache that got poisoned by the earlier failed attempt.
  const categories = window.CategoryStore.getAll();
  assert.ok(categories.some((c) => c.key === "appointment"), "the retried migration must still succeed once storage works again");
});

test("LedgerCategoryStore: a failed write during the income-category migration doesn't poison the in-memory cache — the actual bug fix", () => {
  const { window, localStorage } = loadStoreModuleWithStorage();
  const preIncomeScheme = [{ key: "food", label: "식비", color: "#f97316", budget: 0 }];
  localStorage.setItem("assistant.ledgerCategories.v1", JSON.stringify(preIncomeScheme));

  const realSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = () => {
    throw new Error("quota exceeded");
  };
  window.LedgerCategoryStore.getAll();
  localStorage.setItem = realSetItem;

  const persisted = JSON.parse(localStorage.getItem("assistant.ledgerCategories.v1"));
  assert.equal(persisted.length, 1, "a failed write must not be treated as if it landed");

  const categories = window.LedgerCategoryStore.getAll();
  assert.ok(categories.some((c) => c.type === "income"), "the retried migration must still succeed once storage works again");
});

test("store.js: a 'storage' event from another same-origin tab resets every registered cache — the actual bug fix", () => {
  // Two tabs of the SAME browser share cloud-sync's persisted DEVICE_ID, so
  // a write in one tab is filed as an "own echo" by the other tab's
  // Firestore listener and never triggers a reload — the native `storage`
  // event (fired on every OTHER same-origin tab, never the one that wrote)
  // is the only signal available to invalidate that other tab's stale cache.
  const { window, localStorage } = loadStoreModuleWithStorage();

  // Warm ScheduleStore's cache with one item.
  window.ScheduleStore.add({ title: "A", date: "2026-08-01", repeat: { type: "none" } });
  assert.equal(window.ScheduleStore.getAll().length, 1);

  // Simulate a SECOND tab writing directly to the same underlying
  // localStorage (as cloud-sync.js's own-echo-ignored write would) —
  // bypassing this tab's store entirely, the way a real second tab would.
  const raw = JSON.parse(localStorage.getItem("assistant.schedules.v1"));
  raw.push({ id: "sc_from_other_tab", title: "B", date: "2026-08-02", repeat: { type: "none" } });
  localStorage.setItem("assistant.schedules.v1", JSON.stringify(raw));

  // Without invalidation, the cache still only knows about the first item.
  assert.equal(window.ScheduleStore.getAll().length, 1, "sanity: the cache is stale before the storage event fires");

  // Fire the real registered "storage" listener, exactly as the browser
  // would on every OTHER same-origin tab when localStorage changes.
  assert.ok(window.__testStorageListeners.length >= 1, "store.js must register a storage listener");
  window.__testStorageListeners.forEach((fn) => fn({ key: "assistant.schedules.v1" }));

  assert.equal(window.ScheduleStore.getAll().length, 2, "the cache must reflect the other tab's write after invalidation");
});

test("store.js: a 'storage' event for a non-assistant.* key is ignored", () => {
  const { window } = loadStoreModuleWithStorage();
  window.ScheduleStore.add({ title: "A", date: "2026-08-01", repeat: { type: "none" } });
  window.ScheduleStore.getAll(); // warm the cache

  let resetCount = 0;
  window.__resetStoreCaches.push(() => resetCount++);
  window.__testStorageListeners.forEach((fn) => fn({ key: "someOtherSite.unrelated" }));
  assert.equal(resetCount, 0, "an unrelated key must not trigger a cache reset");
});

test("CategoryStore: a corrupted non-array value falls back to defaults instead of throwing later — the actual bug fix", () => {
  const { window, localStorage } = loadStoreModuleWithStorage();
  localStorage.setItem("assistant.categories.v1", JSON.stringify({ oops: true }));

  const categories = window.CategoryStore.getAll();
  assert.ok(Array.isArray(categories));
  assert.doesNotThrow(() => window.CategoryStore.add("새 카테고리", "#111111"));
});

test("LedgerEntryStore.addMany: adds several entries in one call, each with its own id, amount cap still enforced — the actual bug fix", () => {
  const window = loadStoreModule();
  const store = window.LedgerEntryStore;

  const created = store.addMany([
    { date: "2026-08-01", amount: 1000, categoryKey: "food", type: "expense" },
    { date: "2026-08-02", amount: 5_000_000_000_000, categoryKey: "food", type: "expense" },
  ]);

  assert.equal(created.length, 2);
  assert.notEqual(created[0].id, created[1].id);
  assert.equal(store.getAll().length, 2);
  assert.equal(created[1].amount, 999999999999, "the per-add amount cap must still apply through addMany");
});

test("ScheduleStore.addMany: adds several schedules in one call, preserving each item's own id (used for bulk-delete undo)", () => {
  const window = loadStoreModule();
  const store = window.ScheduleStore;

  const created = store.addMany([
    { id: "sc_a", title: "A", date: "2026-08-01", repeat: { type: "none" } },
    { id: "sc_b", title: "B", date: "2026-08-02", repeat: { type: "none" } },
  ]);

  assert.deepEqual(created.map((s) => s.id).sort(), ["sc_a", "sc_b"]);
  assert.equal(store.getById("sc_a").title, "A");
  assert.equal(store.getById("sc_b").title, "B");
});
