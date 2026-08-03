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
    const fallback = { width: 640, marginTop: 0 };
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
    targetWidth = Math.min(targetWidth, available - LAYOUT_GAP - DAY_PANEL_MIN_WIDTH);

    return { width: Math.max(MIN_WIDTH, targetWidth), marginTop };
  }

  function apply({ layoutId, panelId, gridId, extraHeight }) {
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
    layout.style.gridTemplateColumns = `${fit.width}px 1fr`;
    layout.style.marginTop = fit.marginTop ? fit.marginTop + "px" : "";
  }

  window.CalendarFit = { compute, apply };
})();
