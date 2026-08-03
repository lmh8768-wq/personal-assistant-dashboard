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
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedules));
  }

  function createId() {
    return `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function parseDateStr(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function addDaysToDateStr(dateStr, delta) {
    const d = parseDateStr(dateStr);
    d.setDate(d.getDate() + delta);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  // A schedule item is a "series": one anchor date + an optional repeat rule.
  // Occurrences are derived on demand instead of being stored individually,
  // so editing/deleting a series affects every occurrence at once.
  function matchesDate(item, dateStr) {
    if (dateStr < item.date) return false;
    const repeat = item.repeat || { type: "none" };
    if (repeat.until && dateStr > repeat.until) return false;
    if ((item.excludedDates || []).includes(dateStr)) return false;

    switch (repeat.type) {
      case "daily":
        return true;
      case "weekdays": {
        const day = parseDateStr(dateStr).getDay();
        return day >= 1 && day <= 5;
      }
      case "every10days": {
        const diffDays = Math.round((parseDateStr(dateStr) - parseDateStr(item.date)) / 86400000);
        return diffDays % 10 === 0;
      }
      case "weekly":
        return parseDateStr(item.date).getDay() === parseDateStr(dateStr).getDay();
      case "monthly":
        return parseDateStr(item.date).getDate() === parseDateStr(dateStr).getDate();
      case "yearly": {
        const anchor = parseDateStr(item.date);
        const target = parseDateStr(dateStr);
        return anchor.getMonth() === target.getMonth() && anchor.getDate() === target.getDate();
      }
      default:
        return dateStr === item.date;
    }
  }

  window.ScheduleStore = {
    getAll() {
      return loadSchedules();
    },
    getOccurrences(dateStr) {
      return loadSchedules()
        .filter((item) => matchesDate(item, dateStr))
        .map((item) => {
          const override = (item.overrides || {})[dateStr];
          return { ...item, ...(override || {}), occurrenceDate: dateStr };
        });
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
    localStorage.setItem(ORDER_KEY, JSON.stringify(data));
  }

  window.ScheduleOrderStore = {
    get(dateStr) {
      const data = loadOrder();
      return Array.isArray(data[dateStr]) ? data[dateStr] : [];
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
      localStorage.setItem(PINNED_ORDER_KEY, JSON.stringify(orderedIds));
    },
  };
})();

// ---------- Schedule templates (localStorage) ----------
(function () {
  const TEMPLATES_KEY = "assistant.templates.v1";

  function loadTemplates() {
    try {
      const raw = localStorage.getItem(TEMPLATES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveTemplates(templates) {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  }

  function createId() {
    return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  window.TemplateStore = {
    getAll() {
      return loadTemplates();
    },
    add(template) {
      const templates = loadTemplates();
      const item = { id: createId(), ...template };
      templates.push(item);
      saveTemplates(templates);
      return item;
    },
    remove(id) {
      saveTemplates(loadTemplates().filter((t) => t.id !== id));
    },
  };
})();

// ---------- Schedule categories (localStorage) ----------
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

  function loadCategories() {
    try {
      const raw = localStorage.getItem(CATEGORIES_KEY);
      if (!raw) return DEFAULTS;
      const parsed = JSON.parse(raw);
      const isUnmodifiedOldDefaults =
        parsed.length === OLD_DEFAULT_KEYS.length &&
        parsed.every((c, i) => c.key === OLD_DEFAULT_KEYS[i]);
      if (isUnmodifiedOldDefaults) {
        saveCategories(DEFAULTS);
        return DEFAULTS;
      }
      return parsed;
    } catch {
      return DEFAULTS;
    }
  }

  function saveCategories(categories) {
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
  }

  window.CategoryStore = {
    getAll() {
      return loadCategories();
    },
    getByKey(key) {
      return loadCategories().find((c) => c.key === key) || DEFAULTS[DEFAULTS.length - 1];
    },
    update(key, patch) {
      const categories = loadCategories();
      const idx = categories.findIndex((c) => c.key === key);
      if (idx === -1) return null;
      categories[idx] = { ...categories[idx], ...patch };
      saveCategories(categories);
      return categories[idx];
    },
  };
})();

// ---------- Ledger (가계부) categories ----------
// A separate store from the schedule categories above: this one supports
// freely adding/removing categories (not just relabeling a fixed set), and
// each expense category carries its own monthly budget goal. Every category
// is tagged "expense" or "income" — the two use separate category lists in
// the UI, and only expense categories have a meaningful budget.
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
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return DEFAULTS;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return DEFAULTS;

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
        migrated.push(...DEFAULTS.filter((c) => c.type === "income"));
        changed = true;
      }
      if (changed) save(migrated);
      return migrated;
    } catch {
      return DEFAULTS;
    }
  }

  function save(categories) {
    localStorage.setItem(KEY, JSON.stringify(categories));
  }

  window.LedgerCategoryStore = {
    getAll() {
      return load();
    },
    getByKey(key) {
      return load().find((c) => c.key === key) || null;
    },
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
    update(key, patch) {
      const categories = load();
      const idx = categories.findIndex((c) => c.key === key);
      if (idx === -1) return null;
      categories[idx] = { ...categories[idx], ...patch };
      save(categories);
      return categories[idx];
    },
    remove(key) {
      const categories = load();
      const idx = categories.findIndex((c) => c.key === key);
      if (idx === -1) return null;
      const [removed] = categories.splice(idx, 1);
      save(categories);
      return { item: removed, index: idx };
    },
    restore(item, index) {
      const categories = load();
      const at = Math.min(index, categories.length);
      categories.splice(at, 0, item);
      save(categories);
    },
  };
})();

// ---------- Ledger (가계부) expense entries ----------
(function () {
  const KEY = "assistant.ledgerEntries.v1";

  function createId() {
    return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function save(entries) {
    localStorage.setItem(KEY, JSON.stringify(entries));
  }

  window.LedgerEntryStore = {
    getAll() {
      return load();
    },
    add(entry) {
      const entries = load();
      const item = { id: createId(), ...entry };
      entries.push(item);
      save(entries);
      return item;
    },
    update(id, patch) {
      const entries = load();
      const idx = entries.findIndex((e) => e.id === id);
      if (idx === -1) return null;
      entries[idx] = { ...entries[idx], ...patch };
      save(entries);
      return entries[idx];
    },
    remove(id) {
      const entries = load();
      const idx = entries.findIndex((e) => e.id === id);
      if (idx === -1) return null;
      const [removed] = entries.splice(idx, 1);
      save(entries);
      return { item: removed, index: idx };
    },
    restore(item, index) {
      const entries = load();
      const at = Math.min(index, entries.length);
      entries.splice(at, 0, item);
      save(entries);
    },
  };
})();

// ---------- Vongole pasta (봉골레 파스타) recipes ----------
// Same shape/logic backs two separate lists — 대성공 레시피 (personally
// verified) and 수집한 레시피 (gathered from elsewhere, untried/unrated) —
// so this factory builds each store from its own localStorage key rather
// than duplicating the CRUD logic twice.
function createVongoleRecipeStore(key, idPrefix) {
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

  function save(recipes) {
    localStorage.setItem(key, JSON.stringify(recipes));
  }

  return {
    getAll() {
      return load();
    },
    add(title, content) {
      const recipes = load();
      const item = { id: createId(), title, content };
      recipes.push(item);
      save(recipes);
      return item;
    },
    update(id, patch) {
      const recipes = load();
      const idx = recipes.findIndex((r) => r.id === id);
      if (idx === -1) return null;
      recipes[idx] = { ...recipes[idx], ...patch };
      save(recipes);
      return recipes[idx];
    },
    remove(id) {
      const recipes = load();
      const idx = recipes.findIndex((r) => r.id === id);
      if (idx === -1) return null;
      const [removed] = recipes.splice(idx, 1);
      save(recipes);
      return { item: removed, index: idx };
    },
    restore(item, index) {
      const recipes = load();
      const at = Math.min(index, recipes.length);
      recipes.splice(at, 0, item);
      save(recipes);
    },
  };
}

window.VongoleRecipeStore = createVongoleRecipeStore("assistant.vongoleRecipes.v1", "vr");
window.VongoleCollectedRecipeStore = createVongoleRecipeStore("assistant.vongoleCollectedRecipes.v1", "vcr");

// ---------- Vongole pasta (봉골레 파스타) attempt log ----------
(function () {
  const KEY = "assistant.vongoleLog.v1";

  function createId() {
    return `vl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function save(entries) {
    localStorage.setItem(KEY, JSON.stringify(entries));
  }

  window.VongoleLogStore = {
    getAll() {
      return load();
    },
    add(entry) {
      const entries = load();
      const item = { id: createId(), ...entry };
      entries.push(item);
      save(entries);
      return item;
    },
    update(id, patch) {
      const entries = load();
      const idx = entries.findIndex((e) => e.id === id);
      if (idx === -1) return null;
      entries[idx] = { ...entries[idx], ...patch };
      save(entries);
      return entries[idx];
    },
    remove(id) {
      const entries = load();
      const idx = entries.findIndex((e) => e.id === id);
      if (idx === -1) return null;
      const [removed] = entries.splice(idx, 1);
      save(entries);
      return { item: removed, index: idx };
    },
    restore(item, index) {
      const entries = load();
      const at = Math.min(index, entries.length);
      entries.splice(at, 0, item);
      save(entries);
    },
  };
})();

// ---------- Korean public holidays (2026, static) ----------
window.KoreanHolidays = {
  "2026-01-01": "신정",
  "2026-02-16": "설날 연휴",
  "2026-02-17": "설날",
  "2026-02-18": "설날 연휴",
  "2026-03-01": "삼일절",
  "2026-03-02": "대체공휴일",
  "2026-05-05": "어린이날",
  "2026-05-24": "부처님오신날",
  "2026-05-25": "대체공휴일",
  "2026-06-06": "현충일",
  "2026-08-15": "광복절",
  "2026-08-17": "대체공휴일",
  "2026-09-24": "추석 연휴",
  "2026-09-25": "추석",
  "2026-09-26": "추석 연휴",
  "2026-10-03": "개천절",
  "2026-10-05": "대체공휴일",
  "2026-10-09": "한글날",
  "2026-12-25": "크리스마스",
};
