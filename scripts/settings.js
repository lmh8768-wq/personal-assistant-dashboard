(function () {
  const SETTINGS_KEY = "assistant.settings.v1";

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  window.SettingsStore = {
    get() {
      return loadSettings();
    },
    update(patch) {
      const next = { ...loadSettings(), ...patch };
      saveSettings(next);
      return next;
    },
  };

  function showToast(message) {
    let container = document.getElementById("toastContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "toastContainer";
      container.className = "toast-container";
      document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  function populateSettingsForm() {
    const settings = window.SettingsStore.get();
    document.getElementById("settingsBlogInput").value = settings.naverBlogUrl || "";
    document.getElementById("settingsCafeInput").value = settings.naverCafeUrl || "";
    document.getElementById("settingsInstagramInput").value = settings.instagramUrl || "";
  }

  function handleSettingsSubmit(e) {
    e.preventDefault();
    window.SettingsStore.update({
      naverBlogUrl: document.getElementById("settingsBlogInput").value.trim(),
      naverCafeUrl: document.getElementById("settingsCafeInput").value.trim(),
      instagramUrl: document.getElementById("settingsInstagramInput").value.trim(),
    });
    showToast("설정을 저장했어요");
  }

  function openShortcut(key, label) {
    const url = window.SettingsStore.get()[key];
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.classList.remove("mobile-open");

    if (!url) {
      showToast(`${label} 주소를 먼저 설정에서 입력해주세요`);
      document.querySelector('.nav-item[data-view="settings"]')?.click();
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  function init() {
    populateSettingsForm();
    document.getElementById("settingsForm").addEventListener("submit", handleSettingsSubmit);

    document.getElementById("shortcutBlog").addEventListener("click", () => openShortcut("naverBlogUrl", "네이버 블로그"));
    document.getElementById("shortcutCafe").addEventListener("click", () => openShortcut("naverCafeUrl", "네이버 카페"));
    document.getElementById("shortcutInstagram").addEventListener("click", () => openShortcut("instagramUrl", "인스타그램"));
  }

  window.SettingsView = { init };
})();
