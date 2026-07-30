(function () {
  const GOALS_KEY = "assistant.academicGoals.v1";
  // Collapse/expand state is a per-device UI preference, not real content —
  // deliberately kept OUT of the "assistant." namespace so cloud-sync.js
  // never treats it as data to sync/overwrite across devices.
  const UI_STATE_KEY = "academicUiState.v1";

  // Only used to seed a brand-new year's periods and to migrate data saved
  // before periods became freely add/remove/renamable by the user.
  const DEFAULT_PERIODS = [
    { key: "midterm1", label: "1학기 중간고사" },
    { key: "final1", label: "1학기 기말고사" },
    { key: "summer", label: "여름방학" },
    { key: "midterm2", label: "2학기 중간고사" },
    { key: "final2", label: "2학기 기말고사" },
    { key: "winter", label: "겨울방학" },
  ];

  const LEVEL_ADD_LABEL = ["+ 대목표 추가", "+ 중목표 추가", "+ 소목표 추가"];
  const LEVEL_PLACEHOLDER = ["대목표 이름", "중목표 이름", "소목표 이름"];

  function createId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function defaultPeriodList() {
    return DEFAULT_PERIODS.map((p) => ({ id: createId("period"), label: p.label, goals: [] }));
  }

  // ---------- Storage: years -> periods -> goal tree ----------
  function loadGoals() {
    let data;
    try {
      const raw = localStorage.getItem(GOALS_KEY);
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    let changed = false;
    if (!data || !Array.isArray(data.years)) {
      // Very old shape: a flat { periodKey: [...] } with no year grouping at all.
      const oldFlat = data && !data.years ? data : null;
      const periods = defaultPeriodList();
      if (oldFlat) {
        DEFAULT_PERIODS.forEach((p, i) => {
          if (Array.isArray(oldFlat[p.key])) periods[i].goals = oldFlat[p.key];
        });
      }
      data = { years: [{ id: createId("year"), label: String(new Date().getFullYear()), periods }] };
      changed = true;
    }
    data.years.forEach((year) => {
      if (!Array.isArray(year.periods)) {
        // Mid-generation shape: periods was a fixed-key object (before periods
        // themselves became user-editable). Convert to an ordered array.
        const oldPeriods = year.periods || {};
        year.periods = DEFAULT_PERIODS.map((p) => ({
          id: createId("period"),
          label: p.label,
          goals: Array.isArray(oldPeriods[p.key]) ? oldPeriods[p.key] : [],
        }));
        changed = true;
      }
    });
    if (changed) saveGoals(data);
    return data;
  }

  function saveGoals(data) {
    localStorage.setItem(GOALS_KEY, JSON.stringify(data));
  }

  function findNode(list, id) {
    for (const node of list) {
      if (node.id === id) return node;
      const found = findNode(node.children || [], id);
      if (found) return found;
    }
    return null;
  }

  // Removes the node with `id` from `list` (searching recursively) and
  // returns it so the caller can offer undo.
  function extractNode(list, id) {
    const idx = list.findIndex((n) => n.id === id);
    if (idx !== -1) {
      const [node] = list.splice(idx, 1);
      return node;
    }
    for (const node of list) {
      const found = extractNode(node.children || [], id);
      if (found) return found;
    }
    return null;
  }

  function countProgress(node) {
    let total = 1;
    let done = node.done ? 1 : 0;
    (node.children || []).forEach((child) => {
      const c = countProgress(child);
      total += c.total;
      done += c.done;
    });
    return { total, done };
  }

  function findYear(data, yearId) {
    return data.years.find((y) => y.id === yearId);
  }

  function findPeriod(year, periodId) {
    return year ? year.periods.find((p) => p.id === periodId) : null;
  }

  const GoalStore = {
    getYears() {
      return loadGoals().years;
    },
    addYear(label) {
      const data = loadGoals();
      const year = { id: createId("year"), label, periods: defaultPeriodList() };
      data.years.push(year);
      saveGoals(data);
      return year;
    },
    removeYear(yearId) {
      const data = loadGoals();
      const idx = data.years.findIndex((y) => y.id === yearId);
      if (idx === -1) return null;
      const [removed] = data.years.splice(idx, 1);
      saveGoals(data);
      return { year: removed, index: idx };
    },
    restoreYear(year, index) {
      const data = loadGoals();
      const at = Math.min(index, data.years.length);
      data.years.splice(at, 0, year);
      saveGoals(data);
    },
    getPeriods(yearId) {
      const year = findYear(loadGoals(), yearId);
      return year ? year.periods : [];
    },
    addPeriod(yearId, label) {
      const data = loadGoals();
      const year = findYear(data, yearId);
      if (!year) return null;
      const period = { id: createId("period"), label, goals: [] };
      year.periods.push(period);
      saveGoals(data);
      return period;
    },
    renamePeriod(yearId, periodId, label) {
      const data = loadGoals();
      const period = findPeriod(findYear(data, yearId), periodId);
      if (!period) return;
      period.label = label;
      saveGoals(data);
    },
    removePeriod(yearId, periodId) {
      const data = loadGoals();
      const year = findYear(data, yearId);
      if (!year) return null;
      const idx = year.periods.findIndex((p) => p.id === periodId);
      if (idx === -1) return null;
      const [removed] = year.periods.splice(idx, 1);
      saveGoals(data);
      return { period: removed, index: idx };
    },
    restorePeriod(yearId, period, index) {
      const data = loadGoals();
      const year = findYear(data, yearId);
      if (!year) return;
      const at = Math.min(index, year.periods.length);
      year.periods.splice(at, 0, period);
      saveGoals(data);
    },
    getGoals(yearId, periodId) {
      const period = findPeriod(findYear(loadGoals(), yearId), periodId);
      return period ? period.goals : [];
    },
    addGoal(yearId, periodId, parentId, label) {
      const data = loadGoals();
      const period = findPeriod(findYear(data, yearId), periodId);
      if (!period) return null;
      const node = { id: createId("goal"), label, done: false, children: [] };
      if (!parentId) {
        period.goals.push(node);
      } else {
        const parent = findNode(period.goals, parentId);
        if (!parent) return null;
        parent.children = parent.children || [];
        parent.children.push(node);
      }
      saveGoals(data);
      return node;
    },
    toggleDone(yearId, periodId, id) {
      const data = loadGoals();
      const period = findPeriod(findYear(data, yearId), periodId);
      if (!period) return;
      const node = findNode(period.goals, id);
      if (!node) return;
      node.done = !node.done;
      saveGoals(data);
    },
    removeGoal(yearId, periodId, id) {
      const data = loadGoals();
      const period = findPeriod(findYear(data, yearId), periodId);
      if (!period) return null;
      const removed = extractNode(period.goals, id);
      if (!removed) return null;
      saveGoals(data);
      return removed;
    },
    restoreGoal(yearId, periodId, parentId, node) {
      const data = loadGoals();
      const period = findPeriod(findYear(data, yearId), periodId);
      if (!period) return;
      if (!parentId) {
        period.goals.push(node);
      } else {
        const parent = findNode(period.goals, parentId);
        if (!parent) period.goals.push(node);
        else {
          parent.children = parent.children || [];
          parent.children.push(node);
        }
      }
      saveGoals(data);
    },
    findParentId(yearId, periodId, childId) {
      const list = GoalStore.getGoals(yearId, periodId);
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
    },
  };
  window.AcademicGoalStore = GoalStore;

  // ---------- UI state: collapse/expand (per device, not synced) ----------
  function loadUiState() {
    try {
      const raw = localStorage.getItem(UI_STATE_KEY);
      const s = raw ? JSON.parse(raw) : {};
      if (!s.collapsedYears) s.collapsedYears = {};
      if (!s.collapsedPeriods) s.collapsedPeriods = {};
      return s;
    } catch {
      return { collapsedYears: {}, collapsedPeriods: {} };
    }
  }

  function saveUiState(state) {
    localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
  }

  function isYearCollapsed(yearId) {
    return !!loadUiState().collapsedYears[yearId];
  }

  function toggleYearCollapsed(yearId) {
    const state = loadUiState();
    state.collapsedYears[yearId] = !state.collapsedYears[yearId];
    saveUiState(state);
  }

  function isPeriodCollapsed(periodId) {
    return !!loadUiState().collapsedPeriods[periodId];
  }

  function togglePeriodCollapsed(periodId) {
    const state = loadUiState();
    state.collapsedPeriods[periodId] = !state.collapsedPeriods[periodId];
    saveUiState(state);
  }

  // ---------- Rendering ----------
  function makeToggleBtn(collapsed, onToggle) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "goal-toggle-btn";
    btn.textContent = collapsed ? "▸" : "▾";
    btn.setAttribute("aria-label", "접기/펼치기");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onToggle();
    });
    return btn;
  }

  // Starts as a single compact "add" button; clicking it swaps in a text
  // input (Enter commits, Escape/blur cancels back to the button) instead of
  // leaving an open input box sitting around all the time. `onAdd` is only
  // ever called with a non-empty label, and is expected to trigger a full
  // re-render — so there's no need to revert this node back to button view
  // after a successful add, since the whole tree gets rebuilt around it.
  function makeAddTrigger(containerClass, buttonLabel, placeholder, onAdd) {
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

  // A label that can be turned into an inline text input to rename it,
  // without triggering a full re-render mid-edit.
  function makeEditableTitle(className, currentLabel, onSave) {
    const container = document.createElement("div");
    container.className = className;

    function showView() {
      container.innerHTML = "";
      const span = document.createElement("span");
      span.textContent = currentLabel;
      container.appendChild(span);

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "goal-edit-btn";
      editBtn.textContent = "✎";
      editBtn.setAttribute("aria-label", "이름 수정");
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        showEdit();
      });
      container.appendChild(editBtn);
    }

    function showEdit() {
      container.innerHTML = "";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "goal-title-input";
      input.value = currentLabel;

      let committed = false;
      function commit() {
        if (committed) return;
        committed = true;
        const value = input.value.trim();
        if (value && value !== currentLabel) onSave(value);
        else showView();
      }

      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          committed = true;
          showView();
        }
      });
      input.addEventListener("blur", commit);
      input.addEventListener("click", (e) => e.stopPropagation());

      container.appendChild(input);
      input.focus();
      input.select();
    }

    showView();
    return container;
  }

  function renderGoalItem(yearId, periodId, node, depth, onChange) {
    const li = document.createElement("li");
    li.className = "goal-item";

    const row = document.createElement("div");
    row.className = "goal-item-row checklist-item" + (node.done ? " done" : "");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!node.done;
    checkbox.addEventListener("change", () => {
      GoalStore.toggleDone(yearId, periodId, node.id);
      onChange();
    });
    row.appendChild(checkbox);

    const label = document.createElement("span");
    label.className = "goal-item-label";
    label.textContent = node.label;
    row.appendChild(label);

    if ((node.children || []).length > 0) {
      const { total, done } = countProgress(node);
      const progress = document.createElement("span");
      progress.className = "goal-item-progress";
      progress.textContent = `${done}/${total}`;
      row.appendChild(progress);
    }

    if (depth < 2) {
      row.appendChild(
        makeAddTrigger("goal-item-add", "+", LEVEL_PLACEHOLDER[depth + 1], (label) => {
          GoalStore.addGoal(yearId, periodId, node.id, label);
          onChange();
        })
      );
    }

    const remove = document.createElement("span");
    remove.className = "checklist-item-remove";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      const parentId = GoalStore.findParentId(yearId, periodId, node.id);
      const removedNode = GoalStore.removeGoal(yearId, periodId, node.id);
      onChange();
      if (removedNode && window.Toast) {
        window.Toast.show("목표를 삭제했어요", {
          actionLabel: "실행취소",
          onAction: () => {
            GoalStore.restoreGoal(yearId, periodId, parentId, removedNode);
            onChange();
          },
        });
      }
    });
    row.appendChild(remove);

    li.appendChild(row);

    if (depth < 2) {
      // No trailing add-row here — this item's own "+" (above) is the only
      // way to add into this children list, so it can be clicked repeatedly
      // to add several children one at a time without leaving stray inputs.
      li.appendChild(
        renderGoalList(yearId, periodId, node.children || [], depth + 1, node.id, onChange, false)
      );
    }

    return li;
  }

  function renderGoalList(yearId, periodId, nodes, depth, parentId, onChange, showTrailingAdd) {
    const wrapper = document.createElement("div");
    wrapper.className = "goal-list-wrapper goal-depth-" + depth;

    if (nodes.length > 0) {
      const ul = document.createElement("ul");
      ul.className = "goal-list checklist-items";
      nodes.forEach((node) => ul.appendChild(renderGoalItem(yearId, periodId, node, depth, onChange)));
      wrapper.appendChild(ul);
    }

    if (showTrailingAdd) {
      wrapper.appendChild(
        makeAddTrigger(
          "goal-add-row",
          LEVEL_ADD_LABEL[depth] || "+ 추가",
          LEVEL_PLACEHOLDER[depth] || "목표 이름",
          (label) => {
            GoalStore.addGoal(yearId, periodId, parentId, label);
            onChange();
          }
        )
      );
    }
    return wrapper;
  }

  function renderPeriodCard(yearId, period, onChange) {
    const card = document.createElement("div");
    card.className = "diary-card goal-period-card" + (isPeriodCollapsed(period.id) ? " collapsed" : "");

    const headerRow = document.createElement("div");
    headerRow.className = "diary-card-header-row";

    headerRow.appendChild(
      makeEditableTitle("diary-card-date goal-editable-title", period.label, (newLabel) => {
        GoalStore.renamePeriod(yearId, period.id, newLabel);
        onChange();
      })
    );

    const actions = document.createElement("div");
    actions.className = "diary-card-header-actions";

    const goals = GoalStore.getGoals(yearId, period.id);
    const totals = goals.reduce(
      (acc, g) => {
        const c = countProgress(g);
        acc.total += c.total;
        acc.done += c.done;
        return acc;
      },
      { total: 0, done: 0 }
    );
    if (totals.total > 0) {
      const summary = document.createElement("span");
      summary.className = "practice-card-checklist";
      summary.textContent = `✓ ${totals.done}/${totals.total} 완료`;
      actions.appendChild(summary);
    }

    const collapsed = isPeriodCollapsed(period.id);
    actions.appendChild(
      makeToggleBtn(collapsed, () => {
        togglePeriodCollapsed(period.id);
        onChange();
      })
    );

    const remove = document.createElement("span");
    remove.className = "checklist-item-remove";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      const removed = GoalStore.removePeriod(yearId, period.id);
      onChange();
      if (removed && window.Toast) {
        window.Toast.show(`"${period.label}" 구간을 삭제했어요`, {
          actionLabel: "실행취소",
          onAction: () => {
            GoalStore.restorePeriod(yearId, removed.period, removed.index);
            onChange();
          },
        });
      }
    });
    actions.appendChild(remove);

    headerRow.appendChild(actions);
    card.appendChild(headerRow);

    if (!collapsed) {
      card.appendChild(renderGoalList(yearId, period.id, goals, 0, null, onChange, true));
    }

    return card;
  }

  function renderYearSection(year, onChange) {
    const section = document.createElement("div");
    section.className = "goal-year-section";

    const header = document.createElement("div");
    header.className = "goal-year-header";

    const label = document.createElement("h3");
    label.className = "goal-year-label";
    label.textContent = year.label;
    header.appendChild(label);

    const actions = document.createElement("div");
    actions.className = "diary-card-header-actions";

    const collapsed = isYearCollapsed(year.id);
    actions.appendChild(
      makeToggleBtn(collapsed, () => {
        toggleYearCollapsed(year.id);
        onChange();
      })
    );

    const remove = document.createElement("span");
    remove.className = "checklist-item-remove goal-year-remove";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      const removed = GoalStore.removeYear(year.id);
      onChange();
      if (removed && window.Toast) {
        window.Toast.show(`${year.label} 연도를 삭제했어요`, {
          actionLabel: "실행취소",
          onAction: () => {
            GoalStore.restoreYear(removed.year, removed.index);
            onChange();
          },
        });
      }
    });
    actions.appendChild(remove);

    header.appendChild(actions);
    section.appendChild(header);

    if (!collapsed) {
      const periodsWrap = document.createElement("div");
      periodsWrap.className = "goal-periods-in-year";
      GoalStore.getPeriods(year.id).forEach((period) =>
        periodsWrap.appendChild(renderPeriodCard(year.id, period, onChange))
      );
      periodsWrap.appendChild(
        makeAddTrigger("goal-add-row", "+ 구간 추가", "구간 이름 (예: 자격증 시험)", (label) => {
          GoalStore.addPeriod(year.id, label);
          onChange();
        })
      );
      section.appendChild(periodsWrap);
    }

    return section;
  }

  function renderAll() {
    const container = document.getElementById("goalPeriods");
    if (!container) return;
    container.innerHTML = "";

    container.appendChild(
      makeAddTrigger("goal-add-row", "+ 연도 추가", "연도 이름 (예: 2027)", (label) => {
        GoalStore.addYear(label);
        renderAll();
      })
    );

    GoalStore.getYears().forEach((year) => container.appendChild(renderYearSection(year, renderAll)));
  }

  function init() {
    renderAll();
  }

  window.StudyView = { init };
})();
