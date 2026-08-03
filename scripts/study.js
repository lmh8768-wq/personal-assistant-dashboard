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
    window.safeSetLocalStorage(GOALS_KEY, JSON.stringify(data));
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

  function setDoneRecursive(node, done) {
    node.done = done;
    (node.children || []).forEach((child) => setDoneRecursive(child, done));
  }

  function findParentIdIn(list, childId) {
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

  // Re-derives `done` for a node from its children (done only if it HAS
  // children and every one of them is done), then walks up doing the same
  // for each ancestor. Used whenever a subtree's completeness could have
  // changed out from under an ancestor: a toggle, a new incomplete child, a
  // removed/restored child.
  function recomputeNodeAndAncestors(list, nodeId) {
    let currentId = nodeId;
    while (currentId) {
      const node = findNode(list, currentId);
      if (!node) break;
      const kids = node.children || [];
      if (kids.length > 0) node.done = kids.every((c) => c.done);
      currentId = findParentIdIn(list, currentId);
    }
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
        // A fresh, unchecked child means `parent` (and its own ancestors)
        // can no longer be considered fully done.
        recomputeNodeAndAncestors(period.goals, parentId);
      }
      saveGoals(data);
      return node;
    },
    // Returns true if the toggle actually applied, false if it was rejected
    // (a goal with sub-goals can't be force-checked while any of them isn't
    // done yet — its done state only ever comes from finishing all of them).
    toggleDone(yearId, periodId, id) {
      const data = loadGoals();
      const period = findPeriod(findYear(data, yearId), periodId);
      if (!period) return false;
      const node = findNode(period.goals, id);
      if (!node) return false;
      const hasChildren = (node.children || []).length > 0;
      if (hasChildren && !node.done) return false;
      // Unchecking (always allowed) cascades down to every sub-goal beneath
      // it; bubbling up, each ancestor is done only once ALL of its own
      // children are, and un-done the moment any isn't.
      setDoneRecursive(node, !node.done);
      const parentId = findParentIdIn(period.goals, id);
      if (parentId) recomputeNodeAndAncestors(period.goals, parentId);
      saveGoals(data);
      return true;
    },
    removeGoal(yearId, periodId, id) {
      const data = loadGoals();
      const period = findPeriod(findYear(data, yearId), periodId);
      if (!period) return null;
      const parentId = findParentIdIn(period.goals, id);
      const removed = extractNode(period.goals, id);
      if (!removed) return null;
      if (parentId) recomputeNodeAndAncestors(period.goals, parentId);
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
          recomputeNodeAndAncestors(period.goals, parentId);
        }
      }
      saveGoals(data);
    },
    findParentId(yearId, periodId, childId) {
      return findParentIdIn(GoalStore.getGoals(yearId, periodId), childId);
    },
    renameGoal(yearId, periodId, id, label) {
      const data = loadGoals();
      const period = findPeriod(findYear(data, yearId), periodId);
      if (!period) return;
      const node = findNode(period.goals, id);
      if (!node) return;
      node.label = label;
      saveGoals(data);
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
      if (!s.collapsedGoals) s.collapsedGoals = {};
      return s;
    } catch {
      return { collapsedYears: {}, collapsedPeriods: {}, collapsedGoals: {} };
    }
  }

  function saveUiState(state) {
    window.safeSetLocalStorage(UI_STATE_KEY, JSON.stringify(state));
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

  function isGoalCollapsed(goalId) {
    return !!loadUiState().collapsedGoals[goalId];
  }

  function toggleGoalCollapsed(goalId) {
    const state = loadUiState();
    state.collapsedGoals[goalId] = !state.collapsedGoals[goalId];
    saveUiState(state);
  }

  // A goal created via "+" but abandoned before it got a name (Enter/blur/
  // Escape with nothing typed) — tracked so a second "+" click elsewhere can
  // clean up the still-blank one instead of leaving it stranded with an
  // empty label forever.
  let pendingNewGoal = null; // { yearId, periodId, id }

  function discardPendingNewGoal() {
    if (!pendingNewGoal) return;
    const { yearId, periodId, id } = pendingNewGoal;
    GoalStore.removeGoal(yearId, periodId, id);
    pendingNewGoal = null;
  }

  // ---------- Rendering ----------
  // Toggling collapse used to just flip the stored flag and re-render the
  // whole tree, which meant CSS transitions never had an existing element to
  // animate from — the collapsed subtree was torn down and rebuilt already
  // collapsed. Instead this owns its own state and hands the new value to
  // onToggle, which is expected to persist it and flip a class on the
  // already-in-the-DOM collapse region rather than trigger a full re-render.
  function makeToggleBtn(collapsed, onToggle) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "goal-toggle-btn";
    let state = collapsed;
    btn.textContent = state ? "▸" : "▾";
    btn.setAttribute("aria-label", "접기/펼치기");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      state = !state;
      btn.textContent = state ? "▸" : "▾";
      onToggle(state);
    });
    return btn;
  }

  // Wraps collapsible content in the CSS grid-rows collapse trick: a grid
  // container with one row track (1fr expanded, 0fr collapsed) and an inner
  // element that clips overflow while the track animates toward zero. Works
  // for arbitrary/dynamic content height with no JS measurement.
  function wrapCollapseRegion(contentEl, collapsed) {
    const region = document.createElement("div");
    region.className = "collapse-region" + (collapsed ? " collapsed" : "");
    const inner = document.createElement("div");
    inner.className = "collapse-region-inner";
    inner.appendChild(contentEl);
    region.appendChild(inner);
    return region;
  }

  // A compact "+" button that creates a goal immediately on click (with an
  // empty label) instead of revealing an input first — the caller is
  // expected to put the new node straight into inline-edit mode via
  // makeInlineGoalLabelEditor.
  function makeInstantAddButton(containerClass, label, onClick) {
    const container = document.createElement("div");
    container.className = containerClass;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost-btn goal-add-trigger-btn";
    btn.textContent = label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    container.appendChild(btn);
    return container;
  }

  // Renders a freshly-created (still-unnamed) goal's label as a focused
  // text input instead of a plain span. Enter/blur commits a non-empty
  // value; Enter/blur with nothing typed, or Escape regardless, deletes the
  // goal outright — it was never really "there" from the user's point of
  // view, so it just disappears rather than sticking around blank.
  // Shared with practice.js's goal tree — see scripts/goal-label-editor.js.
  const makeInlineGoalLabelEditor = window.GoalLabelEditor.makeInline;

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

  // Shared with practice.js's goal tree — see scripts/goal-label-editor.js.
  const makeDblClickEditableGoalLabel = window.GoalLabelEditor.makeDblClickEditable;

  function renderGoalItem(yearId, periodId, node, depth, onChange) {
    const li = document.createElement("li");
    li.className = "goal-item";

    const row = document.createElement("div");
    row.className = "goal-item-row checklist-item" + (node.done ? " done" : "");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!node.done;
    checkbox.addEventListener("change", () => {
      const applied = GoalStore.toggleDone(yearId, periodId, node.id);
      if (!applied && window.Toast) {
        window.Toast.show("하위 목표를 모두 완료해야 체크할 수 있어요", { type: "warning" });
      }
      onChange();
    });
    row.appendChild(checkbox);

    const hasChildren = (node.children || []).length > 0;
    const collapsed = hasChildren && isGoalCollapsed(node.id);
    let childrenRegion = null;
    if (hasChildren) {
      childrenRegion = wrapCollapseRegion(
        renderGoalList(yearId, periodId, node.children || [], depth + 1, node.id, onChange, false),
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
            GoalStore.renameGoal(yearId, periodId, node.id, value);
            pendingNewGoal = null;
            onChange();
          },
          () => {
            GoalStore.removeGoal(yearId, periodId, node.id);
            pendingNewGoal = null;
            onChange();
          }
        )
      );
    } else {
      row.appendChild(
        makeDblClickEditableGoalLabel(node.label, (value) => {
          GoalStore.renameGoal(yearId, periodId, node.id, value);
          onChange();
        })
      );
    }

    row.appendChild(
      makeInstantAddButton("goal-item-add", "+", () => {
        discardPendingNewGoal();
        if (collapsed) toggleGoalCollapsed(node.id);
        const newNode = GoalStore.addGoal(yearId, periodId, node.id, "");
        pendingNewGoal = { yearId, periodId, id: newNode.id };
        onChange();
      })
    );

    if (hasChildren) {
      const { total, done } = countProgress(node);
      const progress = document.createElement("span");
      progress.className = "goal-item-progress";
      const percent = Math.round((done / total) * 100);
      // Only the top-level 대목표 gets a completion rate alongside the raw
      // count — 중목표/소목표 subtrees are usually small enough that the
      // n/m count alone reads fine.
      progress.textContent = depth === 0 ? `${done}/${total} (${percent}%)` : `${done}/${total}`;
      row.appendChild(progress);
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

    // No trailing add-row here — this item's own "+" (above, right next to
    // its label) is the only way to add into this children list, so it can
    // be clicked repeatedly to add as many nested sub-goals as needed, at
    // any depth, one at a time.
    if (childrenRegion) li.appendChild(childrenRegion);

    return li;
  }

  function renderGoalList(yearId, periodId, nodes, depth, parentId, onChange, showTrailingAdd) {
    const wrapper = document.createElement("div");
    wrapper.className = "goal-list-wrapper";
    if (depth > 0) {
      wrapper.style.marginLeft = depth * 22 + "px";
      wrapper.style.marginTop = "4px";
    }

    if (nodes.length > 0) {
      const ul = document.createElement("ul");
      ul.className = "goal-list checklist-items";
      nodes.forEach((node) => ul.appendChild(renderGoalItem(yearId, periodId, node, depth, onChange)));
      wrapper.appendChild(ul);
    }

    // Only the top level (adding a fresh 대목표 straight under a period)
    // ever uses a trailing add trigger — nested levels are added via each
    // item's own "+" instead.
    if (showTrailingAdd) {
      wrapper.appendChild(
        makeInstantAddButton("goal-add-row", "+ 대목표 추가", () => {
          discardPendingNewGoal();
          const newNode = GoalStore.addGoal(yearId, periodId, parentId, "");
          pendingNewGoal = { yearId, periodId, id: newNode.id };
          onChange();
        })
      );
    }
    return wrapper;
  }

  function renderPeriodCard(yearId, period, onChange) {
    const card = document.createElement("div");
    const collapsed = isPeriodCollapsed(period.id);
    card.className = "diary-card goal-period-card" + (collapsed ? " collapsed" : "");

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

    const goalListRegion = wrapCollapseRegion(
      renderGoalList(yearId, period.id, goals, 0, null, onChange, true),
      collapsed
    );
    actions.appendChild(
      makeToggleBtn(collapsed, (newCollapsed) => {
        togglePeriodCollapsed(period.id);
        card.classList.toggle("collapsed", newCollapsed);
        goalListRegion.classList.toggle("collapsed", newCollapsed);
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
    card.appendChild(goalListRegion);

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
    const periodsRegion = wrapCollapseRegion(periodsWrap, collapsed);

    actions.appendChild(
      makeToggleBtn(collapsed, (newCollapsed) => {
        toggleYearCollapsed(year.id);
        periodsRegion.classList.toggle("collapsed", newCollapsed);
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
    section.appendChild(periodsRegion);

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

    if (pendingNewGoal) {
      const input = container.querySelector(".goal-item-label-input");
      if (input) input.focus();
    }
  }

  function init() {
    renderAll();
  }

  window.StudyView = { init };
})();
