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

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;

    const openModal = document.querySelector(".modal-overlay:not([hidden])");
    if (!openModal) return;

    const focusable = getFocusable(openModal);
    if (focusable.length === 0) return;

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
    if (document.querySelector(".modal-overlay:not([hidden])")) return; // another modal is still open
    if (!lastFocusedOutsideModal || !document.body.contains(lastFocusedOutsideModal)) return;
    if (typeof lastFocusedOutsideModal.focus !== "function" || lastFocusedOutsideModal.disabled) return;
    lastFocusedOutsideModal.focus();
    lastFocusedOutsideModal = null;
  });

  document.querySelectorAll(".modal-overlay").forEach((el) => {
    restoreObserver.observe(el, { attributes: true, attributeFilter: ["hidden"] });
  });
})();
