(function () {
  const ROUTINES_KEY = "assistant.routines.v1";
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  const TYPES = [
    { key: "morning", listId: "morningRoutineList", inputId: "morningRoutineInput", addBtnId: "morningRoutineAddBtn" },
    { key: "night", listId: "nightRoutineList", inputId: "nightRoutineInput", addBtnId: "nightRoutineAddBtn" },
  ];

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
    localStorage.setItem(ROUTINES_KEY, JSON.stringify(data));
  }

  const RoutineStore = {
    getItems(type) {
      return loadAll()[type].items;
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
      Object.keys(data[type].history).forEach((date) => {
        data[type].history[date] = data[type].history[date].filter((did) => did !== id);
      });
      saveAll(data);
      return { item: removed, index: idx };
    },
    restoreItem(type, item, index) {
      const data = loadAll();
      const at = Math.min(index, data[type].items.length);
      data[type].items.splice(at, 0, item);
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
    // Combined (아침+야간) completion for a given date, against the CURRENT
    // item lists — there's no historical snapshot of what the checklist
    // used to contain, so a past day's rate is "how much of today's list
    // would have been done," which is the simplest reading of the data.
    getRateForDate(dateStr) {
      const data = loadAll();
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

    RoutineStore.getItems(type).forEach((item) => {
      const done = RoutineStore.isDone(type, item.id);
      const li = document.createElement("li");
      li.className = "checklist-item" + (done ? " done" : "");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = done;
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
              RoutineStore.restoreItem(type, removed.item, removed.index);
              renderAll();
            },
          });
        }
      });
      li.appendChild(remove);

      list.appendChild(li);
    });
  }

  function handleAdd(type) {
    const config = TYPES.find((t) => t.key === type);
    const input = document.getElementById(config.inputId);
    const label = input.value.trim();
    if (!label) return;
    RoutineStore.addItem(type, label);
    input.value = "";
    renderAll();
  }

  // ---------- Weekly rate strip ----------
  function rateColor(rate) {
    if (rate === null) return "transparent";
    return `color-mix(in srgb, var(--accent) ${Math.round(rate * 100)}%, var(--bg-elevated-2))`;
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

    for (let i = 0; i < 7; i++) {
      const d = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i);
      const dStr = toDateStr(d);
      const isFuture = dStr > todayDateStr;
      const { done, total, rate } = RoutineStore.getRateForDate(dStr);

      const cell = document.createElement("div");
      cell.className = "routine-week-cell" + (dStr === todayDateStr ? " today" : "") + (isFuture ? " future" : "");
      cell.dataset.date = dStr;
      cell.style.background = isFuture ? "" : rateColor(rate);

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
      pct.textContent = isFuture ? "" : rate === null ? "—" : `${Math.round(rate * 100)}%`;
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
        const { done, total, rate } = RoutineStore.getRateForDate(dStr);
        cell.style.background = rateColor(rate);
        if (rate !== null) {
          const pct = document.createElement("span");
          pct.className = "routine-calendar-day-pct";
          pct.textContent = `${Math.round(rate * 100)}%`;
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

  // FLIP animation: the week strip's cells visually fly to wherever their
  // same date lands in the freshly-rendered calendar grid, so the strip
  // reads as "becoming" that row instead of the calendar just appearing
  // underneath it. Only the current week's row can do this (it's the only
  // one the strip has data for); the rest of the grid fades in around it.
  function expandCalendarAnimated() {
    const weekWrap = document.getElementById("routineWeekRate");
    const section = document.getElementById("routineCalendarSection");
    const panel = document.getElementById("routineWeekPanel");

    const sourceRects = [...weekWrap.querySelectorAll(".routine-week-cell")].map((cell) => ({
      date: cell.dataset.date,
      rect: cell.getBoundingClientRect(),
    }));

    // The card itself should grow into its taller (calendar-included)
    // height smoothly rather than snapping to it the instant the section
    // un-hides — measure before/after and animate between the two.
    const startHeight = panel ? panel.getBoundingClientRect().height : 0;

    section.hidden = false;
    renderRateCalendar();

    // Hide the strip now, BEFORE measuring the expanded height — otherwise
    // scrollHeight still includes the (about-to-disappear) strip's own
    // height on top of the calendar's, so the panel would grow past the
    // true resting size and visibly snap back down once the strip is
    // actually removed and the height is handed back to "auto".
    weekWrap.hidden = true;

    if (panel) {
      const endHeight = panel.scrollHeight;
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

    if (matches.length === 0) return; // nothing to animate from — plain reveal, calendar is already fully visible

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
  }

  // Mirror of expandCalendarAnimated: the current week's calendar-day cells
  // fly back to become the week strip, the rest of the grid fades out, and
  // the card shrinks back to its collapsed height — all before the
  // calendar section actually gets hidden.
  function collapseCalendarAnimated() {
    const weekWrap = document.getElementById("routineWeekRate");
    const section = document.getElementById("routineCalendarSection");
    const panel = document.getElementById("routineWeekPanel");
    const nav = section.querySelector(".routine-calendar-nav");

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
      return;
    }

    const matched = matches.map((m) => m.target);
    const others = [...document.querySelectorAll(".routine-calendar-day")].filter((c) => !weekDates.includes(c.dataset.date));

    const NAV_FADE_MS = 150;
    const ROW_MOVE_MS = 260;
    const OTHERS_SHRINK_MS = 260;
    const PANEL_SHRINK_MS = 300;

    matches.forEach(({ target, dx, dy, sx, sy }) => {
      // Start showing whatever color it had as a calendar cell, and fade to
      // the week cell's own color as it moves — if the two happen to match
      // (the common case, since it's the same date either way), nothing
      // visibly changes at all instead of an unnecessary flash.
      const sourceCell = calendarCellsByDate.get(target.dataset.date);
      target.dataset.pendingBg = target.style.background;
      target.style.background = sourceCell ? sourceCell.style.background : "";
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

    void weekWrap.offsetHeight;

    requestAnimationFrame(() => {
      matched.forEach((target) => {
        target.style.transition = `transform ${ROW_MOVE_MS}ms linear, background-color ${ROW_MOVE_MS}ms ease`;
        target.style.transform = "none";
        target.style.background = target.dataset.pendingBg || "";
        delete target.dataset.pendingBg;
      });
      others.forEach((c) => {
        c.style.transition = `opacity ${OTHERS_SHRINK_MS}ms ease, transform ${OTHERS_SHRINK_MS}ms ease`;
        c.style.opacity = "0";
        c.style.transform = "scale(0.5)";
      });
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
    }, Math.max(NAV_FADE_MS, ROW_MOVE_MS, OTHERS_SHRINK_MS, PANEL_SHRINK_MS) + 30);
  }

  function init() {
    TYPES.forEach((t) => {
      document.getElementById(t.addBtnId)?.addEventListener("click", () => handleAdd(t.key));
      document.getElementById(t.inputId)?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleAdd(t.key);
        }
      });
    });

    document.getElementById("routinePrevMonthBtn")?.addEventListener("click", () => {
      calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() - 1, 1);
      renderRateCalendar();
    });
    document.getElementById("routineNextMonthBtn")?.addEventListener("click", () => {
      calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() + 1, 1);
      renderRateCalendar();
    });

    document.getElementById("toggleRoutineCalendarBtn")?.addEventListener("click", (e) => {
      if (toggleAnimating) return;
      const section = document.getElementById("routineCalendarSection");
      const expanding = section.hidden;
      toggleAnimating = true;
      setTimeout(() => {
        toggleAnimating = false;
      }, 650); // covers the longer of the two animations (expand's cleanup now fires at 610ms)
      if (expanding) {
        calendarViewDate = new Date();
        expandCalendarAnimated();
      } else {
        collapseCalendarAnimated();
      }
      e.currentTarget.textContent = expanding ? "▾" : "▸";
      e.currentTarget.setAttribute("aria-expanded", String(expanding));
    });

    renderAll();
  }

  window.RoutineView = { init };
})();
