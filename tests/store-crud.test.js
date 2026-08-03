"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadStoreModule } = require("./helpers/load-store");

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
