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
      const isActive = btn.dataset.accent === color;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
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
          swatchGroup.querySelectorAll(".category-color-swatch").forEach((s) => s.classList.remove("active"));
          swatch.classList.add("active");
          // Auto-saves immediately, matching ledger.js's category manager —
          // this used to stay batched behind the "카테고리 저장" submit
          // button, an inconsistency where the two near-identical category
          // editors behaved differently: navigating away from 설정 after
          // editing a schedule category silently lost the edit.
          window.CategoryStore.update(cat.key, { color });
          if (window.ScheduleView) window.ScheduleView.refreshAll();
        });
        swatchGroup.appendChild(swatch);
      });
      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.value = cat.label;
      labelInput.dataset.field = "label";
      labelInput.maxLength = 10;
      labelInput.addEventListener("change", () => {
        const label = labelInput.value.trim();
        if (!label) {
          labelInput.value = cat.label; // an empty name shouldn't silently apply
          return;
        }
        window.CategoryStore.update(cat.key, { label });
        if (window.ScheduleView) window.ScheduleView.refreshAll();
      });
      row.appendChild(labelInput);
      row.appendChild(swatchGroup);

      // Removal is immediate (with undo), same as label/color now.
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

  // Same gap as ledger.js's addCategory: repeated "+" clicks without
  // renaming used to pile up several identically-named categories with no
  // way to tell them apart — number the placeholder ("새 카테고리 2", ...)
  // when the base name's already taken.
  function uniqueCategoryLabel(base, existingLabels) {
    if (!existingLabels.includes(base)) return base;
    let n = 2;
    while (existingLabels.includes(`${base} ${n}`)) n += 1;
    return `${base} ${n}`;
  }

  function addScheduleCategory() {
    const existing = window.CategoryStore.getAll();
    const color = CATEGORY_COLOR_PRESETS[existing.length % CATEGORY_COLOR_PRESETS.length];
    const label = uniqueCategoryLabel("새 카테고리", existing.map((c) => c.label));
    const created = window.CategoryStore.add(label, color);
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
            window.DeletionTombstones.record([item.id]);
            renderCustomShortcuts();
          });
          // Every other delete span in the app (routine/practice/ledger/
          // exercise/study/vongole) already goes through this — this one
          // was missed, leaving it mouse-only.
          window.makeKeyboardActivatable(remove, `${item.name} 바로가기 삭제`);
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
    const shortcut = { id: `cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name, url };
    list.push(shortcut);
    saveCustomShortcuts(list);
    window.DeletionTombstones.forget([shortcut.id]);
    document.getElementById("customShortcutForm").reset();
    renderCustomShortcuts();
    window.Toast.show(`"${name}" 바로가기를 추가했어요`);
  }

  // ---------- Storage usage ----------
  // Human labels for the fixed, known set of "assistant."-prefixed keys this
  // app ever writes (verified against every localStorage.setItem/getItem
  // call across scripts/*.js — there are no dynamically-templated key names
  // here). Used only for the breakdown list below; a key not in this map
  // (e.g. one added later and not yet labeled) still shows up under its raw
  // key rather than silently vanishing from the breakdown.
  const STORAGE_KEY_LABELS = {
    "assistant.ledgerEntries.v1": "가계부 내역",
    "assistant.ledgerCategories.v1": "가계부 카테고리",
    "assistant.schedules.v1": "일정",
    "assistant.scheduleOrder.v1": "일정 순서",
    "assistant.pinnedScheduleOrder.v1": "고정 일정 순서",
    "assistant.templates.v1": "반복 일정 템플릿",
    "assistant.categories.v1": "일정 카테고리",
    "assistant.routines.v1": "루틴",
    "assistant.practice.v1": "연습 일지",
    "assistant.practiceChecklist.v1": "연습 체크리스트",
    "assistant.practiceCurriculum.v1": "연습 커리큘럼",
    "assistant.academicGoals.v1": "학업 목표",
    "assistant.exerciseRecords.v1": "운동 개인 기록",
    "assistant.learnedExercises.v1": "배운 운동 목록",
    "assistant.vongoleRecipes.v1": "봉골레 레시피",
    "assistant.vongoleCollectedRecipes.v1": "봉골레 수집 레시피",
    "assistant.vongoleDefaultRecipeSeeded.v1": "봉골레 기본 레시피 시드",
    "assistant.vongoleLog.v1": "봉골레 시도 기록",
    "assistant.customShortcuts.v1": "바로가기",
    "assistant.settings.v1": "설정",
    "assistant.hideCompleted.v1": "완료 항목 숨기기 설정",
    "assistant.upcomingRangeDays.v1": "다가오는 일정 범위 설정",
  };
  const STORAGE_BREAKDOWN_TOP_N = 6;

  // Counts only "assistant."-prefixed keys — the same scope
  // exportData()/handleResetData() operate on below. This used to count
  // every localStorage key (including the device-local weather cache,
  // theme, and Firebase SDK's own auth-persistence keys), so the
  // percentage shown here didn't actually match "how much of this can I
  // back up or reset" — it's a slight undercount against the *literal*
  // browser quota, but assistant.* data is what dominates that quota as it
  // grows, and it's what the gauge is actually meant to help reason about.
  function calculateStorageBreakdown() {
    const perKey = [];
    try {
      for (const key in localStorage) {
        if (!Object.prototype.hasOwnProperty.call(localStorage, key)) continue;
        if (!key.startsWith("assistant.")) continue;
        const bytes = (key.length + (localStorage.getItem(key) || "").length) * 2; // UTF-16 ~2 bytes/char
        perKey.push({ key, label: STORAGE_KEY_LABELS[key] || key, bytes });
      }
    } catch {
      return { total: 0, perKey: [] };
    }
    perKey.sort((a, b) => b.bytes - a.bytes);
    const total = perKey.reduce((sum, item) => sum + item.bytes, 0);
    return { total, perKey };
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }

  function renderStorageUsage() {
    const container = document.getElementById("storageUsage");
    if (!container) return;
    const { total, perKey } = calculateStorageBreakdown();
    const percent = Math.min(100, Math.round((total / STORAGE_ESTIMATE_BYTES) * 100));

    // Which items are actually eating the quota — without this, "80% used"
    // gives no hint what to go clean up. Only items with real content are
    // worth listing; a handful of leftover 0-byte keys would just be noise.
    const withContent = perKey.filter((item) => item.bytes > 0);
    const top = withContent.slice(0, STORAGE_BREAKDOWN_TOP_N);
    const rest = withContent.slice(STORAGE_BREAKDOWN_TOP_N);
    const restBytes = rest.reduce((sum, item) => sum + item.bytes, 0);

    // The gauge fill's own `transition: width` never actually played: this
    // whole container gets rebuilt via innerHTML every time storage
    // changes, and a freshly created element has no "previous" width for a
    // transition to animate from — it always just snapped straight to the
    // new value. Start the fresh element at whatever width was already
    // on-screen (0 on the very first render), then flip to the real value
    // a frame later so the transition has something to actually animate.
    const previousFill = container.querySelector(".storage-gauge-fill");
    const startPercent = previousFill ? previousFill.style.width : "0%";

    // item.label falls back to the raw key when it's not in
    // STORAGE_KEY_LABELS — and applyRemoteData() never validates that a
    // synced key name is one this app actually recognizes, so a crafted
    // remote payload could in principle land an arbitrary string here.
    // Built with createElement/textContent (not innerHTML) so that can
    // never become a stored-XSS path, matching every other list in this file.
    container.innerHTML = `
      <div class="storage-gauge"><div class="storage-gauge-fill" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100" style="width:${startPercent}"></div></div>
      <p class="storage-usage-text">${formatBytes(total)} / 약 ${formatBytes(STORAGE_ESTIMATE_BYTES)} 사용 중 (${percent}%)</p>
    `;
    requestAnimationFrame(() => {
      const fill = container.querySelector(".storage-gauge-fill");
      if (fill) fill.style.width = `${percent}%`;
    });
    if (top.length === 0) return;
    const list = document.createElement("ul");
    list.className = "storage-usage-breakdown";
    top.forEach((item) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = item.label;
      const size = document.createElement("span");
      size.textContent = formatBytes(item.bytes);
      li.append(label, size);
      list.appendChild(li);
    });
    if (rest.length > 0) {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `기타 ${rest.length}개 항목`;
      const size = document.createElement("span");
      size.textContent = formatBytes(restBytes);
      li.append(label, size);
      list.appendChild(li);
    }
    container.appendChild(list);
  }

  // ---------- Export / import ----------
  function exportData() {
    try {
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
    } catch (err) {
      console.error("data export failed:", err);
      window.Toast.show("데이터를 내보내는 데 실패했어요", { type: "error" });
    }
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

  // localStorage.setItem can fail partway through this loop (quota
  // exceeded on a large backup) — using safeSetLocalStorage instead of
  // a bare setItem means a failure here can't throw and get swallowed
  // by a catch that reports the same generic "invalid file" message
  // regardless of whether the file was actually fine and it was just
  // storage that ran out, with some keys already overwritten by then.
  function applyImportedData(data, shouldMerge) {
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
    // Writes here go straight through safeSetLocalStorage, bypassing every
    // store's own save() — each store's in-memory read cache (store.js)
    // would otherwise keep serving pre-import data for the few seconds
    // before the reload below actually lands.
    window.__resetStoreCaches?.forEach((reset) => reset());
    const summary =
      failed === 0
        ? `데이터 ${succeeded}개 항목을 ${shouldMerge ? "병합" : "가져왔어요"}. 새로고침합니다...`
        : `${succeeded}개 항목은 가져왔지만 ${failed}개는 저장 공간 부족 등으로 실패했어요. 새로고침합니다...`;
    window.Toast.show(summary, { duration: 2500, type: failed === 0 ? undefined : "warning" });
    setTimeout(() => location.reload(), 1800);
  }

  const OVERWRITE_CONFIRM_MESSAGE = "기존 데이터를 전부 덮어써요. 되돌릴 수 없어요 — 계속할까요?";

  function importDataFile(file) {
    const shouldMerge = document.getElementById("importMergeInput")?.checked;
    // An earlier, not-yet-confirmed overwrite import's confirm toast would
    // otherwise stay armed with a closure over THAT file's (now stale)
    // data — if the user then picks a different file (merge or overwrite)
    // before confirming, clicking the old toast would still fire and
    // clobber whatever this newer import just did with the older file's
    // contents. Only the most recent import attempt's confirm should ever
    // be able to apply.
    document.querySelectorAll(".toast").forEach((el) => {
      if (el.dataset.toastMessage === OVERWRITE_CONFIRM_MESSAGE) el.remove();
    });
    const reader = new FileReader();
    reader.onload = (e) => {
      let data;
      try {
        data = JSON.parse(e.target.result);
      } catch {
        window.Toast.show("올바른 백업 파일이 아니에요", { type: "error" });
        return;
      }
      // A file whose top-level JSON is valid but not an object (bare
      // "null", a number, an array, ...) used to reach Object.keys(data)
      // below uncaught — Object.keys(null) throws, silently failing the
      // whole import with no toast at all instead of this same message.
      if (data === null || typeof data !== "object" || Array.isArray(data)) {
        window.Toast.show("올바른 백업 파일이 아니에요", { type: "error" });
        return;
      }

      // Overwrite mode is irreversible (every existing assistant.* key gets
      // replaced) and used to run the instant the file was picked, with no
      // confirmation at all — unlike "전체 데이터 초기화", which requires an
      // armed second click first. Merge mode is left alone: it's additive/
      // non-destructive (mergeValue keeps whatever the existing side had a
      // key the incoming side didn't), so there's nothing here to guard.
      if (shouldMerge) {
        applyImportedData(data, true);
      } else {
        window.Toast.show(OVERWRITE_CONFIRM_MESSAGE, {
          type: "warning",
          duration: 10000,
          actionLabel: "덮어쓰기",
          onAction: () => applyImportedData(data, false),
        });
      }
    };
    // Without this, a read failure (corrupted file handle, permission
    // revoked mid-read) just meant onload never fired — the user clicks
    // "가져오기", picks a file, and nothing happens with zero feedback.
    reader.onerror = () => {
      window.Toast.show("파일을 읽지 못했어요", { type: "error" });
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
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith("assistant."))
        .forEach((key) => localStorage.removeItem(key));
    } catch (err) {
      // An exception partway through used to abort the loop silently —
      // some keys deleted, some not, no toast, no reload, and the button
      // left stuck on "정말 삭제할까요?" with resetArmed still true.
      console.error("data reset failed partway through:", err);
      resetArmed = false;
      btn.textContent = "전체 데이터 초기화";
      window.Toast.show("초기화 중 오류가 발생했어요. 일부만 삭제됐을 수 있어요.", { type: "error" });
      return;
    }
    // Same reasoning as applyImportedData above — this bypasses every
    // store's own save(), so their in-memory read caches need an explicit
    // invalidation instead of only relying on the reload below.
    window.__resetStoreCaches?.forEach((reset) => reset());
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

  window.SettingsView = {
    init,
    refreshStorage: renderStorageUsage,
    refreshCategories: renderCategoryEditor,
    // Same reasoning as refreshCategories above — profile name/avatar and
    // custom shortcuts can also change from outside this tab (cloud sync
    // pulling in another device's edit), but only refreshCategories was
    // ever wired to the tab-switch refresh, leaving these two stale in the
    // Settings form/dashboard greeting until a full page reload.
    refreshProfile: () => {
      populateSettingsForm();
      applyProfile();
    },
    refreshShortcuts: renderCustomShortcuts,
  };
})();
