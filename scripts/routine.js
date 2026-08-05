(function () {
  const ROUTINES_KEY = "assistant.routines.v1";
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  const TYPES = [
    { key: "routine", listId: "routineChecklistList", addRowId: "routineChecklistAddRow" },
    { key: "life", listId: "lifeChecklistList", addRowId: "lifeChecklistAddRow" },
  ];

  // A representative width, used only to decide whether the calendar and
  // checklists have room to sit side by side at all — the calendar's real,
  // final width is computed by computeCalendarFit() below once it actually
  // expands, to fit the viewport's height instead of a fixed size.
  const CALENDAR_TYPICAL_WIDTH = 700;

  // The checklists column shouldn't get so narrow beside the calendar that
  // its own rows start wrapping awkwardly — below this width they belong
  // stacked below the calendar instead.
  const CHECKLISTS_MIN_WIDTH = 260;
  const ROUTINE_LAYOUT_GAP = 14;

  // Whether the calendar (at its typical width) and the checklists (at
  // their minimum comfortable width) can actually fit side by side in
  // `availableWidth` without wrapping — the real criterion for switching
  // to the side-by-side layout, rather than a guessed viewport breakpoint.
  function canFitSideBySide(availableWidth) {
    const calendarWidth = Math.min(availableWidth, CALENDAR_TYPICAL_WIDTH);
    return availableWidth - calendarWidth - ROUTINE_LAYOUT_GAP >= CHECKLISTS_MIN_WIDTH;
  }

  // Sizes the expanded month calendar so its full 6-row grid fits the
  // scrollable content area (below the topbar/search bar — that space
  // isn't part of "the page" for this purpose) without needing to scroll,
  // and so the empty space below the panel matches the space above it.
  // Requires the grid to already have its 42 day cells rendered (their own
  // height is what makes this calculation possible: everything else in the
  // panel — header, nav, weekday labels, padding — has a height that
  // doesn't depend on width, so subtracting the grid's current height out
  // of the panel's total pins down exactly how much vertical room is
  // "chrome" versus grid, at any width).
  //
  // Returns { width, marginTop }. #routineLayout's native top offset
  // (.content's own top padding) is usually smaller than its bottom
  // padding, so matching the two visually also means nudging the whole row
  // — calendar AND checklists together, so their tops stay aligned — down
  // by the difference; marginTop is that nudge, zero when the two paddings
  // already happen to match.
  function computeCalendarFit() {
    const panel = document.getElementById("routineWeekPanel");
    const grid = document.getElementById("routineCalendarGrid");
    const layout = document.getElementById("routineLayout");
    const contentEl = document.querySelector(".content");
    if (!panel || !grid || !contentEl || !grid.children.length) {
      return { width: CALENDAR_TYPICAL_WIDTH, marginTop: 0 };
    }

    const ROWS = 6; // buildMonthGrid() always returns exactly 6 weeks
    const GRID_GAP = 4; // must match .routine-calendar-grid's gap in CSS
    const MIN_WIDTH = 300;

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

    // The extra 2px is slack for sub-pixel rounding across 6 rows of cell
    // borders/padding — without it this occasionally overflows by a pixel
    // or two and forces an (invisible-looking but real) scrollbar.
    const targetPanelHeight = contentEl.clientHeight - margin * 2 - 2;
    const targetGridHeight = Math.max(ROWS * 20, targetPanelHeight - chromeHeight);
    const cellSize = (targetGridHeight - (ROWS - 1) * GRID_GAP) / ROWS;
    let targetWidth = 7 * cellSize + 6 * GRID_GAP + chromeWidth;

    if (layout) {
      const available = layout.getBoundingClientRect().width;
      targetWidth = Math.min(targetWidth, available - ROUTINE_LAYOUT_GAP - CHECKLISTS_MIN_WIDTH);
    }

    return { width: Math.max(MIN_WIDTH, targetWidth), marginTop };
  }

  let calendarViewDate = new Date();
  // Blocks the toggle while an expand/collapse animation is in flight — a
  // rapid re-click mid-animation would otherwise start a second FLIP/height
  // transition on cells and a panel that are still mid-transition from the
  // first one.
  let toggleAnimating = false;

  function createId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  // getFullYear/getMonth/getDate (local time), never toISOString (UTC) —
  // local-time-only date convention, see scripts/schedule-recurrence.js's
  // parseDateStr for why.
  function toDateStr(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function todayStr() {
    return toDateStr(new Date());
  }

  function emptyRoutine() {
    return { items: [], history: {} };
  }

  function loadAll() {
    let data;
    try {
      const raw = localStorage.getItem(ROUTINES_KEY);
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (!data) data = {};
    let changed = false;

    // One-time migration: 아침/야간 routines used to be two separate
    // checklists — merge them into a single "routine" checklist (their
    // per-day completion histories are unioned) so existing data survives
    // the move to one combined list.
    if (!data.routine && (data.morning || data.night)) {
      const morning = data.morning && Array.isArray(data.morning.items) ? data.morning : emptyRoutine();
      const night = data.night && Array.isArray(data.night.items) ? data.night : emptyRoutine();
      const history = {};
      new Set([...Object.keys(morning.history || {}), ...Object.keys(night.history || {})]).forEach((date) => {
        history[date] = [...(morning.history[date] || []), ...(night.history[date] || [])];
      });
      data.routine = { items: [...morning.items, ...night.items], history };
      delete data.morning;
      delete data.night;
      changed = true;
    }

    TYPES.forEach((t) => {
      const routine = data[t.key];
      if (!routine || !Array.isArray(routine.items)) {
        data[t.key] = emptyRoutine();
        changed = true;
        return;
      }
      if (!routine.history || typeof routine.history !== "object") {
        // Migrate the old single-day { completion: { date, doneIds } } shape
        // into per-day history, so past completions aren't just discarded.
        const history = {};
        if (routine.completion && routine.completion.date) {
          history[routine.completion.date] = routine.completion.doneIds || [];
        }
        data[t.key] = { items: routine.items, history };
        changed = true;
      }
    });
    if (changed) saveAll(data);
    return data;
  }

  function saveAll(data) {
    window.safeSetLocalStorage(ROUTINES_KEY, JSON.stringify(data));
  }

  const RoutineStore = {
    getItems(type) {
      return loadAll()[type].items;
    },
    // For a render pass that needs items + done-state for every item (or
    // every day in a month) — one load instead of loadAll() being re-run,
    // re-parsing the whole store from localStorage, once per item/cell.
    getSnapshot() {
      return loadAll();
    },
    addItem(type, label) {
      const data = loadAll();
      const item = { id: createId("rt"), label };
      data[type].items.push(item);
      saveAll(data);
      return item;
    },
    removeItem(type, id) {
      const data = loadAll();
      const idx = data[type].items.findIndex((i) => i.id === id);
      if (idx === -1) return null;
      const [removed] = data[type].items.splice(idx, 1);
      // Capture which dates this item was marked done on before stripping
      // it out of history below — restoreItem needs these to actually undo
      // the deletion. Without this, clicking "실행취소" brought the item
      // back with no completion history at all: it displayed unchecked for
      // every past day, and the week/month completion rate permanently
      // read lower than it did before the "undo" — a real, silent loss of
      // data hiding behind what looked like a safe undo action.
      const removedDates = [];
      Object.keys(data[type].history).forEach((date) => {
        if (data[type].history[date].includes(id)) removedDates.push(date);
        data[type].history[date] = data[type].history[date].filter((did) => did !== id);
      });
      saveAll(data);
      return { item: removed, index: idx, dates: removedDates };
    },
    restoreItem(type, item, index, dates) {
      const data = loadAll();
      // Only the upper bound was clamped — see store.js's createKeyedStore/
      // createEntityStore.restore for the same fix and why it matters.
      const at = Math.min(Math.max(0, index), data[type].items.length);
      data[type].items.splice(at, 0, item);
      (dates || []).forEach((date) => {
        if (!data[type].history[date]) data[type].history[date] = [];
        if (!data[type].history[date].includes(item.id)) data[type].history[date].push(item.id);
      });
      saveAll(data);
    },
    isDone(type, id) {
      const routine = loadAll()[type];
      return (routine.history[todayStr()] || []).includes(id);
    },
    toggleDone(type, id) {
      const data = loadAll();
      const routine = data[type];
      const today = todayStr();
      if (!routine.history[today]) routine.history[today] = [];
      const doneIds = routine.history[today];
      const pos = doneIds.indexOf(id);
      if (pos === -1) doneIds.push(id);
      else doneIds.splice(pos, 1);
      saveAll(data);
    },
    // Combined (루틴+생활) completion for a given date, against the CURRENT
    // item lists — there's no historical snapshot of what the checklist
    // used to contain, so a past day's rate is "how much of today's list
    // would have been done," which is the simplest reading of the data.
    // `snapshot`, when given (a prior RoutineStore.getSnapshot() call), is
    // used instead of loading fresh — callers computing this for many dates
    // in a row (a week strip, a month grid) would otherwise re-read+re-parse
    // the whole store from localStorage once per date instead of once total.
    getRateForDate(dateStr, snapshot) {
      const data = snapshot || loadAll();
      let done = 0;
      let total = 0;
      TYPES.forEach((t) => {
        const routine = data[t.key];
        total += routine.items.length;
        const doneIds = new Set(routine.history[dateStr] || []);
        done += routine.items.filter((item) => doneIds.has(item.id)).length;
      });
      return { done, total, rate: total > 0 ? done / total : null };
    },
  };
  window.RoutineStore = RoutineStore;

  function renderList(type) {
    const config = TYPES.find((t) => t.key === type);
    const list = document.getElementById(config.listId);
    if (!list) return;
    list.innerHTML = "";

    const snapshot = RoutineStore.getSnapshot()[type];
    const doneToday = new Set(snapshot.history[todayStr()] || []);

    snapshot.items.forEach((item) => {
      const done = doneToday.has(item.id);
      const li = document.createElement("li");
      li.className = "checklist-item" + (done ? " done" : "");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = done;
      // Without this a screen reader only ever announced "checkbox, not
      // checked" for every single item, with no indication which item it
      // toggles — schedule.js's equivalent checkbox already sets this.
      checkbox.setAttribute("aria-label", item.label || "체크리스트 항목");
      checkbox.addEventListener("change", () => {
        RoutineStore.toggleDone(type, item.id);
        renderAll();
      });
      li.appendChild(checkbox);

      const span = document.createElement("span");
      span.textContent = item.label;
      li.appendChild(span);

      const remove = document.createElement("span");
      remove.className = "checklist-item-remove";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        const removed = RoutineStore.removeItem(type, item.id);
        renderAll();
        if (removed && window.Toast) {
          window.Toast.show("루틴 항목을 삭제했어요", {
            actionLabel: "실행취소",
            onAction: () => {
              RoutineStore.restoreItem(type, removed.item, removed.index, removed.dates);
              renderAll();
            },
          });
        }
      });
      window.makeKeyboardActivatable(remove, `${item.label} 삭제`);
      li.appendChild(remove);

      list.appendChild(li);
    });
  }

  function handleAdd(type, label) {
    RoutineStore.addItem(type, label);
    renderAll();
  }

  // Starts as a single compact "+" button; clicking it swaps in a text
  // input (Enter commits, Escape/blur cancels) instead of leaving an open
  // input box sitting around all the time.
  function makeAddTrigger(onAdd) {
    const container = document.createElement("div");

    function showButton() {
      container.innerHTML = "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghost-btn routine-add-trigger-btn";
      btn.textContent = "+";
      btn.addEventListener("click", () => showInput());
      container.appendChild(btn);
    }

    function showInput() {
      container.innerHTML = "";
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "루틴 항목 이름";
      input.maxLength = 200; // same cap as other single-line title fields (schedule/vongole title)

      let settled = false;
      function commit() {
        if (settled) return;
        settled = true;
        const label = input.value.trim();
        if (label) onAdd(label);
        showButton();
      }
      function cancel() {
        if (settled) return;
        settled = true;
        showButton();
      }

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      });
      input.addEventListener("blur", cancel);

      container.appendChild(input);
      input.focus();
    }

    showButton();
    return container;
  }

  // ---------- Weekly rate strip ----------
  // Four emoji tiers instead of a color-coded background, so a rate reads
  // at a glance without comparing shades of the same color:
  //   0–24%  😞   25–49%  😐   50–74%  🙂   75–100%  😄
  function rateEmoji(rate) {
    if (rate === null) return "";
    if (rate < 0.25) return "😞";
    if (rate < 0.5) return "😐";
    if (rate < 0.75) return "🙂";
    return "😄";
  }

  function renderWeekRate() {
    const wrap = document.getElementById("routineWeekRate");
    if (!wrap) return;
    wrap.innerHTML = "";

    const today = new Date();
    const sunday = new Date(today);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    const todayDateStr = todayStr();

    let sumRate = 0;
    let countedDays = 0;
    const snapshot = RoutineStore.getSnapshot();

    for (let i = 0; i < 7; i++) {
      const d = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i);
      const dStr = toDateStr(d);
      const isFuture = dStr > todayDateStr;
      const { done, total, rate } = RoutineStore.getRateForDate(dStr, snapshot);

      const cell = document.createElement("div");
      cell.className = "routine-week-cell" + (dStr === todayDateStr ? " today" : "") + (isFuture ? " future" : "");
      cell.dataset.date = dStr;

      const weekday = document.createElement("span");
      weekday.className = "routine-week-cell-label";
      weekday.textContent = WEEKDAYS[d.getDay()];
      cell.appendChild(weekday);

      const num = document.createElement("span");
      num.className = "routine-week-cell-date";
      num.textContent = d.getDate();
      cell.appendChild(num);

      const pct = document.createElement("span");
      pct.className = "routine-week-cell-pct";
      pct.textContent = isFuture ? "" : rate === null ? "—" : `${rateEmoji(rate)} ${Math.round(rate * 100)}%`;
      cell.appendChild(pct);

      cell.title = isFuture || rate === null ? "" : `${done}/${total} 완료 (${Math.round(rate * 100)}%)`;

      if (!isFuture && rate !== null) {
        sumRate += rate;
        countedDays += 1;
      }

      wrap.appendChild(cell);
    }

    const avgEl = document.getElementById("routineWeekAverage");
    if (avgEl) {
      avgEl.textContent = countedDays > 0 ? `평균 ${Math.round((sumRate / countedDays) * 100)}%` : "";
    }
  }

  // ---------- Achievement-rate calendar ----------
  function buildMonthGrid(year, month) {
    const firstOfMonth = new Date(year, month, 1);
    const start = new Date(year, month, 1 - firstOfMonth.getDay());
    const days = [];
    for (let i = 0; i < 42; i++) {
      days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }
    return days;
  }

  function renderRateCalendar() {
    const grid = document.getElementById("routineCalendarGrid");
    const title = document.getElementById("routineCalendarTitle");
    if (!grid || !title) return;

    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    title.textContent = `${year}년 ${month + 1}월`;

    const todayDateStr = todayStr();
    const snapshot = RoutineStore.getSnapshot();
    grid.innerHTML = "";
    buildMonthGrid(year, month).forEach((d) => {
      const dStr = toDateStr(d);
      const isOutside = d.getMonth() !== month;
      const isFuture = dStr > todayDateStr;

      const cell = document.createElement("div");
      cell.className = "routine-calendar-day" + (isOutside ? " outside" : "") + (dStr === todayDateStr ? " today" : "");
      cell.dataset.date = dStr;

      const num = document.createElement("span");
      num.className = "routine-calendar-day-number";
      num.textContent = d.getDate();
      cell.appendChild(num);

      if (!isFuture) {
        const { done, total, rate } = RoutineStore.getRateForDate(dStr, snapshot);
        if (rate !== null) {
          const pct = document.createElement("span");
          pct.className = "routine-calendar-day-pct";
          pct.textContent = `${rateEmoji(rate)} ${Math.round(rate * 100)}%`;
          cell.appendChild(pct);
          cell.title = `${done}/${total} 완료 (${Math.round(rate * 100)}%)`;
        }
      }

      grid.appendChild(cell);
    });
  }

  function renderAll() {
    TYPES.forEach((t) => renderList(t.key));
    renderWeekRate();
    renderRateCalendar();
  }

  // Moves #routineChecklists between "below the calendar" (stacked) and
  // "beside the calendar" (its own column) by animating it from its old
  // position to its new one along a slight downward arc rather than a
  // straight line — a direct diagonal cuts right past the calendar panel
  // as it's shrinking/growing right next to it, which read as the two
  // colliding. Eased in and heavily eased out so it settles gently instead
  // of stopping abruptly.
  // `startRectOverride`: collapseCalendarAnimated() measures this itself
  // right at the top, before it clears the panel's inline max-width — that
  // width change reflows the still-side-by-side row (the panel growing
  // shrinks the checklists' flex box) and corrupts a measurement taken
  // any later than that, which made the checklists appear to jump to a
  // wrong spot before animating from there instead of from their true
  // on-screen position.
  // Returns whether it actually started a real animation — setCalendarExpanded
  // uses this (combined with the week-cell FLIP's own outcome) to size its
  // toggleAnimating lock to what actually needs covering, instead of always
  // locking for the full worst-case duration even on a bailout path that
  // changed nothing.
  function animateChecklistsLayout(expanding, startRectOverride) {
    const layout = document.getElementById("routineLayout");
    const checklists = document.getElementById("routineChecklists");
    if (!layout || !checklists) return false;

    // Only switch to the side-by-side layout if the checklists would
    // actually fit beside the calendar without wrapping — otherwise leave
    // them stacked below it. Collapsing always still runs (regardless of
    // the current width) so the class never gets stuck on from before a
    // resize.
    if (expanding && !canFitSideBySide(layout.getBoundingClientRect().width)) return false;

    const startRect = startRectOverride || checklists.getBoundingClientRect();
    layout.classList.toggle("calendar-expanded", expanding);
    const endRect = checklists.getBoundingClientRect();

    if (startRect.width === 0 || endRect.width === 0) return false; // no usable layout to animate from

    const dx = startRect.left - endRect.left;
    const dy = startRect.top - endRect.top;
    const MOVE_MS = 420;
    const DIP = 28; // extra downward travel at the midpoint of the arc
    const midWidth = (startRect.width + endRect.width) / 2;

    checklists.getAnimations().forEach((a) => a.cancel());
    // The app's only reduced-motion handling is a global CSS override that
    // zeroes out `animation-duration`/`transition-duration` — that has no
    // effect on this Web Animations API call, the one .animate() site in
    // the app. The layout class toggle above already applied the real end
    // state; skipping just the flight-path animation leaves it snapping
    // straight there instead of playing the arc motion.
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
    checklists.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px)`,
          width: `${startRect.width}px`,
          offset: 0,
          easing: "cubic-bezier(0.3, 0, 0.6, 1)",
        },
        {
          transform: `translate(${dx * 0.35}px, ${dy * 0.35 + DIP}px)`,
          width: `${midWidth}px`,
          offset: 0.55,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        },
        { transform: "translate(0, 0)", width: `${endRect.width}px`, offset: 1 },
      ],
      { duration: MOVE_MS, fill: "none" }
    );
    return true;
  }

  // FLIP animation: the week strip's cells visually fly to wherever their
  // same date lands in the freshly-rendered calendar grid, so the strip
  // reads as "becoming" that row instead of the calendar just appearing
  // underneath it. Only the current week's row can do this (it's the only
  // one the strip has data for); the rest of the grid fades in around it.
  function expandCalendarAnimated() {
    const weekWrap = document.getElementById("routineWeekRate");
    const section = document.getElementById("routineCalendarSection");
    const panel = document.getElementById("routineWeekPanel");
    const layout = document.getElementById("routineLayout");

    const sourceRects = [...weekWrap.querySelectorAll(".routine-week-cell")].map((cell) => ({
      date: cell.dataset.date,
      rect: cell.getBoundingClientRect(),
    }));

    // The card itself should grow into its taller (calendar-included)
    // height smoothly rather than snapping to it the instant the section
    // un-hides — measure before/after and animate between the two.
    const startHeight = panel ? panel.getBoundingClientRect().height : 0;

    // Reveal + render now (nothing has painted yet, so this causes no
    // flash) so computeCalendarFit() below has a real grid to measure — it
    // needs the day cells' rendered height to work out how much vertical
    // room is chrome versus grid.
    section.hidden = false;
    renderRateCalendar();

    // Hide the strip now too, before computeCalendarFit() and the
    // expanded-height measurement further down — otherwise the panel's
    // scrollHeight still includes the (about-to-disappear) strip's own
    // height on top of the calendar's, throwing both off.
    weekWrap.hidden = true;

    // Only pull the panel in to its fit-to-viewport width when the
    // checklists are actually about to sit beside it — that width is sized
    // to leave them room, so applying it while they're staying stacked
    // below (no room for them beside it, or just not worth it yet) would
    // narrow the calendar for no reason. Stacked mode just grows taller
    // instead, using the full width like before.
    const sideBySide = layout ? canFitSideBySide(layout.getBoundingClientRect().width) : false;
    if (panel) {
      if (sideBySide) {
        const fit = computeCalendarFit();
        panel.style.maxWidth = fit.width + "px";
        if (layout) layout.style.marginTop = fit.marginTop ? fit.marginTop + "px" : "";
      } else {
        panel.style.maxWidth = "";
        if (layout) layout.style.marginTop = "";
      }
    }

    // Move the checklists over to the calendar's right side now that the
    // calendar itself has its final width — placed before the week-cell
    // FLIP's own bail-out check further down so it always runs.
    let animated = animateChecklistsLayout(true);

    if (panel) {
      const endHeight = panel.scrollHeight;
      if (endHeight !== startHeight) {
        animated = true;
        panel.style.height = startHeight + "px";
        panel.style.overflow = "hidden";
        void panel.offsetHeight;
        panel.style.transition = "height 300ms ease";
        panel.style.height = endHeight + "px";
        setTimeout(() => {
          panel.style.height = "";
          panel.style.overflow = "";
          panel.style.transition = "";
        }, 320);
      }
    }

    const targetByDate = new Map();
    document.querySelectorAll(".routine-calendar-day").forEach((cell) => {
      targetByDate.set(cell.dataset.date, cell);
    });

    // Collect the transform needed for each matching cell WITHOUT touching
    // any styles yet — if nothing ends up matching (e.g. a layout engine
    // that never gives real box sizes), we must bail before hiding anything,
    // or the "others" fade-in would never get scheduled to run.
    const matches = [];
    sourceRects.forEach(({ date, rect }) => {
      const target = targetByDate.get(date);
      if (!target) return;
      const targetRect = target.getBoundingClientRect();
      if (targetRect.width === 0 || targetRect.height === 0 || rect.width === 0 || rect.height === 0) return;
      matches.push({
        target,
        dx: rect.left - targetRect.left,
        dy: rect.top - targetRect.top,
        sx: rect.width / targetRect.width,
        sy: rect.height / targetRect.height,
      });
    });

    if (matches.length === 0) return animated; // nothing to FLIP — plain reveal, calendar is already fully visible

    const matched = matches.map((m) => m.target);
    matches.forEach(({ target, dx, dy, sx, sy }) => {
      target.style.transition = "none";
      target.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      target.style.zIndex = "1";
    });

    const others = [...document.querySelectorAll(".routine-calendar-day")].filter((c) => !matched.includes(c));
    others.forEach((c) => {
      c.style.transition = "none";
      c.style.opacity = "0";
      c.style.transform = "scale(0.5)";
    });

    // Force layout so the transform above is committed before the next
    // frame flips it to the resting state — otherwise the browser may
    // collapse both changes into one and skip the animation entirely.
    void section.offsetHeight;

    const ROW_MOVE_MS = 260;
    const OTHERS_GROW_MS = 320;

    requestAnimationFrame(() => {
      matched.forEach((target) => {
        target.style.transition = `transform ${ROW_MOVE_MS}ms linear`;
        target.style.transform = "none";
      });
      // Delayed so the rest of the grid only starts growing in once the
      // current week's row has actually landed, instead of everything
      // appearing at once.
      others.forEach((c) => {
        c.style.transition = `opacity ${OTHERS_GROW_MS}ms ease ${ROW_MOVE_MS}ms, transform ${OTHERS_GROW_MS}ms ease ${ROW_MOVE_MS}ms`;
        c.style.opacity = "1";
        c.style.transform = "scale(1)";
      });
    });

    setTimeout(() => {
      matched.forEach((target) => {
        target.style.transition = "";
        target.style.transform = "";
        target.style.zIndex = "";
      });
      others.forEach((c) => {
        c.style.transition = "";
        c.style.opacity = "";
        c.style.transform = "";
      });
    }, ROW_MOVE_MS + OTHERS_GROW_MS + 30);
    return true;
  }

  // Mirror of expandCalendarAnimated: the current week's calendar-day cells
  // fly back to become the week strip, the rest of the grid fades out, and
  // the card shrinks back to its collapsed height — all before the
  // calendar section actually gets hidden.
  function collapseCalendarAnimated() {
    const weekWrap = document.getElementById("routineWeekRate");
    const section = document.getElementById("routineCalendarSection");
    const panel = document.getElementById("routineWeekPanel");
    const layout = document.getElementById("routineLayout");
    const nav = section.querySelector(".routine-calendar-nav");
    const weekdaysHeader = section.querySelector(".calendar-weekdays");

    // Captured before anything below reflows the still-expanded row layout
    // (see the comment on animateChecklistsLayout) so the checklists'
    // FLIP animates from where they're actually sitting on screen.
    const checklistsEl = document.getElementById("routineChecklists");
    const checklistsStartRect = checklistsEl ? checklistsEl.getBoundingClientRect() : null;

    const weekDates = [];
    const sunday = new Date();
    sunday.setDate(sunday.getDate() - sunday.getDay());
    for (let i = 0; i < 7; i++) {
      const d = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i);
      weekDates.push(toDateStr(d));
    }

    const calendarCellsByDate = new Map();
    document.querySelectorAll(".routine-calendar-day").forEach((cell) => calendarCellsByDate.set(cell.dataset.date, cell));
    const sourceRects = weekDates
      .map((d) => calendarCellsByDate.get(d))
      .filter(Boolean)
      .map((cell) => ({ date: cell.dataset.date, rect: cell.getBoundingClientRect() }));

    const startHeight = panel ? panel.getBoundingClientRect().height : 0;

    // Restore the panel's normal width/position now, before the week strip
    // re-renders, so the FLIP targets measured below reflect their real
    // final (wide) layout instead of the narrow expanded one. Nothing
    // paints between here and the height clamp further down, so this
    // never flashes a taller box in the process.
    if (panel) panel.style.maxWidth = "";
    if (layout) layout.style.marginTop = "";

    // Move the checklists back below the calendar now that it's back to
    // its full width — placed before the week-cell FLIP's own bail-out
    // check further down so it always runs.
    const checklistsAnimated = animateChecklistsLayout(false, checklistsStartRect);

    weekWrap.hidden = false;
    renderWeekRate();

    // Measure the TRUE final resting height by momentarily hiding the
    // calendar section — same trick as expand's fix: subtracting the
    // section's own outer height from startHeight was an estimate that
    // could drift from the real value (margins, rounding), causing the
    // exact overshoot-then-snap bug expand had. Flipping hidden on and
    // back off within the same synchronous tick never paints, so there's
    // no visible flicker.
    let endHeight = startHeight;
    if (panel) {
      const wasHidden = section.hidden;
      section.hidden = true;
      endHeight = panel.scrollHeight;
      section.hidden = wasHidden;
    }

    const targetByDate = new Map();
    weekWrap.querySelectorAll(".routine-week-cell").forEach((cell) => targetByDate.set(cell.dataset.date, cell));

    const matches = [];
    sourceRects.forEach(({ date, rect }) => {
      const target = targetByDate.get(date);
      if (!target) return;
      const targetRect = target.getBoundingClientRect();
      if (targetRect.width === 0 || targetRect.height === 0 || rect.width === 0 || rect.height === 0) return;
      matches.push({
        target,
        dx: rect.left - targetRect.left,
        dy: rect.top - targetRect.top,
        sx: rect.width / targetRect.width,
        sy: rect.height / targetRect.height,
      });
    });

    if (matches.length === 0 || startHeight === 0) {
      // No usable layout to animate from — fall back to the plain, instant swap.
      section.hidden = true;
      renderWeekRate();
      return checklistsAnimated;
    }

    const matched = matches.map((m) => m.target);
    const others = [...document.querySelectorAll(".routine-calendar-day")].filter((c) => !weekDates.includes(c.dataset.date));

    const NAV_FADE_MS = 150;
    const ROW_MOVE_MS = 260;
    const OTHERS_SHRINK_MS = 260;
    const PANEL_SHRINK_MS = 300;

    matches.forEach(({ target, dx, dy, sx, sy }) => {
      const sourceCell = calendarCellsByDate.get(target.dataset.date);
      target.style.transition = "none";
      target.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      target.style.zIndex = "1";
      // The flying week cell visually IS this calendar cell now — leaving
      // the original in place too would show both at once (the calendar
      // row sitting still while a "duplicate" flies away from it).
      if (sourceCell) sourceCell.style.visibility = "hidden";
    });
    others.forEach((c) => {
      c.style.transition = "none";
    });
    if (panel) {
      panel.style.height = startHeight + "px";
      panel.style.overflow = "hidden";
    }
    // The month nav fades out on its own timeline, but doesn't block
    // anything else from starting right away — nothing should sit frozen
    // waiting for it.
    if (nav) {
      nav.style.transition = `opacity ${NAV_FADE_MS}ms ease`;
      nav.style.opacity = "0";
    }
    if (weekdaysHeader) weekdaysHeader.style.transition = "none";

    void weekWrap.offsetHeight;

    requestAnimationFrame(() => {
      matched.forEach((target) => {
        target.style.transition = `transform ${ROW_MOVE_MS}ms linear`;
        target.style.transform = "none";
      });
      others.forEach((c) => {
        c.style.transition = `opacity ${OTHERS_SHRINK_MS}ms ease, transform ${OTHERS_SHRINK_MS}ms ease`;
        c.style.opacity = "0";
        c.style.transform = "scale(0.5)";
      });
      // The 일월화수목금토 labels were sitting untouched above the grid,
      // still fully visible after everything else had faded/moved away —
      // a lingering afterimage. Fades out with the rest of the grid.
      if (weekdaysHeader) {
        weekdaysHeader.style.transition = `opacity ${OTHERS_SHRINK_MS}ms ease`;
        weekdaysHeader.style.opacity = "0";
      }
      if (panel) {
        panel.style.transition = `height ${PANEL_SHRINK_MS}ms ease`;
        panel.style.height = endHeight + "px";
      }
    });

    setTimeout(() => {
      section.hidden = true;
      matched.forEach((target) => {
        target.style.transition = "";
        target.style.transform = "";
        target.style.zIndex = "";
      });
      others.forEach((c) => {
        c.style.transition = "";
        c.style.opacity = "";
        c.style.transform = "";
      });
      if (panel) {
        panel.style.height = "";
        panel.style.overflow = "";
        panel.style.transition = "";
      }
      if (nav) {
        nav.style.transition = "";
        nav.style.opacity = "";
      }
      if (weekdaysHeader) {
        weekdaysHeader.style.transition = "";
        weekdaysHeader.style.opacity = "";
      }
    }, Math.max(NAV_FADE_MS, ROW_MOVE_MS, OTHERS_SHRINK_MS, PANEL_SHRINK_MS) + 30);
    return true;
  }

  function init() {
    TYPES.forEach((t) => {
      const addRow = document.getElementById(t.addRowId);
      if (addRow) addRow.appendChild(makeAddTrigger((label) => handleAdd(t.key, label)));
    });

    document.getElementById("routinePrevMonthBtn")?.addEventListener("click", () => {
      calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() - 1, 1);
      renderRateCalendar();
    });
    document.getElementById("routineNextMonthBtn")?.addEventListener("click", () => {
      calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() + 1, 1);
      renderRateCalendar();
    });

    document.getElementById("toggleRoutineCalendarBtn")?.addEventListener("click", () => {
      const section = document.getElementById("routineCalendarSection");
      setCalendarExpanded(section.hidden);
    });

    window.addEventListener("resize", () => {
      clearTimeout(responsiveResizeTimer);
      // Debounced so a window being actively dragged wider/narrower doesn't
      // fire the (fairly involved) FLIP animation on every intermediate
      // pixel — only once movement settles.
      responsiveResizeTimer = setTimeout(checkResponsiveCalendarLayout, 200);
    });

    renderAll();
    checkResponsiveCalendarLayout();
  }

  // Sets the calendar expanded/collapsed, running the matching FLIP
  // animation and keeping the toggle button in sync — shared by the manual
  // toggle click and the width-based auto layout below.
  function setCalendarExpanded(expanding) {
    if (toggleAnimating) return;
    const btn = document.getElementById("toggleRoutineCalendarBtn");
    let didAnimate;
    if (expanding) {
      calendarViewDate = new Date();
      didAnimate = expandCalendarAnimated();
    } else {
      didAnimate = collapseCalendarAnimated();
    }
    // Both functions can take an early, fully-instant bailout path (nothing
    // to FLIP from — e.g. no usable layout to measure) — locking the
    // toggle for the full worst-case 650ms even then meant the button (and
    // the width-based auto-expand/collapse check below, which also checks
    // this flag) stayed unresponsive for no visual reason. Only lock when
    // a real animation actually started.
    if (didAnimate) {
      toggleAnimating = true;
      setTimeout(() => {
        toggleAnimating = false;
      }, 650); // covers the longer of the two animations (expand's cleanup now fires at 610ms)
    }
    if (btn) {
      btn.textContent = expanding ? "▾" : "▸";
      btn.setAttribute("aria-expanded", String(expanding));
    }
  }

  let responsiveResizeTimer = null;

  // Auto-expands the calendar (moving the checklists beside it) once the
  // window is wide enough to fit both comfortably, without needing a manual
  // click. Once open (whether opened this way or by hand), it stays open —
  // narrowing the window back below that just drops the checklists back to
  // stacked below it and lets the calendar use the full width again; only
  // the manual toggle actually closes it. See expandCalendarAnimated()'s
  // comment for why side-by-side-ness and the fit-to-viewport width are
  // tied together in the first place.
  function checkResponsiveCalendarLayout() {
    if (toggleAnimating) return;
    const layout = document.getElementById("routineLayout");
    const section = document.getElementById("routineCalendarSection");
    const panel = document.getElementById("routineWeekPanel");
    if (!layout || !section || !panel) return;
    const width = layout.getBoundingClientRect().width;
    if (width === 0) return; // view not currently visible — nothing to measure yet

    const fits = canFitSideBySide(width);
    const isExpanded = !section.hidden;

    if (fits && !isExpanded) {
      setCalendarExpanded(true);
      return;
    }
    if (!isExpanded) return; // stays collapsed; nothing else to reconcile

    const isSideBySide = layout.classList.contains("calendar-expanded");
    if (fits !== isSideBySide) animateChecklistsLayout(fits);

    if (fits) {
      const fit = computeCalendarFit();
      panel.style.maxWidth = fit.width + "px";
      layout.style.marginTop = fit.marginTop ? fit.marginTop + "px" : "";
    } else {
      panel.style.maxWidth = "";
      layout.style.marginTop = "";
    }
  }

  // onShow used to be just checkResponsiveCalendarLayout (a layout-fit
  // check), so a change made elsewhere (e.g. cloud sync pulling in another
  // device's edits) while this tab wasn't active never showed up until a
  // full page reload — same gap already fixed for practice/study/vongole/
  // exercise, just missed here since this tab already had *some* onShow.
  window.RoutineView = {
    init,
    onShow: () => {
      renderAll();
      checkResponsiveCalendarLayout();
    },
  };
})();
