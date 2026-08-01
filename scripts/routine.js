(function () {
  const ROUTINES_KEY = "assistant.routines.v1";
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  const TYPES = [
    { key: "morning", listId: "morningRoutineList", inputId: "morningRoutineInput", addBtnId: "morningRoutineAddBtn" },
    { key: "night", listId: "nightRoutineList", inputId: "nightRoutineInput", addBtnId: "nightRoutineAddBtn" },
  ];

  let calendarViewDate = new Date();

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
      const section = document.getElementById("routineCalendarSection");
      const expanding = section.hidden;
      section.hidden = !expanding;
      e.currentTarget.textContent = expanding ? "▾" : "▸";
      e.currentTarget.setAttribute("aria-expanded", String(expanding));
    });

    renderAll();
  }

  window.RoutineView = { init };
})();
