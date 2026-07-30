(function () {
  const GOALS_KEY = "assistant.academicGoals.v1";
  // Collapse/expand state is a per-device UI preference, not real content —
  // deliberately kept OUT of the "assistant." namespace so cloud-sync.js
  // never treats it as data to sync/overwrite across devices.
  const UI_STATE_KEY = "academicUiState.v1";

  const PERIODS = [
    { key: "midterm1", label: "1학기 중간고사" },
    { key: "final1", label: "1학기 기말고사" },
    { key: "summer", label: "여름방학" },
    { key: "midterm2", label: "2학기 중간고사" },
    { key: "final2", label: "2학기 기말고사" },
    { key: "winter", label: "겨울방학" },
  ];

  const LEVEL_PLACEHOLDER = ["대목표 추가 후 Enter", "중목표 추가 후 Enter", "소목표 추가 후 Enter"];

  function createId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function emptyPeriods() {
    const periods = {};
    PERIODS.forEach((p) => {
      periods[p.key] = [];
    });
    return periods;
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
    if (!data || !Array.isArray(data.years)) {
      // Migrate the old flat { periodKey: [...] } shape (no year grouping)
      // into a single year bucket, defaulting to the current calendar year.
      const oldFlat = data && !data.years ? data : null;
      const periods = emptyPeriods();
      if (oldFlat) {
        PERIODS.forEach((p) => {
          if (Array.isArray(oldFlat[p.key])) periods[p.key] = oldFlat[p.key];
        });
      }
      data = { years: [{ id: createId("year"), label: String(new Date().getFullYear()), periods }] };
      saveGoals(data);
    }
    data.years.forEach((year) => {
      PERIODS.forEach((p) => {
        if (!Array.isArray(year.periods[p.key])) year.periods[p.key] = [];
      });
    });
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

  const GoalStore = {
    getYears() {
      return loadGoals().years;
    },
    addYear(label) {
      const data = loadGoals();
      const year = { id: createId("year"), label, periods: emptyPeriods() };
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
    getPeriod(yearId, periodKey) {
      const year = loadGoals().years.find((y) => y.id === yearId);
      return year ? year.periods[periodKey] : [];
    },
    addGoal(yearId, periodKey, parentId, label) {
      const data = loadGoals();
      const year = data.years.find((y) => y.id === yearId);
      if (!year) return null;
      const node = { id: createId("goal"), label, done: false, children: [] };
      if (!parentId) {
        year.periods[periodKey].push(node);
      } else {
        const parent = findNode(year.periods[periodKey], parentId);
        if (!parent) return null;
        parent.children = parent.children || [];
        parent.children.push(node);
      }
      saveGoals(data);
      return node;
    },
    toggleDone(yearId, periodKey, id) {
      const data = loadGoals();
      const year = data.years.find((y) => y.id === yearId);
      if (!year) return;
      const node = findNode(year.periods[periodKey], id);
      if (!node) return;
      node.done = !node.done;
      saveGoals(data);
    },
    removeGoal(yearId, periodKey, id) {
      const data = loadGoals();
      const year = data.years.find((y) => y.id === yearId);
      if (!year) return null;
      const removed = extractNode(year.periods[periodKey], id);
      if (!removed) return null;
      saveGoals(data);
      return removed;
    },
    restoreGoal(yearId, periodKey, parentId, node) {
      const data = loadGoals();
      const year = data.years.find((y) => y.id === yearId);
      if (!year) return;
      if (!parentId) {
        year.periods[periodKey].push(node);
      } else {
        const parent = findNode(year.periods[periodKey], parentId);
        if (!parent) year.periods[periodKey].push(node);
        else {
          parent.children = parent.children || [];
          parent.children.push(node);
        }
      }
      saveGoals(data);
    },
    findParentId(yearId, periodKey, childId) {
      const list = GoalStore.getPeriod(yearId, periodKey);
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

  function periodStateKey(yearId, periodKey) {
    return `${yearId}::${periodKey}`;
  }

  function isPeriodCollapsed(yearId, periodKey) {
    return !!loadUiState().collapsedPeriods[periodStateKey(yearId, periodKey)];
  }

  function togglePeriodCollapsed(yearId, periodKey) {
    const state = loadUiState();
    const key = periodStateKey(yearId, periodKey);
    state.collapsedPeriods[key] = !state.collapsedPeriods[key];
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

  function makeAddRow(depth, placeholder, onAdd) {
    const row = document.createElement("div");
    row.className = "checklist-add-row goal-add-row";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost-btn";
    btn.textContent = "+ 추가";

    function submit() {
      const label = input.value.trim();
      if (!label) return;
      onAdd(label);
    }

    btn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });

    row.appendChild(input);
    row.appendChild(btn);
    return row;
  }

  function renderGoalItem(yearId, periodKey, node, depth, onChange) {
    const li = document.createElement("li");
    li.className = "goal-item";

    const row = document.createElement("div");
    row.className = "goal-item-row checklist-item" + (node.done ? " done" : "");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!node.done;
    checkbox.addEventListener("change", () => {
      GoalStore.toggleDone(yearId, periodKey, node.id);
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

    const remove = document.createElement("span");
    remove.className = "checklist-item-remove";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      const parentId = GoalStore.findParentId(yearId, periodKey, node.id);
      const removedNode = GoalStore.removeGoal(yearId, periodKey, node.id);
      onChange();
      if (removedNode && window.Toast) {
        window.Toast.show("목표를 삭제했어요", {
          actionLabel: "실행취소",
          onAction: () => {
            GoalStore.restoreGoal(yearId, periodKey, parentId, removedNode);
            onChange();
          },
        });
      }
    });
    row.appendChild(remove);

    li.appendChild(row);

    if (depth < 2) {
      li.appendChild(
        renderGoalList(yearId, periodKey, node.children || [], depth + 1, node.id, onChange)
      );
    }

    return li;
  }

  function renderGoalList(yearId, periodKey, nodes, depth, parentId, onChange) {
    const wrapper = document.createElement("div");
    wrapper.className = "goal-list-wrapper goal-depth-" + depth;

    if (nodes.length > 0) {
      const ul = document.createElement("ul");
      ul.className = "goal-list checklist-items";
      nodes.forEach((node) => ul.appendChild(renderGoalItem(yearId, periodKey, node, depth, onChange)));
      wrapper.appendChild(ul);
    }

    wrapper.appendChild(
      makeAddRow(depth, LEVEL_PLACEHOLDER[depth] || "목표 추가 후 Enter", (label) => {
        GoalStore.addGoal(yearId, periodKey, parentId, label);
        onChange();
      })
    );
    return wrapper;
  }

  function renderPeriodCard(yearId, period, onChange) {
    const card = document.createElement("div");
    card.className = "diary-card goal-period-card";

    const headerRow = document.createElement("div");
    headerRow.className = "diary-card-header-row";

    const title = document.createElement("div");
    title.className = "diary-card-date";
    title.textContent = period.label;
    headerRow.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "diary-card-header-actions";

    const goals = GoalStore.getPeriod(yearId, period.key);
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

    const collapsed = isPeriodCollapsed(yearId, period.key);
    actions.appendChild(
      makeToggleBtn(collapsed, () => {
        togglePeriodCollapsed(yearId, period.key);
        onChange();
      })
    );

    headerRow.appendChild(actions);
    card.appendChild(headerRow);

    if (!collapsed) {
      card.appendChild(renderGoalList(yearId, period.key, goals, 0, null, onChange));
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
      PERIODS.forEach((period) => periodsWrap.appendChild(renderPeriodCard(year.id, period, onChange)));
      section.appendChild(periodsWrap);
    }

    return section;
  }

  function renderAll() {
    const container = document.getElementById("goalPeriods");
    if (!container) return;
    container.innerHTML = "";

    container.appendChild(
      makeAddRow(0, "연도 추가 후 Enter (예: 2027)", (label) => {
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
