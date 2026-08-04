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
    assert.equal(after.childProgressText, "2/2");

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
      window.LearnedExerciseStore.add({ bodyPart: "가슴", name: "실시간동기화테스트-운동" });
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
