(function () {
  const SETTINGS_KEY = "assistant.settings.v1";
  const STORAGE_ESTIMATE_BYTES = 5 * 1024 * 1024; // typical localStorage quota

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

  function populateSettingsForm() {
    const settings = window.SettingsStore.get();
    document.getElementById("settingsBlogInput").value = settings.naverBlogUrl || "";
    document.getElementById("settingsCafeInput").value = settings.naverCafeUrl || "";
    document.getElementById("settingsInstagramInput").value = settings.instagramUrl || "";
    document.getElementById("settingsNameInput").value = settings.profileName || "";
  }

  function handleSettingsSubmit(e) {
    e.preventDefault();
    window.SettingsStore.update({
      naverBlogUrl: document.getElementById("settingsBlogInput").value.trim(),
      naverCafeUrl: document.getElementById("settingsCafeInput").value.trim(),
      instagramUrl: document.getElementById("settingsInstagramInput").value.trim(),
    });
    window.Toast.show("설정을 저장했어요");
  }

  function applyProfile() {
    const settings = window.SettingsStore.get();
    const name = (settings.profileName || "").trim();
    const avatar = document.getElementById("userAvatar");
    if (avatar) avatar.textContent = name ? name.charAt(0) : "나";

    const greeting = document.getElementById("dashboardGreeting");
    if (greeting) {
      if (name) {
        greeting.textContent = `안녕하세요, ${name}님 👋`;
        greeting.hidden = false;
      } else {
        greeting.hidden = true;
      }
    }
  }

  function handleProfileSubmit(e) {
    e.preventDefault();
    window.SettingsStore.update({
      profileName: document.getElementById("settingsNameInput").value.trim(),
    });
    applyProfile();
    window.Toast.show("프로필을 저장했어요");
  }

  function openShortcut(key, label) {
    const url = window.SettingsStore.get()[key];
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.classList.remove("mobile-open");

    if (!url) {
      window.Toast.show(`${label} 주소를 먼저 설정에서 입력해주세요`);
      document.querySelector('.nav-item[data-view="settings"]')?.click();
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  // ---------- Storage usage ----------
  function calculateStorageBytes() {
    let chars = 0;
    for (const key in localStorage) {
      if (!Object.prototype.hasOwnProperty.call(localStorage, key)) continue;
      chars += key.length + (localStorage.getItem(key) || "").length;
    }
    return chars * 2; // UTF-16 ~2 bytes/char
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }

  function renderStorageUsage() {
    const container = document.getElementById("storageUsage");
    if (!container) return;
    const used = calculateStorageBytes();
    const percent = Math.min(100, Math.round((used / STORAGE_ESTIMATE_BYTES) * 100));
    container.innerHTML = `
      <div class="storage-gauge"><div class="storage-gauge-fill" style="width:${percent}%"></div></div>
      <p class="storage-usage-text">${formatBytes(used)} / 약 ${formatBytes(STORAGE_ESTIMATE_BYTES)} 사용 중 (${percent}%)</p>
    `;
  }

  // ---------- Export / import ----------
  function exportData() {
    const data = {};
    for (const key in localStorage) {
      if (!Object.prototype.hasOwnProperty.call(localStorage, key)) continue;
      if (!key.startsWith("assistant.")) continue;
      try {
        data[key] = JSON.parse(localStorage.getItem(key));
      } catch {
        data[key] = localStorage.getItem(key);
      }
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `assistant-backup-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
    window.Toast.show("데이터를 내보냈어요");
  }

  function importDataFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        let count = 0;
        Object.keys(data).forEach((key) => {
          if (!key.startsWith("assistant.")) return;
          const value = typeof data[key] === "string" ? data[key] : JSON.stringify(data[key]);
          localStorage.setItem(key, value);
          count += 1;
        });
        if (count === 0) throw new Error("empty");
        window.Toast.show(`데이터 ${count}개 항목을 가져왔어요. 새로고침합니다...`, { duration: 2000 });
        setTimeout(() => location.reload(), 1200);
      } catch {
        window.Toast.show("올바른 백업 파일이 아니에요");
      }
    };
    reader.readAsText(file);
  }

  function init() {
    populateSettingsForm();
    applyProfile();
    renderStorageUsage();

    document.getElementById("settingsForm").addEventListener("submit", handleSettingsSubmit);
    document.getElementById("profileForm").addEventListener("submit", handleProfileSubmit);

    document.getElementById("shortcutBlog").addEventListener("click", () => openShortcut("naverBlogUrl", "네이버 블로그"));
    document.getElementById("shortcutCafe").addEventListener("click", () => openShortcut("naverCafeUrl", "네이버 카페"));
    document.getElementById("shortcutInstagram").addEventListener("click", () => openShortcut("instagramUrl", "인스타그램"));

    document.getElementById("exportDataBtn").addEventListener("click", exportData);
    document.getElementById("importDataBtn").addEventListener("click", () => {
      document.getElementById("importDataInput").click();
    });
    document.getElementById("importDataInput").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importDataFile(file);
      e.target.value = "";
    });
  }

  window.SettingsView = { init, refreshStorage: renderStorageUsage };
})();
