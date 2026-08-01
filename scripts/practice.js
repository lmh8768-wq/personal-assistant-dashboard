(function () {
  const PRACTICE_KEY = "assistant.practice.v1";
  const CHECKLIST_KEY = "assistant.practiceChecklist.v1";

  const DEFAULT_CHECKLIST = [
    { id: "pc_default_1", label: "튜닝 확인" },
    { id: "pc_default_2", label: "스케일 연습" },
    { id: "pc_default_3", label: "코드 · 아르페지오" },
    { id: "pc_default_4", label: "메트로놈 리듬 연습" },
    { id: "pc_default_5", label: "곡 연습" },
  ];

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

  // ---------- Checklist template (recurring daily items) ----------
  function loadChecklist() {
    try {
      const raw = localStorage.getItem(CHECKLIST_KEY);
      return raw ? JSON.parse(raw) : DEFAULT_CHECKLIST;
    } catch {
      return DEFAULT_CHECKLIST;
    }
  }

  function saveChecklist(items) {
    localStorage.setItem(CHECKLIST_KEY, JSON.stringify(items));
  }

  const PracticeChecklistStore = {
    getAll() {
      return loadChecklist();
    },
    add(label) {
      const items = loadChecklist();
      const item = { id: createId("pc"), label };
      items.push(item);
      saveChecklist(items);
      return item;
    },
    remove(id) {
      saveChecklist(loadChecklist().filter((c) => c.id !== id));
    },
    update(id, patch) {
      const items = loadChecklist();
      const idx = items.findIndex((c) => c.id === id);
      if (idx === -1) return null;
      items[idx] = { ...items[idx], ...patch };
      saveChecklist(items);
      return items[idx];
    },
  };
  window.PracticeChecklistStore = PracticeChecklistStore;

  // ---------- Practice status (current song / monthly goal) ----------
  // ---------- Practice entries ----------
  function loadEntries() {
    try {
      const raw = localStorage.getItem(PRACTICE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveEntries(entries) {
    localStorage.setItem(PRACTICE_KEY, JSON.stringify(entries));
  }

  const PracticeStore = {
    getAll() {
      return loadEntries().sort((a, b) => (a.date < b.date ? 1 : -1));
    },
    getById(id) {
      return loadEntries().find((e) => e.id === id) || null;
    },
    add(entry) {
      const entries = loadEntries();
      const item = { id: createId("pr"), ...entry };
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
  window.PracticeStore = PracticeStore;

  // ---------- Checklist rendering (in modal) ----------
  function renderChecklistItems() {
    const list = document.getElementById("practiceChecklistItems");
    list.innerHTML = "";
    PracticeChecklistStore.getAll().forEach((item) => {
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

      const bpmInput = document.createElement("input");
      bpmInput.type = "number";
      bpmInput.min = "0";
      bpmInput.className = "checklist-item-bpm-input";
      bpmInput.placeholder = "BPM";
      bpmInput.value = item.maxBpm ?? "";
      bpmInput.addEventListener("click", (e) => e.stopPropagation());
      bpmInput.addEventListener("change", () => {
        const value = bpmInput.value === "" ? null : Number(bpmInput.value);
        PracticeChecklistStore.update(item.id, { maxBpm: value });
        renderDashboardPractice();
      });
      li.appendChild(bpmInput);

      const remove = document.createElement("span");
      remove.className = "checklist-item-remove";
      remove.textContent = "×";
      remove.title = "체크리스트에서 완전히 제거";
      remove.addEventListener("click", () => {
        PracticeChecklistStore.remove(item.id);
        pendingChecked.delete(item.id);
        renderChecklistItems();
        renderDashboardPractice();
      });
      li.appendChild(remove);

      list.appendChild(li);
    });
  }

  function handleAddChecklistItem() {
    const input = document.getElementById("practiceChecklistInput");
    const label = input.value.trim();
    if (!label) return;
    const item = PracticeChecklistStore.add(label);
    pendingChecked.add(item.id);
    input.value = "";
    renderChecklistItems();
    renderDashboardPractice();
  }

  // ---------- Feed ----------
  function renderCard(entry, onClick) {
    const card = document.createElement("div");
    card.className = "diary-card";

    const date = document.createElement("div");
    date.className = "diary-card-date";
    date.textContent = formatDateLabel(entry.date);
    card.appendChild(date);

    const template = PracticeChecklistStore.getAll();
    if (template.length > 0) {
      const checkedIds = new Set(entry.checkedIds || []);
      const doneLabels = template.filter((t) => checkedIds.has(t.id)).map((t) => t.label);
      const summary = document.createElement("p");
      summary.className = "practice-card-checklist";
      summary.textContent = `✓ ${doneLabels.length}/${template.length} 완료` +
        (doneLabels.length > 0 ? ` · ${doneLabels.join(", ")}` : "");
      card.appendChild(summary);
    }

    if (entry.text) {
      const text = document.createElement("p");
      text.className = "diary-card-text";
      text.textContent = entry.text;
      card.appendChild(text);
    }

    card.addEventListener("click", () => onClick(entry));
    return card;
  }

  function renderFeed() {
    const feed = document.getElementById("practiceFeed");
    const entries = PracticeStore.getAll();

    feed.innerHTML = "";
    if (entries.length === 0) {
      feed.innerHTML = `<div class="empty-state"><span class="empty-icon">🎸</span><p>아직 연습 기록이 없어요</p></div>`;
      return;
    }
    entries.forEach((entry) => feed.appendChild(renderCard(entry, (e) => openModal("edit", e))));
  }

  // ---------- Streak ----------
  function renderStreak() {
    const el = document.getElementById("practiceStreak");
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
      el.textContent = `🔥 ${streak}일 연속 연습 중`;
    } else {
      el.hidden = true;
    }
  }

  // ---------- Modal ----------
  function openModal(mode, data) {
    editingId = mode === "edit" ? data.id : null;
    pendingChecked = new Set(data?.checkedIds || []);

    document.getElementById("practiceModalTitle").textContent = mode === "edit" ? "연습 기록 수정" : "연습 기록";
    document.getElementById("practiceDateInput").value = data?.date || toDateStr(new Date());
    document.getElementById("practiceTextInput").value = data?.text || "";
    document.getElementById("deletePracticeBtn").hidden = mode !== "edit";

    renderChecklistItems();
    document.getElementById("practiceModalOverlay").hidden = false;
  }

  function closeModal() {
    document.getElementById("practiceModalOverlay").hidden = true;
    document.getElementById("practiceForm").reset();
    pendingChecked = new Set();
    editingId = null;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const payload = {
      date: document.getElementById("practiceDateInput").value,
      text: document.getElementById("practiceTextInput").value.trim(),
      checkedIds: [...pendingChecked],
    };
    if (!payload.date) return;

    if (editingId) {
      PracticeStore.update(editingId, payload);
    } else {
      PracticeStore.add(payload);
    }

    closeModal();
    renderFeed();
    renderStreak();
    window.Toast.show("연습 기록을 저장했어요");
  }

  function handleDelete() {
    if (!editingId) return;
    const removed = PracticeStore.getById(editingId);
    PracticeStore.remove(editingId);
    closeModal();
    renderFeed();
    renderStreak();
    if (removed && window.Toast) {
      window.Toast.show("연습 기록을 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          PracticeStore.add(removed);
          renderFeed();
          renderStreak();
        },
      });
    }
  }

  function toggleSection(contentEl, btn) {
    const collapsing = !contentEl.hidden;
    contentEl.hidden = collapsing;
    btn.textContent = collapsing ? "▸" : "▾";
    btn.setAttribute("aria-expanded", String(!collapsing));
  }

  // ---------- Dashboard panel ----------
  function renderDashboardPractice() {
    const bpmList = document.getElementById("dashboardPracticeBpmList");
    if (!bpmList) return;

    const items = PracticeChecklistStore.getAll().filter((item) => item.maxBpm);
    bpmList.innerHTML = "";
    if (items.length === 0) {
      bpmList.innerHTML = `<li>기록된 BPM이 없어요</li>`;
    } else {
      items.forEach((item) => {
        const li = document.createElement("li");
        li.innerHTML = `${item.label} <strong>${item.maxBpm}</strong>`;
        bpmList.appendChild(li);
      });
    }
  }

  // ---------- Curriculum (대목표 > 중목표 > 소목표 goal tree, same mechanic as 학업) ----------
  const CURRICULUM_KEY = "assistant.practiceCurriculum.v1";
  const LEVEL_NAMES = ["대목표", "중목표", "소목표"];

  function levelPlaceholder(depth) {
    return (LEVEL_NAMES[depth] || `${depth + 1}단계 목표`) + " 이름";
  }

  function loadCurriculum() {
    try {
      const raw = localStorage.getItem(CURRICULUM_KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function saveCurriculum(goals) {
    localStorage.setItem(CURRICULUM_KEY, JSON.stringify(goals));
  }

  function findGoalNode(list, id) {
    for (const node of list) {
      if (node.id === id) return node;
      const found = findGoalNode(node.children || [], id);
      if (found) return found;
    }
    return null;
  }

  function extractGoalNode(list, id) {
    const idx = list.findIndex((n) => n.id === id);
    if (idx !== -1) {
      const [node] = list.splice(idx, 1);
      return node;
    }
    for (const node of list) {
      const found = extractGoalNode(node.children || [], id);
      if (found) return found;
    }
    return null;
  }

  function setGoalDoneRecursive(node, done) {
    node.done = done;
    (node.children || []).forEach((child) => setGoalDoneRecursive(child, done));
  }

  function findGoalParentId(list, childId) {
    function search(nodes, parentId) {
      for (const n of nodes) {
        if (n.id === childId) return parentId;
        const found = search(n.children || [], n.id);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    const found = search(list, null);
    return found === undefined ? null : found;
  }

  function recomputeGoalNodeAndAncestors(list, nodeId) {
    let currentId = nodeId;
    while (currentId) {
      const node = findGoalNode(list, currentId);
      if (!node) break;
      const kids = node.children || [];
      if (kids.length > 0) node.done = kids.every((c) => c.done);
      currentId = findGoalParentId(list, currentId);
    }
  }

  function countGoalProgress(node) {
    let total = 1;
    let done = node.done ? 1 : 0;
    (node.children || []).forEach((child) => {
      const c = countGoalProgress(child);
      total += c.total;
      done += c.done;
    });
    return { total, done };
  }

  const CurriculumStore = {
    getGoals() {
      return loadCurriculum();
    },
    addGoal(parentId, label) {
      const goals = loadCurriculum();
      const node = { id: createId("curr"), label, done: false, children: [] };
      if (!parentId) {
        goals.push(node);
      } else {
        const parent = findGoalNode(goals, parentId);
        if (!parent) return null;
        parent.children = parent.children || [];
        parent.children.push(node);
        recomputeGoalNodeAndAncestors(goals, parentId);
      }
      saveCurriculum(goals);
      return node;
    },
    // Returns false (rejected) if the goal has sub-goals that aren't all
    // done yet — it can only become done by finishing all of them, never by
    // being force-checked directly.
    toggleDone(id) {
      const goals = loadCurriculum();
      const node = findGoalNode(goals, id);
      if (!node) return false;
      const hasChildren = (node.children || []).length > 0;
      if (hasChildren && !node.done) return false;
      setGoalDoneRecursive(node, !node.done);
      const parentId = findGoalParentId(goals, id);
      if (parentId) recomputeGoalNodeAndAncestors(goals, parentId);
      saveCurriculum(goals);
      return true;
    },
    removeGoal(id) {
      const goals = loadCurriculum();
      const parentId = findGoalParentId(goals, id);
      const removed = extractGoalNode(goals, id);
      if (!removed) return null;
      if (parentId) recomputeGoalNodeAndAncestors(goals, parentId);
      saveCurriculum(goals);
      return { node: removed, parentId };
    },
    restoreGoal(parentId, node) {
      const goals = loadCurriculum();
      if (!parentId) {
        goals.push(node);
      } else {
        const parent = findGoalNode(goals, parentId);
        if (!parent) goals.push(node);
        else {
          parent.children = parent.children || [];
          parent.children.push(node);
          recomputeGoalNodeAndAncestors(goals, parentId);
        }
      }
      saveCurriculum(goals);
    },
  };
  window.PracticeCurriculumStore = CurriculumStore;

  function makeCurriculumAddTrigger(containerClass, buttonLabel, placeholder, onAdd) {
    const container = document.createElement("div");
    container.className = containerClass;

    function showButton() {
      container.innerHTML = "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghost-btn goal-add-trigger-btn";
      btn.textContent = buttonLabel;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        showInput();
      });
      container.appendChild(btn);
    }

    function showInput() {
      container.innerHTML = "";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "goal-add-input";
      input.placeholder = placeholder;

      let settled = false;
      function commit() {
        if (settled) return;
        settled = true;
        const label = input.value.trim();
        if (label) onAdd(label);
        else showButton();
      }
      function cancel() {
        if (settled) return;
        settled = true;
        showButton();
      }

      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      });
      input.addEventListener("blur", cancel);
      input.addEventListener("click", (e) => e.stopPropagation());

      container.appendChild(input);
      input.focus();
    }

    showButton();
    return container;
  }

  function renderCurriculumItem(node, depth) {
    const li = document.createElement("li");
    li.className = "goal-item";

    const row = document.createElement("div");
    row.className = "goal-item-row checklist-item" + (node.done ? " done" : "");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!node.done;
    checkbox.addEventListener("change", () => {
      const applied = CurriculumStore.toggleDone(node.id);
      if (!applied && window.Toast) {
        window.Toast.show("하위 목표를 모두 완료해야 체크할 수 있어요");
      }
      renderCurriculum();
    });
    row.appendChild(checkbox);

    const label = document.createElement("span");
    label.className = "goal-item-label";
    label.textContent = node.label;
    row.appendChild(label);

    if ((node.children || []).length > 0) {
      const { total, done } = countGoalProgress(node);
      const progress = document.createElement("span");
      progress.className = "goal-item-progress";
      const percent = Math.round((done / total) * 100);
      progress.textContent = depth === 0 ? `${done}/${total} (${percent}%)` : `${done}/${total}`;
      row.appendChild(progress);
    }

    row.appendChild(
      makeCurriculumAddTrigger("goal-item-add", "+", levelPlaceholder(depth + 1), (label) => {
        CurriculumStore.addGoal(node.id, label);
        renderCurriculum();
      })
    );

    const remove = document.createElement("span");
    remove.className = "checklist-item-remove";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      const removed = CurriculumStore.removeGoal(node.id);
      renderCurriculum();
      if (removed && window.Toast) {
        window.Toast.show("목표를 삭제했어요", {
          actionLabel: "실행취소",
          onAction: () => {
            CurriculumStore.restoreGoal(removed.parentId, removed.node);
            renderCurriculum();
          },
        });
      }
    });
    row.appendChild(remove);

    li.appendChild(row);
    li.appendChild(renderCurriculumList(node.children || [], depth + 1, node.id, false));

    return li;
  }

  function renderCurriculumList(nodes, depth, parentId, showTrailingAdd) {
    const wrapper = document.createElement("div");
    wrapper.className = "goal-list-wrapper";
    if (depth > 0) {
      wrapper.style.marginLeft = depth * 22 + "px";
      wrapper.style.marginTop = "4px";
    }

    if (nodes.length > 0) {
      const ul = document.createElement("ul");
      ul.className = "goal-list checklist-items";
      nodes.forEach((node) => ul.appendChild(renderCurriculumItem(node, depth)));
      wrapper.appendChild(ul);
    }

    if (showTrailingAdd) {
      wrapper.appendChild(
        makeCurriculumAddTrigger("goal-add-row", "+ 대목표 추가", levelPlaceholder(depth), (label) => {
          CurriculumStore.addGoal(parentId, label);
          renderCurriculum();
        })
      );
    }
    return wrapper;
  }

  function renderCurriculum() {
    const container = document.getElementById("practiceCurriculum");
    if (!container) return;
    container.innerHTML = "";
    container.appendChild(renderCurriculumList(CurriculumStore.getGoals(), 0, null, true));
  }

  function init() {
    document.getElementById("addPracticeBtn").addEventListener("click", () => openModal("add"));
    document.getElementById("practiceForm").addEventListener("submit", handleSubmit);
    document.getElementById("cancelPracticeBtn").addEventListener("click", closeModal);
    document.getElementById("deletePracticeBtn").addEventListener("click", handleDelete);

    document.getElementById("practiceChecklistAddBtn").addEventListener("click", handleAddChecklistItem);
    document.getElementById("practiceChecklistInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddChecklistItem();
      }
    });

    document.getElementById("toggleFeedBtn").addEventListener("click", (e) => {
      toggleSection(document.getElementById("practiceFeed"), e.currentTarget);
    });
    document.getElementById("toggleCurriculumBtn")?.addEventListener("click", (e) => {
      toggleSection(document.getElementById("practiceCurriculum"), e.currentTarget);
    });

    document.getElementById("practiceModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "practiceModalOverlay") closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.getElementById("practiceModalOverlay").hidden) closeModal();
    });

    renderFeed();
    renderStreak();
    renderDashboardPractice();
    renderCurriculum();
  }

  window.PracticeView = { init, refreshDashboard: renderDashboardPractice };
})();
