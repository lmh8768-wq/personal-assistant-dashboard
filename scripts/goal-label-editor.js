// Shared by practice.js's 커리큘럼 goal tree and study.js's 학업 goal tree —
// both trees needed an inline text editor for a goal's label and ended up
// with byte-identical implementations. Everything else about the two trees
// (their stores, select/copy/delete mode, progress counting) is different
// enough to stay separate — see G4's architecture-consolidation notes — but
// these two pure, side-effect-free DOM builders had nothing tying them to
// either file, so there's no reason for two copies.
window.GoalLabelEditor = {
  // A blank input for a brand-new goal: Enter/blur with a non-empty value
  // commits it, anything else (Escape, or Enter/blur while still empty)
  // cancels — which the caller is expected to treat as "delete this
  // just-created, still-unnamed goal" via onCancelDelete.
  makeInline(initialValue, placeholder, onCommit, onCancelDelete) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "goal-title-input goal-item-label-input";
    input.placeholder = placeholder;
    input.value = initialValue;

    let settled = false;
    function commit() {
      if (settled) return;
      settled = true;
      const value = input.value.trim();
      if (value) onCommit(value);
      else onCancelDelete();
    }
    function cancel() {
      if (settled) return;
      settled = true;
      onCancelDelete();
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
    // blur fires synchronously the instant focus moves — including from the
    // mousedown that STARTS a click on some other element (e.g. a
    // different row's own "+" button, which is exactly how a second
    // still-blank goal gets created while this one is abandoned). Calling
    // commit() synchronously here — which, for a still-empty input, means
    // onCancelDelete() deleting this goal and rebuilding the whole tree —
    // used to finish before that click event even fired, detaching the
    // very element the user just pressed down on and silently swallowing
    // their click. Deferring lets that click's own handler run first; the
    // caller's onCancelDelete is expected to no-op if something else (like
    // that click) already superseded this goal in the meantime.
    input.addEventListener("blur", () => setTimeout(commit, 0));
    input.addEventListener("click", (e) => e.stopPropagation());

    return input;
  },

  // A goal's label, editable by double-clicking it. Enter/blur commits a
  // non-empty, changed value; Escape, or Enter/blur with nothing changed,
  // just reverts to the original text — unlike makeInline, this is for an
  // ALREADY-existing goal, so an empty/unchanged commit never deletes it.
  makeDblClickEditable(currentLabel, onSave) {
    const container = document.createElement("span");
    container.className = "goal-item-label";

    function showView() {
      container.innerHTML = "";
      container.textContent = currentLabel;
    }

    function showEdit() {
      container.innerHTML = "";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "goal-title-input goal-item-label-input";
      input.value = currentLabel;

      let settled = false;
      function commit() {
        if (settled) return;
        settled = true;
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
          settled = true;
          showView();
        }
      });
      input.addEventListener("blur", commit);
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("dblclick", (e) => e.stopPropagation());

      container.appendChild(input);
      input.focus();
      input.select();
    }

    container.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      showEdit();
    });

    showView();
    return container;
  },
};
