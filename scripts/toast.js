(function () {
  const LEAVE_ANIMATION_MS = 150;

  // Tracks the most recent real click position anywhere in the page — the
  // default anchor for an actionable toast (almost always the 실행취소
  // button after a delete) when the caller doesn't pass an explicit
  // position. Without this, every one of the ~20 delete-undo call sites
  // across the app would need its own click handler threading e.clientX/
  // clientY through to Toast.show() by hand; this makes it automatic for
  // all of them (present and future) instead.
  //
  // Capture phase so this updates BEFORE the click that triggers
  // Toast.show() itself runs — that's normally the delete button's own
  // bubble-phase listener, so recording in the bubble phase would always
  // be reporting last click, one click "behind."
  //
  // isTrusted filters out synthetic clicks — makeKeyboardActivatable
  // (a11y.js) activates Enter/Space by calling el.click(), which is NOT a
  // real cursor position (clientX/clientY both 0) and would otherwise
  // anchor a keyboard user's toast to the top-left corner of the screen.
  // Leaving lastClickPosition at whatever the last REAL click was (or null,
  // for a keyboard-only session) falls back to the shared corner instead,
  // which is what a mouse-less user actually wants.
  let lastClickPosition = null;
  document.addEventListener(
    "click",
    (e) => {
      if (e.isTrusted) lastClickPosition = { x: e.clientX, y: e.clientY };
    },
    true
  );

  // toast.js is the only place that ever removes a toast, so (unlike the
  // modal exit-animation trick) this can just wrap the removal directly
  // instead of intercepting a setter — play the exit animation, then
  // actually remove once it's done.
  function removeToast(toast) {
    if (toast.classList.contains("toast-leaving")) return;
    toast.classList.add("toast-leaving");
    setTimeout(() => toast.remove(), LEAVE_ANIMATION_MS);
  }

  function ensureContainer() {
    let container = document.getElementById("toastContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "toastContainer";
      container.className = "toast-container";
      // Toasts are appended dynamically with nothing else pointing a screen
      // reader at them — without this, messages like "동기화 실패" or a
      // delete confirmation are only ever seen, never announced.
      // aria-live="polite" (not "assertive") so a toast doesn't barge in
      // over whatever the user is already doing.
      container.setAttribute("role", "status");
      container.setAttribute("aria-live", "polite");
      document.body.appendChild(container);
    }
    return container;
  }

  function show(message, opts) {
    opts = opts || {};
    const container = ensureContainer();

    // Backward-compatible single action, or a list of actions (e.g. snooze + dismiss).
    const actions = opts.actions || (opts.actionLabel && opts.onAction
      ? [{ label: opts.actionLabel, onAction: opts.onAction }]
      : []);

    // Anchors near wherever the triggering click happened (almost always a
    // delete button) instead of the shared bottom-right corner, so the
    // 실행취소 button lands right next to the cursor instead of requiring a
    // trip across the screen — by the time it's reached, the toast may
    // already be gone. Only for actionable toasts; a plain status message
    // has nothing to click before it disappears, so the shared corner
    // (easier to keep track of, less visually noisy) stays the default.
    const position = opts.position || (actions.length > 0 ? lastClickPosition : null);

    // Rapid repeated identical actions (e.g. deleting several list items in
    // a row, each firing their own toast) used to stack up an unbounded
    // number of toasts with the same text, each independently timered and
    // separately re-announced via aria-live. An existing one for the exact
    // same message is replaced instead — the newest call's timer/action are
    // what stick around. Floating (position-anchored) toasts are excluded:
    // each is tied to a specific spot the user just interacted with, not
    // the shared corner, so piling up is a lot less likely and context
    // (which one goes where, e.g. two different rows deleted back to back
    // with the same message) matters more than deduping them.
    if (!position) {
      [...container.querySelectorAll(".toast")]
        .filter((el) => el.dataset.toastMessage === message)
        .forEach((el) => el.remove());
    }

    const toast = document.createElement("div");
    toast.className = "toast" + (opts.type ? ` toast-${opts.type}` : "");
    toast.dataset.toastMessage = message;
    // Set here too, not just on the shared container — a position-anchored
    // toast (below) is appended straight to document.body instead, outside
    // the container's aria-live region entirely.
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");

    const text = document.createElement("span");
    text.className = "toast-text";
    text.textContent = message;
    toast.appendChild(text);

    let timer;

    // An actionable toast (almost always "실행취소" after a delete) needs
    // longer than a plain status message — 4s barely gives time to read it,
    // let alone notice and tap the button before the delete becomes final.
    // `?? ` (not `||`) so an explicit duration: 0 — "don't auto-dismiss at
    // all" — isn't treated the same as "no duration given"; `||` silently
    // fell through to the default any time a caller asked for exactly that.
    const duration = opts.duration ?? (actions.length > 0 ? 8000 : 4000);

    actions.forEach((action) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-action";
      btn.textContent = action.label;
      btn.addEventListener("click", () => {
        clearTimeout(timer);
        action.onAction();
        removeToast(toast);
      });
      toast.appendChild(btn);
    });

    if (position) {
      // Anchored near wherever the triggering click happened (a delete
      // button, or e.g. a drag drop) instead of the shared bottom-right
      // corner — for a prompt tied to something the user was just looking
      // at, that corner is easy to miss, or lose track of before reaching it.
      toast.classList.add("toast-floating");
      document.body.appendChild(toast);
      const rect = toast.getBoundingClientRect();
      const margin = 10;
      let left = position.x + 12;
      let top = position.y + 12;
      left = Math.min(left, window.innerWidth - rect.width - margin);
      top = Math.min(top, window.innerHeight - rect.height - margin);
      toast.style.left = Math.max(margin, left) + "px";
      toast.style.top = Math.max(margin, top) + "px";
    } else {
      container.appendChild(toast);
    }
    if (duration > 0) {
      timer = setTimeout(() => removeToast(toast), duration);
    }
  }

  window.Toast = { show };
})();
