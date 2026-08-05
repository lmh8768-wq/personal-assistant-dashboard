(function () {
  let viewDate = new Date();
  let selectedDate = new Date();
  // Set by the prev/next month buttons right before renderCalendar() runs,
  // so it knows which way to animate; 0 means "just redraw", no page-turn.
  let monthNavDirection = 0;
  let editingId = null;
  let editingOccurrenceDate = null;
  let categoryFilter = null;
  let scheduleSelectMode = false;
  let scheduleSelectedIds = new Set();

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const DEFAULT_IMPORTANCE = 3;
  const HIDE_COMPLETED_KEY = "assistant.hideCompleted.v1";
  const UPCOMING_RANGE_KEY = "assistant.upcomingRangeDays.v1";
  const UPCOMING_RANGE_OPTIONS = [3, 7, 30];
  // Only ★4+ items get a title chip on the month calendar — showing every
  // occurrence there (this grid renders 42 cells per month) would crowd the
  // cell fast. Everything else still gets the plain "something's on today"
  // dot, so nothing disappears entirely.
  const CALENDAR_HIGHLIGHT_MIN_IMPORTANCE = 4;
  const CALENDAR_MAX_EVENT_CHIPS = 6;

  function loadHideCompleted() {
    try {
      return localStorage.getItem(HIDE_COMPLETED_KEY) === "true";
    } catch {
      return false;
    }
  }

  let hideCompleted = loadHideCompleted();

  function loadUpcomingRangeDays() {
    try {
      const saved = Number(localStorage.getItem(UPCOMING_RANGE_KEY));
      return UPCOMING_RANGE_OPTIONS.includes(saved) ? saved : 7;
    } catch {
      return 7;
    }
  }

  let upcomingRangeDays = loadUpcomingRangeDays();

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toDateStr(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  // Local-time-only date convention (why not `new Date(s)`) — see
  // scripts/schedule-recurrence.js's parseDateStr.
  function parseDateStr(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function buildMonthGrid(year, month) {
    const firstOfMonth = new Date(year, month, 1);
    const start = new Date(year, month, 1 - firstOfMonth.getDay());
    const days = [];
    for (let i = 0; i < 42; i++) {
      days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }
    return days;
  }

  function formatDayLabel(d) {
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  }

  function getCategoryColor(key) {
    return (window.CategoryStore && window.CategoryStore.getByKey(key || "etc").color) || "#94a3b8";
  }

  function getCategoryLabel(key) {
    return (window.CategoryStore && window.CategoryStore.getByKey(key || "etc").label) || "기타";
  }

  function buildImportanceStars(importance) {
    const value = importance || DEFAULT_IMPORTANCE;
    const wrap = document.createElement("span");
    wrap.className = "schedule-item-stars";
    for (let i = 1; i <= 5; i++) {
      const star = document.createElement("span");
      star.className = i <= value ? "star-filled" : "star-empty";
      star.textContent = "★";
      wrap.appendChild(star);
    }
    return wrap;
  }

  function applyHideCompleted(items) {
    if (!hideCompleted) return items;
    return items.filter((item) => !(item.completedDates || []).includes(item.occurrenceDate));
  }

  function applyCategoryFilter(items) {
    if (!categoryFilter) return items;
    return items.filter((item) => (item.category || "etc") === categoryFilter);
  }

  // Applies the day's saved manual order, if any; otherwise (or for items
  // added since the order was last saved) falls back to importance order.
  // Pinned items then float above everything else regardless, in whatever
  // relative order they came out of the step above.
  //
  // `preloaded`, when given, is { orderMap, pinnedOrder } already read from
  // ScheduleOrderStore.getAll()/SchedulePinnedOrderStore.get() once by the
  // caller — the month calendar calls this once per cell (42×/render) and
  // would otherwise re-read+re-parse both stores from localStorage on every
  // one of those instead of once for the whole grid. Callers with just one
  // date to look up (moveWithinDay) can skip it and let this fetch fresh.
  function applyCustomOrder(dateStr, items, preloaded) {
    const savedOrder = preloaded ? preloaded.orderMap[dateStr] || [] : window.ScheduleOrderStore.get(dateStr);
    let ordered;
    if (savedOrder.length === 0) {
      ordered = [...items].sort((a, b) => (b.importance || 0) - (a.importance || 0));
    } else {
      const orderIndex = new Map(savedOrder.map((id, i) => [id, i]));
      const known = items
        .filter((item) => orderIndex.has(item.id))
        .sort((a, b) => orderIndex.get(a.id) - orderIndex.get(b.id));
      const unknown = items
        .filter((item) => !orderIndex.has(item.id))
        .sort((a, b) => (b.importance || 0) - (a.importance || 0));
      ordered = [...known, ...unknown];
    }
    const pinned = ordered.filter((item) => item.pinned);
    const rest = ordered.filter((item) => !item.pinned);

    // The pinned subset's relative order defaults to whatever came out of
    // the day-specific step above, but a saved global order (see
    // SchedulePinnedOrderStore) — established once the user confirms a
    // reorder should apply everywhere — takes precedence when present.
    const pinnedOrder = preloaded ? preloaded.pinnedOrder : window.SchedulePinnedOrderStore.get();
    const pinnedOrderIndex = new Map(pinnedOrder.map((id, i) => [id, i]));
    const sortedPinned = [...pinned].sort((a, b) => {
      const ai = pinnedOrderIndex.has(a.id) ? pinnedOrderIndex.get(a.id) : Infinity;
      const bi = pinnedOrderIndex.has(b.id) ? pinnedOrderIndex.get(b.id) : Infinity;
      return ai - bi;
    });

    return [...sortedPinned, ...rest];
  }

  // Repositions `draggedId` relative to `targetId` within the FULL (unfiltered)
  // order for that day, so items hidden by the current category/completed
  // filters keep their relative position even though they weren't visible
  // to drag against. If the reorder was between two PINNED items, asks
  // whether that relative order should also apply on every other day.
  function moveWithinDay(dateStr, draggedId, targetId, insertBefore, cursorPos) {
    if (draggedId === targetId) return;
    const fullOrder = applyCustomOrder(dateStr, window.ScheduleStore.getOccurrences(dateStr));
    const pinnedIds = new Set(fullOrder.filter((item) => item.pinned).map((item) => item.id));

    const ids = fullOrder.map((item) => item.id);
    const fromIdx = ids.indexOf(draggedId);
    if (fromIdx === -1) return;
    ids.splice(fromIdx, 1);
    let toIdx = ids.indexOf(targetId);
    if (toIdx === -1) toIdx = ids.length;
    else if (!insertBefore) toIdx += 1;
    ids.splice(toIdx, 0, draggedId);
    window.ScheduleOrderStore.set(dateStr, ids);

    if (pinnedIds.has(draggedId) && pinnedIds.has(targetId) && window.Toast) {
      const newPinnedOrder = ids.filter((id) => pinnedIds.has(id));
      window.Toast.show("고정된 일정의 순서를 다른 날짜에도 적용할까요?", {
        duration: 6000,
        position: cursorPos,
        actions: [
          {
            label: "네, 적용",
            onAction: () => {
              window.SchedulePinnedOrderStore.set(newPinnedOrder);
              refreshAll();
            },
          },
          { label: "아니요, 오늘만", onAction: () => {} },
        ],
      });
    }
  }

  // `reorderDateStr`, when passed, turns on drag-to-reorder among the day
  // list's own items (as opposed to the existing drag-onto-a-calendar-cell
  // behavior, which reschedules the item and applies everywhere already).
  function renderScheduleItem(item, onClick, reorderDateStr) {
    const li = document.createElement("li");
    li.className = "schedule-item";
    li.draggable = true;
    li.dataset.scheduleItemId = item.id;
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", item.id);
      e.dataTransfer.effectAllowed = "move";
    });

    if (reorderDateStr) {
      li.addEventListener("dragover", (e) => {
        e.preventDefault();
        const rect = li.getBoundingClientRect();
        const before = e.clientY - rect.top < rect.height / 2;
        li.classList.toggle("drag-over-before", before);
        li.classList.toggle("drag-over-after", !before);
      });
      li.addEventListener("dragleave", () => {
        li.classList.remove("drag-over-before", "drag-over-after");
      });
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        li.classList.remove("drag-over-before", "drag-over-after");
        const draggedId = e.dataTransfer.getData("text/plain");
        if (!draggedId) return;
        const rect = li.getBoundingClientRect();
        const before = e.clientY - rect.top < rect.height / 2;
        moveWithinDay(reorderDateStr, draggedId, item.id, before, { x: e.clientX, y: e.clientY });
        renderDayList();
      });
      // Drag-and-drop had no keyboard equivalent — same Alt+↑/↓ pattern
      // already used for the goal trees (practice.js/study.js). Reorders
      // among the day's full (unfiltered) item order via the same
      // moveWithinDay the mouse drag uses, so pinned/hidden-by-filter items
      // keep working identically either way.
      li.tabIndex = 0;
      li.title = "Alt+↑/↓ 키로 순서를 바꿀 수 있어요";
      li.addEventListener("keydown", (e) => {
        if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        if (e.target !== li) return; // let a nested checkbox/button handle its own keys
        e.preventDefault();
        const fullOrder = applyCustomOrder(reorderDateStr, window.ScheduleStore.getOccurrences(reorderDateStr));
        const idx = fullOrder.findIndex((it) => it.id === item.id);
        const targetIdx = e.key === "ArrowUp" ? idx - 1 : idx + 1;
        if (idx === -1 || targetIdx < 0 || targetIdx >= fullOrder.length) return;
        moveWithinDay(reorderDateStr, item.id, fullOrder[targetIdx].id, e.key === "ArrowUp");
        renderDayList();
        requestAnimationFrame(() => {
          // Scoped to #scheduleList specifically — the dashboard's "오늘의
          // 일정"/"다가오는 일정" widgets render this same schedule item
          // (same id, same .schedule-item class) into their own lists too,
          // which stay in the DOM (just [hidden]) when on the schedule tab.
          // An unscoped selector matched whichever came first in DOM order,
          // which could be one of those hidden copies — focus() on a hidden
          // element is a silent no-op, so this used to leave focus on
          // <body> instead of the reordered row.
          document.querySelector(`#scheduleList .schedule-item[data-schedule-item-id="${item.id}"]`)?.focus();
        });
      });
    }

    const isDone = (item.completedDates || []).includes(item.occurrenceDate);
    if (isDone) li.classList.add("completed");

    const categoryDot = document.createElement("span");
    categoryDot.className = "schedule-item-category-dot";
    categoryDot.style.background = getCategoryColor(item.category);
    categoryDot.title = getCategoryLabel(item.category);
    li.appendChild(categoryDot);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "schedule-item-checkbox";
    checkbox.checked = isDone;
    checkbox.setAttribute("aria-label", "완료 표시");
    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      window.ScheduleStore.toggleCompleted(item.id, item.occurrenceDate);
      refreshAll();
    });
    li.appendChild(checkbox);

    const body = document.createElement("div");
    body.className = "schedule-item-body";

    const title = document.createElement("div");
    title.className = "schedule-item-title";
    title.textContent = item.title;
    if (item.pinned) {
      const pin = document.createElement("span");
      pin.className = "schedule-item-badge";
      pin.textContent = "📌";
      pin.title = "목록 맨 위에 고정됨";
      title.appendChild(pin);
    }
    if (item.repeat && item.repeat.type !== "none") {
      const badge = document.createElement("span");
      badge.className = "schedule-item-badge";
      badge.textContent = "🔁";
      title.appendChild(badge);
    }
    if (item.checklist && item.checklist.length > 0) {
      const done = item.checklist.filter((c) => c.done).length;
      const badge = document.createElement("span");
      badge.className = "schedule-item-checklist-badge";
      badge.textContent = `☑ ${done}/${item.checklist.length}`;
      title.appendChild(badge);
    }
    title.appendChild(buildImportanceStars(item.importance));
    body.appendChild(title);

    if (item.memo) {
      const memo = document.createElement("div");
      memo.className = "schedule-item-memo";
      memo.textContent = item.memo;
      body.appendChild(memo);
    }

    li.appendChild(body);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "schedule-item-delete";
    deleteBtn.textContent = "×";
    deleteBtn.setAttribute("aria-label", "일정 삭제");
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      requestDelete(item);
    });
    li.appendChild(deleteBtn);

    li.addEventListener("click", () => onClick(item));
    return li;
  }

  // ---------- Calendar area (month view) ----------
  function renderCalendarArea() {
    renderCalendar();
  }

  // The actual compute/apply logic lives in scripts/calendar-fit.js now —
  // shared with ledger.js, which used to hand-maintain an identical copy.
  function applyScheduleCalendarFit() {
    window.CalendarFit.apply({ layoutId: "scheduleLayout", panelId: "calendarPanel", gridId: "calendarGrid" });
  }

  let scheduleResizeTimer = null;

  function buildCalendarCell(d, isOutside, preloaded) {
    const dStr = toDateStr(d);
    const todayStr = toDateStr(new Date());
    const selectedStr = toDateStr(selectedDate);

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day";
    if (isOutside) cell.classList.add("outside");
    if (dStr === todayStr) cell.classList.add("today");
    if (dStr === selectedStr) cell.classList.add("selected");
    window.CalendarFit.applyWeekendClass(cell, d);
    // A screen reader used to hear just the bare day number, 42 times a
    // month, with no month/year context and no way to tell "today" or
    // "selected" apart from any other day.
    const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
    const dateLabel = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAY_NAMES[d.getDay()]}요일`;
    cell.setAttribute(
      "aria-label",
      dateLabel + (dStr === todayStr ? " (오늘)" : "") + (dStr === selectedStr ? " (선택됨)" : "")
    );
    if (dStr === todayStr) cell.setAttribute("aria-current", "date");
    cell.setAttribute("aria-pressed", String(dStr === selectedStr));

    const topRow = document.createElement("div");
    topRow.className = "calendar-day-top";
    const num = document.createElement("span");
    num.className = "day-number";
    num.textContent = d.getDate();
    topRow.appendChild(num);
    cell.appendChild(topRow);

    const holidayName = window.KoreanHolidays && window.KoreanHolidays[dStr];
    if (holidayName) {
      cell.classList.add("holiday");
      const holiday = document.createElement("span");
      holiday.className = "calendar-day-holiday";
      holiday.textContent = holidayName;
      holiday.title = holidayName;
      cell.appendChild(holiday);
    }

    // ★4+ schedules show their own title right on the calendar; anything
    // less important just gets folded into the plain "something's on
    // today" dot.
    const occurrences = preloaded
      ? window.ScheduleRecurrence.getOccurrences(preloaded.schedules, dStr)
      : window.ScheduleStore.getOccurrences(dStr);
    const dayItems = applyCustomOrder(dStr, occurrences, preloaded);
    const highlighted = dayItems.filter((item) => (item.importance || DEFAULT_IMPORTANCE) >= CALENDAR_HIGHLIGHT_MIN_IMPORTANCE);
    const hasLowerImportance = dayItems.some((item) => (item.importance || DEFAULT_IMPORTANCE) < CALENDAR_HIGHLIGHT_MIN_IMPORTANCE);

    if (highlighted.length > 0) {
      const eventsWrap = document.createElement("div");
      eventsWrap.className = "calendar-day-events";
      highlighted.slice(0, CALENDAR_MAX_EVENT_CHIPS).forEach((item) => {
        const chip = document.createElement("span");
        chip.className = "calendar-day-event-chip";
        chip.style.background = getCategoryColor(item.category);
        chip.textContent = item.title;
        chip.title = item.title;
        eventsWrap.appendChild(chip);
      });
      if (highlighted.length > CALENDAR_MAX_EVENT_CHIPS) {
        const more = document.createElement("span");
        more.className = "calendar-day-event-more";
        more.textContent = `+${highlighted.length - CALENDAR_MAX_EVENT_CHIPS}`;
        eventsWrap.appendChild(more);
      }
      cell.appendChild(eventsWrap);
    }

    if (hasLowerImportance) {
      const dot = document.createElement("span");
      dot.className = "dot";
      topRow.appendChild(dot);
    }

    cell.addEventListener("click", () => {
      selectedDate = d;
      if (d.getMonth() !== viewDate.getMonth()) {
        viewDate = new Date(d.getFullYear(), d.getMonth(), 1);
      }
      renderCalendarArea();
      renderDayList();
    });

    cell.addEventListener("dragover", (e) => {
      e.preventDefault();
      cell.classList.add("drag-over");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      cell.classList.remove("drag-over");
      const id = e.dataTransfer.getData("text/plain");
      if (!id) return;
      window.ScheduleStore.update(id, { date: dStr });
      refreshAll();
    });

    return cell;
  }

  function renderCalendar() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    document.getElementById("calendarTitle").textContent = `${year}년 ${month + 1}월`;

    const grid = document.getElementById("calendarGrid");
    const direction = monthNavDirection;
    monthNavDirection = 0;

    // Page-turn effect: freeze the outgoing month as an absolutely-positioned
    // ghost that slides out over the grid, while the grid itself (already
    // holding the new month, since rebuild happens below) is pre-positioned
    // off to the entry side and slides into place. Without this, rebuilding
    // the grid's innerHTML would just swap content instantly with nothing
    // for a CSS transition to animate from.
    grid.parentElement.querySelectorAll(".calendar-grid-ghost").forEach((el) => el.remove());

    let ghost = null;
    if (direction && grid.children.length) {
      ghost = grid.cloneNode(true);
      ghost.removeAttribute("id");
      ghost.classList.add("calendar-grid-ghost");
      grid.parentElement.appendChild(ghost);
    }

    if (ghost) {
      grid.classList.remove("month-nav-animating");
      grid.style.transform = `translateX(${direction > 0 ? "100%" : "-100%"})`;
      grid.style.opacity = "0";
    }

    grid.innerHTML = "";
    // Loaded once for all 42 cells instead of each cell independently
    // re-reading+re-parsing the same three localStorage-backed stores.
    const preloaded = {
      schedules: window.ScheduleStore.getAll(),
      orderMap: window.ScheduleOrderStore.getAll(),
      pinnedOrder: window.SchedulePinnedOrderStore.get(),
    };
    buildMonthGrid(year, month).forEach((d) => {
      grid.appendChild(buildCalendarCell(d, d.getMonth() !== month, preloaded));
    });

    if (ghost) {
      // Force layout so the pre-transition transform above actually takes
      // hold before the class/transform change below is animated.
      void grid.offsetWidth;
      grid.classList.add("month-nav-animating");
      grid.style.transform = "translateX(0)";
      grid.style.opacity = "1";
      grid.addEventListener(
        "transitionend",
        () => {
          grid.classList.remove("month-nav-animating");
          grid.style.transform = "";
          grid.style.opacity = "";
        },
        { once: true }
      );

      requestAnimationFrame(() => {
        ghost.style.transform = `translateX(${direction > 0 ? "-100%" : "100%"})`;
        ghost.style.opacity = "0";
      });
      ghost.addEventListener("transitionend", () => ghost.remove(), { once: true });
      setTimeout(() => ghost.remove(), 500);
    }
  }

  // ---------- Filter bar ----------
  function renderScheduleFilterBar() {
    const bar = document.getElementById("scheduleFilterBar");
    if (!bar) return;
    bar.innerHTML = "";

    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "schedule-filter-chip" + (!categoryFilter ? " active" : "");
    allChip.textContent = "전체";
    allChip.addEventListener("click", () => {
      categoryFilter = null;
      renderScheduleFilterBar();
      renderDayList();
    });
    bar.appendChild(allChip);

    window.CategoryStore.getAll().forEach((cat) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "schedule-filter-chip" + (categoryFilter === cat.key ? " active" : "");

      const dot = document.createElement("span");
      dot.className = "schedule-filter-chip-dot";
      dot.style.background = cat.color;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(cat.label));

      chip.addEventListener("click", () => {
        categoryFilter = categoryFilter === cat.key ? null : cat.key;
        renderScheduleFilterBar();
        renderDayList();
      });
      bar.appendChild(chip);
    });
  }

  // ---------- Day panel ----------
  function updateScheduleSelectToolbar() {
    const toolbar = document.getElementById("scheduleSelectToolbar");
    if (!toolbar) return;
    toolbar.hidden = !scheduleSelectMode;
    const countEl = document.getElementById("scheduleSelectCount");
    if (countEl) countEl.textContent = `${scheduleSelectedIds.size}개 선택됨`;
  }

  function renderDayList() {
    document.getElementById("selectedDateLabel").textContent = formatDayLabel(selectedDate);

    const list = document.getElementById("scheduleList");
    list.innerHTML = "";

    const dateStr = toDateStr(selectedDate);
    let items = applyCustomOrder(dateStr, window.ScheduleStore.getOccurrences(dateStr));
    items = applyCategoryFilter(items);
    items = applyHideCompleted(items);

    if (items.length === 0) {
      list.innerHTML = `<li class="schedule-empty"><span class="empty-icon">🗓️</span>이 날에는 일정이 없어요</li>`;
      return;
    }

    items.forEach((item) => {
      const key = `${item.id}::${item.occurrenceDate}`;
      // `li` is assigned right after this (still within the same closure) —
      // toggling a selection used to call renderDayList() and tear down/
      // rebuild every row in the list just to flip one .selected class.
      // Patching this one row directly in place avoids that, same reasoning
      // as patchGoalDoneAncestors in practice.js.
      let li;
      const onClick = scheduleSelectMode
        ? () => {
            if (scheduleSelectedIds.has(key)) scheduleSelectedIds.delete(key);
            else scheduleSelectedIds.add(key);
            li.classList.toggle("selected", scheduleSelectedIds.has(key));
            updateScheduleSelectToolbar();
          }
        : (it) => openModal("edit", it);
      li = renderScheduleItem(item, onClick, dateStr);
      if (scheduleSelectMode) {
        li.classList.add("selectable");
        if (scheduleSelectedIds.has(key)) li.classList.add("selected");
      }
      list.appendChild(li);
    });
  }

  // Dropping past the last item (in the empty space below the list, or on
  // the list container itself rather than a specific item) moves the
  // dragged item to the very end of that day's order. Attached once — the
  // <ul> element itself persists across renderDayList() calls, so wiring
  // this inside renderDayList would keep stacking duplicate listeners.
  function initDayListDropZone() {
    const list = document.getElementById("scheduleList");
    if (!list) return;
    list.addEventListener("dragover", (e) => e.preventDefault());
    list.addEventListener("drop", (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData("text/plain");
      if (!draggedId) return;
      const dateStr = toDateStr(selectedDate);
      const fullOrder = applyCustomOrder(dateStr, window.ScheduleStore.getOccurrences(dateStr));
      const lastId = fullOrder[fullOrder.length - 1]?.id;
      if (lastId) moveWithinDay(dateStr, draggedId, lastId, false, { x: e.clientX, y: e.clientY });
      renderDayList();
    });
  }

  function renderTemplateChips() {
    const row = document.getElementById("templateChipRow");
    if (!row) return;
    const templates = window.TemplateStore.getAll();
    row.innerHTML = "";

    templates.forEach((tpl) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "template-chip";
      chip.style.borderColor = getCategoryColor(tpl.category);

      const label = document.createElement("span");
      label.textContent = tpl.title;
      chip.appendChild(label);

      // Not wired up for keyboard access like the other "×" controls in this
      // app (see window.makeKeyboardActivatable) — this span sits nested
      // inside `chip`, itself a <button>, and making a span inside a button
      // separately focusable is invalid nested-interactive-content markup.
      // Fixing it properly means pulling this out to a sibling button
      // instead of a nested span, which touches template-chip's CSS: not
      // done here since nothing in the app ever calls TemplateStore.add()
      // (confirmed via search), so this row can never actually render a
      // chip today regardless.
      const remove = document.createElement("span");
      remove.className = "template-chip-remove";
      remove.textContent = "×";
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        window.TemplateStore.remove(tpl.id);
        renderTemplateChips();
      });
      chip.appendChild(remove);

      chip.addEventListener("click", () => {
        window.ScheduleStore.add({
          title: tpl.title,
          date: toDateStr(selectedDate),
          memo: "",
          category: tpl.category,
          importance: tpl.importance,
          repeat: { type: "none", until: null },
          checklist: [],
        });
        refreshAll();
        window.Toast.show(`"${tpl.title}" 일정을 추가했어요`);
      });

      row.appendChild(chip);
    });
  }

  function renderDashboardSchedule() {
    const list = document.getElementById("dashboardScheduleList");
    if (!list) return;

    const items = window.ScheduleStore.getOccurrences(toDateStr(new Date()));

    const completedCount = items.filter((item) =>
      (item.completedDates || []).includes(item.occurrenceDate)
    ).length;

    const pendingCount = items.length - completedCount;

    document.title = pendingCount > 0 ? `(${pendingCount}) 비서 | 개인 대시보드` : "비서 | 개인 대시보드";

    const fillEl = document.getElementById("completionRateFill");
    const valueEl = document.getElementById("completionRateValue");
    const rate = items.length === 0 ? null : completedCount / items.length;
    if (fillEl) {
      const percent = rate === null ? 0 : Math.round(rate * 100);
      fillEl.style.width = `${percent}%`;
      // The percentage is also shown as adjacent text (valueEl below), but
      // the bar itself carried none of it — a screen reader user relying on
      // the bar rather than hunting for the nearby text got nothing.
      fillEl.setAttribute("role", "progressbar");
      fillEl.setAttribute("aria-valuenow", String(percent));
      fillEl.setAttribute("aria-valuemin", "0");
      fillEl.setAttribute("aria-valuemax", "100");
    }
    if (valueEl) {
      valueEl.textContent =
        rate === null ? "오늘 일정 없음" : `${completedCount}/${items.length} · ${Math.round(rate * 100)}%`;
    }

    const displayItems = applyHideCompleted(items);
    list.innerHTML = "";
    if (displayItems.length === 0) {
      list.innerHTML = `<li class="schedule-empty"><span class="empty-icon">🗓️</span>오늘 등록된 일정이 없어요</li>`;
      return;
    }
    displayItems.forEach((item) => list.appendChild(renderScheduleItem(item, (it) => openModal("edit", it))));
  }

  function formatShortDate(dateStr) {
    const d = parseDateStr(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
  }

  function renderUpcoming() {
    const list = document.getElementById("dashboardUpcomingList");
    if (!list) return;

    const today = new Date();
    const items = [];
    for (let i = 1; i <= upcomingRangeDays; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      items.push(...window.ScheduleStore.getOccurrences(toDateStr(d)));
    }

    const importantItems = items.filter((item) => (item.importance || 0) >= 4);
    const displayItems = applyHideCompleted(importantItems);
    list.innerHTML = "";
    if (displayItems.length === 0) {
      list.innerHTML = `<li class="schedule-empty"><span class="empty-icon">📭</span>다가오는 중요 일정이 없어요</li>`;
      return;
    }
    displayItems.slice(0, 8).forEach((item) => {
      const li = renderScheduleItem(item, (it) => openModal("edit", it));
      const titleEl = li.querySelector(".schedule-item-title");
      if (titleEl) {
        const dateBadge = document.createElement("span");
        dateBadge.className = "schedule-item-upcoming-date";
        dateBadge.textContent = formatShortDate(item.occurrenceDate);
        titleEl.prepend(dateBadge);
      }
      list.appendChild(li);
    });
  }

  function refreshDashboard() {
    renderDashboardSchedule();
    renderUpcoming();
  }

  // Categories are freely deletable now — if the one currently filtered on
  // was just deleted (e.g. from 설정), drop the filter back to "전체" rather
  // than leaving the day list filtered on a key nothing can ever match
  // again, with no visible indication a filter is even still active.
  function validateCategoryFilter() {
    if (categoryFilter && !window.CategoryStore.getAll().some((c) => c.key === categoryFilter)) {
      categoryFilter = null;
    }
  }

  function refreshAll() {
    validateCategoryFilter();
    renderCalendarArea();
    renderDayList();
    renderTemplateChips();
    renderScheduleFilterBar();
    refreshDashboard();
  }

  // ---------- Modal ----------
  function updateRepeatFieldsVisibility() {
    const repeatType = document.getElementById("scheduleRepeatInput").value;
    const isRepeating = repeatType !== "none";
    document.getElementById("repeatUntilRow").hidden = !isRepeating;
    document.getElementById("repeatNote").hidden = !isRepeating;
    document.getElementById("schedulePinnedRow").hidden = !isRepeating;
    if (!isRepeating) document.getElementById("schedulePinnedInput").checked = false;
    updateRepeatUntilDateVisibility();
  }

  function updateRepeatUntilDateVisibility() {
    const mode = document.getElementById("scheduleRepeatUntilModeInput").value;
    document.getElementById("repeatUntilDateRow").hidden = mode !== "date";
  }

  function paintImportanceStars(value) {
    document.querySelectorAll("#scheduleImportanceStars .star-btn").forEach((btn) => {
      const starValue = Number(btn.dataset.value);
      btn.classList.toggle("filled", starValue <= value);
    });
    document.getElementById("scheduleImportanceInput").value = String(value);
  }

  // desiredValue is the category to select — either the item's own
  // (already-saved) category, or undefined for a brand-new item. Either way,
  // that category may no longer exist (categories are freely deletable now)
  // — setting select.value to a key with no matching <option> just leaves
  // nothing selected rather than falling back to anything, so that case is
  // handled explicitly here instead of relying on the browser to do it.
  // The filter pills elsewhere show each category's color as a dot;
  // #scheduleCategoryDot mirrors that next to this plain <select> so
  // picking a category here isn't the one place in the app where category
  // color goes unrepresented. Kept in sync on both the initial value set
  // here and every subsequent manual selection (see the "change" listener
  // wired in init()).
  function updateCategorySelectDot() {
    const select = document.getElementById("scheduleCategoryInput");
    const dot = document.getElementById("scheduleCategoryDot");
    if (!select || !dot) return;
    dot.style.background = getCategoryColor(select.value);
  }

  function syncCategorySelectOptions(desiredValue) {
    const select = document.getElementById("scheduleCategoryInput");
    const categories = window.CategoryStore.getAll();
    select.innerHTML = "";
    categories.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat.key;
      opt.textContent = cat.label;
      select.appendChild(opt);
    });
    const hasDesired = categories.some((c) => c.key === desiredValue);
    select.value = hasDesired ? desiredValue : categories[0]?.key || "";
    updateCategorySelectDot();
  }

  function openModal(mode, data) {
    if (mode !== "edit" && window.CategoryStore.getAll().length === 0) {
      window.Toast?.show("먼저 카테고리를 추가해주세요", { type: "warning" });
      return;
    }
    editingId = mode === "edit" ? data.id : null;
    editingOccurrenceDate = mode === "edit" ? (data.occurrenceDate || data.date) : null;
    document.getElementById("modalTitle").textContent = mode === "edit" ? "일정 수정" : "일정 추가";
    document.getElementById("scheduleTitleInput").value = data?.title || "";
    document.getElementById("scheduleDateInput").value = data?.occurrenceDate || data?.date || toDateStr(selectedDate);
    document.getElementById("scheduleMemoInput").value = data?.memo || "";
    document.getElementById("scheduleRepeatInput").value = data?.repeat?.type || "none";
    const repeatUntilValue = data?.repeat?.until || "";
    document.getElementById("scheduleRepeatUntilModeInput").value = repeatUntilValue ? "date" : "never";
    document.getElementById("scheduleRepeatUntilInput").value = repeatUntilValue;
    document.getElementById("schedulePinnedInput").checked = !!data?.pinned;

    syncCategorySelectOptions(data?.category);
    paintImportanceStars(data?.importance || DEFAULT_IMPORTANCE);

    updateRepeatFieldsVisibility();
    document.getElementById("deleteScheduleBtn").hidden = mode !== "edit";
    document.getElementById("duplicateScheduleBtn").hidden = mode !== "edit";
    document.getElementById("scheduleModalOverlay").hidden = false;
    document.getElementById("scheduleTitleInput").focus();
  }

  function closeModal() {
    document.getElementById("scheduleModalOverlay").hidden = true;
    document.getElementById("scheduleForm").reset();
    updateRepeatFieldsVisibility();
    paintImportanceStars(DEFAULT_IMPORTANCE);
    editingId = null;
    editingOccurrenceDate = null;
  }

  function readPayloadFromForm() {
    const repeatType = document.getElementById("scheduleRepeatInput").value;
    const repeatUntilMode = document.getElementById("scheduleRepeatUntilModeInput").value;

    return {
      title: document.getElementById("scheduleTitleInput").value.trim(),
      date: document.getElementById("scheduleDateInput").value,
      memo: document.getElementById("scheduleMemoInput").value.trim(),
      repeat: {
        type: repeatType,
        until: repeatType !== "none" && repeatUntilMode === "date"
          ? (document.getElementById("scheduleRepeatUntilInput").value || null)
          : null,
      },
      importance: Number(document.getElementById("scheduleImportanceInput").value) || DEFAULT_IMPORTANCE,
      category: document.getElementById("scheduleCategoryInput").value,
      pinned: repeatType !== "none" && document.getElementById("schedulePinnedInput").checked,
    };
  }

  // ---------- Edit scope (single occurrence vs. this-and-following) ----------
  let pendingEditPayload = null;

  function openEditScopeModal(payload) {
    pendingEditPayload = payload;
    document.getElementById("scheduleModalOverlay").hidden = true;
    document.getElementById("editScopeModalOverlay").hidden = false;
  }

  function closeEditScopeModal() {
    document.getElementById("editScopeModalOverlay").hidden = true;
    document.getElementById("scheduleModalOverlay").hidden = false;
    pendingEditPayload = null;
  }

  function finalizeEdit(payload, wasEditing) {
    selectedDate = parseDateStr(payload.date);
    viewDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    closeModal();
    refreshAll();
    window.Toast.show(wasEditing ? "일정을 수정했어요" : "일정을 추가했어요");
  }

  function applyOccurrenceOnlyEdit() {
    if (!pendingEditPayload || !editingId) return;
    const occurrenceDate = editingOccurrenceDate;
    const payload = pendingEditPayload;
    const stored = window.ScheduleStore.getById(editingId);
    // Any repeat-setting change is silently dropped a few lines below (this
    // scope only ever patches this one occurrence's content, never the
    // series' repeat rule) — the modal never disables/hides the repeat
    // dropdown when "이 날짜만" is the scope actually being applied, so warn
    // instead of letting the user believe a change they just made took effect.
    const repeatChanged = stored?.repeat && payload.repeat.type !== stored.repeat.type;

    if (payload.date && payload.date !== occurrenceDate) {
      // Moving just this occurrence to a new date: pull it out of the series
      // and add it as a standalone one-off item on the new date.
      window.ScheduleStore.excludeOccurrence(editingId, occurrenceDate);
      window.ScheduleStore.add({ ...payload, repeat: { type: "none", until: null } });
    } else {
      const { date, repeat, ...contentPatch } = payload;
      window.ScheduleStore.setOccurrenceOverride(editingId, occurrenceDate, contentPatch);
    }

    document.getElementById("editScopeModalOverlay").hidden = true;
    pendingEditPayload = null;
    finalizeEdit(payload, true);
    if (repeatChanged) {
      window.Toast?.show("반복 설정 변경은 '이 날짜만'에는 적용되지 않아요 — 반복 전체를 바꾸려면 '이후 일정 모두'를 선택해주세요", {
        type: "warning",
        duration: 6000,
      });
    }
  }

  function applyFollowingEdit() {
    if (!pendingEditPayload || !editingId) return;
    const payload = pendingEditPayload;
    const { date, ...contentPatch } = payload;
    window.ScheduleStore.splitSeriesFrom(editingId, editingOccurrenceDate, contentPatch);

    document.getElementById("editScopeModalOverlay").hidden = true;
    pendingEditPayload = null;
    finalizeEdit(payload, true);
  }

  function handleSubmit(e) {
    e.preventDefault();
    const payload = readPayloadFromForm();
    if (!payload.title || !payload.date) {
      // A title of all spaces passes HTML5 `required` (it accepts any
      // non-empty string) but readPayloadFromForm() trims it — the modal
      // used to just sit there doing nothing with no explanation.
      window.Toast?.show("제목을 입력해주세요", { type: "error" });
      return;
    }
    if (payload.repeat.type !== "none" && payload.repeat.until && payload.repeat.until < payload.date) {
      // An "until" earlier than the start date used to save fine but could
      // never produce a single occurrence — a silent "empty" recurring item.
      window.Toast?.show("반복 종료일이 시작일보다 빠를 수 없어요", { type: "error" });
      return;
    }

    if (editingId) {
      const stored = window.ScheduleStore.getById(editingId);
      const isRecurring = !!(stored && stored.repeat && stored.repeat.type !== "none");
      if (isRecurring) {
        openEditScopeModal(payload);
        return;
      }
      window.ScheduleStore.update(editingId, payload);
      finalizeEdit(payload, true);
      return;
    }

    const created = window.ScheduleStore.add(payload);
    window.ScheduleOrderStore.prependToDay(payload.date, created.id);
    finalizeEdit(payload, false);
  }

  // ---------- Delete (single occurrence vs. whole recurring series) ----------
  let pendingDeleteItem = null;

  function requestDelete(item) {
    const repeat = item.repeat || { type: "none" };
    if (repeat.type === "none") {
      performDeleteAll(item);
      return;
    }
    pendingDeleteItem = item;
    document.getElementById("deleteScopeModalOverlay").hidden = false;
  }

  function closeDeleteScopeModal() {
    document.getElementById("deleteScopeModalOverlay").hidden = true;
    pendingDeleteItem = null;
  }

  function performDeleteOccurrence(item) {
    window.ScheduleStore.excludeOccurrence(item.id, item.occurrenceDate);
    refreshAll();
    if (window.Toast) {
      window.Toast.show("이 날짜의 일정을 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          window.ScheduleStore.includeOccurrence(item.id, item.occurrenceDate);
          refreshAll();
        },
      });
    }
  }

  function performDeleteAll(item) {
    const removed = window.ScheduleStore.getById(item.id);
    window.ScheduleStore.remove(item.id);
    refreshAll();
    if (removed && window.Toast) {
      window.Toast.show("일정을 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          window.ScheduleStore.add(removed);
          refreshAll();
        },
      });
    }
  }

  function handleDelete() {
    if (!editingId) return;
    const stored = window.ScheduleStore.getById(editingId);
    const occurrenceDate = editingOccurrenceDate || stored?.date;
    closeModal();
    if (stored) requestDelete({ ...stored, occurrenceDate });
  }

  function handleDuplicate() {
    if (!editingId) return;
    const original = window.ScheduleStore.getById(editingId);
    if (!original) return;
    const { id, completedDates, excludedDates, overrides, ...rest } = original;
    window.ScheduleStore.add(rest);
    closeModal();
    refreshAll();
    window.Toast.show(`"${original.title}" 일정을 복제했어요`);
  }

  function toggleHideCompleted() {
    hideCompleted = !hideCompleted;
    window.safeSetLocalStorage(HIDE_COMPLETED_KEY, String(hideCompleted));
    document.getElementById("toggleHideCompletedBtn").textContent = hideCompleted
      ? "완료 항목 보기"
      : "완료 항목 숨기기";
    refreshAll();
  }

  // ---------- Bulk select ----------
  function toggleScheduleSelectMode() {
    scheduleSelectMode = !scheduleSelectMode;
    scheduleSelectedIds.clear();
    document.getElementById("scheduleSelectModeBtn").textContent = scheduleSelectMode ? "선택 취소" : "선택";
    updateScheduleSelectToolbar();
    renderDayList();
  }

  function splitKey(key) {
    const idx = key.lastIndexOf("::");
    return [key.slice(0, idx), key.slice(idx + 2)];
  }

  function handleBulkComplete() {
    // Only the ones this action actually flipped to done get undone — an
    // item that was already complete before the bulk action shouldn't get
    // un-completed by an undo of a different action.
    const justCompleted = [];
    scheduleSelectedIds.forEach((key) => {
      const [id, occurrenceDate] = splitKey(key);
      const item = window.ScheduleStore.getById(id);
      if (!item) return;
      const isDone = (item.completedDates || []).includes(occurrenceDate);
      if (!isDone) {
        window.ScheduleStore.toggleCompleted(id, occurrenceDate);
        justCompleted.push({ id, occurrenceDate });
      }
    });
    const count = scheduleSelectedIds.size;
    scheduleSelectedIds.clear();
    scheduleSelectMode = false;
    document.getElementById("scheduleSelectModeBtn").textContent = "선택";
    updateScheduleSelectToolbar();
    refreshAll();
    window.Toast.show(`일정 ${count}개를 완료 처리했어요`, {
      actionLabel: "실행취소",
      onAction: () => {
        justCompleted.forEach(({ id, occurrenceDate }) => window.ScheduleStore.toggleCompleted(id, occurrenceDate));
        refreshAll();
      },
    });
  }

  function handleBulkDelete() {
    const ids = [...new Set([...scheduleSelectedIds].map((key) => splitKey(key)[0]))];
    const removedItems = ids.map((id) => window.ScheduleStore.getById(id)).filter(Boolean);
    ids.forEach((id) => window.ScheduleStore.remove(id));
    const count = removedItems.length;
    scheduleSelectedIds.clear();
    scheduleSelectMode = false;
    document.getElementById("scheduleSelectModeBtn").textContent = "선택";
    updateScheduleSelectToolbar();
    refreshAll();
    window.Toast.show(`일정 ${count}개를 삭제했어요`, {
      actionLabel: "실행취소",
      onAction: () => {
        window.ScheduleStore.addMany(removedItems);
        refreshAll();
      },
    });
  }

  function init() {
    document.getElementById("toggleHideCompletedBtn").textContent = hideCompleted
      ? "완료 항목 보기"
      : "완료 항목 숨기기";
    document.getElementById("toggleHideCompletedBtn").addEventListener("click", toggleHideCompleted);
    document.getElementById("duplicateScheduleBtn").addEventListener("click", handleDuplicate);

    const upcomingRangeSelect = document.getElementById("upcomingRangeSelect");
    if (upcomingRangeSelect) {
      upcomingRangeSelect.value = String(upcomingRangeDays);
      upcomingRangeSelect.addEventListener("change", (e) => {
        upcomingRangeDays = Number(e.target.value);
        window.safeSetLocalStorage(UPCOMING_RANGE_KEY, String(upcomingRangeDays));
        renderUpcoming();
      });
    }

    initDayListDropZone();

    document.getElementById("prevMonthBtn").addEventListener("click", () => {
      viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
      monthNavDirection = -1;
      renderCalendarArea();
    });

    document.getElementById("nextMonthBtn").addEventListener("click", () => {
      viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
      monthNavDirection = 1;
      renderCalendarArea();
    });

    document.getElementById("todayBtn").addEventListener("click", () => {
      const now = new Date();
      viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
      selectedDate = now;
      renderCalendarArea();
      renderDayList();
    });

    document.getElementById("addScheduleBtn").addEventListener("click", () => openModal("add"));

    document.getElementById("dashboardAddScheduleBtn").addEventListener("click", () => {
      selectedDate = new Date();
      openModal("add");
    });

    document.getElementById("scheduleForm").addEventListener("submit", handleSubmit);
    document.getElementById("cancelScheduleBtn").addEventListener("click", closeModal);
    document.getElementById("closeScheduleModalBtn").addEventListener("click", closeModal);
    document.getElementById("deleteScheduleBtn").addEventListener("click", handleDelete);
    document.getElementById("scheduleRepeatInput").addEventListener("change", updateRepeatFieldsVisibility);
    document.getElementById("scheduleCategoryInput").addEventListener("change", updateCategorySelectDot);
    document.getElementById("scheduleRepeatUntilModeInput").addEventListener("change", updateRepeatUntilDateVisibility);

    document.getElementById("scheduleSelectModeBtn").addEventListener("click", toggleScheduleSelectMode);
    document.getElementById("scheduleBulkCompleteBtn").addEventListener("click", handleBulkComplete);
    document.getElementById("scheduleBulkDeleteBtn").addEventListener("click", handleBulkDelete);

    document.querySelectorAll("#scheduleImportanceStars .star-btn").forEach((btn) => {
      btn.addEventListener("click", () => paintImportanceStars(Number(btn.dataset.value)));
    });

    document.getElementById("scheduleModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "scheduleModalOverlay") closeModal();
    });

    document.getElementById("deleteScopeOccurrenceBtn").addEventListener("click", () => {
      if (pendingDeleteItem) performDeleteOccurrence(pendingDeleteItem);
      closeDeleteScopeModal();
    });
    document.getElementById("deleteScopeAllBtn").addEventListener("click", () => {
      if (pendingDeleteItem) performDeleteAll(pendingDeleteItem);
      closeDeleteScopeModal();
    });
    document.getElementById("deleteScopeCancelBtn").addEventListener("click", closeDeleteScopeModal);
    document.getElementById("closeDeleteScopeModalBtn").addEventListener("click", closeDeleteScopeModal);
    document.getElementById("deleteScopeModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "deleteScopeModalOverlay") closeDeleteScopeModal();
    });

    document.getElementById("editScopeOccurrenceBtn").addEventListener("click", applyOccurrenceOnlyEdit);
    document.getElementById("editScopeFollowingBtn").addEventListener("click", applyFollowingEdit);
    document.getElementById("editScopeCancelBtn").addEventListener("click", closeEditScopeModal);
    document.getElementById("closeEditScopeModalBtn").addEventListener("click", closeEditScopeModal);
    document.getElementById("editScopeModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "editScopeModalOverlay") closeEditScopeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.getElementById("scheduleModalOverlay").hidden) closeModal();
      if (e.key === "Escape" && !document.getElementById("deleteScopeModalOverlay").hidden) closeDeleteScopeModal();
      if (e.key === "Escape" && !document.getElementById("editScopeModalOverlay").hidden) closeEditScopeModal();
    });

    refreshAll();
    applyScheduleCalendarFit();

    window.addEventListener("resize", () => {
      clearTimeout(scheduleResizeTimer);
      scheduleResizeTimer = setTimeout(applyScheduleCalendarFit, 200);
    });
  }

  window.ScheduleView = {
    init,
    refreshDashboard,
    refreshAll,
    // onShow used to be just applyScheduleCalendarFit (a layout-fit check),
    // so a change made elsewhere (e.g. cloud sync pulling in another
    // device's edits) while this tab wasn't active never showed up until a
    // full page reload — same gap already fixed for practice/study/
    // vongole/exercise, just missed here since this tab already had *some*
    // onShow.
    onShow: () => {
      refreshAll();
      applyScheduleCalendarFit();
    },
    openAddModal: () => openModal("add"),
    goToToday: () => {
      const now = new Date();
      viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
      selectedDate = now;
      renderCalendarArea();
      renderDayList();
    },
  };
})();
