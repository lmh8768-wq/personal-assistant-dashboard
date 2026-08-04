// Shared by practice.js's 커리큘럼 goal tree and study.js's 학업 goal tree —
// same reasoning as scripts/goal-label-editor.js: these three pure,
// side-effect-free DOM builders ended up byte-identical in both files with
// nothing tying them to either one, so there's no reason for two copies.
window.GoalTreeUI = {
  // Toggling collapse used to just flip the stored flag and re-render the
  // whole tree, which meant CSS transitions never had an existing element to
  // animate from — the collapsed subtree was torn down and rebuilt already
  // collapsed. Instead this owns its own state and hands the new value to
  // onToggle, which is expected to persist it and flip a class on the
  // already-in-the-DOM collapse region rather than trigger a full re-render.
  makeToggleBtn(collapsed, onToggle) {
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
  },

  // Wraps collapsible content in the CSS grid-rows collapse trick: a grid
  // container with one row track (1fr expanded, 0fr collapsed) and an inner
  // element that clips overflow while the track animates toward zero. Works
  // for arbitrary/dynamic content height with no JS measurement.
  wrapCollapseRegion(contentEl, collapsed) {
    const region = document.createElement("div");
    region.className = "collapse-region" + (collapsed ? " collapsed" : "");
    const inner = document.createElement("div");
    inner.className = "collapse-region-inner";
    inner.appendChild(contentEl);
    region.appendChild(inner);
    return region;
  },

  // A compact "+" button that creates a goal immediately on click (with an
  // empty label) instead of revealing an input first — the caller is
  // expected to put the new node straight into inline-edit mode via
  // makeInlineGoalLabelEditor.
  makeInstantAddButton(containerClass, label, onClick) {
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
  },
};
