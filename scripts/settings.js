(function () {
  const SETTINGS_KEY = "assistant.settings.v1";
  const STORAGE_ESTIMATE_BYTES = 5 * 1024 * 1024; // typical localStorage quota
  const CUSTOM_SHORTCUTS_KEY = "assistant.customShortcuts.v1";
  const DEFAULT_SETTINGS = { naverBlogUrl: "https://blog.naver.com/minhyeogi50" };
  let resetArmed = false;

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return { ...DEFAULT_SETTINGS, ...parsed, naverBlogUrl: parsed.naverBlogUrl || DEFAULT_SETTINGS.naverBlogUrl };
    } catch {
      return { ...DEFAULT_SETTINGS };
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

  // ---------- Appearance: accent color + font size ----------
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function applyAccentColor(color) {
    if (!color) return;
    document.documentElement.style.setProperty("--accent", color);
    document.documentElement.style.setProperty("--accent-soft", hexToRgba(color, 0.14));
    document.querySelectorAll(".accent-swatch").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.accent === color);
    });
  }

  function applyFontSize(size) {
    document.documentElement.setAttribute("data-font-size", size || "medium");
    const select = document.getElementById("fontSizeSelect");
    if (select) select.value = size || "medium";
  }

  function initAppearance() {
    const settings = window.SettingsStore.get();
    if (settings.accentColor) applyAccentColor(settings.accentColor);
    applyFontSize(settings.fontSize || "medium");

    document.querySelectorAll(".accent-swatch").forEach((btn) => {
      btn.addEventListener("click", () => {
        const color = btn.dataset.accent;
        applyAccentColor(color);
        window.SettingsStore.update({ accentColor: color });
      });
    });

    document.getElementById("fontSizeSelect").addEventListener("change", (e) => {
      applyFontSize(e.target.value);
      window.SettingsStore.update({ fontSize: e.target.value });
    });
  }

  // ---------- Category customization ----------
  function renderCategoryEditor() {
    const container = document.getElementById("categoryEditRows");
    if (!container) return;
    container.innerHTML = "";
    window.CategoryStore.getAll().forEach((cat) => {
      const row = document.createElement("div");
      row.className = "category-edit-row";
      row.dataset.key = cat.key;

      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = cat.color;
      colorInput.dataset.field = "color";
      row.appendChild(colorInput);

      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.value = cat.label;
      labelInput.dataset.field = "label";
      labelInput.maxLength = 10;
      row.appendChild(labelInput);

      container.appendChild(row);
    });
  }

  function handleCategorySubmit(e) {
    e.preventDefault();
    document.querySelectorAll("#categoryEditRows .category-edit-row").forEach((row) => {
      const key = row.dataset.key;
      const color = row.querySelector('[data-field="color"]').value;
      const label = row.querySelector('[data-field="label"]').value.trim();
      if (label) window.CategoryStore.update(key, { color, label });
    });
    window.Toast.show("카테고리를 저장했어요");
    if (window.ScheduleView) window.ScheduleView.refreshAll();
  }

  // ---------- Custom shortcuts ----------
  function loadCustomShortcuts() {
    try {
      const raw = localStorage.getItem(CUSTOM_SHORTCUTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveCustomShortcuts(list) {
    localStorage.setItem(CUSTOM_SHORTCUTS_KEY, JSON.stringify(list));
  }

  function renderCustomShortcuts() {
    const list = loadCustomShortcuts();

    const settingsList = document.getElementById("customShortcutList");
    if (settingsList) {
      settingsList.innerHTML = "";
      if (list.length === 0) {
        settingsList.innerHTML = `<li class="schedule-empty">추가된 바로가기가 없어요</li>`;
      } else {
        list.forEach((item) => {
          const li = document.createElement("li");
          const name = document.createElement("span");
          name.textContent = item.name;
          li.appendChild(name);
          const remove = document.createElement("span");
          remove.className = "remove";
          remove.textContent = "삭제";
          remove.addEventListener("click", () => {
            saveCustomShortcuts(loadCustomShortcuts().filter((s) => s.id !== item.id));
            renderCustomShortcuts();
          });
          li.appendChild(remove);
          settingsList.appendChild(li);
        });
      }
    }

    const sidebarContainer = document.getElementById("sidebarCustomShortcuts");
    if (sidebarContainer) {
      sidebarContainer.innerHTML = "";
      list.forEach((item) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "nav-item";
        btn.innerHTML = `<span class="nav-icon">🔗</span><span class="nav-label">${item.name}</span>`;
        btn.addEventListener("click", () => window.open(item.url, "_blank", "noopener"));
        sidebarContainer.appendChild(btn);
      });
    }
  }

  function handleAddCustomShortcut(e) {
    e.preventDefault();
    const name = document.getElementById("customShortcutNameInput").value.trim();
    const url = document.getElementById("customShortcutUrlInput").value.trim();
    if (!name || !url) return;
    const list = loadCustomShortcuts();
    list.push({ id: `cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name, url });
    saveCustomShortcuts(list);
    document.getElementById("customShortcutForm").reset();
    renderCustomShortcuts();
    window.Toast.show(`"${name}" 바로가기를 추가했어요`);
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

  function mergeValue(existingRaw, incoming) {
    let existing;
    try {
      existing = existingRaw ? JSON.parse(existingRaw) : undefined;
    } catch {
      existing = undefined;
    }
    if (Array.isArray(existing) && Array.isArray(incoming)) {
      const byId = new Map(existing.map((item) => [item && item.id, item]));
      incoming.forEach((item) => byId.set(item && item.id, item));
      return [...byId.values()];
    }
    if (existing && typeof existing === "object" && !Array.isArray(existing) &&
        incoming && typeof incoming === "object" && !Array.isArray(incoming)) {
      return { ...existing, ...incoming };
    }
    return incoming;
  }

  function importDataFile(file) {
    const shouldMerge = document.getElementById("importMergeInput")?.checked;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        let count = 0;
        Object.keys(data).forEach((key) => {
          if (!key.startsWith("assistant.")) return;
          const incoming = data[key];
          const finalValue = shouldMerge ? mergeValue(localStorage.getItem(key), incoming) : incoming;
          const value = typeof finalValue === "string" ? finalValue : JSON.stringify(finalValue);
          localStorage.setItem(key, value);
          count += 1;
        });
        if (count === 0) throw new Error("empty");
        window.Toast.show(`데이터 ${count}개 항목을 ${shouldMerge ? "병합" : "가져왔어요"}. 새로고침합니다...`, { duration: 2000 });
        setTimeout(() => location.reload(), 1200);
      } catch {
        window.Toast.show("올바른 백업 파일이 아니에요");
      }
    };
    reader.readAsText(file);
  }

  // ---------- Data reset ----------
  function handleResetData() {
    const btn = document.getElementById("resetDataBtn");
    if (!resetArmed) {
      resetArmed = true;
      btn.textContent = "정말 삭제할까요? 다시 클릭하면 초기화됩니다";
      setTimeout(() => {
        resetArmed = false;
        btn.textContent = "전체 데이터 초기화";
      }, 5000);
      return;
    }
    Object.keys(localStorage)
      .filter((key) => key.startsWith("assistant."))
      .forEach((key) => localStorage.removeItem(key));
    window.Toast.show("모든 데이터를 초기화했어요. 새로고침합니다...", { duration: 1500 });
    setTimeout(() => location.reload(), 1000);
  }

  function init() {
    populateSettingsForm();
    applyProfile();
    renderStorageUsage();
    initAppearance();
    renderCategoryEditor();
    renderCustomShortcuts();

    document.getElementById("settingsForm").addEventListener("submit", handleSettingsSubmit);
    document.getElementById("profileForm").addEventListener("submit", handleProfileSubmit);
    document.getElementById("categoryForm").addEventListener("submit", handleCategorySubmit);
    document.getElementById("customShortcutForm").addEventListener("submit", handleAddCustomShortcut);

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
    document.getElementById("resetDataBtn").addEventListener("click", handleResetData);
  }

  window.SettingsView = { init, refreshStorage: renderStorageUsage, refreshCategories: renderCategoryEditor };
})();
