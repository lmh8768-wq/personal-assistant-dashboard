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
  notes: "메모",
  diary: "일기장",
  photos: "사진첩",
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
  if (viewName === "settings" && window.SettingsView) {
    window.SettingsView.refreshStorage();
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

// ---------- Schedule feature ----------
if (window.ScheduleView) {
  window.ScheduleView.init();
}

// ---------- Reminder feature ----------
if (window.ReminderEngine) {
  window.ReminderEngine.init();
}

// ---------- Settings & shortcuts ----------
if (window.SettingsView) {
  window.SettingsView.init();
}

// ---------- Diary feature ----------
if (window.DiaryView) {
  window.DiaryView.init();
}

// ---------- Photo library feature ----------
if (window.PhotoLibraryView) {
  window.PhotoLibraryView.init();
}

// ---------- Notes feature ----------
if (window.NotesView) {
  window.NotesView.init();
}

// ---------- Global search ----------
if (window.GlobalSearch) {
  window.GlobalSearch.init();
}

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
