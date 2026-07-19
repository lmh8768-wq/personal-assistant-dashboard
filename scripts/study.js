(function () {
  const PLAN_KEY = "assistant.studyPlan.v1";

  let editingEntryIds = [];
  let pendingItems = [];
  const collapsedDates = new Set();

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

  function typeLabel(type) {
    return type === "assignment" ? "과제" : "공부";
  }

  // ---------- Study plan entries (freeform items per date + completion) ----------
  function loadEntries() {
    try {
      const raw = localStorage.getItem(PLAN_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveEntries(entries) {
    localStorage.setItem(PLAN_KEY, JSON.stringify(entries));
  }

  const StudyPlanStore = {
    getAll() {
      return loadEntries().sort((a, b) => (a.date < b.date ? -1 : 1));
    },
    getById(id) {
      return loadEntries().find((e) => e.id === id) || null;
    },
    add(entry) {
      const entries = loadEntries();
      const item = { id: createId("sp"), ...entry };
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
    getByDate(date) {
      return loadEntries().find((e) => e.date === date) || null;
    },
    toggleItemDone(planId, itemId) {
      const entries = loadEntries();
      const idx = entries.findIndex((e) => e.id === planId);
      if (idx === -1) return null;
      const items = (entries[idx].items || []).map((item) =>
        item.id === itemId ? { ...item, done: !item.done } : item
      );
      entries[idx] = { ...entries[idx], items };
      saveEntries(entries);
      return entries[idx];
    },
  };
  window.StudyPlanStore = StudyPlanStore;

  // ---------- Pending item list (in plan modal) ----------
  function renderPendingItems() {
    const list = document.getElementById("studyChecklistItems");
    list.innerHTML = "";
    pendingItems.forEach((item, idx) => {
      const li = document.createElement("li");
      li.className = "checklist-item";

      const badge = document.createElement("span");
      badge.className = "study-item-type type-" + (item.type === "assignment" ? "assignment" : "study");
      badge.textContent = typeLabel(item.type);
      li.appendChild(badge);

      const span = document.createElement("span");
      span.textContent = item.label;
      li.appendChild(span);

      const remove = document.createElement("span");
      remove.className = "checklist-item-remove";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        pendingItems.splice(idx, 1);
        renderPendingItems();
      });
      li.appendChild(remove);

      list.appendChild(li);
    });
  }

  function handleAddItem() {
    const typeInput = document.getElementById("studyItemTypeInput");
    const input = document.getElementById("studyChecklistInput");
    const label = input.value.trim();
    if (!label) return;
    pendingItems.push({ id: createId("spi"), label, type: typeInput.value, done: false });
    input.value = "";
    renderPendingItems();
  }

  // ---------- Study plan feed (grouped one card per date) ----------
  function groupEntriesByDate(entries) {
    const map = new Map();
    entries.forEach((entry) => {
      if (!map.has(entry.date)) {
        map.set(entry.date, { date: entry.date, entryIds: [], items: [] });
      }
      const group = map.get(entry.date);
      group.entryIds.push(entry.id);
      (entry.items || []).forEach((item) => group.items.push({ entryId: entry.id, item }));
    });
    return [...map.values()];
  }

  function renderCard(group, onOpen) {
    const card = document.createElement("div");
    card.className = "diary-card";

    const collapsed = collapsedDates.has(group.date);
    const doneCount = group.items.filter(({ item }) => item.done).length;

    const headerRow = document.createElement("div");
    headerRow.className = "diary-card-header-row";

    const date = document.createElement("div");
    date.className = "diary-card-date";
    date.textContent = formatDateLabel(group.date);
    headerRow.appendChild(date);

    const actions = document.createElement("div");
    actions.className = "diary-card-header-actions";

    const summary = document.createElement("span");
    summary.className = "practice-card-checklist";
    summary.textContent = `✓ ${doneCount}/${group.items.length} 완료`;
    actions.appendChild(summary);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "card-action-btn";
    editBtn.textContent = "✎";
    editBtn.setAttribute("aria-label", "계획 수정");
    editBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      onOpen(group);
    });
    actions.appendChild(editBtn);

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "card-action-btn";
    toggleBtn.textContent = collapsed ? "▸" : "▾";
    toggleBtn.setAttribute("aria-label", "접기/펼치기");
    toggleBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      if (collapsedDates.has(group.date)) collapsedDates.delete(group.date);
      else collapsedDates.add(group.date);
      renderStudyFeed();
    });
    actions.appendChild(toggleBtn);

    headerRow.appendChild(actions);
    card.appendChild(headerRow);

    if (!collapsed) {
      if (group.items.length === 0) {
        const empty = document.createElement("p");
        empty.className = "diary-card-text";
        empty.textContent = "계획된 항목이 없어요";
        card.appendChild(empty);
      } else {
        const list = document.createElement("ul");
        list.className = "checklist-items";

        group.items.forEach(({ entryId, item }) => {
          const li = document.createElement("li");
          li.className = "checklist-item" + (item.done ? " done" : "");

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = !!item.done;
          checkbox.addEventListener("change", () => {
            StudyPlanStore.toggleItemDone(entryId, item.id);
            renderStudyFeed();
            renderStreak();
          });
          li.appendChild(checkbox);

          const badge = document.createElement("span");
          badge.className = "study-item-type type-" + (item.type === "assignment" ? "assignment" : "study");
          badge.textContent = typeLabel(item.type);
          li.appendChild(badge);

          const span = document.createElement("span");
          span.textContent = item.label;
          li.appendChild(span);

          list.appendChild(li);
        });

        card.appendChild(list);
      }
    }

    return card;
  }

  function renderStudyFeed() {
    const feed = document.getElementById("studyFeed");
    const groups = groupEntriesByDate(StudyPlanStore.getAll());

    feed.innerHTML = "";
    if (groups.length === 0) {
      feed.innerHTML = `<div class="empty-state"><span class="empty-icon">📖</span><p>아직 세운 공부 계획이 없어요</p></div>`;
      return;
    }
    groups.forEach((group) => feed.appendChild(renderCard(group, (g) => openStudyModal("edit", g))));
  }

  // ---------- Streak ----------
  function renderStreak() {
    const el = document.getElementById("studyStreak");
    if (!el) return;
    const completedDates = new Set(
      loadEntries()
        .filter((e) => (e.items || []).length > 0 && e.items.every((i) => i.done))
        .map((e) => e.date)
    );

    let streak = 0;
    const cursor = new Date();
    if (!completedDates.has(toDateStr(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (completedDates.has(toDateStr(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    if (streak > 0) {
      el.hidden = false;
      el.textContent = `🔥 ${streak}일 연속 계획 완료`;
    } else {
      el.hidden = true;
    }
  }

  // ---------- Study plan modal ----------
  // `data` is a date group: { date, entryIds, items: [{entryId, item}] }
  function openStudyModal(mode, data) {
    editingEntryIds = mode === "edit" ? data.entryIds : [];
    pendingItems = data?.items ? data.items.map(({ item }) => ({ ...item })) : [];

    document.getElementById("studyModalTitle").textContent = mode === "edit" ? "공부 계획 수정" : "공부 계획 추가";
    document.getElementById("studyDateInput").value = data?.date || toDateStr(new Date());
    document.getElementById("deleteStudyBtn").hidden = mode !== "edit";

    renderPendingItems();
    document.getElementById("studyModalOverlay").hidden = false;
  }

  function closeStudyModal() {
    document.getElementById("studyModalOverlay").hidden = true;
    document.getElementById("studyForm").reset();
    pendingItems = [];
    editingEntryIds = [];
  }

  function handleStudySubmit(e) {
    e.preventDefault();
    const date = document.getElementById("studyDateInput").value;
    if (!date) return;
    const items = [...pendingItems];

    if (editingEntryIds.length > 0) {
      const [firstId, ...restIds] = editingEntryIds;
      StudyPlanStore.update(firstId, { date, items });
      restIds.forEach((id) => StudyPlanStore.remove(id));
    } else {
      const existing = StudyPlanStore.getByDate(date);
      if (existing) {
        StudyPlanStore.update(existing.id, { items: [...(existing.items || []), ...items] });
      } else {
        StudyPlanStore.add({ date, items });
      }
    }

    closeStudyModal();
    renderStudyFeed();
    renderStreak();
    window.Toast.show("공부 계획을 저장했어요");
  }

  function handleStudyDelete() {
    if (editingEntryIds.length === 0) return;
    const removedEntries = editingEntryIds.map((id) => StudyPlanStore.getById(id)).filter(Boolean);
    editingEntryIds.forEach((id) => StudyPlanStore.remove(id));
    closeStudyModal();
    renderStudyFeed();
    renderStreak();
    if (removedEntries.length > 0 && window.Toast) {
      window.Toast.show("공부 계획을 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          removedEntries.forEach((entry) => StudyPlanStore.add(entry));
          renderStudyFeed();
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

  function init() {
    document.getElementById("addStudyBtn").addEventListener("click", () => openStudyModal("add"));
    document.getElementById("studyForm").addEventListener("submit", handleStudySubmit);
    document.getElementById("cancelStudyBtn").addEventListener("click", closeStudyModal);
    document.getElementById("deleteStudyBtn").addEventListener("click", handleStudyDelete);
    document.getElementById("studyChecklistAddBtn").addEventListener("click", handleAddItem);
    document.getElementById("studyChecklistInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddItem();
      }
    });
    document.getElementById("studyModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "studyModalOverlay") closeStudyModal();
    });

    document.getElementById("toggleStudyFeedBtn").addEventListener("click", (e) => {
      toggleSection(document.getElementById("studyFeed"), e.currentTarget);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.getElementById("studyModalOverlay").hidden) closeStudyModal();
    });

    renderStudyFeed();
    renderStreak();
  }

  window.StudyView = { init };
})();
