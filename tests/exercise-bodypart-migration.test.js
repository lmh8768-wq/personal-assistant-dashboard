"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadExerciseModule } = require("./helpers/load-exercise");

// loadBodyParts() falls back to the 6 DEFAULT_BODY_PARTS (chest/back/
// shoulder/arm/leg/abs) in-memory whenever nothing's been saved yet, and
// BodyPartStore.add() persists that in-memory list (defaults included) the
// moment it first saves — so a fresh sandbox already "has" the defaults by
// the time any add() runs, and getAll() is never actually empty in these
// tests. Assertions below check for the specific garbled entry the bug
// creates, not overall list length/emptiness.
//
// Returns a plain count, not the array itself — the array comes back from
// code that ran inside the vm sandbox (a separate JS realm), so comparing
// it directly against a host-realm `[]` literal via assert.deepEqual fails
// on the prototype/constructor check even when both are structurally
// empty ("Values have same structure but are not reference-equal").
function garbledLabelCount(window) {
  return window.BodyPartStore.getAll()
    .map((p) => p.label)
    .filter((label) => /^bp_\d+_[a-z0-9]+$/.test(label) || label === "chest").length;
}

test("migrateBodyPartsToKeys: a genuine pre-migration free-text label still migrates into a real body part — regression guard for the original feature", () => {
  const window = loadExerciseModule();
  // "이두근" isn't one of the 6 DEFAULT_BODY_PARTS labels, so this only
  // passes if migration actually MINTS a new body part for it (reusing an
  // existing default's key by label match, which happens for e.g. "가슴",
  // wouldn't exercise that path).
  window.ExerciseLogStore.add({ date: "2026-08-01", bodyPart: "이두근" }); // old-style free text, no key
  window.__migrateBodyPartsToKeysForTest();

  const created = window.BodyPartStore.getAll().find((p) => p.label === "이두근");
  assert.ok(created, "a genuine legacy label must still migrate into a real body part");
  const [entry] = window.ExerciseLogStore.getAll();
  assert.equal(entry.bodyPart, created.key, "the log entry must now point at the real key, not the old label string");
});

test("migrateBodyPartsToKeys: a log entry referencing a DELETED default-keyed body part is left alone, not resurrected as a body part literally labeled 'chest' — the actual bug fix", () => {
  const window = loadExerciseModule();
  // Give the account a real, saved body part list that no longer includes
  // the "chest" default (e.g. it was deleted early on) — add() persists
  // the full list including defaults, so this simulates "chest" genuinely
  // being gone rather than just never-yet-saved.
  const core = window.BodyPartStore.add("코어");
  window.BodyPartStore.remove("chest");
  window.ExerciseLogStore.add({ date: "2026-08-01", bodyPart: "chest" }); // orphaned reference to the deleted default

  window.__migrateBodyPartsToKeysForTest();

  assert.equal(garbledLabelCount(window), 0, "must not create a body part literally labeled 'chest'");
  assert.ok(window.BodyPartStore.getByKey(core.key), "unrelated body parts must be untouched");
});

test("migrateBodyPartsToKeys: a log entry referencing a DELETED custom (bp_-keyed) body part is left alone, not resurrected as a body part literally labeled with the raw internal key — the actual bug fix", () => {
  const window = loadExerciseModule();
  const part = window.BodyPartStore.add("코어");
  window.ExerciseLogStore.add({ date: "2026-08-01", bodyPart: part.key });
  window.BodyPartStore.remove(part.key); // part.key is now orphaned in the log entry

  window.__migrateBodyPartsToKeysForTest();

  assert.equal(
    garbledLabelCount(window),
    0,
    "must not create a new body part literally labeled with the deleted part's raw internal key"
  );
});

test("migrateBodyPartsToKeys: an orphaned routine note (bp_-keyed) is left alone too, not resurrected as a body part", () => {
  const window = loadExerciseModule();
  const part = window.BodyPartStore.add("코어");
  window.BodyPartRoutineStore.update(part.key, "플랭크 1분 x3");
  window.BodyPartStore.remove(part.key); // routine note for part.key is now orphaned

  window.__migrateBodyPartsToKeysForTest();

  assert.equal(garbledLabelCount(window), 0);
});

test("BodyPartStore.remove + clearing the routine note leaves no orphan, and undo restores both the part and its note", () => {
  const window = loadExerciseModule();
  const part = window.BodyPartStore.add("코어");
  window.BodyPartRoutineStore.update(part.key, "플랭크 1분 x3");

  const routineBeforeDelete = window.BodyPartRoutineStore.get(part.key);
  const removed = window.BodyPartStore.remove(part.key);
  window.BodyPartRoutineStore.update(part.key, ""); // mirrors the delete handler in exercise.js

  assert.equal(window.BodyPartRoutineStore.get(part.key), "", "the routine note must not be left orphaned");
  assert.equal(window.BodyPartStore.getByKey(part.key), null);

  // Undo: restore both the body part and its routine note.
  window.BodyPartStore.restore(removed.item, removed.index);
  if (routineBeforeDelete) window.BodyPartRoutineStore.update(part.key, routineBeforeDelete);

  assert.equal(window.BodyPartRoutineStore.get(part.key), "플랭크 1분 x3");
  assert.ok(window.BodyPartStore.getByKey(part.key));
});
