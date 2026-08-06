"use strict";
// DOM/UI test layer for the render-heavy feature scripts (vongole.js,
// practice.js, study.js, routine.js) — the other test files in this
// directory only cover store.js's pure logic via a vm sandbox, which can't
// exercise real createElement/event-listener rendering code at all. These
// launch an actual Chromium page against the app instead.
//
// Slower and needs a Chromium binary, so they're opt-in rather than part of
// the default `npm test` loop: run with `npm run test:ui`, which sets
// RUN_UI_TESTS=1. Each test still gets discovered and reported (as skipped)
// under bare `node --test`, so nothing here is silently invisible.
const test = require("node:test");
const assert = require("node:assert/strict");
const { launchApp, bypassAuthGate } = require("./helpers/browser-app");

const RUN = !!process.env.RUN_UI_TESTS;

test("vongole: add a recipe, delete it, undo restores it", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => document.querySelector('[data-view="vongole"]')?.click());
    await page.waitForTimeout(150);

    const before = await page.evaluate(() => window.VongoleRecipeStore.getAll().length);
    await page.click("#addVongoleRecipeBtn");
    await page.waitForTimeout(150);
    const afterAdd = await page.evaluate(() => window.VongoleRecipeStore.getAll().length);
    assert.equal(afterAdd, before + 1);

    await page.click("#vongoleRecipeList .vongole-recipe-card:last-child .checklist-item-remove");
    await page.waitForTimeout(150);
    const afterDelete = await page.evaluate(() => window.VongoleRecipeStore.getAll().length);
    assert.equal(afterDelete, before);

    await page.click(".toast button, .toast-action");
    await page.waitForTimeout(150);
    const afterUndo = await page.evaluate(() => window.VongoleRecipeStore.getAll().length);
    assert.equal(afterUndo, before + 1);
  } finally {
    await close();
  }
});

test("vongole: linking a log entry to a recipe shows an attempt-count badge", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const recipeId = await page.evaluate(() => window.VongoleRecipeStore.add({ title: "UI테스트레시피", content: "" }).id);
    await page.evaluate(() => document.querySelector('[data-view="vongole"]')?.click());
    await page.waitForTimeout(150);

    await page.click("#addVongoleLogBtn");
    await page.waitForTimeout(100);
    await page.fill("#vongoleLogDateInput", "2026-08-01");
    await page.selectOption("#vongoleLogRecipeSelectInput", { label: "UI테스트레시피" });
    await page.click("#vongoleLogForm button[type=submit]");
    await page.waitForTimeout(150);

    const badge = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll("#vongoleRecipeList .vongole-recipe-card"));
      const card = cards.find((c) => c.querySelector(".vongole-recipe-title")?.textContent === "UI테스트레시피");
      return card?.querySelector(".vongole-recipe-attempt-badge")?.textContent || null;
    });
    assert.equal(badge, "1번 시도");

    const stored = await page.evaluate(() => window.VongoleLogStore.getAll()[0]);
    assert.equal(stored.recipeId, recipeId);
    assert.equal(stored.recipeKind, "success");
  } finally {
    await close();
  }
});

test("practice: adding a curriculum goal and renaming it via double-click both persist", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => document.querySelector('[data-view="practice"]')?.click());
    await page.waitForTimeout(150);

    await page.click("#practiceCurriculum .goal-add-trigger-btn");
    await page.waitForTimeout(100);
    const addInput = page.locator("#practiceCurriculum .goal-item-label-input");
    await addInput.fill("UI테스트목표");
    await addInput.press("Enter");
    await page.waitForTimeout(150);

    const added = await page.evaluate(() => window.PracticeCurriculumStore.getGoals().some((g) => g.label === "UI테스트목표"));
    assert.equal(added, true);

    const label = page.locator("#practiceCurriculum .goal-item-label", { hasText: "UI테스트목표" }).first();
    await label.dblclick();
    await page.waitForTimeout(100);
    const renameInput = page.locator("#practiceCurriculum .goal-item-label-input");
    await renameInput.fill("UI테스트목표-수정");
    await renameInput.press("Enter");
    await page.waitForTimeout(150);

    const renamed = await page.evaluate(() => window.PracticeCurriculumStore.getGoals().some((g) => g.label === "UI테스트목표-수정"));
    assert.equal(renamed, true);
  } finally {
    await close();
  }
});

test("study: adding a goal inside a period via its own + button persists", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    // Goals nest under year -> period, so a period has to exist first —
    // seeding that through the store is faster and just as valid as
    // clicking through "+ 연도 추가" / "+ 구간 추가" first, since those aren't
    // what this test is about.
    const ids = await page.evaluate(() => {
      const year = window.AcademicGoalStore.addYear("2027");
      const period = window.AcademicGoalStore.addPeriod(year.id, "테스트 구간");
      return { yearId: year.id, periodId: period.id };
    });
    await page.reload();
    await bypassAuthGate(page);

    await page.evaluate(() => document.querySelector('[data-view="study"]')?.click());
    await page.waitForTimeout(150);

    // Scoped to the just-seeded period specifically — study.js already ships
    // with other default years/periods, so an unscoped selector would hit
    // whichever one happens to render first instead.
    const periodCard = page.locator(".goal-period-card", { hasText: "테스트 구간" });
    await periodCard.locator(".goal-add-row button").click();
    await page.waitForTimeout(100);
    const input = periodCard.locator(".goal-item-label-input");
    await input.fill("UI학업목표");
    await input.press("Enter");
    await page.waitForTimeout(150);

    const goals = await page.evaluate(
      (ids) => window.AcademicGoalStore.getGoals(ids.yearId, ids.periodId),
      ids
    );
    assert.equal(goals.some((g) => g.label === "UI학업목표"), true);
  } finally {
    await close();
  }
});

test("routine: adding a checklist item and toggling it done both persist", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => document.querySelector('[data-view="routine"]')?.click());
    await page.waitForTimeout(150);

    await page.click("#routineChecklistAddRow .routine-add-trigger-btn");
    await page.waitForTimeout(100);
    const input = page.locator("#routineChecklistAddRow input[type=text]");
    await input.fill("UI루틴항목");
    await input.press("Enter");
    await page.waitForTimeout(150);

    const added = await page.evaluate(() => window.RoutineStore.getItems("routine").some((i) => i.label === "UI루틴항목"));
    assert.equal(added, true);

    const checkbox = page.locator("#routineChecklistList li", { hasText: "UI루틴항목" }).locator("input[type=checkbox]");
    await checkbox.click();
    await page.waitForTimeout(150);

    const doneAfter = await page.evaluate(() => {
      const item = window.RoutineStore.getItems("routine").find((i) => i.label === "UI루틴항목");
      return window.RoutineStore.isDone("routine", item.id);
    });
    assert.equal(doneAfter, true);
  } finally {
    await close();
  }
});

test("accessibility: toast has aria-live, modal focus returns to its trigger, delete spans are keyboard-activatable", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const toastAttrs = await page.evaluate(() => {
      window.Toast.show("테스트 메시지");
      const container = document.getElementById("toastContainer");
      return { role: container.getAttribute("role"), ariaLive: container.getAttribute("aria-live") };
    });
    assert.equal(toastAttrs.role, "status");
    assert.equal(toastAttrs.ariaLive, "polite");

    await page.evaluate(() => document.querySelector('[data-view="schedule"]')?.click());
    await page.waitForTimeout(150);
    await page.focus("#addScheduleBtn");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.activeElement.id), "scheduleTitleInput");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "addScheduleBtn",
      "focus should return to whatever opened the modal, not fall back to <body>"
    );

    await page.evaluate(() => window.VongoleRecipeStore.add({ title: "UI키보드삭제", content: "" }));
    await page.reload();
    await bypassAuthGate(page);
    await page.evaluate(() => document.querySelector('[data-view="vongole"]')?.click());
    await page.waitForTimeout(150);

    const before = await page.evaluate(() => window.VongoleRecipeStore.getAll().length);
    const deleteSpan = page.locator(".vongole-recipe-card", { hasText: "UI키보드삭제" }).locator(".checklist-item-remove");
    const spanAttrs = await deleteSpan.evaluate((el) => ({ tabIndex: el.tabIndex, role: el.getAttribute("role") }));
    assert.equal(spanAttrs.tabIndex, 0);
    assert.equal(spanAttrs.role, "button");
    await deleteSpan.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => window.VongoleRecipeStore.getAll().length);
    assert.equal(after, before - 1, "Enter on the focused delete span should trigger the same delete as a click");
  } finally {
    await close();
  }
});

test("study: select-mode multi-select, copy/paste, and multi-select delete match practice.js's curriculum tree", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const ids = await page.evaluate(() => {
      const year = window.AcademicGoalStore.addYear("2028");
      const period = window.AcademicGoalStore.addPeriod(year.id, "테스트구간");
      const goalA = window.AcademicGoalStore.addGoal(year.id, period.id, null, "목표A");
      const goalB = window.AcademicGoalStore.addGoal(year.id, period.id, null, "목표B");
      return { yearId: year.id, periodId: period.id, goalA: goalA.id, goalB: goalB.id };
    });
    await page.reload();
    await bypassAuthGate(page);
    await page.evaluate(() => document.querySelector('[data-view="study"]')?.click());
    await page.waitForTimeout(150);

    await page.click("#studySelectModeBtn");
    await page.waitForTimeout(100);
    const rowA = page.locator(`.goal-item-row[data-goal-id="${ids.goalA}"]`);
    await rowA.locator(".goal-select-checkbox").click();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.getElementById("studySelectCount").textContent), "1개 선택됨");

    await page.click("#studyCopyBtn");
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => !document.getElementById("studyClipboardNote").hidden), true);

    await page.locator(`.goal-item-row[data-goal-id="${ids.goalB}"]`).locator(".goal-paste-btn").click();
    await page.waitForTimeout(150);
    const goalBChildren = await page.evaluate(
      (ids) => window.AcademicGoalStore.getGoals(ids.yearId, ids.periodId).find((g) => g.id === ids.goalB)?.children?.length,
      ids
    );
    assert.equal(goalBChildren, 1);

    await page.click("#studySelectModeBtn");
    await page.waitForTimeout(100);
    await rowA.locator(".goal-select-checkbox").click();
    await page.waitForTimeout(100);
    await page.click("#studyDeleteBtn");
    await page.waitForTimeout(150);
    const remainingIds = await page.evaluate((ids) => window.AcademicGoalStore.getGoals(ids.yearId, ids.periodId).map((g) => g.id), ids);
    assert.equal(remainingIds.includes(ids.goalA), false);
    assert.equal(remainingIds.includes(ids.goalB), true);
  } finally {
    await close();
  }
});

test("study: reordering goals only ever reorders siblings within the same period, never across periods", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const result = await page.evaluate(() => {
      const year = window.AcademicGoalStore.addYear("리오더테스트");
      const period = window.AcademicGoalStore.addPeriod(year.id, "구간");
      const a = window.AcademicGoalStore.addGoal(year.id, period.id, null, "A");
      window.AcademicGoalStore.addGoal(year.id, period.id, null, "B");
      const c = window.AcademicGoalStore.addGoal(year.id, period.id, null, "C");

      window.AcademicGoalStore.reorderGoal(year.id, period.id, c.id, a.id, true);
      const afterMove = window.AcademicGoalStore.getGoals(year.id, period.id).map((g) => g.label);

      const otherPeriod = window.AcademicGoalStore.addPeriod(year.id, "다른구간");
      const d = window.AcademicGoalStore.addGoal(year.id, otherPeriod.id, null, "D");
      window.AcademicGoalStore.reorderGoal(year.id, period.id, d.id, a.id, true);
      return {
        afterMove,
        periodUnaffected: window.AcademicGoalStore.getGoals(year.id, period.id).map((g) => g.label),
        otherPeriodUnaffected: window.AcademicGoalStore.getGoals(year.id, otherPeriod.id).map((g) => g.label),
      };
    });
    assert.deepEqual(result.afterMove, ["C", "A", "B"]);
    assert.deepEqual(result.periodUnaffected, ["C", "A", "B"]);
    assert.deepEqual(result.otherPeriodUnaffected, ["D"]);
  } finally {
    await close();
  }
});

test("study: deleting a year needs two clicks (arm, then confirm) — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => window.AcademicGoalStore.addYear("2028"));
    await page.reload();
    await bypassAuthGate(page);
    await page.evaluate(() => document.querySelector('[data-view="study"]')?.click());
    await page.waitForTimeout(150);

    const yearRemove = page.locator(".goal-year-section", { hasText: "2028" }).locator(".goal-year-remove");
    await yearRemove.click();
    await page.waitForTimeout(100);
    assert.equal(await yearRemove.textContent(), "확인");
    assert.equal(
      await page.evaluate(() => window.AcademicGoalStore.getYears().some((y) => y.label === "2028")),
      true,
      "first click only arms — the year must still exist"
    );

    await yearRemove.click();
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(() => window.AcademicGoalStore.getYears().some((y) => y.label === "2028")),
      false,
      "second click confirms — the year should now be gone"
    );
  } finally {
    await close();
  }
});

test("practice: toggling a leaf goal's checkbox patches its row + ancestors in place, without rebuilding the tree", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const ids = await page.evaluate(() => {
      const parent = window.PracticeCurriculumStore.addGoal(null, "부모");
      const child = window.PracticeCurriculumStore.addGoal(parent.id, "자식");
      const grandchild = window.PracticeCurriculumStore.addGoal(child.id, "손자");
      return { parent: parent.id, child: child.id, grandchild: grandchild.id };
    });
    await page.reload();
    await bypassAuthGate(page);
    await page.evaluate(() => document.querySelector('[data-view="practice"]')?.click());
    await page.waitForTimeout(200);

    // Tag the parent row so we can tell if it got torn down and rebuilt —
    // a fresh element from renderCurriculum() wouldn't carry this marker.
    await page.evaluate((ids) => {
      document.querySelector(`.goal-item-row[data-goal-id="${ids.parent}"]`).dataset.notRebuilt = "true";
    }, ids);

    await page.locator(`.goal-item-row[data-goal-id="${ids.grandchild}"]`).locator('input[type="checkbox"]').click();
    await page.waitForTimeout(150);

    const after = await page.evaluate((ids) => {
      const parentRow = document.querySelector(`.goal-item-row[data-goal-id="${ids.parent}"]`);
      const childRow = document.querySelector(`.goal-item-row[data-goal-id="${ids.child}"]`);
      return {
        parentSurvived: parentRow?.dataset.notRebuilt === "true",
        parentDone: parentRow?.classList.contains("done"),
        childDone: childRow?.classList.contains("done"),
        childProgressText: childRow?.querySelector(".goal-item-progress")?.textContent,
      };
    }, ids);
    assert.equal(after.parentSurvived, true, "the parent row's DOM element should be patched in place, not replaced");
    assert.equal(after.parentDone, true);
    assert.equal(after.childDone, true);
    // "child" has exactly one real leaf task (grandchild) — 1/1, not 2/2.
    // countGoalProgress only counts leaves as tasks now (see its own
    // comment for why counting the "child" node itself was wrong).
    assert.equal(after.childProgressText, "1/1");

    // Rejected toggle (checking a parent whose children aren't all done)
    // should revert the checkbox and leave the store untouched.
    const otherParent = await page.evaluate(() => window.PracticeCurriculumStore.addGoal(null, "미완료부모"));
    await page.evaluate((id) => window.PracticeCurriculumStore.addGoal(id, "미완료자식"), otherParent.id);
    await page.reload();
    await bypassAuthGate(page);
    await page.evaluate(() => document.querySelector('[data-view="practice"]')?.click());
    await page.waitForTimeout(200);
    await page.locator(`.goal-item-row[data-goal-id="${otherParent.id}"]`).locator('input[type="checkbox"]').click();
    await page.waitForTimeout(150);
    const rejected = await page.evaluate(
      (id) => document.querySelector(`.goal-item-row[data-goal-id="${id}"] input[type="checkbox"]`).checked,
      otherParent.id
    );
    assert.equal(rejected, false, "a rejected toggle must revert the checkbox's native flip");
  } finally {
    await close();
  }
});

test("study: unchecking a done parent cascades to its children via the full-rebuild fallback path", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const ids = await page.evaluate(() => {
      const year = window.AcademicGoalStore.addYear("패치테스트");
      const period = window.AcademicGoalStore.addPeriod(year.id, "구간");
      const parent = window.AcademicGoalStore.addGoal(year.id, period.id, null, "부모");
      const child = window.AcademicGoalStore.addGoal(year.id, period.id, parent.id, "자식");
      window.AcademicGoalStore.toggleDone(year.id, period.id, child.id); // also marks parent done via recompute
      return { yearId: year.id, periodId: period.id, parent: parent.id, child: child.id };
    });
    await page.reload();
    await bypassAuthGate(page);
    await page.evaluate(() => document.querySelector('[data-view="study"]')?.click());
    await page.waitForTimeout(200);

    await page.locator(`.goal-item-row[data-goal-id="${ids.parent}"]`).locator('input[type="checkbox"]').click();
    await page.waitForTimeout(200);

    const after = await page.evaluate((ids) => {
      const parentDone = document.querySelector(`.goal-item-row[data-goal-id="${ids.parent}"]`)?.classList.contains("done");
      const childDone = document.querySelector(`.goal-item-row[data-goal-id="${ids.child}"]`)?.classList.contains("done");
      const storeChild = window.AcademicGoalStore.getGoals(ids.yearId, ids.periodId).find((g) => g.id === ids.parent)?.children[0];
      return { parentDone, childDone, storeChildDone: storeChild?.done };
    }, ids);
    assert.equal(after.parentDone, false);
    assert.equal(after.childDone, false, "unchecking a done parent must cascade to un-check its children too");
    assert.equal(after.storeChildDone, false);
  } finally {
    await close();
  }
});

test("practice/study/vongole/exercise tabs reflect data changed while the tab wasn't active — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    // Simulates a live cross-device sync update: a raw store write with no
    // UI-triggered re-render, while still sitting on the dashboard tab —
    // these 4 tabs used to only ever render once, at app startup, with no
    // onShow hook to catch up on navigation like schedule/ledger/routine/
    // settings already had.
    const needles = await page.evaluate(() => {
      window.PracticeCurriculumStore.addGoal(null, "실시간동기화테스트-연습");
      window.AcademicGoalStore.addYear("실시간동기화테스트-학업");
      window.VongoleRecipeStore.add({ title: "실시간동기화테스트-봉골레", content: "" });
      window.BodyPartStore.add("실시간동기화테스트-운동");
      return {
        practice: "실시간동기화테스트-연습",
        study: "실시간동기화테스트-학업",
        vongole: "실시간동기화테스트-봉골레",
        exercise: "실시간동기화테스트-운동",
      };
    });

    for (const [view, needle] of Object.entries(needles)) {
      await page.evaluate((v) => document.querySelector(`[data-view="${v}"]`)?.click(), view);
      await page.waitForTimeout(200);
      const bodyText = await page.evaluate((v) => document.getElementById(`view-${v}`)?.textContent || "", view);
      assert.ok(bodyText.includes(needle), `${view} tab should show "${needle}" on its first render after the data changed off-tab`);
    }
  } finally {
    await close();
  }
});

test("exercise: an invalid running-pace format is rejected without blocking the other fields — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => document.querySelector('[data-view="exercise"]')?.click());
    await page.waitForTimeout(150);

    await page.fill("#exerciseRecordRunPaceInput", "notapace");
    await page.locator("#exerciseRecordRunPaceInput").blur();
    await page.waitForTimeout(150);
    assert.notEqual(await page.inputValue("#exerciseRecordRunPaceInput"), "notapace");

    // A bad value left sitting in the pace field must not block saving a
    // completely unrelated field that shares the same "change" handler.
    await page.fill("#exerciseRecordRunDistanceInput", "5");
    await page.locator("#exerciseRecordRunDistanceInput").blur();
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.ExerciseRecordStore.get().runDistance), "5");

    await page.fill("#exerciseRecordRunPaceInput", "5'30\"");
    await page.locator("#exerciseRecordRunPaceInput").blur();
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.ExerciseRecordStore.get().runPace), "5'30\"");
  } finally {
    await close();
  }
});

test("ledger/schedule: repeated '+' clicks on new-category number the placeholder instead of duplicating it — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => document.querySelector('[data-view="settings"]')?.click());
    await page.waitForTimeout(150);
    await page.click("#addScheduleCategoryBtn");
    await page.waitForTimeout(100);
    await page.click("#addScheduleCategoryBtn");
    await page.waitForTimeout(100);
    const scheduleLabels = await page.evaluate(() => window.CategoryStore.getAll().map((c) => c.label));
    assert.ok(scheduleLabels.includes("새 카테고리"));
    assert.ok(scheduleLabels.includes("새 카테고리 2"));

    await page.evaluate(() => document.querySelector('[data-view="ledger"]')?.click());
    await page.waitForTimeout(150);
    await page.evaluate(() => { document.getElementById("ledgerCategoryModalOverlay").hidden = false; });
    await page.click("#addLedgerExpenseCategoryBtn");
    await page.waitForTimeout(100);
    await page.click("#addLedgerExpenseCategoryBtn");
    await page.waitForTimeout(100);
    const ledgerLabels = await page.evaluate(() => window.LedgerCategoryStore.getByType("expense").map((c) => c.label));
    assert.ok(ledgerLabels.includes("새 카테고리"));
    assert.ok(ledgerLabels.includes("새 카테고리 2"));
  } finally {
    await close();
  }
});

test("practice: dragging a goal onto a row under a different parent shows no drop indicator — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => document.querySelector('[data-view="practice"]')?.click());
    await page.waitForTimeout(150);

    const result = await page.evaluate(async () => {
      localStorage.setItem("assistant.practiceCurriculum.v1", JSON.stringify([
        { id: "gA", label: "A", done: false, children: [{ id: "gA1", label: "A1", done: false, children: [] }] },
        { id: "gB", label: "B", done: false, children: [] },
      ]));
      // A direct localStorage write like the one above bypasses
      // CurriculumStore's own save(), which is the only thing that normally
      // keeps its in-memory cache in sync — the storage event that would
      // catch this doesn't fire on the same document that made the write,
      // so the cache has to be invalidated explicitly here, same as
      // settings.js's backup import does for a real direct write.
      window.__resetStoreCaches.forEach((reset) => reset());
      window.PracticeView.onShow();
      await new Promise((r) => setTimeout(r, 50));

      const rowFor = (id) => document.querySelector(`.goal-item-row[data-goal-id="${id}"]`);
      const a1 = rowFor("gA1");
      const b = rowFor("gB");

      function simulateDragOver(draggedRow, draggedId, targetRow) {
        const start = new Event("dragstart", { bubbles: true, cancelable: true });
        start.dataTransfer = { setData: () => {}, effectAllowed: "" };
        draggedRow.dispatchEvent(start);

        const rect = targetRow.getBoundingClientRect();
        const over = new Event("dragover", { bubbles: true, cancelable: true });
        over.dataTransfer = { setData: () => {}, getData: () => draggedId };
        Object.defineProperty(over, "clientY", { value: rect.top + rect.height / 2 });
        targetRow.dispatchEvent(over);
        return targetRow.classList.contains("drag-over-before") || targetRow.classList.contains("drag-over-after");
      }

      const crossParent = simulateDragOver(a1, "gA1", b); // gA1's parent is gA, gB's parent is null
      const sameParent = simulateDragOver(rowFor("gA"), "gA", b); // both top-level siblings
      return { crossParent, sameParent };
    });

    assert.equal(result.crossParent, false);
    assert.equal(result.sameParent, true);
  } finally {
    await close();
  }
});

test("ledger: an amount typed past the upper bound clamps instead of saving an unbounded number — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => document.querySelector('[data-view="ledger"]')?.click());
    await page.waitForTimeout(150);
    await page.click("#addLedgerEntryBtn");
    await page.waitForTimeout(150);

    await page.fill(".ledger-row-amount", "9999999999999"); // 13 digits, past the 999,999,999,999 cap
    await page.waitForTimeout(100);
    assert.equal(await page.inputValue(".ledger-row-amount"), "999,999,999,999");
  } finally {
    await close();
  }
});

test("schedule: only ★4+ items get a title chip on the month calendar, lower-importance items just get a dot", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const catKey = await page.evaluate(() => window.CategoryStore.getAll()[0].key);
    await page.evaluate((catKey) => {
      window.ScheduleStore.add({ title: "중요 회의", date: "2026-08-04", repeat: { type: "none" }, importance: 5, category: catKey });
      window.ScheduleStore.add({ title: "가벼운 약속", date: "2026-08-04", repeat: { type: "none" }, importance: 2, category: catKey });
    }, catKey);

    await page.evaluate(() => document.querySelector('[data-view="schedule"]')?.click());
    await page.waitForTimeout(300);

    const cell = await page.evaluate(() => {
      const cells = [...document.querySelectorAll("#calendarGrid .calendar-day")];
      const cell4 = cells.find((c) => c.querySelector(".day-number")?.textContent === "4");
      return {
        chipText: cell4?.querySelector(".calendar-day-event-chip")?.textContent || null,
        hasDot: !!cell4?.querySelector(".calendar-day-top .dot"),
      };
    });
    assert.equal(cell.chipText, "중요 회의");
    assert.equal(cell.hasDot, true);
  } finally {
    await close();
  }
});

test("dashboard: a multi-day schedule shows as one row in 다가오는 일정, not once per day — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const catKey = await page.evaluate(() => window.CategoryStore.getAll()[0].key);
    await page.evaluate((catKey) => {
      const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2);
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 4);
      window.ScheduleStore.add({
        title: "멀티데이 일정",
        date: fmt(start),
        endDate: fmt(end),
        repeat: { type: "none" },
        importance: 5,
        category: catKey,
      });
    }, catKey);

    await page.evaluate(() => document.querySelector('[data-view="dashboard"]')?.click());
    await page.waitForTimeout(300);

    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("#dashboardUpcomingList .schedule-item")].map(
        (li) => li.querySelector(".schedule-item-title")?.textContent || ""
      )
    );
    assert.equal(rows.length, 1);
    assert.ok(rows[0].includes("~"), "a multi-day item's badge should show its full date range, not a single day");
  } finally {
    await close();
  }
});

test("ledger: the month calendar shows that day's expense/income totals — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => {
      const expCat = window.LedgerCategoryStore.getByType("expense")[0].key;
      const incCat = window.LedgerCategoryStore.getByType("income")[0].key;
      window.LedgerEntryStore.add({ date: "2026-08-04", amount: 15000, categoryKey: expCat, type: "expense" });
      window.LedgerEntryStore.add({ date: "2026-08-04", amount: 2000000, categoryKey: incCat, type: "income" });
    });

    await page.evaluate(() => document.querySelector('[data-view="ledger"]')?.click());
    await page.waitForTimeout(300);

    const cellText = await page.evaluate(() => {
      const cells = [...document.querySelectorAll("#ledgerCalendarGrid .calendar-day")];
      const cell4 = cells.find((c) => c.querySelector(".day-number")?.textContent === "4");
      return cell4?.querySelector(".ledger-calendar-day-amounts")?.textContent || "";
    });
    assert.ok(cellText.includes("1.5만"), `expected the expense total in the cell, got "${cellText}"`);
    assert.ok(cellText.includes("200만"), `expected the income total in the cell, got "${cellText}"`);
  } finally {
    await close();
  }
});

test("schedule/ledger/routine: onShow does a full data refresh, not just a layout re-fit — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    // Regression for onShow previously being wired to only the calendar's
    // responsive-layout-fit function (applyScheduleCalendarFit /
    // applyLedgerCalendarFit / checkResponsiveCalendarLayout), so data
    // written while the tab wasn't active never appeared without a full
    // page reload — same class of bug already fixed for practice/study/
    // vongole/exercise, just missed here since these 3 already had *some*
    // onShow.
    await page.evaluate(() => {
      const catKey = window.CategoryStore.getAll()[0].key;
      window.ScheduleStore.add({ title: "실시간동기화테스트-일정", date: "2026-08-04", repeat: { type: "none" }, importance: 5, category: catKey });
      const expCat = window.LedgerCategoryStore.getByType("expense")[0].key;
      window.LedgerEntryStore.add({ date: "2026-08-04", amount: 12345, categoryKey: expCat, type: "expense" });
    });

    await page.evaluate(() => document.querySelector('[data-view="schedule"]')?.click());
    await page.waitForTimeout(250);
    const scheduleShows = await page.evaluate(() =>
      document.getElementById("view-schedule").textContent.includes("실시간동기화테스트-일정")
    );
    assert.ok(scheduleShows, "schedule tab should show data added while it wasn't active");

    await page.evaluate(() => document.querySelector('[data-view="ledger"]')?.click());
    await page.waitForTimeout(250);
    const ledgerShows = await page.evaluate(() => document.getElementById("view-ledger").textContent.includes("12,345"));
    assert.ok(ledgerShows, "ledger tab should show data added while it wasn't active");
  } finally {
    await close();
  }
});

test("schedule modal: the category color dot tracks the selected category", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => document.querySelector('[data-view="schedule"]')?.click());
    await page.waitForTimeout(200);
    await page.evaluate(() => window.ScheduleView.openAddModal());
    await page.waitForTimeout(200);

    const cats = await page.evaluate(() => window.CategoryStore.getAll());
    const initialColor = await page.evaluate(() => getComputedStyle(document.getElementById("scheduleCategoryDot")).backgroundColor);

    await page.selectOption("#scheduleCategoryInput", cats[cats.length - 1].key);
    await page.waitForTimeout(100);
    const changedColor = await page.evaluate(() => getComputedStyle(document.getElementById("scheduleCategoryDot")).backgroundColor);

    assert.notEqual(changedColor, initialColor);
  } finally {
    await close();
  }
});

test("modals: every add/edit modal has a working top-right close button", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => document.querySelector('[data-view="schedule"]')?.click());
    await page.waitForTimeout(150);
    await page.evaluate(() => window.ScheduleView.openAddModal());
    await page.waitForTimeout(150);
    await page.click("#closeScheduleModalBtn");
    await page.waitForTimeout(220); // modal close now plays a ~150ms exit animation before hidden actually flips
    assert.equal(await page.evaluate(() => document.getElementById("scheduleModalOverlay").hidden), true);

    await page.evaluate(() => document.querySelector('[data-view="practice"]')?.click());
    await page.waitForTimeout(150);
    await page.click("#addPracticeBtn");
    await page.waitForTimeout(150);
    await page.click("#closePracticeModalBtn");
    await page.waitForTimeout(220); // modal close now plays a ~150ms exit animation before hidden actually flips
    assert.equal(await page.evaluate(() => document.getElementById("practiceModalOverlay").hidden), true);

    await page.evaluate(() => document.querySelector('[data-view="vongole"]')?.click());
    await page.waitForTimeout(150);
    await page.click("#addVongoleLogBtn");
    await page.waitForTimeout(150);
    await page.click("#closeVongoleLogModalBtn");
    await page.waitForTimeout(220); // modal close now plays a ~150ms exit animation before hidden actually flips
    assert.equal(await page.evaluate(() => document.getElementById("vongoleLogModalOverlay").hidden), true);

    await page.evaluate(() => document.querySelector('[data-view="ledger"]')?.click());
    await page.waitForTimeout(150);
    await page.click("#addLedgerEntryBtn");
    await page.waitForTimeout(150);
    await page.click("#closeLedgerModalBtn");
    await page.waitForTimeout(220); // modal close now plays a ~150ms exit animation before hidden actually flips
    assert.equal(await page.evaluate(() => document.getElementById("ledgerModalOverlay").hidden), true);

    await page.evaluate(() => { document.getElementById("ledgerCategoryModalOverlay").hidden = false; });
    await page.waitForTimeout(150);
    await page.click("#closeLedgerCategoryModalTopBtn");
    await page.waitForTimeout(220); // modal close now plays a ~150ms exit animation before hidden actually flips
    assert.equal(await page.evaluate(() => document.getElementById("ledgerCategoryModalOverlay").hidden), true);
  } finally {
    await close();
  }
});

test("practice: deleting a parent goal's last child resets its stale derived done state — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const result = await page.evaluate(() => {
      const store = window.PracticeCurriculumStore;
      const parent = store.addGoal(null, "부모 목표");
      const child = store.addGoal(parent.id, "자식 목표");
      store.toggleDone(child.id); // cascades parent.done = true (all children done)
      const beforeRemove = store.getGoals().find((g) => g.id === parent.id);
      store.removeGoal(child.id); // parent loses its only (and now derived-done) child
      const afterRemove = store.getGoals().find((g) => g.id === parent.id);
      return { beforeDone: beforeRemove.done, afterChildCount: afterRemove.children.length, afterDone: afterRemove.done };
    });
    assert.equal(result.beforeDone, true);
    assert.equal(result.afterChildCount, 0);
    assert.equal(result.afterDone, false);
  } finally {
    await close();
  }
});

test("study: deleting a goal's last child resets its stale derived done state — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const result = await page.evaluate(() => {
      const store = window.AcademicGoalStore;
      const year = store.addYear("2026");
      const periodId = store.getPeriods(year.id)[0].id;
      const parent = store.addGoal(year.id, periodId, null, "부모 목표");
      const child = store.addGoal(year.id, periodId, parent.id, "자식 목표");
      store.toggleDone(year.id, periodId, child.id);
      const beforeRemove = store.getGoals(year.id, periodId).find((g) => g.id === parent.id);
      store.removeGoal(year.id, periodId, child.id);
      const afterRemove = store.getGoals(year.id, periodId).find((g) => g.id === parent.id);
      return { beforeDone: beforeRemove.done, afterChildCount: afterRemove.children.length, afterDone: afterRemove.done };
    });
    assert.equal(result.beforeDone, true);
    assert.equal(result.afterChildCount, 0);
    assert.equal(result.afterDone, false);
  } finally {
    await close();
  }
});

test("settings: importing a backup file whose top-level JSON isn't an object shows an error instead of crashing — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => document.querySelector('[data-view="settings"]')?.click());
    await page.waitForTimeout(150);

    const errorShown = await page.evaluate(async () => {
      const file = new File([JSON.stringify(null)], "backup.json", { type: "application/json" });
      let shown = false;
      const originalShow = window.Toast.show;
      window.Toast.show = (msg, opts) => {
        if (msg.includes("올바른 백업 파일이 아니에요")) shown = true;
        return originalShow(msg, opts);
      };
      document.getElementById("importDataInput").files = (() => {
        const dt = new DataTransfer();
        dt.items.add(file);
        return dt.files;
      })();
      document.getElementById("importDataInput").dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      window.Toast.show = originalShow;
      return shown;
    });
    assert.equal(errorShown, true);
  } finally {
    await close();
  }
});

test("settings: an overwrite-mode import requires a confirm click before applying — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const catKey = await page.evaluate(() => window.CategoryStore.getAll()[0].key);
    await page.evaluate((catKey) => {
      window.ScheduleStore.add({ title: "덮어쓰기전일정", date: "2026-08-05", repeat: { type: "none" }, category: catKey });
    }, catKey);

    await page.evaluate(() => document.querySelector('[data-view="settings"]')?.click());
    await page.waitForTimeout(150);

    const result = await page.evaluate(async () => {
      document.getElementById("importMergeInput").checked = false; // overwrite mode
      const backup = { "assistant.schedules.v1": JSON.stringify([]) };
      const file = new File([JSON.stringify(backup)], "backup.json", { type: "application/json" });
      document.getElementById("importDataInput").files = (() => {
        const dt = new DataTransfer();
        dt.items.add(file);
        return dt.files;
      })();
      document.getElementById("importDataInput").dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      // Nothing should have applied yet — still just the confirm toast.
      const beforeConfirm = window.ScheduleStore.getAll().length;
      const toastText = [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | ");
      document.querySelector(".toast-action")?.click();
      await new Promise((r) => setTimeout(r, 200));
      const afterConfirm = window.ScheduleStore.getAll().length;
      return { beforeConfirm, toastText, afterConfirm };
    });

    assert.equal(result.beforeConfirm, 1, "import must not apply until the user confirms");
    assert.ok(result.toastText.includes("덮어써요"), "expected a warning toast about the destructive overwrite");
    assert.equal(result.afterConfirm, 0, "confirming should apply the overwrite (backup had zero schedules)");
  } finally {
    await close();
  }
});

test("settings: picking a second (merge) file dismisses an earlier unconfirmed overwrite's confirm toast — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const catKey = await page.evaluate(() => window.CategoryStore.getAll()[0].key);
    await page.evaluate((catKey) => {
      window.ScheduleStore.add({ title: "원래일정", date: "2026-08-05", repeat: { type: "none" }, category: catKey });
    }, catKey);

    await page.evaluate(() => document.querySelector('[data-view="settings"]')?.click());
    await page.waitForTimeout(150);

    const result = await page.evaluate(async () => {
      const pickFile = (backup) => {
        const file = new File([JSON.stringify(backup)], "backup.json", { type: "application/json" });
        document.getElementById("importDataInput").files = (() => {
          const dt = new DataTransfer();
          dt.items.add(file);
          return dt.files;
        })();
        document.getElementById("importDataInput").dispatchEvent(new Event("change", { bubbles: true }));
      };

      // File A: overwrite mode, would wipe schedules — left UNCONFIRMED.
      // Backup files store PARSED values (see settings.js exportData's
      // `data[key] = JSON.parse(...)`), not pre-stringified JSON strings.
      document.getElementById("importMergeInput").checked = false;
      pickFile({ "assistant.schedules.v1": [] });
      await new Promise((r) => setTimeout(r, 200));

      // File B: merge mode, adds a second schedule — applies immediately.
      document.getElementById("importMergeInput").checked = true;
      pickFile({ "assistant.schedules.v1": [{ id: "sc_merged", title: "병합된일정", date: "2026-08-05", repeat: { type: "none" } }] });
      await new Promise((r) => setTimeout(r, 300));

      const afterMerge = window.ScheduleStore.getAll().length;
      // File A's stale confirm toast must be gone — clicking any remaining
      // toast action must NOT re-apply file A's (now stale) empty-schedules
      // overwrite on top of what the merge just produced.
      const staleToastGone = ![...document.querySelectorAll(".toast")].some((t) => t.textContent.includes("덮어써요"));
      document.querySelector(".toast-action")?.click();
      await new Promise((r) => setTimeout(r, 200));
      const afterStaleClick = window.ScheduleStore.getAll().length;
      return { afterMerge, staleToastGone, afterStaleClick };
    });

    assert.equal(result.afterMerge, 2, "merge should add to the existing schedule, not wait for confirmation");
    assert.equal(result.staleToastGone, true, "file A's overwrite-confirm toast must be dismissed once file B was picked");
    assert.equal(result.afterStaleClick, 2, "no stale confirm should be able to wipe what the merge just produced");
  } finally {
    await close();
  }
});

test("practice: Alt+ArrowDown reorders a goal among its siblings via the keyboard — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => {
      const store = window.PracticeCurriculumStore;
      store.addGoal(null, "첫째");
      store.addGoal(null, "둘째");
    });
    await page.evaluate(() => document.querySelector('[data-view="practice"]')?.click());
    await page.waitForTimeout(200);

    const firstRow = page.locator('.goal-item-row', { hasText: "첫째" }).first();
    await firstRow.focus();
    await page.keyboard.down("Alt");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.up("Alt");
    await page.waitForTimeout(150);

    const order = await page.evaluate(() => window.PracticeCurriculumStore.getGoals().map((g) => g.label));
    assert.deepEqual(order, ["둘째", "첫째"]);
  } finally {
    await close();
  }
});

test("study: Alt+ArrowDown reorders a goal among its siblings via the keyboard — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const { yearId, periodId } = await page.evaluate(() => {
      const store = window.AcademicGoalStore;
      const year = store.addYear("2026");
      const periodId = store.getPeriods(year.id)[0].id;
      store.addGoal(year.id, periodId, null, "첫째");
      store.addGoal(year.id, periodId, null, "둘째");
      return { yearId: year.id, periodId };
    });
    await page.evaluate(() => document.querySelector('[data-view="study"]')?.click());
    await page.waitForTimeout(200);

    const firstRow = page.locator('.goal-item-row', { hasText: "첫째" }).first();
    await firstRow.focus();
    await page.keyboard.down("Alt");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.up("Alt");
    await page.waitForTimeout(150);

    const order = await page.evaluate(
      ({ yearId, periodId }) => window.AcademicGoalStore.getGoals(yearId, periodId).map((g) => g.label),
      { yearId, periodId }
    );
    assert.deepEqual(order, ["둘째", "첫째"]);
  } finally {
    await close();
  }
});

test("vongole: a recipe card's header expands/collapses via the keyboard — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => window.VongoleRecipeStore.add({ title: "키보드 테스트 레시피", content: "" }));
    await page.evaluate(() => document.querySelector('[data-view="vongole"]')?.click());
    await page.waitForTimeout(200);

    const header = page.locator(".vongole-recipe-header", { hasText: "키보드 테스트 레시피" });
    await header.focus();
    assert.equal(await header.getAttribute("aria-expanded"), "false");

    await page.keyboard.press("Enter");
    await page.waitForTimeout(100);
    assert.equal(await header.getAttribute("aria-expanded"), "true");
  } finally {
    await close();
  }
});

test("modals: Tab is trapped even when the open modal has zero focusable descendants — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => document.querySelector('[data-view="schedule"]')?.click());
    await page.waitForTimeout(150);
    await page.evaluate(() => window.ScheduleView.openAddModal());
    await page.waitForTimeout(150);

    // Strip every focusable descendant to simulate a modal caught in a
    // moment with nothing focusable in it (e.g. #authGate's loading state).
    await page.evaluate(() => {
      document.querySelectorAll("#scheduleModalOverlay input, #scheduleModalOverlay button, #scheduleModalOverlay select, #scheduleModalOverlay textarea")
        .forEach((el) => el.remove());
    });
    await page.evaluate(() => document.getElementById("scheduleModalOverlay").focus());
    await page.keyboard.press("Tab");
    await page.waitForTimeout(50);

    const trapped = await page.evaluate(() => document.activeElement === document.getElementById("scheduleModalOverlay"));
    assert.equal(trapped, true);
  } finally {
    await close();
  }
});

test("modals: Tab traps within the most-recently-opened modal, not whichever is first in DOM order — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    // scheduleModalOverlay comes before practiceModalOverlay in DOM order —
    // force both "open" and confirm Tab traps in the one opened LAST.
    await page.evaluate(() => {
      document.getElementById("scheduleModalOverlay").hidden = false;
    });
    await page.waitForTimeout(30);
    await page.evaluate(() => {
      document.getElementById("practiceModalOverlay").hidden = false;
    });
    await page.waitForTimeout(30);

    await page.evaluate(() => document.getElementById("practiceDateInput")?.focus());
    await page.keyboard.press("Tab");
    await page.waitForTimeout(50);

    const stillInPracticeModal = await page.evaluate(() =>
      !!document.activeElement?.closest("#practiceModalOverlay")
    );
    assert.equal(stillInPracticeModal, true);
  } finally {
    await close();
  }
});

test("study: dragging a goal onto a row under a different parent shows no drop indicator — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => document.querySelector('[data-view="study"]')?.click());
    await page.waitForTimeout(150);

    const result = await page.evaluate(async () => {
      const store = window.AcademicGoalStore;
      const year = store.addYear("2026");
      const periodId = store.getPeriods(year.id)[0].id;
      const a = store.addGoal(year.id, periodId, null, "A");
      const a1 = store.addGoal(year.id, periodId, a.id, "A1");
      const b = store.addGoal(year.id, periodId, null, "B");
      window.StudyView.onShow();
      await new Promise((r) => setTimeout(r, 50));

      const rowFor = (id) => document.querySelector(`.goal-item-row[data-goal-id="${id}"]`);
      const a1Row = rowFor(a1.id);
      const bRow = rowFor(b.id);
      const aRow = rowFor(a.id);

      function simulateDragOver(draggedRow, draggedId, targetRow) {
        const start = new Event("dragstart", { bubbles: true, cancelable: true });
        start.dataTransfer = { setData: () => {}, effectAllowed: "" };
        draggedRow.dispatchEvent(start);

        const rect = targetRow.getBoundingClientRect();
        const over = new Event("dragover", { bubbles: true, cancelable: true });
        over.dataTransfer = { setData: () => {}, getData: () => draggedId };
        Object.defineProperty(over, "clientY", { value: rect.top + rect.height / 2 });
        targetRow.dispatchEvent(over);
        return targetRow.classList.contains("drag-over-before") || targetRow.classList.contains("drag-over-after");
      }

      const crossParent = simulateDragOver(a1Row, a1.id, bRow); // a1's parent is A, B's parent is null
      const sameParent = simulateDragOver(aRow, a.id, bRow); // both top-level siblings
      return { crossParent, sameParent };
    });

    assert.equal(result.crossParent, false);
    assert.equal(result.sameParent, true);
  } finally {
    await close();
  }
});

test("study: marking a period as current drives the dashboard's 완료율 bar, un-marking it reverts to 미지정 — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => document.querySelector('[data-view="study"]')?.click());
    await page.waitForTimeout(150);

    const ids = await page.evaluate(() => {
      const store = window.AcademicGoalStore;
      const year = store.addYear("2026테스트");
      const periodId = store.getPeriods(year.id)[0].id;
      const g1 = store.addGoal(year.id, periodId, null, "목표1");
      store.addGoal(year.id, periodId, null, "목표2");
      store.toggleDone(year.id, periodId, g1.id);
      window.StudyView.onShow();
      return { yearId: year.id, periodId };
    });
    await page.waitForTimeout(150);

    // A default year (labeled with the real current year, no "테스트"
    // suffix) is auto-seeded on first-ever load, so a bare "1학기 중간고사"
    // text match could hit that empty period instead of the "2026테스트"
    // one this test just created — scope to the containing year section.
    const yearSection = page.locator(".goal-year-section", { hasText: "2026테스트" });
    const starBtn = yearSection.locator(".goal-period-card", { hasText: "1학기 중간고사" }).locator(".goal-period-current-btn");
    await starBtn.click();
    await page.waitForTimeout(150);

    await page.evaluate(() => document.querySelector('[data-view="dashboard"]')?.click());
    await page.waitForTimeout(200);
    const barText = await page.evaluate(() => document.getElementById("academicRateValue")?.textContent);
    assert.equal(barText, "1/2 · 50%", `expected the marked period's own progress, got "${barText}"`);
    const titleText = await page.evaluate(() => document.getElementById("academicRateTitle")?.textContent);
    assert.ok(titleText.includes("1학기 중간고사"), `title should name the current period, got "${titleText}"`);

    await page.evaluate(() => document.querySelector('[data-view="study"]')?.click());
    await page.waitForTimeout(150);
    await starBtn.click(); // un-mark
    await page.waitForTimeout(150);
    await page.evaluate(() => document.querySelector('[data-view="dashboard"]')?.click());
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.getElementById("academicRateValue")?.textContent), "현재 구간 미지정");
  } finally {
    await close();
  }
});

test("dashboard: the 6 panels fill equal, matching heights and the page needs no scroll when the window is tall enough — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.evaluate(() => document.querySelector('[data-view="dashboard"]')?.click());
    await page.waitForTimeout(300);

    const heights = await page.evaluate(() =>
      [...document.querySelectorAll("#view-dashboard .panel")].map((p) => Math.round(p.getBoundingClientRect().height))
    );
    assert.equal(heights.length, 6);
    assert.ok(heights.every((h) => h === heights[0]), `all 6 panels should be the same height, got ${JSON.stringify(heights)}`);

    const scrollable = await page.evaluate(() => {
      const c = document.querySelector(".content");
      return c.scrollHeight > c.clientHeight + 2;
    });
    assert.equal(scrollable, false, "a tall enough window shouldn't need to scroll to see the whole dashboard");
  } finally {
    await close();
  }
});

test("dashboard: a common laptop viewport height (768px) still avoids scrolling — the actual bug fix", { skip: !RUN }, async () => {
  // A too-conservative minimum panel height floor used to reject fitting
  // at this exact height by fractions of a pixel (the real computed row
  // height came out to 219.5px against a 220px floor), falling all the
  // way back to natural/scrollable sizing even though the window was easily
  // "big enough" by any reasonable read of that phrase — 1366x768 is one
  // of the most common laptop resolutions there is.
  const { page, close } = await launchApp();
  try {
    await page.setViewportSize({ width: 1600, height: 768 });
    await page.evaluate(() => document.querySelector('[data-view="dashboard"]')?.click());
    await page.waitForTimeout(300);

    const scrollable = await page.evaluate(() => {
      const c = document.querySelector(".content");
      return c.scrollHeight > c.clientHeight + 2;
    });
    assert.equal(scrollable, false, "768px tall is a common, clearly-big-enough laptop viewport — it must not need to scroll");
  } finally {
    await close();
  }
});

test("dashboard: narrower windows drop to a 2-column grid (3 rows) and still fit without scrolling when tall enough — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    // Between the 1200px (3->2 columns) and 960px (2->1 column) breakpoints.
    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.evaluate(() => document.querySelector('[data-view="dashboard"]')?.click());
    await page.waitForTimeout(300);

    const columns = await page.evaluate(
      () => getComputedStyle(document.querySelector("#view-dashboard .grid")).gridTemplateColumns.split(" ").length
    );
    assert.equal(columns, 2, "1100px should be in the 2-column tier");

    const heights = await page.evaluate(() =>
      [...document.querySelectorAll("#view-dashboard .panel")].map((p) => Math.round(p.getBoundingClientRect().height))
    );
    assert.ok(heights.every((h) => h === heights[0]), `all 6 panels should still be equal height in 3-row layout, got ${JSON.stringify(heights)}`);

    const scrollable = await page.evaluate(() => {
      const c = document.querySelector(".content");
      return c.scrollHeight > c.clientHeight + 2;
    });
    assert.equal(scrollable, false, "a tall enough window in the 2-column tier shouldn't need to scroll either");
  } finally {
    await close();
  }
});

test("dashboard: a cold page load re-fits the grid after the profile greeting appears, not just once before it — the actual bug fix", { skip: !RUN }, async () => {
  // The very first setActiveView("dashboard") call (bottom of main.js) runs
  // synchronously before initFeatures() has run any view's init() at all —
  // including SettingsView's, whose applyProfile() un-hides
  // #dashboardGreeting for a signed-in user with a profile name set. That
  // first fit was computed while the greeting was still in its default
  // hidden state, so the grid was sized as if that extra row of text
  // didn't exist, and nothing re-measured afterward to correct it — this
  // only reproduces on an actual cold load (page.reload()), not a plain
  // tab switch, since __featuresInitialized guards initFeatures() to once.
  const { page, close } = await launchApp();
  try {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.evaluate(() => window.SettingsStore.update({ profileName: "테스트유저" }));
    await page.reload();
    await bypassAuthGate(page);
    await page.waitForTimeout(300);

    const info = await page.evaluate(() => {
      const c = document.querySelector(".content");
      const greeting = document.getElementById("dashboardGreeting");
      const heights = [...document.querySelectorAll("#view-dashboard .panel")].map((p) =>
        Math.round(p.getBoundingClientRect().height)
      );
      return {
        greetingVisible: !greeting.hidden,
        scrollable: c.scrollHeight > c.clientHeight + 2,
        allEqual: heights.every((h) => h === heights[0]),
      };
    });
    assert.equal(info.greetingVisible, true, "the greeting should actually be showing for this test to mean anything");
    assert.equal(info.scrollable, false, "the dashboard must still fit without scrolling once the greeting's height is accounted for");
    assert.equal(info.allEqual, true, "the 6 panels must still be equal height, not sized against the pre-greeting measurement");
  } finally {
    await close();
  }
});

test("vongole: adding a recipe while a filter is active also refreshes the other section and the attempt log — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => {
      window.VongoleRecipeStore.add({ title: "필터에 안 걸리는 레시피", content: "" });
      window.VongoleLogStore.add({ date: "2026-08-01", recipe: "필터에 안 걸리는 시도", comment: "" });
    });
    await page.evaluate(() => document.querySelector('[data-view="vongole"]')?.click());
    await page.waitForTimeout(150);

    // Filter down to something that matches nothing, so the collected-
    // recipe section and the attempt log both render their "no results"
    // empty state before the add.
    await page.fill("#vongoleFilterInput", "존재하지않는검색어");
    await page.waitForTimeout(150);

    await page.click("#addVongoleCollectedRecipeBtn");
    await page.waitForTimeout(150);

    const successSectionText = await page.evaluate(() => document.getElementById("vongoleRecipeList")?.textContent || "");
    const logText = await page.evaluate(() => document.getElementById("vongoleLogFeed")?.textContent || "");
    assert.ok(successSectionText.includes("필터에 안 걸리는 레시피"), "the other (success) section should refresh too");
    assert.ok(logText.includes("필터에 안 걸리는 시도"), "the attempt log should refresh too");
  } finally {
    await close();
  }
});

test("toast: repeated identical messages replace the previous one instead of stacking up — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const count = await page.evaluate(() => {
      window.Toast.show("같은 메시지");
      window.Toast.show("같은 메시지");
      window.Toast.show("같은 메시지");
      return document.querySelectorAll(".toast").length;
    });
    assert.equal(count, 1);
  } finally {
    await close();
  }
});

test("toast: duration: 0 means never auto-dismiss instead of falling back to the default — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => window.Toast.show("계속 떠 있어야 함", { duration: 0 }));
    await page.waitForTimeout(4500); // past the normal 4s default
    const stillThere = await page.evaluate(() =>
      [...document.querySelectorAll(".toast-text")].some((el) => el.textContent === "계속 떠 있어야 함")
    );
    assert.equal(stillThere, true);
  } finally {
    await close();
  }
});

test("practice: the progress percentage only counts leaf goals, not derived-done parents — the actual bug fix", { skip: !RUN }, async () => {
  // root has children A (2 leaves, both done -> A itself reads done) and B
  // (2 leaves, 1 done). Real leaf completion is 3/4 = 75%. Counting the
  // intermediate A/B/root nodes as extra tasks used to compute 4/7 ≈ 57%.
  const { page, close } = await launchApp();
  try {
    const rootId = await page.evaluate(() => {
      const store = window.PracticeCurriculumStore;
      const root = store.addGoal(null, "루트");
      const a = store.addGoal(root.id, "A");
      const a1 = store.addGoal(a.id, "a1");
      const a2 = store.addGoal(a.id, "a2");
      const b = store.addGoal(root.id, "B");
      const b1 = store.addGoal(b.id, "b1");
      store.addGoal(b.id, "b2"); // left undone
      store.toggleDone(a1.id);
      store.toggleDone(a2.id);
      store.toggleDone(b1.id);
      return root.id;
    });
    await page.evaluate(() => document.querySelector('[data-view="practice"]')?.click());
    await page.waitForTimeout(200);

    const text = await page.evaluate(
      (id) => document.querySelector(`.goal-item-row[data-goal-id="${id}"] .goal-item-progress`)?.textContent,
      rootId
    );
    assert.equal(text, "3/4 (75%)");
  } finally {
    await close();
  }
});

test("exercise: the top-of-tab summary lists every body part's days-since-last-worked, most overdue first — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => {
      const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      window.ExerciseLogStore.add({ date: fmt(threeDaysAgo), bodyPart: "chest" });
      window.ExerciseLogStore.add({ date: fmt(tenDaysAgo), bodyPart: "back" });
    });
    await page.evaluate(() => document.querySelector('[data-view="exercise"]')?.click());
    await page.waitForTimeout(200);

    const chips = await page.evaluate(() =>
      [...document.querySelectorAll("#exerciseLastWorkedSummary .exercise-last-worked-chip")].map((c) => ({
        label: c.querySelector(".exercise-last-worked-chip-label")?.textContent,
        value: c.querySelector(".exercise-last-worked-chip-value")?.textContent,
      }))
    );
    // Every default body part shows up, not just ones with a 배운 운동 group.
    assert.equal(chips.length, 6);
    // Longest-idle first: 등 (10일 전) ahead of 가슴 (3일 전), both ahead of
    // any never-logged body part.
    assert.equal(chips[0].label, "등");
    assert.equal(chips[0].value, "10일 전");
    assert.equal(chips[1].label, "가슴");
    assert.equal(chips[1].value, "3일 전");
    assert.ok(chips.slice(2).every((c) => c.value === "기록 없음"));
  } finally {
    await close();
  }
});

test("exercise: days-since-last-worked turns orange at 7 days and red at 14, on both the tab chips and the dashboard panel — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => {
      const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const daysAgo = (n) => {
        const d = new Date();
        d.setDate(d.getDate() - n);
        return fmt(d);
      };
      window.ExerciseLogStore.add({ date: daysAgo(5), bodyPart: "chest" }); // under 7: no warning
      window.ExerciseLogStore.add({ date: daysAgo(7), bodyPart: "back" }); // exactly 7: orange
      window.ExerciseLogStore.add({ date: daysAgo(14), bodyPart: "leg" }); // exactly 14: red
    });
    await page.evaluate(() => document.querySelector('[data-view="exercise"]')?.click());
    await page.waitForTimeout(200);

    const chipLevels = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll("#exerciseLastWorkedSummary .exercise-last-worked-chip")].map((c) => [
          c.querySelector(".exercise-last-worked-chip-label")?.textContent,
          c.querySelector(".exercise-last-worked-chip-value")?.className,
        ])
      )
    );
    assert.ok(!chipLevels["가슴"].includes("overdue"), `5 days shouldn't be flagged, got "${chipLevels["가슴"]}"`);
    assert.ok(chipLevels["등"].includes("overdue-warning"), `7 days should be orange, got "${chipLevels["등"]}"`);
    assert.ok(chipLevels["하체"].includes("overdue-critical"), `14 days should be red, got "${chipLevels["하체"]}"`);

    await page.evaluate(() => document.querySelector('[data-view="dashboard"]')?.click());
    await page.waitForTimeout(200);
    const dashboardLevels = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll("#dashboardExerciseBodyPartStatus .practice-status-row")].map((row) => [
          row.querySelector("strong")?.textContent,
          row.querySelector("span")?.className,
        ])
      )
    );
    assert.ok(!dashboardLevels["가슴"].includes("overdue"), "same thresholds must apply on the dashboard");
    assert.ok(dashboardLevels["등"].includes("overdue-warning"));
    assert.ok(dashboardLevels["하체"].includes("overdue-critical"));
  } finally {
    await close();
  }
});

test("exercise: 부위별 운동 루틴's textarea keeps line breaks the old single-line input couldn't — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => document.querySelector('[data-view="exercise"]')?.click());
    await page.waitForTimeout(200);

    const tagName = await page.evaluate(() => document.querySelector(".body-part-routine-input")?.tagName);
    assert.equal(tagName, "TEXTAREA", "the routine field must be a textarea, not a single-line input");

    const routineInput = page.locator(".body-part-routine-row", { hasText: "가슴" }).locator(".body-part-routine-input");
    await routineInput.fill("벤치프레스 3세트\n딥스 3세트");
    await routineInput.evaluate((el) => el.dispatchEvent(new Event("change")));
    await page.waitForTimeout(100);

    const chestKey = await page.evaluate(() => window.BodyPartStore.getAll().find((p) => p.label === "가슴")?.key);
    const saved = await page.evaluate((key) => window.BodyPartRoutineStore.get(key), chestKey);
    assert.equal(saved, "벤치프레스 3세트\n딥스 3세트", "the line break must survive the save, not get collapsed/stripped");
  } finally {
    await close();
  }
});

test("exercise: 부위별 운동 루틴's textarea grows to fit its content instead of scrolling internally — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => {
      window.BodyPartRoutineStore.update(
        "chest",
        "벤치프레스 3세트\n인클라인 벤치프레스 3세트\n딥스 3세트\n케이블 크로스오버 3세트\n푸시업 마무리 세트"
      );
    });
    await page.evaluate(() => document.querySelector('[data-view="exercise"]')?.click());
    await page.waitForTimeout(200);

    const chestTextarea = page.locator(".body-part-routine-row", { hasText: "가슴" }).locator(".body-part-routine-input");
    const rendered = await chestTextarea.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    assert.ok(
      rendered.clientHeight >= rendered.scrollHeight,
      `a multi-line routine shouldn't need internal scroll, got clientHeight ${rendered.clientHeight} < scrollHeight ${rendered.scrollHeight}`
    );

    // Also grows live as more lines are typed in, not just on initial render.
    await chestTextarea.evaluate((el) => (el.value = "한 줄"));
    await chestTextarea.fill("첫줄\n둘째줄\n셋째줄\n넷째줄\n다섯째줄\n여섯째줄");
    await page.waitForTimeout(100);
    const afterTyping = await chestTextarea.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    assert.ok(afterTyping.clientHeight >= afterTyping.scrollHeight, "typing more lines in should grow the box too, live");
  } finally {
    await close();
  }
});

test("exercise: the calendar button opens a 3-week view with logged days marked green, deletable by clicking the body part — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.evaluate(() => {
      const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      window.ExerciseLogStore.add({ date: fmt(new Date()), bodyPart: "chest" });
    });
    await page.evaluate(() => document.querySelector('[data-view="exercise"]')?.click());
    await page.waitForTimeout(200);

    // The old flat log list is gone entirely — the calendar is the only
    // place a logged entry shows now.
    assert.equal(await page.locator("#exerciseLogList").count(), 0);

    await page.click("#exerciseLogCalendarBtn");
    await page.waitForTimeout(200);

    const todayCell = await page.evaluate(() => {
      const cell = document.querySelector(".exercise-log-calendar-grid .calendar-day.today");
      return {
        hasGreenDate: !!cell?.querySelector(".day-number.has-log"),
        partText: cell?.querySelector(".exercise-log-calendar-day-part")?.textContent,
      };
    });
    assert.equal(todayCell.hasGreenDate, true, "a logged day's date number should get the green .has-log class");
    assert.equal(todayCell.partText, "가슴");

    // Clicking the body part removes that day's entry.
    await page.click(".exercise-log-calendar-day-part");
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.ExerciseLogStore.getAll().length), 0);
    assert.equal(await page.locator(".exercise-log-calendar-day-part").count(), 0);

    // Undo brings it back and re-renders the calendar with it.
    await page.click(".toast-action");
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.ExerciseLogStore.getAll().length), 1);
    assert.equal(await page.locator(".exercise-log-calendar-day-part").textContent(), "가슴");
  } finally {
    await close();
  }
});

test("exercise: pre-existing free-text 부위 data migrates to real BodyPartStore keys, and stays usable — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    // Simulates data saved before 부위 became a managed category — the old
    // free-text input stored the label directly, not a key.
    await page.evaluate(() => {
      localStorage.setItem("assistant.exerciseLog.v1", JSON.stringify([
        { id: "exlog_old1", date: "2026-08-01", bodyPart: "가슴" },
        { id: "exlog_old2", date: "2026-08-02", bodyPart: "커스텀부위" },
      ]));
      localStorage.setItem("assistant.bodyPartRoutines.v1", JSON.stringify({ "가슴": "벤치프레스 3세트" }));
    });
    await page.reload();
    await bypassAuthGate(page);

    const result = await page.evaluate(() => {
      const parts = window.BodyPartStore.getAll();
      const logs = window.ExerciseLogStore.getAll();
      const chestPart = parts.find((p) => p.label === "가슴");
      const customPart = parts.find((p) => p.label === "커스텀부위");
      return {
        customPartCreated: !!customPart,
        chestLogMigrated: logs.find((l) => l.id === "exlog_old1")?.bodyPart === chestPart?.key,
        customLogMigrated: logs.find((l) => l.id === "exlog_old2")?.bodyPart === customPart?.key,
        routineMigrated: chestPart ? window.BodyPartRoutineStore.get(chestPart.key) : null,
      };
    });

    assert.equal(result.customPartCreated, true, "a non-default label must get its own new BodyPartStore entry");
    assert.equal(result.chestLogMigrated, true, "a label matching a default body part must reuse its key");
    assert.equal(result.customLogMigrated, true, "a custom label's log entries must migrate to its new key too");
    assert.equal(result.routineMigrated, "벤치프레스 3세트", "BodyPartRoutineStore must be re-keyed, not left keyed by the old label");

    // Renaming the migrated body part must update the label everywhere it's
    // used — the whole point of migrating to a real key instead of a string.
    await page.evaluate(() => document.querySelector('[data-view="exercise"]')?.click());
    await page.waitForTimeout(200);
    await page.click("#exerciseBodyPartManageBtn");
    await page.waitForTimeout(150);
    const chestInput = await page.evaluateHandle(() => {
      const inputs = [...document.querySelectorAll("#exerciseBodyPartManagerList input")];
      return inputs.find((el) => el.value === "가슴");
    });
    await chestInput.asElement().fill("가슴근육");
    await chestInput.asElement().evaluate((el) => el.blur());
    await page.waitForTimeout(150);

    const routineLabels = await page.evaluate(() =>
      [...document.querySelectorAll(".body-part-routine-label")].map((el) => el.textContent)
    );
    assert.ok(routineLabels.includes("가슴근육"), `expected "가슴근육" in the routine list after rename, got: ${routineLabels}`);
    assert.ok(!routineLabels.includes("가슴"), "the old label must not still be showing after the rename");
  } finally {
    await close();
  }
});

test("routine: undoing a deleted checklist item restores its completion history too, not just the item itself — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const itemId = await page.evaluate(() => {
      const item = window.RoutineStore.addItem("routine", "물 마시기");
      window.RoutineStore.toggleDone("routine", item.id); // marks it done today
      return item.id;
    });

    const removed = await page.evaluate((id) => {
      const r = window.RoutineStore.removeItem("routine", id);
      return r;
    }, itemId);
    assert.ok(removed.dates.length > 0, "removeItem should report which dates it was done on");

    const restoredHistory = await page.evaluate(
      ({ removed, itemId }) => {
        window.RoutineStore.restoreItem("routine", removed.item, removed.index, removed.dates);
        return window.RoutineStore.isDone("routine", itemId);
      },
      { removed, itemId }
    );
    assert.equal(restoredHistory, true, "the restored item should still show as done today");
  } finally {
    await close();
  }
});

test("schedule: selecting an item in bulk-select mode patches just that row, without rebuilding the day list — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const catKey = await page.evaluate(() => window.CategoryStore.getAll()[0].key);
    // Must be "today" — the schedule day panel defaults to today's date,
    // and a date hardcoded to whatever day this test was written on would
    // silently stop matching (and this test would time out finding zero
    // rows) the moment the real calendar date moved past it.
    await page.evaluate((catKey) => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      window.ScheduleStore.add({ title: "일정A", date: today, repeat: { type: "none" }, category: catKey });
      window.ScheduleStore.add({ title: "일정B", date: today, repeat: { type: "none" }, category: catKey });
    }, catKey);
    await page.evaluate(() => document.querySelector('[data-view="schedule"]')?.click());
    await page.waitForTimeout(200);
    await page.click("#scheduleSelectModeBtn");
    await page.waitForTimeout(150);

    // Tag every row so we can tell if any got torn down and rebuilt — a
    // fresh element from renderDayList() wouldn't carry this marker.
    await page.evaluate(() => {
      document.querySelectorAll("#scheduleList .schedule-item").forEach((el, i) => {
        el.dataset.notRebuilt = `row-${i}`;
      });
    });

    const items = page.locator("#scheduleList .schedule-item");
    await items.first().click();
    await page.waitForTimeout(150);

    const result = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#scheduleList .schedule-item")];
      return {
        allSurvived: rows.every((el) => el.dataset.notRebuilt?.startsWith("row-")),
        firstSelected: rows[0]?.classList.contains("selected"),
        countText: document.getElementById("scheduleSelectCount")?.textContent,
      };
    });
    assert.equal(result.allSurvived, true, "no row should have been torn down and rebuilt");
    assert.equal(result.firstSelected, true);
    assert.equal(result.countText, "1개 선택됨");
  } finally {
    await close();
  }
});

test("search: a single early category can't starve out every other category — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const catKey = await page.evaluate(() => window.CategoryStore.getAll()[0].key);
    await page.evaluate((catKey) => {
      // 12 matching schedules (well past the old flat 10-result cap) plus
      // one matching ledger entry — the schedule matches alone used to
      // fill the entire results.slice(0, 10) budget before the ledger
      // category (or anything else) was ever considered.
      for (let i = 0; i < 12; i++) {
        window.ScheduleStore.add({ title: `테스트일정${i}`, date: "2026-08-01", repeat: { type: "none" }, category: catKey });
      }
      const expCat = window.LedgerCategoryStore.getByType("expense")[0];
      window.LedgerCategoryStore.update(expCat.key, { label: "테스트카테고리" });
      window.LedgerEntryStore.add({ date: "2026-08-01", amount: 1000, categoryKey: expCat.key, type: "expense" });
    }, catKey);

    await page.fill("#globalSearchInput", "테스트");
    await page.waitForTimeout(250);
    const types = await page.evaluate(() =>
      [...document.querySelectorAll("#searchResults .search-result-badge")].map((el) => el.textContent)
    );
    assert.ok(types.includes("가계부"), `expected a 가계부 result among the top 10, got types: ${types.join(",")}`);
    assert.ok(types.filter((t) => t === "일정").length <= 3, "no single category should exceed its per-category cap");
  } finally {
    await close();
  }
});

test("search: a 1-character query doesn't spuriously match the 비서 assistant shortcut — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    await page.fill("#globalSearchInput", "c");
    await page.waitForTimeout(250);
    const types = await page.evaluate(() =>
      [...document.querySelectorAll("#searchResults .search-result-badge")].map((el) => el.textContent)
    );
    assert.ok(!types.includes("비서"), `"c" should not match the assistant shortcut, got types: ${types.join(",")}`);
  } finally {
    await close();
  }
});

test("a11y: makeKeyboardActivatable fires once per Space press-release, not once per repeated keydown — the actual bug fix", { skip: !RUN }, async () => {
  const { page, close } = await launchApp();
  try {
    const clickCount = await page.evaluate(() => {
      const btn = document.createElement("button");
      btn.textContent = "test";
      let clicks = 0;
      btn.addEventListener("click", () => clicks++);
      document.body.appendChild(btn);
      window.makeKeyboardActivatable(btn);
      btn.focus();

      // Simulate OS key-repeat: several keydowns, only one keyup — this is
      // exactly what holding a key down actually generates.
      const keydown = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
      btn.dispatchEvent(keydown);
      btn.dispatchEvent(keydown);
      btn.dispatchEvent(keydown);
      const keyup = new KeyboardEvent("keyup", { key: " ", bubbles: true, cancelable: true });
      btn.dispatchEvent(keyup);

      btn.remove();
      return clicks;
    });
    assert.equal(clickCount, 1);
  } finally {
    await close();
  }
});

test("calendar-fit: on a short viewport, MIN_WIDTH is only applied when it still fits — the actual bug fix", { skip: !RUN }, async () => {
  // Regression test scoped to the specific bug: MIN_WIDTH used to be
  // applied unconditionally, ignoring the (much taller) grid height that
  // width implies via the fixed 3:4 cell aspect ratio — so the calendar
  // PANEL ITSELF rendered taller than the content area had room for. This
  // checks the panel's own height against the content area's, independent
  // of any other unrelated chrome (filter bar, chips, ...) that might also
  // be sitting above .schedule-layout and contributing to page-level
  // scroll — that's a separate concern from what this fix addresses.
  const { page, close } = await launchApp();
  try {
    await page.setViewportSize({ width: 1400, height: 500 }); // wide, short
    await page.evaluate(() => document.querySelector('[data-view="schedule"]')?.click());
    await page.waitForTimeout(300);

    const { panelHeight, contentClientHeight, appliedWidth } = await page.evaluate(() => {
      const content = document.querySelector(".content");
      const panel = document.getElementById("calendarPanel");
      const layout = document.getElementById("scheduleLayout");
      return {
        panelHeight: panel.getBoundingClientRect().height,
        contentClientHeight: content.clientHeight,
        appliedWidth: parseFloat(getComputedStyle(layout).gridTemplateColumns),
      };
    });
    assert.ok(
      panelHeight <= contentClientHeight,
      `calendar panel (${panelHeight}px) should fit within the content area (${contentClientHeight}px)`
    );
    // On this short a viewport, the fix should have kept the width BELOW
    // MIN_WIDTH (420) rather than forcing it up and overflowing.
    assert.ok(appliedWidth < 420, `expected width to stay below MIN_WIDTH on a short viewport, got ${appliedWidth}px`);
  } finally {
    await close();
  }
});
