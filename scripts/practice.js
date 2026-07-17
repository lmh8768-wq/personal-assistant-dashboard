(function () {
  const PRACTICE_KEY = "assistant.practice.v1";
  const CHECKLIST_KEY = "assistant.practiceChecklist.v1";
  const SHEETS_KEY = "assistant.practiceSheets.v1";
  const MAX_WIDTH = 900;

  const DEFAULT_CHECKLIST = [
    { id: "pc_default_1", label: "튜닝 확인" },
    { id: "pc_default_2", label: "스케일 연습" },
    { id: "pc_default_3", label: "코드 · 아르페지오" },
    { id: "pc_default_4", label: "메트로놈 리듬 연습" },
    { id: "pc_default_5", label: "곡 연습" },
  ];

  let editingId = null;
  let pendingChecked = new Set();

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toDateStr(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function parseDateStr(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDateLabel(dateStr) {
    const d = parseDateStr(dateStr);
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdays[d.getDay()]})`;
  }

  function createId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ---------- Checklist template (recurring daily items) ----------
  function loadChecklist() {
    try {
      const raw = localStorage.getItem(CHECKLIST_KEY);
      return raw ? JSON.parse(raw) : DEFAULT_CHECKLIST;
    } catch {
      return DEFAULT_CHECKLIST;
    }
  }

  function saveChecklist(items) {
    localStorage.setItem(CHECKLIST_KEY, JSON.stringify(items));
  }

  const PracticeChecklistStore = {
    getAll() {
      return loadChecklist();
    },
    add(label) {
      const items = loadChecklist();
      const item = { id: createId("pc"), label };
      items.push(item);
      saveChecklist(items);
      return item;
    },
    remove(id) {
      saveChecklist(loadChecklist().filter((c) => c.id !== id));
    },
  };
  window.PracticeChecklistStore = PracticeChecklistStore;

  // ---------- Practice entries ----------
  function loadEntries() {
    try {
      const raw = localStorage.getItem(PRACTICE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveEntries(entries) {
    localStorage.setItem(PRACTICE_KEY, JSON.stringify(entries));
  }

  const PracticeStore = {
    getAll() {
      return loadEntries().sort((a, b) => (a.date < b.date ? 1 : -1));
    },
    getById(id) {
      return loadEntries().find((e) => e.id === id) || null;
    },
    add(entry) {
      const entries = loadEntries();
      const item = { id: createId("pr"), ...entry };
      entries.push(item);
      saveEntries(entries);
      return item;
    },
    update(id, patch) {
      const entries = loadEntries();
      const idx = entries.findIndex((e) => e.id === id);
      if (idx === -1) return null;
      entries[idx] = { ...entries[idx], ...patch };
      saveEntries(entries);
      return entries[idx];
    },
    remove(id) {
      saveEntries(loadEntries().filter((e) => e.id !== id));
    },
  };
  window.PracticeStore = PracticeStore;

  // ---------- Sheet music library ----------
  function loadSheets() {
    try {
      const raw = localStorage.getItem(SHEETS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveSheets(sheets) {
    localStorage.setItem(SHEETS_KEY, JSON.stringify(sheets));
  }

  const SheetStore = {
    getAll() {
      return loadSheets().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    getById(id) {
      return loadSheets().find((s) => s.id === id) || null;
    },
    add(sheet) {
      const sheets = loadSheets();
      const item = { id: createId("sh"), createdAt: new Date().toISOString(), ...sheet };
      sheets.push(item);
      saveSheets(sheets);
      return item;
    },
    remove(id) {
      saveSheets(loadSheets().filter((s) => s.id !== id));
    },
  };
  window.SheetStore = SheetStore;

  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, MAX_WIDTH / img.width);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.75));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleSheetUploadChange(e) {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      try {
        const isPdf = file.type === "application/pdf";
        const dataUrl = isPdf ? await readAsDataUrl(file) : await resizeImage(file);
        SheetStore.add({ name: file.name, dataUrl, isPdf });
      } catch {
        // skip files that fail to load
      }
    }
    e.target.value = "";
    renderSheetGrid();
  }

  function renderSheetGrid() {
    const grid = document.getElementById("practiceSheetGrid");
    const sheets = SheetStore.getAll();

    grid.innerHTML = "";
    if (sheets.length === 0) {
      grid.innerHTML = `<div class="empty-state"><span class="empty-icon">🎼</span><p>업로드된 악보가 없어요</p></div>`;
      return;
    }

    sheets.forEach((sheet) => {
      const cell = document.createElement("div");
      cell.className = "photo-cell";

      if (sheet.isPdf) {
        const badge = document.createElement("div");
        badge.className = "practice-sheet-file";
        badge.textContent = "📄";
        const name = document.createElement("span");
        name.textContent = sheet.name;
        badge.appendChild(name);
        cell.appendChild(badge);
      } else {
        const img = document.createElement("img");
        img.src = sheet.dataUrl;
        img.loading = "lazy";
        cell.appendChild(img);
      }

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "diary-thumb-remove";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        handleSheetDelete(sheet.id);
      });
      cell.appendChild(removeBtn);

      cell.addEventListener("click", () => window.open(sheet.dataUrl, "_blank", "noopener"));
      grid.appendChild(cell);
    });
  }

  function handleSheetDelete(id) {
    const removed = SheetStore.getById(id);
    SheetStore.remove(id);
    renderSheetGrid();
    if (removed && window.Toast) {
      window.Toast.show("악보를 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          SheetStore.add(removed);
          renderSheetGrid();
        },
      });
    }
  }

  // ---------- Checklist rendering (in modal) ----------
  function renderChecklistItems() {
    const list = document.getElementById("practiceChecklistItems");
    list.innerHTML = "";
    PracticeChecklistStore.getAll().forEach((item) => {
      const checked = pendingChecked.has(item.id);
      const li = document.createElement("li");
      li.className = "checklist-item" + (checked ? " done" : "");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = checked;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) pendingChecked.add(item.id);
        else pendingChecked.delete(item.id);
        renderChecklistItems();
      });
      li.appendChild(checkbox);

      const span = document.createElement("span");
      span.textContent = item.label;
      li.appendChild(span);

      const remove = document.createElement("span");
      remove.className = "checklist-item-remove";
      remove.textContent = "×";
      remove.title = "체크리스트에서 완전히 제거";
      remove.addEventListener("click", () => {
        PracticeChecklistStore.remove(item.id);
        pendingChecked.delete(item.id);
        renderChecklistItems();
      });
      li.appendChild(remove);

      list.appendChild(li);
    });
  }

  function handleAddChecklistItem() {
    const input = document.getElementById("practiceChecklistInput");
    const label = input.value.trim();
    if (!label) return;
    const item = PracticeChecklistStore.add(label);
    pendingChecked.add(item.id);
    input.value = "";
    renderChecklistItems();
  }

  // ---------- Feed ----------
  function renderCard(entry, onClick) {
    const card = document.createElement("div");
    card.className = "diary-card";

    const date = document.createElement("div");
    date.className = "diary-card-date";
    date.textContent = formatDateLabel(entry.date);
    card.appendChild(date);

    const template = PracticeChecklistStore.getAll();
    if (template.length > 0) {
      const checkedIds = new Set(entry.checkedIds || []);
      const doneLabels = template.filter((t) => checkedIds.has(t.id)).map((t) => t.label);
      const summary = document.createElement("p");
      summary.className = "practice-card-checklist";
      summary.textContent = `✓ ${doneLabels.length}/${template.length} 완료` +
        (doneLabels.length > 0 ? ` · ${doneLabels.join(", ")}` : "");
      card.appendChild(summary);
    }

    if (entry.text) {
      const text = document.createElement("p");
      text.className = "diary-card-text";
      text.textContent = entry.text;
      card.appendChild(text);
    }

    card.addEventListener("click", () => onClick(entry));
    return card;
  }

  function renderFeed() {
    const feed = document.getElementById("practiceFeed");
    const entries = PracticeStore.getAll();

    feed.innerHTML = "";
    if (entries.length === 0) {
      feed.innerHTML = `<div class="empty-state"><span class="empty-icon">🎸</span><p>아직 연습 기록이 없어요</p></div>`;
      return;
    }
    entries.forEach((entry) => feed.appendChild(renderCard(entry, (e) => openModal("edit", e))));
  }

  // ---------- Streak ----------
  function renderStreak() {
    const el = document.getElementById("practiceStreak");
    if (!el) return;
    const dateSet = new Set(loadEntries().map((e) => e.date));

    let streak = 0;
    const cursor = new Date();
    if (!dateSet.has(toDateStr(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (dateSet.has(toDateStr(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    if (streak > 0) {
      el.hidden = false;
      el.textContent = `🔥 ${streak}일 연속 연습 중`;
    } else {
      el.hidden = true;
    }
  }

  // ---------- Modal ----------
  function openModal(mode, data) {
    editingId = mode === "edit" ? data.id : null;
    pendingChecked = new Set(data?.checkedIds || []);

    document.getElementById("practiceModalTitle").textContent = mode === "edit" ? "연습 기록 수정" : "연습 기록";
    document.getElementById("practiceDateInput").value = data?.date || toDateStr(new Date());
    document.getElementById("practiceTextInput").value = data?.text || "";
    document.getElementById("deletePracticeBtn").hidden = mode !== "edit";

    renderChecklistItems();
    document.getElementById("practiceModalOverlay").hidden = false;
  }

  function closeModal() {
    document.getElementById("practiceModalOverlay").hidden = true;
    document.getElementById("practiceForm").reset();
    pendingChecked = new Set();
    editingId = null;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const payload = {
      date: document.getElementById("practiceDateInput").value,
      text: document.getElementById("practiceTextInput").value.trim(),
      checkedIds: [...pendingChecked],
    };
    if (!payload.date) return;

    if (editingId) {
      PracticeStore.update(editingId, payload);
    } else {
      PracticeStore.add(payload);
    }

    closeModal();
    renderFeed();
    renderStreak();
    window.Toast.show("연습 기록을 저장했어요");
  }

  function handleDelete() {
    if (!editingId) return;
    const removed = PracticeStore.getById(editingId);
    PracticeStore.remove(editingId);
    closeModal();
    renderFeed();
    renderStreak();
    if (removed && window.Toast) {
      window.Toast.show("연습 기록을 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          PracticeStore.add(removed);
          renderFeed();
          renderStreak();
        },
      });
    }
  }

  function toggleSection(contentEl, btn) {
    const collapsing = !contentEl.hidden;
    contentEl.hidden = collapsing;
    btn.textContent = collapsing ? "▸" : "▾";
    btn.setAttribute("aria-expanded", String(!collapsing));
  }

  function init() {
    document.getElementById("addPracticeBtn").addEventListener("click", () => openModal("add"));
    document.getElementById("practiceForm").addEventListener("submit", handleSubmit);
    document.getElementById("cancelPracticeBtn").addEventListener("click", closeModal);
    document.getElementById("deletePracticeBtn").addEventListener("click", handleDelete);

    document.getElementById("practiceChecklistAddBtn").addEventListener("click", handleAddChecklistItem);
    document.getElementById("practiceChecklistInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddChecklistItem();
      }
    });

    document.getElementById("addSheetBtn").addEventListener("click", () => {
      document.getElementById("practiceSheetUploadInput").click();
    });
    document.getElementById("practiceSheetUploadInput").addEventListener("change", handleSheetUploadChange);

    document.getElementById("toggleSheetsBtn").addEventListener("click", (e) => {
      toggleSection(document.getElementById("practiceSheetGrid"), e.currentTarget);
    });
    document.getElementById("toggleFeedBtn").addEventListener("click", (e) => {
      toggleSection(document.getElementById("practiceFeed"), e.currentTarget);
    });

    document.getElementById("practiceModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "practiceModalOverlay") closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.getElementById("practiceModalOverlay").hidden) closeModal();
    });

    renderFeed();
    renderStreak();
    renderSheetGrid();
  }

  window.PracticeView = { init };
})();
