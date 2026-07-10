(function () {
  const DIARY_KEY = "assistant.diary.v1";
  const MAX_PHOTOS = 4;
  const MAX_WIDTH = 900;

  let editingId = null;
  let pendingPhotos = [];
  const filterState = { text: "", from: "", to: "" };

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

  function loadEntries() {
    try {
      const raw = localStorage.getItem(DIARY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveEntries(entries) {
    localStorage.setItem(DIARY_KEY, JSON.stringify(entries));
  }

  function createId() {
    return `dy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  const DiaryStore = {
    getAll() {
      return loadEntries().sort((a, b) => (a.date < b.date ? 1 : -1));
    },
    getById(id) {
      return loadEntries().find((e) => e.id === id) || null;
    },
    add(entry) {
      const entries = loadEntries();
      const item = { id: createId(), ...entry };
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
  window.DiaryStore = DiaryStore;

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
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function renderPhotoPreview() {
    const wrap = document.getElementById("diaryPhotoPreview");
    wrap.innerHTML = "";
    pendingPhotos.forEach((src, idx) => {
      const thumb = document.createElement("div");
      thumb.className = "diary-thumb";

      const img = document.createElement("img");
      img.src = src;
      thumb.appendChild(img);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "diary-thumb-remove";
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", () => {
        pendingPhotos.splice(idx, 1);
        renderPhotoPreview();
      });
      thumb.appendChild(removeBtn);

      wrap.appendChild(thumb);
    });
  }

  async function handlePhotoInputChange(e) {
    const files = Array.from(e.target.files || []);
    const room = MAX_PHOTOS - pendingPhotos.length;
    const toProcess = files.slice(0, room);
    for (const file of toProcess) {
      try {
        const dataUrl = await resizeImage(file);
        pendingPhotos.push(dataUrl);
      } catch {
        // skip files that fail to load
      }
    }
    renderPhotoPreview();
    e.target.value = "";
  }

  function renderDiaryCard(entry, onClick) {
    const card = document.createElement("div");
    card.className = "diary-card";

    const date = document.createElement("div");
    date.className = "diary-card-date";
    date.textContent = formatDateLabel(entry.date);
    card.appendChild(date);

    if (entry.text) {
      const text = document.createElement("p");
      text.className = "diary-card-text";
      text.textContent = entry.text;
      card.appendChild(text);
    }

    if (entry.photos && entry.photos.length > 0) {
      const photos = document.createElement("div");
      photos.className = "diary-card-photos";
      entry.photos.forEach((src) => {
        const img = document.createElement("img");
        img.src = src;
        photos.appendChild(img);
      });
      card.appendChild(photos);
    }

    card.addEventListener("click", () => onClick(entry));
    return card;
  }

  function applyFilters(entries) {
    return entries.filter((entry) => {
      if (filterState.text && !(entry.text || "").toLowerCase().includes(filterState.text.toLowerCase())) {
        return false;
      }
      if (filterState.from && entry.date < filterState.from) return false;
      if (filterState.to && entry.date > filterState.to) return false;
      return true;
    });
  }

  function renderFeed() {
    const feed = document.getElementById("diaryFeed");
    const entries = applyFilters(DiaryStore.getAll());

    feed.innerHTML = "";
    if (entries.length === 0) {
      const message = filterState.text || filterState.from || filterState.to
        ? "조건에 맞는 일기가 없어요"
        : "아직 작성된 일기가 없어요";
      feed.innerHTML = `<div class="empty-state"><span class="empty-icon">▣</span><p>${message}</p></div>`;
      return;
    }
    entries.forEach((entry) => feed.appendChild(renderDiaryCard(entry, (e) => openModal("edit", e))));
  }

  function openModal(mode, data) {
    editingId = mode === "edit" ? data.id : null;
    pendingPhotos = data?.photos ? [...data.photos] : [];
    document.getElementById("diaryModalTitle").textContent = mode === "edit" ? "일기 수정" : "일기 쓰기";
    document.getElementById("diaryDateInput").value = data?.date || toDateStr(new Date());
    document.getElementById("diaryTextInput").value = data?.text || "";
    document.getElementById("deleteDiaryBtn").hidden = mode !== "edit";
    renderPhotoPreview();
    document.getElementById("diaryModalOverlay").hidden = false;
  }

  function closeModal() {
    document.getElementById("diaryModalOverlay").hidden = true;
    document.getElementById("diaryForm").reset();
    pendingPhotos = [];
    renderPhotoPreview();
    editingId = null;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const payload = {
      date: document.getElementById("diaryDateInput").value,
      text: document.getElementById("diaryTextInput").value.trim(),
      photos: [...pendingPhotos],
    };
    if (!payload.date) return;

    if (editingId) {
      DiaryStore.update(editingId, payload);
    } else {
      DiaryStore.add(payload);
    }

    closeModal();
    renderFeed();
  }

  function handleDelete() {
    if (!editingId) return;
    const removed = DiaryStore.getById(editingId);
    DiaryStore.remove(editingId);
    closeModal();
    renderFeed();
    if (removed && window.Toast) {
      window.Toast.show("일기를 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          DiaryStore.add(removed);
          renderFeed();
        },
      });
    }
  }

  function handleFilterChange() {
    filterState.text = document.getElementById("diarySearchInput").value;
    filterState.from = document.getElementById("diaryFilterFrom").value;
    filterState.to = document.getElementById("diaryFilterTo").value;
    renderFeed();
  }

  function resetFilters() {
    document.getElementById("diarySearchInput").value = "";
    document.getElementById("diaryFilterFrom").value = "";
    document.getElementById("diaryFilterTo").value = "";
    filterState.text = "";
    filterState.from = "";
    filterState.to = "";
    renderFeed();
  }

  function init() {
    document.getElementById("addDiaryBtn").addEventListener("click", () => openModal("add"));
    document.getElementById("diaryForm").addEventListener("submit", handleSubmit);
    document.getElementById("cancelDiaryBtn").addEventListener("click", closeModal);
    document.getElementById("deleteDiaryBtn").addEventListener("click", handleDelete);
    document.getElementById("diaryPhotoInput").addEventListener("change", handlePhotoInputChange);

    document.getElementById("diarySearchInput").addEventListener("input", handleFilterChange);
    document.getElementById("diaryFilterFrom").addEventListener("change", handleFilterChange);
    document.getElementById("diaryFilterTo").addEventListener("change", handleFilterChange);
    document.getElementById("diaryFilterResetBtn").addEventListener("click", resetFilters);

    document.getElementById("diaryModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "diaryModalOverlay") closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.getElementById("diaryModalOverlay").hidden) closeModal();
    });

    renderFeed();
  }

  window.DiaryView = { init };
})();
