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
})();
