// ---------- Schedule persistence (localStorage) ----------
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

window.ScheduleStore = {
  getAll() {
    return loadSchedules();
  },
  getByDate(dateStr) {
    return loadSchedules()
      .filter((s) => s.date === dateStr)
      .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
  },
  countByDate(dateStr) {
    return loadSchedules().filter((s) => s.date === dateStr).length;
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
