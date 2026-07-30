(function () {
  const ROUTINES_KEY = "assistant.routines.v1";

  const TYPES = [
    { key: "morning", listId: "morningRoutineList", inputId: "morningRoutineInput", addBtnId: "morningRoutineAddBtn" },
    { key: "night", listId: "nightRoutineList", inputId: "nightRoutineInput", addBtnId: "nightRoutineAddBtn" },
  ];

  function createId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function emptyRoutine() {
    return { items: [], completion: { date: "", doneIds: [] } };
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
    TYPES.forEach((t) => {
      if (!data[t.key] || !Array.isArray(data[t.key].items)) data[t.key] = emptyRoutine();
    });
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
      data[type].completion.doneIds = data[type].completion.doneIds.filter((did) => did !== id);
      saveAll(data);
      return { item: removed, index: idx };
    },
    restoreItem(type, item, index) {
      const data = loadAll();
      const at = Math.min(index, data[type].items.length);
      data[type].items.splice(at, 0, item);
      saveAll(data);
    },
    // Effective completion is scoped to today — a stale date means every
    // item reads as not-done without needing to eagerly clear storage.
    isDone(type, id) {
      const routine = loadAll()[type];
      if (routine.completion.date !== todayStr()) return false;
      return routine.completion.doneIds.includes(id);
    },
    toggleDone(type, id) {
      const data = loadAll();
      const routine = data[type];
      if (routine.completion.date !== todayStr()) {
        routine.completion = { date: todayStr(), doneIds: [] };
      }
      const doneIds = routine.completion.doneIds;
      const pos = doneIds.indexOf(id);
      if (pos === -1) doneIds.push(id);
      else doneIds.splice(pos, 1);
      saveAll(data);
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
        renderList(type);
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
        renderList(type);
        if (removed && window.Toast) {
          window.Toast.show("루틴 항목을 삭제했어요", {
            actionLabel: "실행취소",
            onAction: () => {
              RoutineStore.restoreItem(type, removed.item, removed.index);
              renderList(type);
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
    renderList(type);
  }

  function renderAll() {
    TYPES.forEach((t) => renderList(t.key));
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
    renderAll();
  }

  window.RoutineView = { init };
})();
