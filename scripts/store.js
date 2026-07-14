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

  // A schedule item is a "series": one anchor date + an optional repeat rule.
  // Occurrences are derived on demand instead of being stored individually,
  // so editing/deleting a series affects every occurrence at once.
  function matchesDate(item, dateStr) {
    if (dateStr < item.date) return false;
    const repeat = item.repeat || { type: "none" };
    if (repeat.until && dateStr > repeat.until) return false;

    switch (repeat.type) {
      case "daily":
        return true;
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
        .map((item) => ({ ...item, occurrenceDate: dateStr }))
        .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
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
  const DEFAULTS = [
    { key: "work", label: "업무", color: "#60a5fa" },
    { key: "personal", label: "개인", color: "#a78bfa" },
    { key: "health", label: "건강", color: "#f87171" },
    { key: "study", label: "공부", color: "#4ade80" },
    { key: "etc", label: "기타", color: "#94a3b8" },
  ];

  function loadCategories() {
    try {
      const raw = localStorage.getItem(CATEGORIES_KEY);
      return raw ? JSON.parse(raw) : DEFAULTS;
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
