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
  };
})();
