// Shared calendar-panel auto-fit logic for the 일정 (schedule.js) and 가계부
// (ledger.js) tabs — both render a month-grid calendar (6 rows, 3:4 cells)
// beside a side panel using the same .schedule-layout/.calendar-panel/
// .calendar-grid CSS, and both used to hand-maintain an identical
// compute+apply pair differing only in element ids (and, for ledger, an
// extra section above the calendar whose height needs to come out of the
// space the grid gets to fit into). One shared implementation here instead.
//
// routine.js has its own separate computeCalendarFit() — its cells are
// square rather than 3:4, its width decision is driven by a side-by-side
// fit check rather than a fixed breakpoint, and it applies via
// panel.style.maxWidth instead of layout.style.gridTemplateColumns — different
// enough in all three respects that folding it in here would trade a small
// amount of duplication for a much harder to follow shared function, so it
// stays separate.
(function () {
  const ROWS = 6; // buildMonthGrid() always returns exactly 6 weeks
  const GRID_GAP = 4; // must match .calendar-grid's gap in CSS
  const CELL_ASPECT = 4 / 3; // height / width, matches .calendar-day's aspect-ratio: 3/4
  const MIN_WIDTH = 420;
  const DAY_PANEL_MIN_WIDTH = 280;
  // The calendar's own width is driven entirely by fitting its fixed 6-row
  // height into the available vertical space, via the fixed 3:4 cell aspect
  // ratio — it has no way to grow wider just because the window is wider.
  // Handing the day panel 100% of whatever's left over (the old plain
  // "1fr" column) meant a wide-but-not-especially-tall window (a common
  // desktop shape, e.g. 1920x1080) left the calendar looking small next to
  // a day panel stretched into mostly-empty space. Capping it here instead
  // leaves genuinely unused width as empty margin, which reads as "the
  // calendar is the main thing" rather than "the list panel is."
  const DAY_PANEL_MAX_WIDTH = 480;
  const LAYOUT_GAP = 14; // must match .schedule-layout's gap in CSS

  // Sizes the calendar panel so its full 6-row month grid fits the
  // scrollable content area (below the topbar/search bar) without needing
  // to scroll, and so the empty space below it matches the space above.
  // Requires the grid to already have its 42 day cells rendered: everything
  // else in the panel has a width-independent height, so subtracting the
  // grid's current height out of the panel's total pins down how much
  // vertical room is "chrome" versus grid.
  function compute({ panelId, gridId, layoutId, extraHeight }) {
    const panel = document.getElementById(panelId);
    const grid = document.getElementById(gridId);
    const layout = document.getElementById(layoutId);
    const contentEl = document.querySelector(".content");
    const fallback = { width: 640, dayPanelWidth: DAY_PANEL_MIN_WIDTH, marginTop: 0 };
    if (!panel || !grid || !layout || !contentEl || !grid.children.length) return fallback;

    const gridRect = grid.getBoundingClientRect();
    const chromeHeight = panel.scrollHeight - gridRect.height;
    const chromeWidth = panel.getBoundingClientRect().width - gridRect.width;

    const contentStyle = getComputedStyle(contentEl);
    const paddingTop = parseFloat(contentStyle.paddingTop) || 0;
    const paddingBottom = parseFloat(contentStyle.paddingBottom) || 0;
    // The smaller of the two margins can't be matched without either
    // scrolling (shrinking it isn't possible, it's fixed page padding) or
    // growing past the larger one — so equalize on whichever is bigger.
    const margin = Math.max(paddingTop, paddingBottom);
    const marginTop = margin - paddingTop;

    const extra = typeof extraHeight === "function" ? extraHeight() : 0;
    // The extra 2px is slack for sub-pixel rounding across 6 rows of cell
    // borders/padding — without it this occasionally overflows by a pixel
    // or two and forces an (invisible-looking but real) scrollbar.
    const targetPanelHeight = contentEl.clientHeight - margin * 2 - 2 - extra;
    const targetGridHeight = Math.max(ROWS * 24, targetPanelHeight - chromeHeight);
    const cellWidth = (targetGridHeight - (ROWS - 1) * GRID_GAP) / (ROWS * CELL_ASPECT);
    let targetWidth = 7 * cellWidth + 6 * GRID_GAP + chromeWidth;

    const available = layout.getBoundingClientRect().width;
    // How wide the calendar is ever allowed to get without squeezing the
    // day panel below its own DAY_PANEL_MIN_WIDTH — a horizontal ceiling
    // independent of, and checked before, the readability floor below.
    const maxWidthKeepingDayPanelMin = available - LAYOUT_GAP - DAY_PANEL_MIN_WIDTH;
    targetWidth = Math.min(targetWidth, maxWidthKeepingDayPanelMin);

    // MIN_WIDTH is a floor for readability — below it, date numbers and
    // event dots get too small to actually read, so the calendar stops
    // being useful at all, not just less comfortable. This used to only
    // raise a too-small targetWidth back up to MIN_WIDTH when doing so
    // still fit inside targetPanelHeight (avoiding the panel rendering
    // taller than the content area, since CSS drives height from width
    // here, not the other way around) — trading "shrink further, however
    // small that gets" for "never cause a page scroll." That trade-off is
    // reversed on purpose now, per explicit direction: a calendar shrunk
    // well past readability (e.g. 가계부's month grid while its 목표 소비
    // budget panel is fully expanded, leaving little vertical room) is a
    // worse outcome than a page that needs to scroll a little. Auto-fit
    // still shrinks the calendar to use whatever room IS available, all
    // the way down to this floor — it just no longer goes past it.
    //
    // Still capped at maxWidthKeepingDayPanelMin, not blindly MIN_WIDTH —
    // a genuinely narrow window (just above the 960px stacking breakpoint)
    // could otherwise have this floor push the calendar wide enough to
    // squeeze the day panel below ITS OWN minimum, trading one readability
    // problem for another.
    targetWidth = Math.max(targetWidth, Math.min(MIN_WIDTH, maxWidthKeepingDayPanelMin));

    // Whatever's left after the calendar, capped at DAY_PANEL_MAX_WIDTH —
    // the targetWidth clamps above already guarantee at least
    // DAY_PANEL_MIN_WIDTH remains, so this is never smaller than that.
    const dayPanelWidth = Math.min(available - targetWidth - LAYOUT_GAP, DAY_PANEL_MAX_WIDTH);

    return { width: targetWidth, dayPanelWidth, marginTop };
  }

  // minChangeThreshold: skip actually applying a recomputed width that's
  // barely different from what's already on screen — used by ledger.js,
  // whose 목표 소비 budget panel recomputes this on every category add/
  // remove and every expand/collapse transition-end, most of which nudge
  // the available height by just a little. Without a floor on "worth
  // resizing for," each of those nudges still visibly (if subtly) resized
  // the calendar every time, which read as distracting jitter rather than
  // a meaningful size change. schedule.js doesn't pass this (defaults to
  // 0, i.e. always apply) since it has no equivalent frequently-changing
  // panel above its calendar.
  //
  // Compared against whatever's CURRENTLY applied, not the previous
  // *ideal* — compute() is always a fresh, from-scratch calculation with
  // no memory of earlier calls, so this can't accumulate drift the way
  // comparing against a chain of near-equal deltas could: a genuine trend
  // (a window being resized steadily smaller, say) still crosses the
  // threshold and applies exactly once accumulated real change exceeds it,
  // every time.
  function apply({ layoutId, panelId, gridId, extraHeight, minChangeThreshold = 0 }) {
    const layout = document.getElementById(layoutId);
    if (!layout || layout.getBoundingClientRect().width === 0) return; // view not visible yet

    // Below this width the CSS media query stacks the calendar and day
    // panel into a single column — an inline grid-template-columns would
    // outrank that (it's more specific than a class selector regardless of
    // the media query), so back off and let the stylesheet drive it there.
    if (window.matchMedia("(max-width: 960px)").matches) {
      layout.style.gridTemplateColumns = "";
      layout.style.marginTop = "";
      return;
    }

    const fit = compute({ panelId, gridId, layoutId, extraHeight });

    if (minChangeThreshold > 0) {
      const currentWidth = parseFloat(layout.style.gridTemplateColumns) || 0;
      if (Math.abs(fit.width - currentWidth) < minChangeThreshold) return;
    }

    layout.style.gridTemplateColumns = `${fit.width}px ${fit.dayPanelWidth}px`;
    layout.style.marginTop = fit.marginTop ? fit.marginTop + "px" : "";
  }

  // Adds the Sat/Sun coloring classes a calendar day cell gets in both
  // schedule.js and ledger.js — the two calendars' cell-building otherwise
  // diverges right after this point (schedule shows occurrence titles and a
  // holiday label, ledger shows expense/income totals), so this one bit
  // stayed the only thing worth sharing between them.
  function applyWeekendClass(cell, date) {
    if (date.getDay() === 0) cell.classList.add("weekday-sun");
    if (date.getDay() === 6) cell.classList.add("weekday-sat");
  }

  window.CalendarFit = { compute, apply, applyWeekendClass };
})();
