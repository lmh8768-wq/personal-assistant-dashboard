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
    if (opts.actionLabel && typeof opts.onAction === "function") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-action";
      btn.textContent = opts.actionLabel;
      btn.addEventListener("click", () => {
        clearTimeout(timer);
        opts.onAction();
        toast.remove();
      });
      toast.appendChild(btn);
    }

    container.appendChild(toast);
    timer = setTimeout(() => toast.remove(), duration);
  }

  window.Toast = { show };
})();
