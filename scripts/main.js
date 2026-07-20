// ---------- Theme ----------
const root = document.documentElement;
const themeToggle = document.getElementById("themeToggle");

function applyTheme(theme) {
  root.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}

const savedTheme = localStorage.getItem("theme");
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

// ---------- Nav switching ----------
const navItems = document.querySelectorAll(".nav-item[data-view]");
const pageTitle = document.getElementById("pageTitle");
const viewSections = document.querySelectorAll(".view");

const viewTitles = {
  dashboard: "대시보드",
  schedule: "일정 · 할 일",
  practice: "베이스 연습 일지",
  study: "스터디 플래너",
  exercise: "운동",
  assistant: "비서에게 묻기",
  settings: "설정",
};

function showView(viewName) {
  viewSections.forEach((section) => {
    section.hidden = section.id !== `view-${viewName}`;
  });
  if (viewName === "dashboard" && window.ScheduleView) {
    window.ScheduleView.refreshDashboard();
  }
  if (viewName === "dashboard" && window.PracticeView) {
    window.PracticeView.refreshDashboard();
  }
  if (viewName === "settings" && window.SettingsView) {
    window.SettingsView.refreshStorage();
  }
  if (viewName === "settings" && window.CloudSync) {
    window.CloudSync.renderDebugLog();
  }
}

navItems.forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    navItems.forEach((n) => n.classList.remove("active"));
    item.classList.add("active");
    pageTitle.textContent = viewTitles[item.dataset.view] ?? "";
    showView(item.dataset.view);
    sidebar.classList.remove("mobile-open");
  });
});

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
