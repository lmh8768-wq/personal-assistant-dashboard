// Every view builds its own open/close modal functions independently (see
// each scripts/*.js's openXModal/closeXModal), so rather than touching all
// of them individually, this is one shared, generic Tab-key handler: while
// any ".modal-overlay" is visible, Tab/Shift+Tab cycles only through its
// own focusable elements instead of escaping into the page behind it.
(function () {
  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function getFocusable(container) {
    return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
      (el) => el.offsetParent !== null // skip hidden/collapsed elements
    );
  }

  // DOM order (a plain querySelector) has nothing to do with "which modal
  // opened most recently" — every .modal-overlay is a static element
  // already sitting in index.html, just toggled [hidden]; none are
  // reordered on open. Re-synced against live DOM state on every call
  // (rather than only reacting to a separate MutationObserver) so it never
  // depends on event-ordering — a newly-opened modal already-open when
  // this runs is appended to the end of the stack, keeping it topmost.
  let openModalStack = [];
  function getTopmostOpenModal() {
    document.querySelectorAll(".modal-overlay").forEach((el) => {
      const isOpen = !el.hidden;
      const idx = openModalStack.indexOf(el);
      if (isOpen && idx === -1) openModalStack.push(el);
      else if (!isOpen && idx !== -1) openModalStack.splice(idx, 1);
    });
    return openModalStack[openModalStack.length - 1] || null;
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;

    const openModal = getTopmostOpenModal();
    if (!openModal) return;

    const focusable = getFocusable(openModal);
    if (focusable.length === 0) {
      // No focusable descendant at all (e.g. #authGate's loading state —
      // just a message with its "이대로 오프라인으로 계속하기" fallback
      // button still hidden) used to leave Tab completely untrapped here,
      // letting it escape into the page behind the modal for as long as
      // this state lasts. Trap it on the modal container itself instead.
      e.preventDefault();
      if (!openModal.hasAttribute("tabindex")) openModal.setAttribute("tabindex", "-1");
      openModal.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (!openModal.contains(document.activeElement)) {
      // Focus drifted outside the modal somehow (e.g. it was just opened
      // without moving focus itself) — pull it back in instead of letting
      // this Tab press carry it further away.
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // Same "one generic handler instead of touching every view's own
  // openXModal/closeXModal" approach, for focus restoration: none of them
  // return focus to whatever triggered the modal when it closes, so a
  // keyboard user has to re-navigate from the top of the page every time.
  // Tracks the last element focused *outside* any modal (i.e. whatever
  // opened it, for a keyboard-driven open — a mouse click on a
  // non-focusable trigger like a list row doesn't move focus at all, so
  // this is a no-op for that case rather than actively wrong) and restores
  // it once every modal on the page is hidden again.
  let lastFocusedOutsideModal = null;

  document.addEventListener(
    "focusin",
    (e) => {
      if (!e.target.closest(".modal-overlay")) {
        lastFocusedOutsideModal = e.target;
      }
    },
    true
  );

  const restoreObserver = new MutationObserver(() => {
    if (getTopmostOpenModal()) return; // another modal is still open
    if (!lastFocusedOutsideModal || !document.body.contains(lastFocusedOutsideModal)) return;
    if (typeof lastFocusedOutsideModal.focus !== "function" || lastFocusedOutsideModal.disabled) return;
    lastFocusedOutsideModal.focus();
    lastFocusedOutsideModal = null;
  });

  document.querySelectorAll(".modal-overlay").forEach((el) => {
    restoreObserver.observe(el, { attributes: true, attributeFilter: ["hidden"] });
  });

  // ---------- Exit animation ----------
  // Every closeXModal() across scripts/*.js just sets overlay.hidden = true
  // directly — components.css gives every modal an entrance animation (see
  // ".modal-overlay:not([hidden])"), but nothing plays on the way out since
  // [hidden] applies display:none !important the instant it's set, with no
  // chance for a transition to run. Intercepting the `hidden` property
  // setter itself (same technique cloud-sync.js already uses for
  // localStorage.setItem) means every existing close call gets an exit
  // animation for free — no call site needs to change.
  const MODAL_CLOSE_ANIMATION_MS = 150;
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "hidden");
    if (!descriptor || !descriptor.set || !descriptor.get) return;
    // Tracked per-overlay so a re-open within the animation window can
    // cancel it — without this, quickly closing then reopening the same
    // modal left the original close's timeout still pending, and 150ms
    // later it force-hid the modal the user had just reopened and was
    // already interacting with.
    let closeTimer = null;
    Object.defineProperty(overlay, "hidden", {
      configurable: true,
      get() {
        return descriptor.get.call(overlay);
      },
      set(value) {
        if (value && !descriptor.get.call(overlay) && !overlay.classList.contains("modal-closing")) {
          overlay.classList.add("modal-closing");
          closeTimer = setTimeout(() => {
            closeTimer = null;
            overlay.classList.remove("modal-closing");
            descriptor.set.call(overlay, true);
          }, MODAL_CLOSE_ANIMATION_MS);
        } else if (!value) {
          clearTimeout(closeTimer);
          closeTimer = null;
          overlay.classList.remove("modal-closing");
          descriptor.set.call(overlay, value);
        }
      },
    });
  });
})();
