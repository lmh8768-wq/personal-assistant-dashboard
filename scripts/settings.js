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
    window.safeSetLocalStorage(SETTINGS_KEY, JSON.stringify(settings));
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
      window.Toast.show(`${label} 주소를 먼저 설정에서 입력해주세요`, { type: "warning" });
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
  // A native <input type="color"> used to sit here, popping up the OS's own
  // color picker — a jarring detour from the app's own look. A small preset
  // swatch grid keeps color choice inline and on-theme instead.
  const CATEGORY_COLOR_PRESETS = [
    "#7c9eff", "#4ade80", "#f472b6", "#fb923c", "#a78bfa",
    "#f87171", "#22d3ee", "#fbbf24", "#6366f1", "#9ca3af",
  ];

  function renderCategoryEditor() {
    const container = document.getElementById("categoryEditRows");
    if (!container) return;
    container.innerHTML = "";
    window.CategoryStore.getAll().forEach((cat) => {
      const row = document.createElement("div");
      row.className = "category-edit-row";
      row.dataset.key = cat.key;

      const colorInput = document.createElement("input");
      colorInput.type = "hidden";
      colorInput.value = cat.color;
      colorInput.dataset.field = "color";
      row.appendChild(colorInput);

      const swatchGroup = document.createElement("div");
      swatchGroup.className = "category-color-swatches";
      // The category's current color always gets a swatch, even if it's a
      // one-off value the user picked before this preset grid existed.
      const palette = CATEGORY_COLOR_PRESETS.includes(cat.color)
        ? CATEGORY_COLOR_PRESETS
        : [cat.color, ...CATEGORY_COLOR_PRESETS];
      palette.forEach((color) => {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "category-color-swatch" + (color === cat.color ? " active" : "");
        swatch.style.background = color;
        swatch.setAttribute("aria-label", `색상 ${color}`);
        swatch.addEventListener("click", () => {
          colorInput.value = color;
          swatchGroup.querySelectorAll(".category-color-swatch").forEach((s) => s.classList.remove("active"));
          swatch.classList.add("active");
        });
        swatchGroup.appendChild(swatch);
      });
      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.value = cat.label;
      labelInput.dataset.field = "label";
      labelInput.maxLength = 10;
      row.appendChild(labelInput);
      row.appendChild(swatchGroup);

      // Removal is immediate (with undo), unlike label/color which stay
      // batched behind the "카테고리 저장" submit button below — deleting a
      // category isn't something you'd want to accidentally leave pending.
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "checklist-item-remove";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", `${cat.label} 카테고리 삭제`);
      removeBtn.addEventListener("click", () => {
        const removed = window.CategoryStore.remove(cat.key);
        renderCategoryEditor();
        if (window.ScheduleView) window.ScheduleView.refreshAll();
        if (removed && window.Toast) {
          window.Toast.show(`"${cat.label}" 카테고리를 삭제했어요`, {
            actionLabel: "실행취소",
            onAction: () => {
              window.CategoryStore.restore(removed.item, removed.index);
              renderCategoryEditor();
              if (window.ScheduleView) window.ScheduleView.refreshAll();
            },
          });
        }
      });
      row.appendChild(removeBtn);

      container.appendChild(row);
    });
  }

  function addScheduleCategory() {
    const existingCount = window.CategoryStore.getAll().length;
    const color = CATEGORY_COLOR_PRESETS[existingCount % CATEGORY_COLOR_PRESETS.length];
    const created = window.CategoryStore.add("새 카테고리", color);
    renderCategoryEditor();
    if (window.ScheduleView) window.ScheduleView.refreshAll();
    requestAnimationFrame(() => {
      const row = document.querySelector(`#categoryEditRows .category-edit-row[data-key="${created.key}"]`);
      const input = row?.querySelector('[data-field="label"]');
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  function handleCategorySubmit(e) {
    e.preventDefault();
    let skippedLabelCount = 0;
    document.querySelectorAll("#categoryEditRows .category-edit-row").forEach((row) => {
      const key = row.dataset.key;
      const color = row.querySelector('[data-field="color"]').value;
      const label = row.querySelector('[data-field="label"]').value.trim();
      if (label) {
        window.CategoryStore.update(key, { color, label });
      } else {
        // An empty name shouldn't also throw away a color pick made in the
        // same row — apply just the color instead of skipping the whole
        // row silently.
        window.CategoryStore.update(key, { color });
        skippedLabelCount += 1;
      }
    });
    window.Toast.show(
      skippedLabelCount > 0
        ? `카테고리를 저장했어요 (이름이 비어있는 ${skippedLabelCount}개는 이름을 바꾸지 않았어요)`
        : "카테고리를 저장했어요",
      skippedLabelCount > 0 ? { type: "warning" } : undefined
    );
    renderCategoryEditor();
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
    window.safeSetLocalStorage(CUSTOM_SHORTCUTS_KEY, JSON.stringify(list));
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
        const icon = document.createElement("span");
        icon.className = "nav-icon";
        icon.textContent = "🔗";
        const label = document.createElement("span");
        label.className = "nav-label";
        label.textContent = item.name;
        btn.appendChild(icon);
        btn.appendChild(label);
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
    try {
      let chars = 0;
      for (const key in localStorage) {
        if (!Object.prototype.hasOwnProperty.call(localStorage, key)) continue;
        chars += key.length + (localStorage.getItem(key) || "").length;
      }
      return chars * 2; // UTF-16 ~2 bytes/char
    } catch {
      return 0;
    }
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
    return window.DeepMerge.mergeValues(existing, incoming);
  }

  function importDataFile(file) {
    const shouldMerge = document.getElementById("importMergeInput")?.checked;
    const reader = new FileReader();
    reader.onload = (e) => {
      let data;
      try {
        data = JSON.parse(e.target.result);
      } catch {
        window.Toast.show("올바른 백업 파일이 아니에요", { type: "error" });
        return;
      }

      // localStorage.setItem can fail partway through this loop (quota
      // exceeded on a large backup) — using safeSetLocalStorage instead of
      // a bare setItem means a failure here can't throw and get swallowed
      // by a catch that reports the same generic "invalid file" message
      // regardless of whether the file was actually fine and it was just
      // storage that ran out, with some keys already overwritten by then.
      let succeeded = 0;
      let failed = 0;
      Object.keys(data).forEach((key) => {
        if (!key.startsWith("assistant.")) return;
        const incoming = data[key];
        const finalValue = shouldMerge ? mergeValue(localStorage.getItem(key), incoming) : incoming;
        const value = typeof finalValue === "string" ? finalValue : JSON.stringify(finalValue);
        if (window.safeSetLocalStorage(key, value)) succeeded += 1;
        else failed += 1;
      });

      if (succeeded === 0 && failed === 0) {
        window.Toast.show("올바른 백업 파일이 아니에요", { type: "error" });
        return;
      }
      const summary =
        failed === 0
          ? `데이터 ${succeeded}개 항목을 ${shouldMerge ? "병합" : "가져왔어요"}. 새로고침합니다...`
          : `${succeeded}개 항목은 가져왔지만 ${failed}개는 저장 공간 부족 등으로 실패했어요. 새로고침합니다...`;
      window.Toast.show(summary, { duration: 2500, type: failed === 0 ? undefined : "warning" });
      setTimeout(() => location.reload(), 1800);
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

  function renderNotificationStatus() {
    const statusEl = document.getElementById("notificationStatusText");
    const btn = document.getElementById("notificationToggleBtn");
    if (!statusEl || !btn) return;

    if (!window.PushNotifications || !window.PushNotifications.isSupported()) {
      statusEl.textContent = "이 기기/브라우저에서는 알림을 지원하지 않아요";
      btn.hidden = true;
      return;
    }

    const enabled = window.PushNotifications.isEnabled() && Notification.permission === "granted";
    statusEl.textContent = enabled ? "알림 켜짐" : "알림 꺼짐";
    btn.textContent = enabled ? "알림 끄기" : "알림 켜기";
  }

  async function handleNotificationToggle() {
    const enabled = window.PushNotifications.isEnabled() && Notification.permission === "granted";
    if (enabled) {
      await window.PushNotifications.disableNotifications();
    } else {
      await window.PushNotifications.enableNotifications();
    }
    renderNotificationStatus();
  }

  function init() {
    populateSettingsForm();
    applyProfile();
    renderStorageUsage();
    initAppearance();
    renderCategoryEditor();
    renderCustomShortcuts();
    renderNotificationStatus();
    document.getElementById("notificationToggleBtn")?.addEventListener("click", handleNotificationToggle);

    document.getElementById("settingsForm").addEventListener("submit", handleSettingsSubmit);
    document.getElementById("profileForm").addEventListener("submit", handleProfileSubmit);
    document.getElementById("categoryForm").addEventListener("submit", handleCategorySubmit);
    document.getElementById("addScheduleCategoryBtn")?.addEventListener("click", addScheduleCategory);
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

    document.getElementById("copySyncLogBtn")?.addEventListener("click", async () => {
      const text = document.getElementById("cloudSyncLog")?.textContent || "";
      try {
        await navigator.clipboard.writeText(text);
        window.Toast.show("로그를 복사했어요");
      } catch {
        window.Toast.show("복사에 실패했어요. 로그를 길게 눌러 직접 선택해주세요.", { type: "error" });
      }
    });
  }

  window.SettingsView = { init, refreshStorage: renderStorageUsage, refreshCategories: renderCategoryEditor };
})();
