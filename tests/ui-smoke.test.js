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
const { launchApp } = require("./helpers/browser-app");

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
    // reload() wipes the style-tag override from launchApp() too — reapply
    // it, same as the initial bypass.
    await page.addStyleTag({ content: "#authGate { display: none !important; }" });
    await page.evaluate(() => {
      document.getElementById("authGate").hidden = true;
      document.getElementById("appRoot").hidden = false;
      window.initFeatures && window.initFeatures();
    });
    await page.waitForTimeout(300);

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
    await page.addStyleTag({ content: "#authGate { display: none !important; }" });
    await page.evaluate(() => {
      const authGate = document.getElementById("authGate");
      authGate.setAttribute("hidden", "");
      Object.defineProperty(authGate, "hidden", { get: () => true, set: () => {} });
      document.getElementById("appRoot").hidden = false;
      window.initFeatures && window.initFeatures();
    });
    await page.waitForTimeout(300);
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
