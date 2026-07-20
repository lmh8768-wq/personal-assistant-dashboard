(function () {
  const CHECKLIST_KEY = "assistant.exerciseChecklist.v1";
  const LOG_KEY = "assistant.exerciseLog.v1";
  const RECORDS_KEY = "assistant.exerciseRecords.v1";

  let editingId = null;
  let pendingChecked = new Set();

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toDateStr(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function parseDateStr(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDateLabel(dateStr) {
    const d = parseDateStr(dateStr);
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdays[d.getDay()]})`;
  }

  function createId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ---------- Checklist template (recurring, flat list) ----------
  function loadChecklist() {
    try {
      const raw = localStorage.getItem(CHECKLIST_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveChecklist(items) {
    localStorage.setItem(CHECKLIST_KEY, JSON.stringify(items));
  }

  const ExerciseChecklistStore = {
    getAll() {
      return loadChecklist();
    },
    add(label) {
      const items = loadChecklist();
      const item = { id: createId("exi"), label };
      items.push(item);
      saveChecklist(items);
      return item;
    },
    remove(id) {
      saveChecklist(loadChecklist().filter((c) => c.id !== id));
    },
  };
  window.ExerciseChecklistStore = ExerciseChecklistStore;

  // ---------- Exercise log entries ----------
  function loadEntries() {
    try {
      const raw = localStorage.getItem(LOG_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveEntries(entries) {
    localStorage.setItem(LOG_KEY, JSON.stringify(entries));
  }

  const ExerciseLogStore = {
    getAll() {
      return loadEntries().sort((a, b) => (a.date < b.date ? 1 : -1));
    },
    getById(id) {
      return loadEntries().find((e) => e.id === id) || null;
    },
    add(entry) {
      const entries = loadEntries();
      const item = { id: createId("exl"), ...entry };
      entries.push(item);
      saveEntries(entries);
      return item;
    },
    update(id, patch) {
      const entries = loadEntries();
      const idx = entries.findIndex((e) => e.id === id);
      if (idx === -1) return null;
      entries[idx] = { ...entries[idx], ...patch };
      saveEntries(entries);
      return entries[idx];
    },
    remove(id) {
      saveEntries(loadEntries().filter((e) => e.id !== id));
    },
  };
  window.ExerciseLogStore = ExerciseLogStore;

  // ---------- Personal records (러닝 / 삼대운동) ----------
  function loadRecords() {
    try {
      const raw = localStorage.getItem(RECORDS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveRecords(records) {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  }

  const ExerciseRecordStore = {
    get() {
      return loadRecords();
    },
    update(patch) {
      const records = { ...loadRecords(), ...patch };
      saveRecords(records);
      return records;
    },
  };
  window.ExerciseRecordStore = ExerciseRecordStore;

  // ---------- Checklist rendering (in entry modal) ----------
  function renderChecklistItems() {
    const list = document.getElementById("exerciseChecklistItems");
    list.innerHTML = "";
    ExerciseChecklistStore.getAll().forEach((item) => {
      const checked = pendingChecked.has(item.id);
      const li = document.createElement("li");
      li.className = "checklist-item" + (checked ? " done" : "");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = checked;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) pendingChecked.add(item.id);
        else pendingChecked.delete(item.id);
        renderChecklistItems();
      });
      li.appendChild(checkbox);

      const span = document.createElement("span");
      span.textContent = item.label;
      li.appendChild(span);

      const remove = document.createElement("span");
      remove.className = "checklist-item-remove";
      remove.textContent = "×";
      remove.title = "체크리스트에서 완전히 제거";
      remove.addEventListener("click", () => {
        ExerciseChecklistStore.remove(item.id);
        pendingChecked.delete(item.id);
        renderChecklistItems();
      });
      li.appendChild(remove);

      list.appendChild(li);
    });
  }

  function handleAddChecklistItem() {
    const input = document.getElementById("exerciseChecklistInput");
    const label = input.value.trim();
    if (!label) return;
    const item = ExerciseChecklistStore.add(label);
    pendingChecked.add(item.id);
    input.value = "";
    renderChecklistItems();
  }

  // ---------- Feed ----------
  function renderCard(entry, onClick) {
    const card = document.createElement("div");
    card.className = "diary-card";

    const date = document.createElement("div");
    date.className = "diary-card-date";
    date.textContent = formatDateLabel(entry.date);
    card.appendChild(date);

    const template = ExerciseChecklistStore.getAll();
    if (template.length > 0) {
      const checkedIds = new Set(entry.checkedIds || []);
      const doneLabels = template.filter((t) => checkedIds.has(t.id)).map((t) => t.label);
      const summary = document.createElement("p");
      summary.className = "practice-card-checklist";
      summary.textContent = `✓ ${doneLabels.length}/${template.length} 완료` +
        (doneLabels.length > 0 ? ` · ${doneLabels.join(", ")}` : "");
      card.appendChild(summary);
    }

    card.addEventListener("click", () => onClick(entry));
    return card;
  }

  function renderFeed() {
    const feed = document.getElementById("exerciseFeed");
    const entries = ExerciseLogStore.getAll();

    feed.innerHTML = "";
    if (entries.length === 0) {
      feed.innerHTML = `<div class="empty-state"><span class="empty-icon">💪</span><p>아직 운동 기록이 없어요</p></div>`;
      return;
    }
    entries.forEach((entry) => feed.appendChild(renderCard(entry, (e) => openModal("edit", e))));
  }

  // ---------- Streak ----------
  function renderStreak() {
    const el = document.getElementById("exerciseStreak");
    if (!el) return;
    const dateSet = new Set(loadEntries().map((e) => e.date));

    let streak = 0;
    const cursor = new Date();
    if (!dateSet.has(toDateStr(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (dateSet.has(toDateStr(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    if (streak > 0) {
      el.hidden = false;
      el.textContent = `🔥 ${streak}일 연속 운동 중`;
    } else {
      el.hidden = true;
    }
  }

  // ---------- Modal ----------
  function openModal(mode, data) {
    editingId = mode === "edit" ? data.id : null;
    pendingChecked = new Set(data?.checkedIds || []);

    document.getElementById("exerciseModalTitle").textContent = mode === "edit" ? "운동 기록 수정" : "운동 기록";
    document.getElementById("exerciseDateInput").value = data?.date || toDateStr(new Date());
    document.getElementById("deleteExerciseLogBtn").hidden = mode !== "edit";

    renderChecklistItems();
    document.getElementById("exerciseModalOverlay").hidden = false;
  }

  function closeModal() {
    document.getElementById("exerciseModalOverlay").hidden = true;
    document.getElementById("exerciseForm").reset();
    pendingChecked = new Set();
    editingId = null;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const payload = {
      date: document.getElementById("exerciseDateInput").value,
      checkedIds: [...pendingChecked],
    };
    if (!payload.date) return;

    if (editingId) {
      ExerciseLogStore.update(editingId, payload);
    } else {
      ExerciseLogStore.add(payload);
    }

    closeModal();
    renderFeed();
    renderStreak();
    window.Toast.show("운동 기록을 저장했어요");
  }

  function handleDelete() {
    if (!editingId) return;
    const removed = ExerciseLogStore.getById(editingId);
    ExerciseLogStore.remove(editingId);
    closeModal();
    renderFeed();
    renderStreak();
    if (removed && window.Toast) {
      window.Toast.show("운동 기록을 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          ExerciseLogStore.add(removed);
          renderFeed();
          renderStreak();
        },
      });
    }
  }

  // ---------- Collapsible sections ----------
  function toggleSection(contentEl, btn) {
    const collapsing = !contentEl.hidden;
    contentEl.hidden = collapsing;
    btn.textContent = collapsing ? "▸" : "▾";
    btn.setAttribute("aria-expanded", String(!collapsing));
  }

  // ---------- Personal records panel ----------
  function renderRecordsPanel() {
    const records = ExerciseRecordStore.get();
    document.getElementById("exerciseRecordRunDistanceInput").value = records.runDistance ?? "";
    document.getElementById("exerciseRecordRunPaceInput").value = records.runPace ?? "";
    document.getElementById("exerciseRecordSquatInput").value = records.squat ?? "";
    document.getElementById("exerciseRecordBenchInput").value = records.bench ?? "";
    document.getElementById("exerciseRecordDeadliftInput").value = records.deadlift ?? "";
  }

  function handleRecordFieldChange() {
    ExerciseRecordStore.update({
      runDistance: document.getElementById("exerciseRecordRunDistanceInput").value,
      runPace: document.getElementById("exerciseRecordRunPaceInput").value.trim(),
      squat: document.getElementById("exerciseRecordSquatInput").value,
      bench: document.getElementById("exerciseRecordBenchInput").value,
      deadlift: document.getElementById("exerciseRecordDeadliftInput").value,
    });
  }

  function init() {
    document.getElementById("addExerciseLogBtn").addEventListener("click", () => openModal("add"));
    document.getElementById("exerciseForm").addEventListener("submit", handleSubmit);
    document.getElementById("cancelExerciseBtn").addEventListener("click", closeModal);
    document.getElementById("deleteExerciseLogBtn").addEventListener("click", handleDelete);
    document.getElementById("exerciseChecklistAddBtn").addEventListener("click", handleAddChecklistItem);
    document.getElementById("exerciseChecklistInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddChecklistItem();
      }
    });
    document.getElementById("exerciseModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "exerciseModalOverlay") closeModal();
    });

    document.getElementById("toggleExerciseFeedBtn").addEventListener("click", (e) => {
      toggleSection(document.getElementById("exerciseFeed"), e.currentTarget);
    });
    document.getElementById("toggleExerciseRecordsBtn").addEventListener("click", (e) => {
      toggleSection(document.getElementById("exerciseRecordsPanel"), e.currentTarget);
    });

    [
      "exerciseRecordRunDistanceInput",
      "exerciseRecordRunPaceInput",
      "exerciseRecordSquatInput",
      "exerciseRecordBenchInput",
      "exerciseRecordDeadliftInput",
    ].forEach((id) => {
      document.getElementById(id).addEventListener("change", handleRecordFieldChange);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.getElementById("exerciseModalOverlay").hidden) closeModal();
    });

    renderFeed();
    renderStreak();
    renderRecordsPanel();
  }

  window.ExerciseView = { init };
})();
