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

  // Local-time-only date convention (why not `new Date(s)`) — see
  // scripts/schedule-recurrence.js's parseDateStr.
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
    window.safeSetLocalStorage(CHECKLIST_KEY, JSON.stringify(items));
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
    window.safeSetLocalStorage(PRACTICE_KEY, JSON.stringify(entries));
  }

  const PracticeStore = {
    getAll() {
      // Must return 0 for equal dates — returning -1 for "a.date === b.date"
      // (the old `a.date < b.date ? 1 : -1`) violates antisymmetry, so two
      // same-day entries could flip order between renders.
      return loadEntries().sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
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
      checkbox.setAttribute("aria-label", item.label || "체크리스트 항목");
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
      window.makeKeyboardActivatable(remove, "체크리스트에서 완전히 제거");
      li.appendChild(remove);

      list.appendChild(li);
    });
  }

  function handleAddChecklistItem() {
    const input = document.getElementById("practiceChecklistInput");
    const label = input.value.trim();
    if (!label) return;
    const item = PracticeChecklistStore.add(label);
    // Only auto-check a brand-new checklist item when creating today's
    // entry — doing this unconditionally used to backdate a habit that
    // didn't exist yet whenever the "+" was used while editing an older
    // diary entry (e.g. fixing a typo in last month's log).
    if (editingId === null) pendingChecked.add(item.id);
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
      // The denominator is the checklist size AT THE TIME this entry was
      // saved (entry.checklistTotal), not today's — otherwise adding a new
      // checklist item retroactively changes every past entry's ratio (e.g.
      // a historical "5/5 완료" silently becomes "5/6") even though nothing
      // about that entry changed. Older entries saved before this field
      // existed fall back to today's template size, same as before.
      const total = entry.checklistTotal != null ? entry.checklistTotal : template.length;
      const summary = document.createElement("p");
      summary.className = "practice-card-checklist";
      summary.textContent = `✓ ${doneLabels.length}/${total} 완료` +
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
    window.makeKeyboardActivatable(card, `${formatDateLabel(entry.date)} 연습 기록 편집`);
    return card;
  }

  // Resets to the first page each time the feed view is (re)opened — a
  // module-level count rather than persisted, since "where I left off
  // scrolling" isn't worth remembering across sessions the way the data
  // itself is. Rendering years of entries in one go (one full DOM subtree
  // per diary card, rebuilt on every single edit) is the part that isn't
  // free; showing only the most recent page up front keeps that cheap.
  const FEED_PAGE_SIZE = 20;
  let feedVisibleCount = FEED_PAGE_SIZE;

  function renderFeed() {
    const feed = document.getElementById("practiceFeed");
    const entries = PracticeStore.getAll();

    feed.innerHTML = "";
    if (entries.length === 0) {
      feed.innerHTML = `<div class="empty-state"><span class="empty-icon" aria-hidden="true">🎸</span><p>아직 연습 기록이 없어요</p></div>`;
      return;
    }
    entries
      .slice(0, feedVisibleCount)
      .forEach((entry) => feed.appendChild(renderCard(entry, (e) => openModal("edit", e))));

    if (entries.length > feedVisibleCount) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "ghost-btn diary-load-more-btn";
      more.textContent = `더 보기 (${entries.length - feedVisibleCount}개 남음)`;
      more.addEventListener("click", () => {
        feedVisibleCount += FEED_PAGE_SIZE;
        renderFeed();
      });
      feed.appendChild(more);
    }
  }

  // ---------- Streak ----------
  // Deliberately anchored to the device's local calendar day (via plain
  // Date/setDate, no UTC conversion) rather than a fixed timezone — "did I
  // practice today" should follow wherever the user actually is, which is
  // exactly what the device's local clock already reflects for the
  // overwhelmingly common case of never changing timezone mid-streak.
  // Crossing timezones while entries are logged right at a day boundary is
  // a real but rare edge case; pinning to a fixed "home" timezone instead
  // would fix that at the cost of making every ordinary (non-traveling) day
  // boundary wrong for whichever zone isn't "home" — a worse trade for the
  // common case, so this stays local-clock-based on purpose.
  function computeStreak() {
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
    return streak;
  }

  function renderStreak() {
    const el = document.getElementById("practiceStreak");
    if (!el) return;
    const streak = computeStreak();

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
      checklistTotal: PracticeChecklistStore.getAll().length,
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

  // `storageKey`, when given, persists the collapsed state (device-local UI
  // state, not synced) — these sections used to always reopen expanded on
  // every reload regardless of what the user last chose.
  //
  // `regionEl` is the .collapse-region wrapper (index.html), not the raw
  // content element — toggling .hidden on the content directly (the old
  // approach) snapped it open/closed instantly with nothing for a
  // transition to animate, unlike the goal tree right next to it, which
  // already used this same grid-rows collapse trick.
  function toggleSection(regionEl, btn, storageKey) {
    const collapsing = !regionEl.classList.contains("collapsed");
    regionEl.classList.toggle("collapsed", collapsing);
    btn.textContent = collapsing ? "▸" : "▾";
    btn.setAttribute("aria-expanded", String(!collapsing));
    if (storageKey) localStorage.setItem(storageKey, String(collapsing));
  }

  function applyStoredCollapse(regionEl, btn, storageKey) {
    const collapsed = localStorage.getItem(storageKey) === "true";
    regionEl.classList.toggle("collapsed", collapsed);
    btn.textContent = collapsed ? "▸" : "▾";
    btn.setAttribute("aria-expanded", String(!collapsed));
  }

  // ---------- Dashboard panel (just the practice streak, in big text) ----------
  function renderDashboardPractice() {
    const el = document.getElementById("dashboardPracticeStreak");
    if (!el) return;
    el.textContent = computeStreak();
  }

  // ---------- Curriculum (대목표 > 중목표 > 소목표 goal tree, same mechanic as 학업) ----------
  const CURRICULUM_KEY = "assistant.practiceCurriculum.v1";

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
    window.safeSetLocalStorage(CURRICULUM_KEY, JSON.stringify(goals));
  }

  // Thin wrappers over scripts/goal-tree-logic.js's shared implementation
  // (identical to study.js's goal tree — this used to be a hand-copied
  // second implementation that could silently drift from that one whenever
  // only one side got a bug fix). Every existing call site below is
  // unchanged; only the logic underneath is now shared.
  function findGoalNode(list, id) {
    return window.GoalTreeLogic.findNode(list, id);
  }
  function extractGoalNode(list, id) {
    return window.GoalTreeLogic.extractNode(list, id);
  }
  function setGoalDoneRecursive(node, done) {
    return window.GoalTreeLogic.setDoneRecursive(node, done);
  }
  function findGoalParentId(list, childId) {
    return window.GoalTreeLogic.findParentId(list, childId);
  }
  function recomputeGoalNodeAndAncestors(list, nodeId) {
    return window.GoalTreeLogic.recomputeNodeAndAncestors(list, nodeId);
  }
  function countGoalProgress(node) {
    return window.GoalTreeLogic.countProgress(node);
  }
  function deepCloneGoalWithNewIds(node) {
    return window.GoalTreeLogic.deepCloneWithNewIds(node, "curr", createId);
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
    // Reorders `draggedId` next to `targetId` within their shared sibling
    // list. A no-op if they don't share a parent — dragging only ever
    // reorders among siblings, it never re-parents a goal.
    reorderGoal(draggedId, targetId, insertBefore) {
      if (draggedId === targetId) return;
      const goals = loadCurriculum();
      const draggedParentId = findGoalParentId(goals, draggedId);
      const targetParentId = findGoalParentId(goals, targetId);
      if (draggedParentId !== targetParentId) return;
      const siblings = draggedParentId ? (findGoalNode(goals, draggedParentId).children || []) : goals;
      const fromIdx = siblings.findIndex((n) => n.id === draggedId);
      if (fromIdx === -1) return;
      const [node] = siblings.splice(fromIdx, 1);
      let toIdx = siblings.findIndex((n) => n.id === targetId);
      if (toIdx === -1) toIdx = siblings.length;
      else if (!insertBefore) toIdx += 1;
      siblings.splice(toIdx, 0, node);
      saveCurriculum(goals);
    },
    renameGoal(id, label) {
      const goals = loadCurriculum();
      const node = findGoalNode(goals, id);
      if (!node) return;
      node.label = label;
      saveCurriculum(goals);
    },
    // Pastes deep clones of `nodes` (each gets an entirely new id, top to
    // bottom) as new children of `targetParentId`.
    pasteGoals(targetParentId, nodes) {
      const goals = loadCurriculum();
      const parent = findGoalNode(goals, targetParentId);
      if (!parent) return [];
      const cloned = nodes.map(deepCloneGoalWithNewIds);
      parent.children = parent.children || [];
      parent.children.push(...cloned);
      recomputeGoalNodeAndAncestors(goals, targetParentId);
      saveCurriculum(goals);
      return cloned;
    },
  };
  window.PracticeCurriculumStore = CurriculumStore;

  // ---------- UI state: per-goal collapse/expand (per device, not synced) ----------
  const CURRICULUM_UI_STATE_KEY = "practiceCurriculumUiState.v1";

  function loadCurriculumUiState() {
    try {
      const raw = localStorage.getItem(CURRICULUM_UI_STATE_KEY);
      const s = raw ? JSON.parse(raw) : {};
      if (!s.collapsedGoals) s.collapsedGoals = {};
      return s;
    } catch {
      return { collapsedGoals: {} };
    }
  }

  function saveCurriculumUiState(state) {
    window.safeSetLocalStorage(CURRICULUM_UI_STATE_KEY, JSON.stringify(state));
  }

  function isGoalCollapsed(goalId) {
    return !!loadCurriculumUiState().collapsedGoals[goalId];
  }

  function toggleGoalCollapsed(goalId) {
    const state = loadCurriculumUiState();
    state.collapsedGoals[goalId] = !state.collapsedGoals[goalId];
    saveCurriculumUiState(state);
  }

  // A goal created via "+" but abandoned before it got a name — tracked so
  // a second "+" click elsewhere can clean up the still-blank one instead
  // of leaving it stranded with an empty label forever.
  let pendingNewGoal = null; // { id }

  function discardPendingNewGoal() {
    if (!pendingNewGoal) return;
    CurriculumStore.removeGoal(pendingNewGoal.id);
    pendingNewGoal = null;
  }

  // ---------- Multi-select copy/paste (drag across rows to select, copy, then paste as another goal's children) ----------
  let curriculumSelectMode = false;
  let selectedGoalIds = new Set();
  let dragSelectValue = null; // true/false while a paint-select drag is in progress, else null
  let clipboardGoals = []; // deep-cloned snapshot of the goals copied last

  // ---------- Row reordering (drag-and-drop within a shared parent) ----------
  // dataTransfer.getData() isn't readable during "dragover" in most browsers
  // (only during "drop"), so the id being dragged is tracked here instead —
  // lets dragover know up front whether this drop would actually be a no-op
  // (see reorderGoal's "no-op if they don't share a parent" comment) instead
  // of showing a before/after indicator for a drop that silently does nothing.
  let draggedGoalId = null;

  function setGoalSelected(id, val) {
    if (val) selectedGoalIds.add(id);
    else selectedGoalIds.delete(id);
    const row = document.querySelector(`.goal-item-row[data-goal-id="${id}"]`);
    if (row) {
      row.classList.toggle("selected", val);
      const cb = row.querySelector(".goal-select-checkbox");
      if (cb) cb.checked = val;
    }
    updateCurriculumSelectToolbar();
  }

  function updateCurriculumSelectToolbar() {
    const toolbar = document.getElementById("curriculumSelectToolbar");
    if (!toolbar) return;
    toolbar.hidden = !curriculumSelectMode;
    const countEl = document.getElementById("curriculumSelectCount");
    if (countEl) countEl.textContent = `${selectedGoalIds.size}개 선택됨`;
    const copyBtn = document.getElementById("curriculumCopyBtn");
    if (copyBtn) copyBtn.disabled = selectedGoalIds.size === 0;
    const deleteBtn = document.getElementById("curriculumDeleteBtn");
    if (deleteBtn) deleteBtn.disabled = selectedGoalIds.size === 0;
  }

  function toggleCurriculumSelectMode() {
    curriculumSelectMode = !curriculumSelectMode;
    selectedGoalIds.clear();
    document.getElementById("curriculumSelectModeBtn").textContent = curriculumSelectMode ? "선택 취소" : "선택";
    updateCurriculumSelectToolbar();
    renderCurriculum();
  }

  function exitCurriculumSelectMode() {
    curriculumSelectMode = false;
    selectedGoalIds.clear();
    document.getElementById("curriculumSelectModeBtn").textContent = "선택";
    updateCurriculumSelectToolbar();
  }

  function handleCurriculumSelectAll() {
    function addAll(nodes) {
      nodes.forEach((node) => {
        selectedGoalIds.add(node.id);
        addAll(node.children || []);
      });
    }
    addAll(CurriculumStore.getGoals());
    updateCurriculumSelectToolbar();
    renderCurriculum();
  }

  function handleCurriculumCopy() {
    if (selectedGoalIds.size === 0) return;
    const goals = CurriculumStore.getGoals();
    clipboardGoals = [...selectedGoalIds]
      .map((id) => findGoalNode(goals, id))
      .filter(Boolean)
      .map((n) => JSON.parse(JSON.stringify(n)));
    const count = clipboardGoals.length;
    exitCurriculumSelectMode();
    updateClipboardNote();
    renderCurriculum();
    window.Toast?.show(`${count}개 목표를 복사했어요. 붙여넣을 목표의 "붙여넣기"를 눌러주세요.`);
  }

  function getTopLevelSelectedIds() {
    const goals = CurriculumStore.getGoals();
    return [...selectedGoalIds].filter((id) => {
      let parentId = findGoalParentId(goals, id);
      while (parentId) {
        if (selectedGoalIds.has(parentId)) return false;
        parentId = findGoalParentId(goals, parentId);
      }
      return true;
    });
  }

  function handleCurriculumDelete() {
    if (selectedGoalIds.size === 0) return;
    const removed = getTopLevelSelectedIds()
      .map((id) => CurriculumStore.removeGoal(id))
      .filter(Boolean);
    exitCurriculumSelectMode();
    renderCurriculum();
    if (removed.length > 0 && window.Toast) {
      window.Toast.show(`${removed.length}개 목표를 삭제했어요`, {
        actionLabel: "실행취소",
        onAction: () => {
          removed.forEach(({ parentId, node }) => CurriculumStore.restoreGoal(parentId, node));
          renderCurriculum();
        },
      });
    }
  }

  function updateClipboardNote() {
    const note = document.getElementById("curriculumClipboardNote");
    if (!note) return;
    note.innerHTML = "";
    if (clipboardGoals.length === 0) {
      note.hidden = true;
      return;
    }
    note.hidden = false;
    const text = document.createElement("span");
    text.textContent = `📋 ${clipboardGoals.length}개 복사됨 — 붙여넣을 목표의 "붙여넣기"를 누르세요.`;
    note.appendChild(text);
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "checklist-item-remove";
    clearBtn.textContent = "×";
    clearBtn.setAttribute("aria-label", "복사 취소");
    clearBtn.addEventListener("click", () => {
      clipboardGoals = [];
      updateClipboardNote();
      renderCurriculum();
    });
    note.appendChild(clearBtn);
  }

  // Shared with study.js's goal tree — see scripts/goal-tree-ui.js.
  const makeToggleBtn = window.GoalTreeUI.makeToggleBtn;
  const wrapCollapseRegion = window.GoalTreeUI.wrapCollapseRegion;
  const makeInstantAddButton = window.GoalTreeUI.makeInstantAddButton;

  // Renders a freshly-created (still-unnamed) goal's label as a focused
  // text input instead of a plain span. Enter/blur commits a non-empty
  // value; Enter/blur with nothing typed, or Escape regardless, deletes the
  // goal outright — it just disappears rather than sticking around blank.
  // Shared with study.js's goal tree — see scripts/goal-label-editor.js.
  const makeInlineGoalLabelEditor = window.GoalLabelEditor.makeInline;
  const makeDblClickEditableGoalLabel = window.GoalLabelEditor.makeDblClickEditable;

  // Patches just the toggled leaf's row plus its ancestors' progress badges
  // in place, instead of renderCurriculum() tearing down and rebuilding the
  // whole tree for what's otherwise a single checkbox flip. Only valid for
  // a leaf toggle — see the caller's comment for why a node with children
  // still falls back to a full re-render.
  function patchGoalDoneAncestors(id) {
    const goals = CurriculumStore.getGoals();
    const chain = [];
    let currentId = id;
    while (currentId) {
      chain.push(currentId);
      currentId = findGoalParentId(goals, currentId);
    }
    // chain[0] is the toggled node itself; the last entry is the topmost
    // ancestor (depth 0) — reversed, its index is that node's actual depth,
    // which the progress badge's text format depends on.
    chain.forEach((nodeId, indexFromToggled) => {
      const node = findGoalNode(goals, nodeId);
      const row = document.querySelector(`.goal-item-row[data-goal-id="${nodeId}"]`);
      if (!node || !row) return;
      const depth = chain.length - 1 - indexFromToggled;
      row.classList.toggle("done", !!node.done);
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = !!node.done;
      if ((node.children || []).length > 0) {
        const progress = row.querySelector(".goal-item-progress");
        if (progress) {
          const { total, done } = countGoalProgress(node);
          const percent = Math.round((done / total) * 100);
          progress.textContent = depth === 0 ? `${done}/${total} (${percent}%)` : `${done}/${total}`;
        }
      }
    });
  }

  function renderCurriculumItem(node, depth) {
    const li = document.createElement("li");
    li.className = "goal-item";

    const row = document.createElement("div");
    row.className = "goal-item-row checklist-item" +
      (node.done ? " done" : "") +
      (selectedGoalIds.has(node.id) ? " selected" : "");
    row.dataset.goalId = node.id;

    row.draggable = !curriculumSelectMode;
    row.addEventListener("dragstart", (e) => {
      draggedGoalId = node.id;
      e.dataTransfer.setData("text/plain", node.id);
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      draggedGoalId = null;
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (draggedGoalId === null || draggedGoalId === node.id) return;
      const goals = CurriculumStore.getGoals();
      if (findGoalParentId(goals, draggedGoalId) !== findGoalParentId(goals, node.id)) {
        row.classList.remove("drag-over-before", "drag-over-after");
        return;
      }
      const rect = row.getBoundingClientRect();
      const before = e.clientY - rect.top < rect.height / 2;
      row.classList.toggle("drag-over-before", before);
      row.classList.toggle("drag-over-after", !before);
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("drag-over-before", "drag-over-after");
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("drag-over-before", "drag-over-after");
      const draggedId = e.dataTransfer.getData("text/plain");
      if (!draggedId) return;
      const rect = row.getBoundingClientRect();
      const before = e.clientY - rect.top < rect.height / 2;
      CurriculumStore.reorderGoal(draggedId, node.id, before);
      renderCurriculum();
    });

    // Drag-and-drop had no keyboard equivalent at all — Alt+↑/↓ reorders
    // the focused row among its own siblings (never re-parents, same
    // restriction reorderGoal already enforces for a mouse drag). This is
    // the same pattern used elsewhere for reorderable lists; aria-grabbed/
    // aria-dropeffect (the "proper" drag-and-drop ARIA attributes) were
    // actually dropped from the ARIA spec for being unreliable across
    // screen readers, so a documented keyboard shortcut is the more
    // practical accessible alternative.
    if (!curriculumSelectMode) {
      row.tabIndex = 0;
      row.title = "Alt+↑/↓ 키로 순서를 바꿀 수 있어요";
      row.addEventListener("keydown", (e) => {
        if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        if (e.target !== row) return; // let a nested input/button handle its own keys
        e.preventDefault();
        const goals = CurriculumStore.getGoals();
        const parentId = findGoalParentId(goals, node.id);
        const siblings = parentId ? (findGoalNode(goals, parentId)?.children || []) : goals;
        const idx = siblings.findIndex((n) => n.id === node.id);
        const targetIdx = e.key === "ArrowUp" ? idx - 1 : idx + 1;
        if (idx === -1 || targetIdx < 0 || targetIdx >= siblings.length) return;
        CurriculumStore.reorderGoal(node.id, siblings[targetIdx].id, e.key === "ArrowUp");
        renderCurriculum();
        requestAnimationFrame(() => {
          document.querySelector(`.goal-item-row[data-goal-id="${node.id}"]`)?.focus();
        });
      });
    }

    if (curriculumSelectMode) {
      // Click-and-drag across rows paints them all to the same new
      // selected state as the row the gesture started on. The checkbox
      // itself is excluded here and handled by its own "change" listener
      // below instead — this handler's preventDefault() stops the
      // checkbox's default focus behavior but NOT its native click-driven
      // checked toggle, so a click landing on the checkbox used to flip
      // selectedGoalIds here AND get toggled again natively, leaving the
      // checkbox's visible state inverted from the actual selection.
      row.addEventListener("mousedown", (e) => {
        if (e.target.closest("button, .goal-item-label-input, .checklist-item-remove, .goal-select-checkbox")) return;
        e.preventDefault();
        const newVal = !selectedGoalIds.has(node.id);
        dragSelectValue = newVal;
        setGoalSelected(node.id, newVal);
      });
      row.addEventListener("mouseenter", () => {
        if (dragSelectValue === null) return;
        setGoalSelected(node.id, dragSelectValue);
      });

      const selectCheckbox = document.createElement("input");
      selectCheckbox.type = "checkbox";
      selectCheckbox.className = "goal-select-checkbox";
      selectCheckbox.setAttribute("aria-label", `${node.label || "목표"} 선택`);
      selectCheckbox.checked = selectedGoalIds.has(node.id);
      selectCheckbox.addEventListener("click", (e) => e.stopPropagation());
      selectCheckbox.addEventListener("change", () => setGoalSelected(node.id, selectCheckbox.checked));
      row.appendChild(selectCheckbox);
    } else {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !!node.done;
      checkbox.setAttribute("aria-label", node.label || "목표");
      checkbox.addEventListener("change", () => {
        const applied = CurriculumStore.toggleDone(node.id);
        if (!applied) {
          checkbox.checked = !!node.done; // revert the native toggle — the store didn't change
          if (window.Toast) window.Toast.show("하위 목표를 모두 완료해야 체크할 수 있어요", { type: "warning" });
          return;
        }
        // Toggling a node with children only ever succeeds when UN-checking
        // an already-done one, which cascades done=false to every
        // descendant — patching just the ancestor chain wouldn't touch
        // those, so fall back to a full rebuild for that (rarer) case.
        // A plain leaf toggle (the common case — checking/unchecking one
        // item) only ever affects that node plus its ancestors' progress
        // counts, so patch just those instead of tearing down and
        // rebuilding the entire tree for a single checkbox click.
        if ((node.children || []).length > 0) renderCurriculum();
        else patchGoalDoneAncestors(node.id);
      });
      row.appendChild(checkbox);
    }

    const hasChildren = (node.children || []).length > 0;
    const collapsed = hasChildren && isGoalCollapsed(node.id);
    let childrenRegion = null;
    if (hasChildren) {
      childrenRegion = wrapCollapseRegion(
        renderCurriculumList(node.children || [], depth + 1, node.id, false),
        collapsed
      );
      row.appendChild(
        makeToggleBtn(collapsed, (newCollapsed) => {
          toggleGoalCollapsed(node.id);
          childrenRegion.classList.toggle("collapsed", newCollapsed);
        })
      );
    }

    const isEditingLabel = pendingNewGoal && pendingNewGoal.id === node.id;
    if (isEditingLabel) {
      row.appendChild(
        makeInlineGoalLabelEditor(
          node.label,
          depth === 0 ? "대목표 이름" : "하위 목표 이름",
          (value) => {
            // This can now run after a click elsewhere already discarded
            // this goal (see goal-label-editor.js's deferred blur-commit,
            // needed so that click isn't itself swallowed) — only act if
            // this is still the actual pending goal, not one some other
            // action already cleaned up/superseded.
            if (!pendingNewGoal || pendingNewGoal.id !== node.id) return;
            CurriculumStore.renameGoal(node.id, value);
            pendingNewGoal = null;
            renderCurriculum();
          },
          () => {
            if (!pendingNewGoal || pendingNewGoal.id !== node.id) return;
            CurriculumStore.removeGoal(node.id);
            pendingNewGoal = null;
            renderCurriculum();
          }
        )
      );
    } else {
      row.appendChild(
        makeDblClickEditableGoalLabel(node.label, (value) => {
          CurriculumStore.renameGoal(node.id, value);
          renderCurriculum();
        })
      );
    }

    row.appendChild(
      makeInstantAddButton("goal-item-add", "+", () => {
        discardPendingNewGoal();
        if (collapsed) toggleGoalCollapsed(node.id);
        const newNode = CurriculumStore.addGoal(node.id, "");
        pendingNewGoal = { id: newNode.id };
        renderCurriculum();
      })
    );

    if (!curriculumSelectMode && clipboardGoals.length > 0) {
      const pasteBtn = document.createElement("button");
      pasteBtn.type = "button";
      pasteBtn.className = "ghost-btn goal-paste-btn";
      pasteBtn.textContent = "붙여넣기";
      pasteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (collapsed) toggleGoalCollapsed(node.id);
        const pasted = CurriculumStore.pasteGoals(node.id, clipboardGoals);
        renderCurriculum();
        window.Toast?.show(`${pasted.length}개 목표를 붙여넣었어요`);
      });
      row.appendChild(pasteBtn);
    }

    if (hasChildren) {
      const { total, done } = countGoalProgress(node);
      const progress = document.createElement("span");
      progress.className = "goal-item-progress";
      const percent = Math.round((done / total) * 100);
      progress.textContent = depth === 0 ? `${done}/${total} (${percent}%)` : `${done}/${total}`;
      row.appendChild(progress);
    }

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
    window.makeKeyboardActivatable(remove, `${node.label || "목표"} 삭제`);
    row.appendChild(remove);

    li.appendChild(row);
    // No trailing add-row here — this item's own "+" (above, right next to
    // its label) is the only way to add into this children list.
    if (childrenRegion) li.appendChild(childrenRegion);

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

    // Only the top level (adding a fresh 대목표) ever uses a trailing add
    // trigger — nested levels are added via each item's own "+" instead.
    if (showTrailingAdd) {
      wrapper.appendChild(
        makeInstantAddButton("goal-add-row", "+ 대목표 추가", () => {
          discardPendingNewGoal();
          const newNode = CurriculumStore.addGoal(parentId, "");
          pendingNewGoal = { id: newNode.id };
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
    if (pendingNewGoal) {
      const input = container.querySelector(".goal-item-label-input");
      if (input) input.focus();
    }
  }

  function init() {
    document.getElementById("addPracticeBtn").addEventListener("click", () => openModal("add"));
    document.getElementById("practiceForm").addEventListener("submit", handleSubmit);
    document.getElementById("cancelPracticeBtn").addEventListener("click", closeModal);
    document.getElementById("closePracticeModalBtn").addEventListener("click", closeModal);
    document.getElementById("deletePracticeBtn").addEventListener("click", handleDelete);

    document.getElementById("practiceChecklistAddBtn").addEventListener("click", handleAddChecklistItem);
    document.getElementById("practiceChecklistInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddChecklistItem();
      }
    });

    const feedToggleBtn = document.getElementById("toggleFeedBtn");
    const feedRegion = document.getElementById("practiceFeedRegion");
    applyStoredCollapse(feedRegion, feedToggleBtn, "practiceFeedCollapsed");
    feedToggleBtn.addEventListener("click", (e) => {
      toggleSection(feedRegion, e.currentTarget, "practiceFeedCollapsed");
    });

    const curriculumToggleBtn = document.getElementById("toggleCurriculumBtn");
    const curriculumRegion = document.getElementById("practiceCurriculumRegion");
    if (curriculumToggleBtn && curriculumRegion) {
      applyStoredCollapse(curriculumRegion, curriculumToggleBtn, "practiceCurriculumCollapsed");
      curriculumToggleBtn.addEventListener("click", (e) => {
        toggleSection(curriculumRegion, e.currentTarget, "practiceCurriculumCollapsed");
      });
    }

    document.getElementById("curriculumSelectModeBtn")?.addEventListener("click", toggleCurriculumSelectMode);
    document.getElementById("curriculumSelectAllBtn")?.addEventListener("click", handleCurriculumSelectAll);
    document.getElementById("curriculumCopyBtn")?.addEventListener("click", handleCurriculumCopy);
    document.getElementById("curriculumDeleteBtn")?.addEventListener("click", handleCurriculumDelete);
    document.getElementById("curriculumCancelSelectBtn")?.addEventListener("click", () => {
      exitCurriculumSelectMode();
      renderCurriculum();
    });
    document.addEventListener("mouseup", () => {
      dragSelectValue = null;
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

  // Unlike schedule/ledger/routine/settings, this tab's own content never
  // refreshed when navigated to — only once, at app startup. A live
  // cross-device sync update to the practice feed or curriculum tree while
  // this tab wasn't the active one stayed invisible until some unrelated
  // local action (e.g. adding a goal) happened to trigger renderCurriculum()
  // again. onShow() doesn't re-attach any of init()'s event listeners, just
  // re-runs the same render calls init() ends with.
  window.PracticeView = {
    init,
    refreshDashboard: renderDashboardPractice,
    onShow: () => {
      feedVisibleCount = FEED_PAGE_SIZE;
      renderFeed();
      renderStreak();
      renderCurriculum();
    },
  };
})();
