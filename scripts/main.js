// A localStorage read/write can throw in rare cases (Safari private mode,
// storage disabled by policy, quota exceeded) — falling back to null/no-op
// instead of letting that exception take down the rest of this script.
function safeGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // best effort — the preference just won't persist this session
  }
}

// ---------- Service worker (offline app-shell caching) ----------
// Previously only ever registered from inside the push-notification opt-in
// flow (scripts/notifications.js) — meaning offline support silently never
// activated for anyone who hadn't turned notifications on. Registering it
// unconditionally here is what actually makes sw.js's caching apply
// app-wide; notifications.js's own register() call for the same scriptURL
// afterward just resolves to this same registration, it doesn't create a
// second one.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => {
    console.error("service worker registration failed", err);
  });
}

// ---------- Theme ----------
const root = document.documentElement;
const themeToggle = document.getElementById("themeToggle");

function applyTheme(theme) {
  root.setAttribute("data-theme", theme);
  safeSetItem("theme", theme);
}

const savedTheme = safeGetItem("theme");
if (savedTheme) {
  applyTheme(savedTheme);
} else {
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  applyTheme(prefersLight ? "light" : "dark");
}

themeToggle.addEventListener("click", () => {
  const current = root.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

// ---------- Sidebar collapse (desktop) ----------
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
});

// ---------- Sidebar mobile open/close ----------
const mobileMenuBtn = document.getElementById("mobileMenuBtn");

mobileMenuBtn.addEventListener("click", () => {
  sidebar.classList.toggle("mobile-open");
});

document.addEventListener("click", (e) => {
  const isMobile = window.matchMedia("(max-width: 720px)").matches;
  if (!isMobile) return;
  if (sidebar.classList.contains("mobile-open") &&
      !sidebar.contains(e.target) &&
      !mobileMenuBtn.contains(e.target)) {
    sidebar.classList.remove("mobile-open");
  }
});

// ---------- Mobile search (the search box itself is hidden below 720px) ----------
const mobileSearchBtn = document.getElementById("mobileSearchBtn");
const searchBoxEl = document.getElementById("searchBox");

if (mobileSearchBtn && searchBoxEl) {
  mobileSearchBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    searchBoxEl.classList.toggle("mobile-open");
    if (searchBoxEl.classList.contains("mobile-open")) {
      window.GlobalSearch?.focusInput();
    }
  });

  document.addEventListener("click", (e) => {
    const isMobile = window.matchMedia("(max-width: 720px)").matches;
    if (!isMobile) return;
    if (searchBoxEl.classList.contains("mobile-open") &&
        !searchBoxEl.contains(e.target) &&
        !mobileSearchBtn.contains(e.target)) {
      searchBoxEl.classList.remove("mobile-open");
    }
  });
}

// ---------- Nav switching ----------
const navItems = document.querySelectorAll(".nav-item[data-view]");
const pageTitle = document.getElementById("pageTitle");
const viewSections = document.querySelectorAll(".view");

const viewTitles = {
  dashboard: "대시보드",
  routine: "루틴",
  schedule: "일정 · 할 일",
  practice: "베이스 연습 일지",
  study: "학업",
  exercise: "운동",
  ledger: "가계부",
  vongole: "봉골레 파스타",
  assistant: "비서에게 묻기",
  settings: "설정",
};

function showView(viewName) {
  viewSections.forEach((section) => {
    section.hidden = section.id !== `view-${viewName}`;
  });

  const nextSection = document.getElementById(`view-${viewName}`);
  if (nextSection) {
    // Remove-then-re-add so the animation replays even if this same tab
    // was just clicked again (a bare class add is a no-op the second time).
    nextSection.classList.remove("view-enter");
    void nextSection.offsetWidth;
    nextSection.classList.add("view-enter");
  }

  if (viewName === "dashboard" && window.ScheduleView) {
    window.ScheduleView.refreshDashboard();
  }
  if (viewName === "dashboard" && window.PracticeView) {
    window.PracticeView.refreshDashboard();
  }
  if (viewName === "dashboard" && window.ExerciseView) {
    window.ExerciseView.refreshDashboard();
  }
  if (viewName === "dashboard" && window.WeatherView) {
    window.WeatherView.refreshDashboard();
  }
  if (viewName === "dashboard" && window.LedgerView) {
    window.LedgerView.refreshDashboard();
  }
  if (viewName === "dashboard" && window.VongoleView) {
    window.VongoleView.refreshDashboard();
  }
  if (viewName === "routine" && window.RoutineView) {
    // The routine layout was hidden (width 0) for any resize that happened
    // while on another tab, so re-check now that it's actually measurable.
    window.RoutineView.onShow();
  }
  if (viewName === "schedule" && window.ScheduleView) {
    window.ScheduleView.onShow();
  }
  if (viewName === "ledger" && window.LedgerView) {
    window.LedgerView.onShow();
  }
  if (viewName === "settings" && window.SettingsView) {
    window.SettingsView.refreshStorage();
  }
  if (viewName === "settings" && window.CloudSync) {
    window.CloudSync.renderDebugLog();
  }
}

// Device-local UI state (not synced across devices, like "theme").
const CURRENT_VIEW_KEY = "currentView";

function setActiveView(viewName) {
  const item = [...navItems].find((n) => n.dataset.view === viewName);
  if (!item) return;
  navItems.forEach((n) => n.classList.remove("active"));
  item.classList.add("active");
  pageTitle.textContent = viewTitles[viewName] ?? "";
  showView(viewName);
  safeSetItem(CURRENT_VIEW_KEY, viewName);
}

navItems.forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    setActiveView(item.dataset.view);
    sidebar.classList.remove("mobile-open");
  });
});

// A URL hash (e.g. from a shortcut/widget link like "#schedule") always wins
// over the last-visited view, so links can deep-link into a specific tab.
const hashView = location.hash.slice(1);
const isValidView = [...navItems].some((n) => n.dataset.view === hashView);
setActiveView(isValidView ? hashView : safeGetItem(CURRENT_VIEW_KEY) || "dashboard");

document.getElementById("dashboardGoToScheduleBtn")?.addEventListener("click", () => {
  document.querySelector('.nav-item[data-view="schedule"]')?.click();
});

// ---------- Date display ----------
const pageDate = document.getElementById("pageDate");
const today = new Date();
const formatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});
pageDate.textContent = formatter.format(today);

// ---------- Feature init ----------
// Called by cloud-sync.js once it has pulled the latest data (or immediately,
// via the cloud-sync.js script tag's onerror fallback, if that script can't load).
window.initFeatures = function initFeatures() {
  if (window.__featuresInitialized) return;
  window.__featuresInitialized = true;

  if (window.ScheduleView) window.ScheduleView.init();
  if (window.SettingsView) window.SettingsView.init();
  if (window.PracticeView) window.PracticeView.init();
  if (window.StudyView) window.StudyView.init();
  if (window.ExerciseView) window.ExerciseView.init();
  if (window.LedgerView) window.LedgerView.init();
  if (window.VongoleView) window.VongoleView.init();
  if (window.RoutineView) window.RoutineView.init();
  if (window.GlobalSearch) window.GlobalSearch.init();
};

// ---------- Open Claude app (stand-in for AI features) ----------
document.querySelectorAll(".open-claude-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    window.open("https://claude.ai", "_blank", "noopener");
  });
});

// ---------- Keyboard shortcuts ----------
document.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  const isTyping = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;

  if (e.key === "/" && !isTyping) {
    e.preventDefault();
    window.GlobalSearch?.focusInput();
    return;
  }

  if (e.key === "n" && !isTyping && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    document.querySelector('.nav-item[data-view="schedule"]')?.click();
    window.ScheduleView?.openAddModal();
  }
});
