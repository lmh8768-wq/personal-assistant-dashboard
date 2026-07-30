(function () {
  function ensureContainer() {
    let container = document.getElementById("toastContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "toastContainer";
      container.className = "toast-container";
      document.body.appendChild(container);
    }
    return container;
  }

  function show(message, opts) {
    opts = opts || {};
    const duration = opts.duration || 4000;
    const container = ensureContainer();

    const toast = document.createElement("div");
    toast.className = "toast";

    const text = document.createElement("span");
    text.className = "toast-text";
    text.textContent = message;
    toast.appendChild(text);

    let timer;

    // Backward-compatible single action, or a list of actions (e.g. snooze + dismiss).
    const actions = opts.actions || (opts.actionLabel && opts.onAction
      ? [{ label: opts.actionLabel, onAction: opts.onAction }]
      : []);

    actions.forEach((action) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-action";
      btn.textContent = action.label;
      btn.addEventListener("click", () => {
        clearTimeout(timer);
        action.onAction();
        toast.remove();
      });
      toast.appendChild(btn);
    });

    if (opts.position) {
      // Anchored near wherever the triggering action happened (e.g. a drag
      // drop), instead of the shared bottom-right corner — for a prompt
      // tied to something the user was just looking at, that corner is
      // easy to miss entirely.
      toast.classList.add("toast-floating");
      document.body.appendChild(toast);
      const rect = toast.getBoundingClientRect();
      const margin = 10;
      let left = opts.position.x + 12;
      let top = opts.position.y + 12;
      left = Math.min(left, window.innerWidth - rect.width - margin);
      top = Math.min(top, window.innerHeight - rect.height - margin);
      toast.style.left = Math.max(margin, left) + "px";
      toast.style.top = Math.max(margin, top) + "px";
    } else {
      container.appendChild(toast);
    }
    timer = setTimeout(() => toast.remove(), duration);
  }

  window.Toast = { show };
})();
