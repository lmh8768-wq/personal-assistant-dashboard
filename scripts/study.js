(function () {
  const GOALS_KEY = "assistant.academicGoals.v1";

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

  // ---------- Storage (tree of goals per fixed semester period) ----------
  function loadGoals() {
    let data;
    try {
      const raw = localStorage.getItem(GOALS_KEY);
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }
    PERIODS.forEach((p) => {
      if (!Array.isArray(data[p.key])) data[p.key] = [];
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
  // returns enough context (its parent list + original index) to undo.
  function extractNode(list, id) {
    const idx = list.findIndex((n) => n.id === id);
    if (idx !== -1) {
      const [node] = list.splice(idx, 1);
      return { node, parentList: list, index: idx };
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
    getPeriod(periodKey) {
      return loadGoals()[periodKey] || [];
    },
    addGoal(periodKey, parentId, label) {
      const data = loadGoals();
      const node = { id: createId("goal"), label, done: false, children: [] };
      if (!parentId) {
        data[periodKey].push(node);
      } else {
        const parent = findNode(data[periodKey], parentId);
        if (!parent) return null;
        parent.children = parent.children || [];
        parent.children.push(node);
      }
      saveGoals(data);
      return node;
    },
    toggleDone(periodKey, id) {
      const data = loadGoals();
      const node = findNode(data[periodKey], id);
      if (!node) return;
      node.done = !node.done;
      saveGoals(data);
    },
    // Returns the removed node (for undo) or null if not found.
    removeGoal(periodKey, id) {
      const data = loadGoals();
      const removed = extractNode(data[periodKey], id);
      if (!removed) return null;
      saveGoals(data);
      return removed.node;
    },
    // Re-inserts a previously removed node back under its original parent
    // (or at the period's top level if it had none).
    restoreGoal(periodKey, parentId, node) {
      const data = loadGoals();
      if (!parentId) {
        data[periodKey].push(node);
      } else {
        const parent = findNode(data[periodKey], parentId);
        if (!parent) {
          data[periodKey].push(node);
        } else {
          parent.children = parent.children || [];
          parent.children.push(node);
        }
      }
      saveGoals(data);
    },
  };
  window.AcademicGoalStore = GoalStore;

  // ---------- Rendering ----------
  function makeAddRow(periodKey, parentId, depth, onAdded) {
    const row = document.createElement("div");
    row.className = "checklist-add-row goal-add-row";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = LEVEL_PLACEHOLDER[depth] || "목표 추가 후 Enter";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost-btn";
    btn.textContent = "+ 추가";

    function submit() {
      const label = input.value.trim();
      if (!label) return;
      GoalStore.addGoal(periodKey, parentId, label);
      onAdded();
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

  function renderGoalItem(periodKey, node, depth, onChange) {
    const li = document.createElement("li");
    li.className = "goal-item";

    const row = document.createElement("div");
    row.className = "goal-item-row checklist-item" + (node.done ? " done" : "");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!node.done;
    checkbox.addEventListener("change", () => {
      GoalStore.toggleDone(periodKey, node.id);
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
      const parentId = findParentId(periodKey, node.id);
      const removedNode = GoalStore.removeGoal(periodKey, node.id);
      onChange();
      if (removedNode && window.Toast) {
        window.Toast.show("목표를 삭제했어요", {
          actionLabel: "실행취소",
          onAction: () => {
            GoalStore.restoreGoal(periodKey, parentId, removedNode);
            onChange();
          },
        });
      }
    });
    row.appendChild(remove);

    li.appendChild(row);

    if (depth < 2) {
      li.appendChild(renderGoalList(periodKey, node.children || [], depth + 1, node.id, onChange));
    }

    return li;
  }

  function findParentId(periodKey, childId) {
    const list = GoalStore.getPeriod(periodKey);
    function search(nodes, parentId) {
      for (const n of nodes) {
        if (n.id === childId) return parentId;
        const found = search(n.children || [], n.id);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    return search(list, null) ?? null;
  }

  function renderGoalList(periodKey, nodes, depth, parentId, onChange) {
    const wrapper = document.createElement("div");
    wrapper.className = "goal-list-wrapper goal-depth-" + depth;

    if (nodes.length > 0) {
      const ul = document.createElement("ul");
      ul.className = "goal-list checklist-items";
      nodes.forEach((node) => ul.appendChild(renderGoalItem(periodKey, node, depth, onChange)));
      wrapper.appendChild(ul);
    }

    wrapper.appendChild(makeAddRow(periodKey, parentId, depth, onChange));
    return wrapper;
  }

  function renderPeriodCard(period, onChange) {
    const card = document.createElement("div");
    card.className = "diary-card goal-period-card";

    const headerRow = document.createElement("div");
    headerRow.className = "diary-card-header-row";

    const title = document.createElement("div");
    title.className = "diary-card-date";
    title.textContent = period.label;
    headerRow.appendChild(title);

    const goals = GoalStore.getPeriod(period.key);
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
      headerRow.appendChild(summary);
    }

    card.appendChild(headerRow);
    card.appendChild(renderGoalList(period.key, goals, 0, null, onChange));

    return card;
  }

  function renderAll() {
    const container = document.getElementById("goalPeriods");
    if (!container) return;
    container.innerHTML = "";
    PERIODS.forEach((period) => container.appendChild(renderPeriodCard(period, renderAll)));
  }

  function init() {
    renderAll();
  }

  window.StudyView = { init };
})();
