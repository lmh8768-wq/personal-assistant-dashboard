// Every "×" remove/delete control across the app is a <span> (for compact
// inline styling a real <button> would need extra CSS reset for), which
// means none of them are keyboard-focusable or activatable by default — a
// keyboard-only user can Tab right past every one of them with no way to
// ever trigger it. This adds exactly that without touching each site's
// actual delete logic: Enter/Space replay a real click via el.click(), so
// whatever click listener is already registered on the element just fires
// normally, same as a mouse click would.
window.makeKeyboardActivatable = function (el, defaultAriaLabel) {
  el.tabIndex = 0;
  if (!el.hasAttribute("role")) el.setAttribute("role", "button");
  if (defaultAriaLabel && !el.hasAttribute("aria-label")) el.setAttribute("aria-label", defaultAriaLabel);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      el.click();
    } else if (e.key === " ") {
      // Space activates on keyup below, matching native <button> semantics
      // — firing it here on keydown instead meant holding Space down (OS
      // auto-repeat sends repeated keydown events but only one keyup)
      // re-triggered the underlying click/delete handler repeatedly for as
      // long as the key was held. Still needs preventDefault on keydown,
      // though, or the page scrolls before keyup ever fires.
      e.preventDefault();
    }
  });
  el.addEventListener("keyup", (e) => {
    if (e.key === " ") {
      e.preventDefault();
      el.click();
    }
  });
};
