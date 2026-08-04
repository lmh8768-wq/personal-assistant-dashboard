// Shared by every store in this file and in the other scripts/*.js feature
// modules (all of which load after this one) — a bare localStorage.setItem
// throws if the quota is exceeded or storage is disabled (Safari private
// mode, policy-restricted browsers), which would otherwise take down
// whatever action the user just took with no explanation. This degrades to
// "the write silently didn't happen, but at least says so" instead.
window.safeSetLocalStorage = function (key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.error(`localStorage.setItem("${key}") failed`, err);
    window.Toast?.show("저장에 실패했어요 (저장 공간이 가득 찼을 수 있어요)", { type: "error" });
    return false;
  }
};

// ---------- Schedule persistence (localStorage) ----------
(function () {
  const SCHEDULE_KEY = "assistant.schedules.v1";

  function loadSchedules() {
    try {
      const raw = localStorage.getItem(SCHEDULE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveSchedules(schedules) {
    window.safeSetLocalStorage(SCHEDULE_KEY, JSON.stringify(schedules));
  }

  function createId() {
    return `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // The actual recurrence-matching logic (matchesDate/getOccurrences) lives
  // in scripts/schedule-recurrence.js now — shared with
  // api/send-daily-notifications.js, which used to hand-maintain its own
  // separate copy (see that file's history). parseDateStr/pad2 are reused
  // from there too rather than re-declared, so there's exactly one
  // definition of each.
  const { matchesDate, getOccurrences, parseDateStr, pad2 } = window.ScheduleRecurrence;

  function addDaysToDateStr(dateStr, delta) {
    const d = parseDateStr(dateStr);
    d.setDate(d.getDate() + delta);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  window.ScheduleStore = {
    getAll() {
      return loadSchedules();
    },
    getOccurrences(dateStr) {
      return getOccurrences(loadSchedules(), dateStr);
    },
    countOccurrences(dateStr) {
      return loadSchedules().filter((item) => matchesDate(item, dateStr)).length;
    },
    getById(id) {
      return loadSchedules().find((s) => s.id === id) || null;
    },
    add(schedule) {
      const schedules = loadSchedules();
      const item = { id: createId(), ...schedule };
      schedules.push(item);
      saveSchedules(schedules);
      return item;
    },
    update(id, patch) {
      const schedules = loadSchedules();
      const idx = schedules.findIndex((s) => s.id === id);
      if (idx === -1) return null;
      schedules[idx] = { ...schedules[idx], ...patch };
      saveSchedules(schedules);
      return schedules[idx];
    },
    remove(id) {
      saveSchedules(loadSchedules().filter((s) => s.id !== id));
    },
    toggleCompleted(id, occurrenceDate) {
      const schedules = loadSchedules();
      const idx = schedules.findIndex((s) => s.id === id);
      if (idx === -1) return null;
      const dates = new Set(schedules[idx].completedDates || []);
      if (dates.has(occurrenceDate)) {
        dates.delete(occurrenceDate);
      } else {
        dates.add(occurrenceDate);
      }
      schedules[idx] = { ...schedules[idx], completedDates: [...dates] };
      saveSchedules(schedules);
      return schedules[idx];
    },
    excludeOccurrence(id, occurrenceDate) {
      const schedules = loadSchedules();
      const idx = schedules.findIndex((s) => s.id === id);
      if (idx === -1) return null;
      const excluded = new Set(schedules[idx].excludedDates || []);
      excluded.add(occurrenceDate);
      schedules[idx] = { ...schedules[idx], excludedDates: [...excluded] };
      saveSchedules(schedules);
      return schedules[idx];
    },
    includeOccurrence(id, occurrenceDate) {
      const schedules = loadSchedules();
      const idx = schedules.findIndex((s) => s.id === id);
      if (idx === -1) return null;
      const excluded = new Set(schedules[idx].excludedDates || []);
      excluded.delete(occurrenceDate);
      schedules[idx] = { ...schedules[idx], excludedDates: [...excluded] };
      saveSchedules(schedules);
      return schedules[idx];
    },
    // Edits applied to a single occurrence of a recurring series, without
    // touching the series definition or any other occurrence.
    setOccurrenceOverride(id, occurrenceDate, patch) {
      const schedules = loadSchedules();
      const idx = schedules.findIndex((s) => s.id === id);
      if (idx === -1) return null;
      const overrides = { ...(schedules[idx].overrides || {}), [occurrenceDate]: patch };
      schedules[idx] = { ...schedules[idx], overrides };
      saveSchedules(schedules);
      return schedules[idx];
    },
    // "This and following" edits: the original series stops the day before
    // occurrenceDate, and a new series starting at occurrenceDate carries the
    // patch forward (plus any excluded dates / overrides / completions from
    // that point on).
    splitSeriesFrom(id, occurrenceDate, patch) {
      const schedules = loadSchedules();
      const idx = schedules.findIndex((s) => s.id === id);
      if (idx === -1) return null;
      const original = schedules[idx];

      if (occurrenceDate === original.date) {
        schedules[idx] = { ...original, ...patch };
        saveSchedules(schedules);
        return schedules[idx];
      }

      const excludedAll = original.excludedDates || [];
      const excludedBefore = excludedAll.filter((d) => d < occurrenceDate);
      const excludedFromSplit = excludedAll.filter((d) => d >= occurrenceDate);

      const overridesAll = original.overrides || {};
      const overridesBefore = {};
      const overridesFromSplit = {};
      Object.keys(overridesAll).forEach((d) => {
        if (d >= occurrenceDate) overridesFromSplit[d] = overridesAll[d];
        else overridesBefore[d] = overridesAll[d];
      });
      delete overridesFromSplit[occurrenceDate];

      const completedAll = original.completedDates || [];
      const completedBefore = completedAll.filter((d) => d < occurrenceDate);
      const completedFromSplit = completedAll.filter((d) => d >= occurrenceDate);

      schedules[idx] = {
        ...original,
        repeat: { ...original.repeat, until: addDaysToDateStr(occurrenceDate, -1) },
        excludedDates: excludedBefore,
        overrides: overridesBefore,
        completedDates: completedBefore,
      };

      const newItem = {
        ...original,
        ...patch,
        id: createId(),
        date: occurrenceDate,
        excludedDates: excludedFromSplit,
        overrides: overridesFromSplit,
        completedDates: completedFromSplit,
      };
      schedules.push(newItem);
      saveSchedules(schedules);
      return newItem;
    },
  };
})();

// ---------- Per-day manual schedule ordering (localStorage) ----------
// Absent an entry for a date, the day's list falls back to importance
// order. Once the user drags an item, that day's full order is recorded
// here and takes over from then on.
(function () {
  const ORDER_KEY = "assistant.scheduleOrder.v1";

  function loadOrder() {
    try {
      const raw = localStorage.getItem(ORDER_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveOrder(data) {
    window.safeSetLocalStorage(ORDER_KEY, JSON.stringify(data));
  }

  window.ScheduleOrderStore = {
    get(dateStr) {
      const data = loadOrder();
      return Array.isArray(data[dateStr]) ? data[dateStr] : [];
    },
    // For callers about to look up many dates in a row (a month grid's 42
    // cells) — one read instead of 42 separate localStorage reads/JSON.parses
    // of the same data.
    getAll() {
      return loadOrder();
    },
    set(dateStr, orderedIds) {
      const data = loadOrder();
      data[dateStr] = orderedIds;
      saveOrder(data);
    },
    // A freshly added schedule jumps to the top of the day it was added
    // for, ahead of anything already ordered (or not yet ordered) there.
    prependToDay(dateStr, id) {
      const data = loadOrder();
      const current = Array.isArray(data[dateStr]) ? data[dateStr] : [];
      data[dateStr] = [id, ...current.filter((existingId) => existingId !== id)];
      saveOrder(data);
    },
  };
})();

// ---------- Global relative order of pinned schedules (localStorage) ----------
// A day's own order only ever affects that day. When the user reorders two
// pinned items relative to each other, they're asked whether that order
// should apply everywhere those items are pinned — if they say yes, it's
// recorded here and applied as the pinned items' order on every day.
(function () {
  const PINNED_ORDER_KEY = "assistant.pinnedScheduleOrder.v1";

  function loadPinnedOrder() {
    try {
      const raw = localStorage.getItem(PINNED_ORDER_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  window.SchedulePinnedOrderStore = {
    get() {
      return loadPinnedOrder();
    },
    set(orderedIds) {
      window.safeSetLocalStorage(PINNED_ORDER_KEY, JSON.stringify(orderedIds));
    },
  };
})();

// ---------- Schedule templates (localStorage) ----------
// createEntityStore is declared further down in this file (as a function
// declaration, so it's hoisted and already callable here).
window.TemplateStore = createEntityStore("assistant.templates.v1", "tpl");

// ---------- Generic key-based store factory (categories) ----------
// Both category stores below identify items by a "key" (not "id") and never
// reorder on remove/restore in a way that differs from createEntityStore's
// id-based version — same getByKey/update/remove/restore shape either way.
// Each store keeps its own load()/save() (their migration logic differs:
// schedule's is a one-time rename of a stale default set, ledger's is
// backfilling the expense/income split) and its own add() (different
// constructed shape — ledger's carries budget/type, schedule's doesn't).
function createKeyedStore(loadFn, saveFn) {
  return {
    getAll() {
      return loadFn();
    },
    getByKey(key) {
      return loadFn().find((c) => c.key === key) || null;
    },
    update(key, patch) {
      const items = loadFn();
      const idx = items.findIndex((c) => c.key === key);
      if (idx === -1) return null;
      items[idx] = { ...items[idx], ...patch };
      saveFn(items);
      return items[idx];
    },
    remove(key) {
      const items = loadFn();
      const idx = items.findIndex((c) => c.key === key);
      if (idx === -1) return null;
      const [removed] = items.splice(idx, 1);
      saveFn(items);
      return { item: removed, index: idx };
    },
    restore(item, index) {
      const items = loadFn();
      const at = Math.min(index, items.length);
      items.splice(at, 0, item);
      saveFn(items);
    },
  };
}

// ---------- Schedule categories (localStorage) ----------
// Used to be a fixed 5-item set with no add/remove (only relabel/recolor) —
// now unified with the ledger categories below to support freely adding and
// removing categories too.
(function () {
  const CATEGORIES_KEY = "assistant.categories.v1";
  const OLD_DEFAULT_KEYS = ["work", "personal", "health", "study", "etc"];
  const DEFAULTS = [
    { key: "appointment", label: "약속", color: "#60a5fa" },
    { key: "event", label: "행사", color: "#a78bfa" },
    { key: "academic", label: "학업", color: "#4ade80" },
    { key: "hobby", label: "취미", color: "#f472b6" },
    { key: "etc", label: "기타", color: "#94a3b8" },
  ];

  function createKey() {
    return `cat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function loadCategories() {
    // Always a fresh copy — add()/update()/remove() below mutate whatever
    // array they get back in place (push/splice), and returning the DEFAULTS
    // constant itself here would let that first mutation permanently corrupt
    // it for the rest of the page's lifetime.
    try {
      const raw = localStorage.getItem(CATEGORIES_KEY);
      if (!raw) return DEFAULTS.map((c) => ({ ...c }));
      const parsed = JSON.parse(raw);
      const isUnmodifiedOldDefaults =
        parsed.length === OLD_DEFAULT_KEYS.length &&
        parsed.every((c, i) => c.key === OLD_DEFAULT_KEYS[i]);
      if (isUnmodifiedOldDefaults) {
        saveCategories(DEFAULTS);
        return DEFAULTS.map((c) => ({ ...c }));
      }
      return parsed;
    } catch {
      return DEFAULTS.map((c) => ({ ...c }));
    }
  }

  function saveCategories(categories) {
    window.safeSetLocalStorage(CATEGORIES_KEY, JSON.stringify(categories));
  }

  window.CategoryStore = {
    ...createKeyedStore(loadCategories, saveCategories),
    // Falls back to the "기타" default rather than null — callers like
    // schedule.js's getCategoryColor()/getCategoryLabel() always want a
    // valid category to render, even for a schedule item whose category was
    // since deleted.
    getByKey(key) {
      return loadCategories().find((c) => c.key === key) || DEFAULTS[DEFAULTS.length - 1];
    },
    add(label, color) {
      const categories = loadCategories();
      const item = { key: createKey(), label, color };
      categories.push(item);
      saveCategories(categories);
      return item;
    },
  };
})();

// ---------- Ledger (가계부) categories ----------
// Each expense category carries its own monthly budget goal, and every
// category is tagged "expense" or "income" — the two use separate category
// lists in the UI, and only expense categories have a meaningful budget.
(function () {
  const KEY = "assistant.ledgerCategories.v1";
  const DEFAULTS = [
    { key: "food", label: "식비", color: "#f97316", budget: 0, type: "expense" },
    { key: "transport", label: "교통", color: "#60a5fa", budget: 0, type: "expense" },
    { key: "shopping", label: "쇼핑", color: "#f472b6", budget: 0, type: "expense" },
    { key: "culture", label: "문화/여가", color: "#a78bfa", budget: 0, type: "expense" },
    { key: "living", label: "주거/생활", color: "#4ade80", budget: 0, type: "expense" },
    { key: "etc", label: "기타", color: "#94a3b8", budget: 0, type: "expense" },
    { key: "salary", label: "급여", color: "#22c55e", budget: 0, type: "income" },
    { key: "allowance", label: "용돈", color: "#38bdf8", budget: 0, type: "income" },
    { key: "etc_income", label: "기타수입", color: "#a3a3a3", budget: 0, type: "income" },
  ];

  function createKey() {
    return `cat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function load() {
    // Always a fresh copy — add()/update()/remove() below mutate whatever
    // array they get back in place (push/splice), and returning the DEFAULTS
    // constant itself here would let that first mutation permanently corrupt
    // it for the rest of the page's lifetime.
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return DEFAULTS.map((c) => ({ ...c }));
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return DEFAULTS.map((c) => ({ ...c }));

      // Migrate categories saved before income categories existed — they
      // were all implicitly expense categories, and income defaults get
      // appended once so there's something to pick from for income entries.
      let changed = false;
      const migrated = parsed.map((c) => {
        if (c.type) return c;
        changed = true;
        return { ...c, type: "expense" };
      });
      if (!migrated.some((c) => c.type === "income")) {
        migrated.push(...DEFAULTS.filter((c) => c.type === "income").map((c) => ({ ...c })));
        changed = true;
      }
      if (changed) save(migrated);
      return migrated;
    } catch {
      return DEFAULTS.map((c) => ({ ...c }));
    }
  }

  function save(categories) {
    window.safeSetLocalStorage(KEY, JSON.stringify(categories));
  }

  window.LedgerCategoryStore = {
    ...createKeyedStore(load, save),
    getByType(type) {
      return load().filter((c) => c.type === type);
    },
    add(label, color, type) {
      const categories = load();
      const item = { key: createKey(), label, color, budget: 0, type: type === "income" ? "income" : "expense" };
      categories.push(item);
      save(categories);
      return item;
    },
  };
})();

// ---------- Generic flat-list entity store factory ----------
// Ledger entries, vongole recipes (both lists), and the vongole attempt log
// all reduce to the same shape — an id-keyed array in one localStorage key
// with add/update/remove/restore — so every one of them is built from this
// one factory instead of each hand-rolling its own copy of the same
// getAll/find/splice logic.
function createEntityStore(key, idPrefix) {
  function createId() {
    return `${idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function load() {
    try {
      const raw = localStorage.getItem(key);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function save(items) {
    window.safeSetLocalStorage(key, JSON.stringify(items));
  }

  return {
    getAll() {
      return load();
    },
    add(entry) {
      const items = load();
      const item = { id: createId(), ...entry };
      items.push(item);
      save(items);
      return item;
    },
    update(id, patch) {
      const items = load();
      const idx = items.findIndex((it) => it.id === id);
      if (idx === -1) return null;
      items[idx] = { ...items[idx], ...patch };
      save(items);
      return items[idx];
    },
    remove(id) {
      const items = load();
      const idx = items.findIndex((it) => it.id === id);
      if (idx === -1) return null;
      const [removed] = items.splice(idx, 1);
      save(items);
      return { item: removed, index: idx };
    },
    restore(item, index) {
      const items = load();
      const at = Math.min(index, items.length);
      items.splice(at, 0, item);
      save(items);
    },
  };
}

// ---------- Ledger (가계부) expense entries ----------
window.LedgerEntryStore = createEntityStore("assistant.ledgerEntries.v1", "exp");

// ---------- Vongole pasta (봉골레 파스타) recipes ----------
// Same shape/logic backs two separate lists — 대성공 레시피 (personally
// verified) and 수집한 레시피 (gathered from elsewhere, untried/unrated).
window.VongoleRecipeStore = createEntityStore("assistant.vongoleRecipes.v1", "vr");
window.VongoleCollectedRecipeStore = createEntityStore("assistant.vongoleCollectedRecipes.v1", "vcr");

// ---------- Vongole pasta (봉골레 파스타) attempt log ----------
window.VongoleLogStore = createEntityStore("assistant.vongoleLog.v1", "vl");

// ---------- Korean public holidays ----------
// Previously a single static object hardcoded for 2026 only — every other
// year silently showed no holidays at all. Fixed-date holidays (law hasn't
// moved these in decades) are now computed for any year; lunar-calendar
// holidays (설날/추석/부처님오신날) shift every year and can't be computed
// without a lunar calendar, so they still need a manual entry added below
// each time a new year's dates are confirmed — years without an entry just
// fall back to showing the fixed-date holidays only, instead of nothing.
(function () {
  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  // { name, substitute } — substitute: true means Korean law gives this one
  // a 대체공휴일 the next weekday when it lands on a Sat/Sun (실제 시행:
  // 설날/추석/어린이날/삼일절/광복절/개천절/한글날). 신정/현충일/크리스마스/
  // 부처님오신날 never get a substitute.
  const FIXED_HOLIDAYS = [
    { month: 1, day: 1, name: "신정", substitute: false },
    { month: 3, day: 1, name: "삼일절", substitute: true },
    { month: 5, day: 5, name: "어린이날", substitute: true },
    { month: 6, day: 6, name: "현충일", substitute: false },
    { month: 8, day: 15, name: "광복절", substitute: true },
    { month: 10, day: 3, name: "개천절", substitute: true },
    { month: 10, day: 9, name: "한글날", substitute: true },
    { month: 12, day: 25, name: "크리스마스", substitute: false },
  ];

  // Confirmed lunar-calendar holiday dates by year — add a new entry here
  // once that year's official dates are published (usually 1-2 years out).
  const LUNAR_HOLIDAYS_BY_YEAR = {
    2026: {
      "02-16": "설날 연휴",
      "02-17": "설날",
      "02-18": "설날 연휴",
      "05-24": "부처님오신날",
      "09-24": "추석 연휴",
      "09-25": "추석",
      "09-26": "추석 연휴",
    },
    2027: {
      "02-06": "설날 연휴",
      "02-07": "설날",
      "02-08": "설날 연휴",
      "02-09": "설날 연휴",
      "05-13": "부처님오신날",
      "09-14": "추석 연휴",
      "09-15": "추석",
      "09-16": "추석 연휴",
    },
  };

  function buildHolidays(startYear, endYear) {
    const map = {};

    for (let year = startYear; year <= endYear; year++) {
      FIXED_HOLIDAYS.forEach(({ month, day, name, substitute }) => {
        const date = new Date(year, month - 1, day);
        map[`${year}-${pad2(month)}-${pad2(day)}`] = name;

        if (substitute) {
          const weekday = date.getDay(); // 0 = Sun, 6 = Sat
          if (weekday === 0 || weekday === 6) {
            const sub = new Date(year, month - 1, day + (weekday === 0 ? 1 : 2));
            map[`${sub.getFullYear()}-${pad2(sub.getMonth() + 1)}-${pad2(sub.getDate())}`] = "대체공휴일";
          }
        }
      });

      const lunar = LUNAR_HOLIDAYS_BY_YEAR[year];
      if (lunar) {
        Object.entries(lunar).forEach(([md, name]) => {
          map[`${year}-${md}`] = name;
        });
      }
    }

    return map;
  }

  // A ~decade-wide fixed-date range is cheap to precompute and means the
  // calendar never goes back to showing nothing even for years with no
  // lunar entry yet.
  window.KoreanHolidays = buildHolidays(2024, 2035);
})();
