(function () {
  const PHOTOS_KEY = "assistant.photos.v1";
  const MAX_WIDTH = 1000;

  let editingId = null;
  let activeTag = null;
  let sortOrder = "newest";
  let selectMode = false;
  let selectedIds = new Set();

  function loadPhotos() {
    try {
      const raw = localStorage.getItem(PHOTOS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function savePhotos(photos) {
    localStorage.setItem(PHOTOS_KEY, JSON.stringify(photos));
  }

  function createId() {
    return `ph_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  const PhotoStore = {
    getAll(order) {
      const sorted = loadPhotos().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return order === "oldest" ? sorted.reverse() : sorted;
    },
    getById(id) {
      return loadPhotos().find((p) => p.id === id) || null;
    },
    add(photo) {
      const photos = loadPhotos();
      const item = { id: createId(), createdAt: new Date().toISOString(), tags: [], ...photo };
      photos.push(item);
      savePhotos(photos);
      return item;
    },
    update(id, patch) {
      const photos = loadPhotos();
      const idx = photos.findIndex((p) => p.id === id);
      if (idx === -1) return null;
      photos[idx] = { ...photos[idx], ...patch };
      savePhotos(photos);
      return photos[idx];
    },
    remove(id) {
      savePhotos(loadPhotos().filter((p) => p.id !== id));
    },
    removeMany(ids) {
      const idSet = new Set(ids);
      savePhotos(loadPhotos().filter((p) => !idSet.has(p.id)));
    },
  };
  window.PhotoStore = PhotoStore;

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

  function parseTagsInput(value) {
    return value
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  function getAllTags() {
    const tagSet = new Set();
    PhotoStore.getAll().forEach((p) => (p.tags || []).forEach((t) => tagSet.add(t)));
    return [...tagSet].sort();
  }

  function renderTagFilterBar() {
    const bar = document.getElementById("photoTagFilterBar");
    const tags = getAllTags();
    bar.innerHTML = "";

    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "tag-chip" + (activeTag === null ? " active" : "");
    allChip.textContent = "전체";
    allChip.addEventListener("click", () => {
      activeTag = null;
      renderTagFilterBar();
      renderGrid();
    });
    bar.appendChild(allChip);

    tags.forEach((tag) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-chip" + (activeTag === tag ? " active" : "");
      chip.textContent = tag;
      chip.addEventListener("click", () => {
        activeTag = tag;
        renderTagFilterBar();
        renderGrid();
      });
      bar.appendChild(chip);
    });
  }

  function updateSelectToolbar() {
    const toolbar = document.getElementById("photoSelectToolbar");
    const countEl = document.getElementById("photoSelectCount");
    if (!toolbar) return;
    toolbar.hidden = !selectMode;
    if (countEl) countEl.textContent = `${selectedIds.size}장 선택됨`;
  }

  function renderGrid() {
    const grid = document.getElementById("photoGrid");
    let photos = PhotoStore.getAll(sortOrder);
    if (activeTag) {
      photos = photos.filter((p) => (p.tags || []).includes(activeTag));
    }

    grid.innerHTML = "";
    if (photos.length === 0) {
      grid.innerHTML = `<div class="empty-state"><span class="empty-icon">🖼</span><p>사진이 없어요</p></div>`;
      updateSelectToolbar();
      return;
    }

    photos.forEach((photo) => {
      const cell = document.createElement("div");
      cell.className = "photo-cell";
      if (selectMode && selectedIds.has(photo.id)) cell.classList.add("selected");

      const img = document.createElement("img");
      img.src = photo.dataUrl;
      img.loading = "lazy";
      cell.appendChild(img);

      if (photo.tags && photo.tags.length > 0) {
        const tagOverlay = document.createElement("span");
        tagOverlay.className = "photo-cell-tag";
        tagOverlay.textContent = photo.tags[0] + (photo.tags.length > 1 ? ` +${photo.tags.length - 1}` : "");
        cell.appendChild(tagOverlay);
      }

      if (selectMode) {
        const check = document.createElement("span");
        check.className = "photo-cell-check";
        check.textContent = selectedIds.has(photo.id) ? "✓" : "";
        cell.appendChild(check);
      }

      cell.addEventListener("click", () => {
        if (selectMode) {
          if (selectedIds.has(photo.id)) selectedIds.delete(photo.id);
          else selectedIds.add(photo.id);
          updateSelectToolbar();
          renderGrid();
        } else {
          openModal(photo);
        }
      });
      grid.appendChild(cell);
    });

    updateSelectToolbar();
  }

  function openModal(photo) {
    editingId = photo.id;
    document.getElementById("photoModalImage").src = photo.dataUrl;
    document.getElementById("photoTagsInput").value = (photo.tags || []).join(", ");
    document.getElementById("photoModalOverlay").hidden = false;
  }

  function closeModal() {
    document.getElementById("photoModalOverlay").hidden = true;
    document.getElementById("photoForm").reset();
    editingId = null;
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!editingId) return;
    const tags = parseTagsInput(document.getElementById("photoTagsInput").value);
    PhotoStore.update(editingId, { tags });
    closeModal();
    renderTagFilterBar();
    renderGrid();
  }

  function handleDelete() {
    if (!editingId) return;
    const removed = PhotoStore.getById(editingId);
    PhotoStore.remove(editingId);
    closeModal();
    renderTagFilterBar();
    renderGrid();
    if (removed && window.Toast) {
      window.Toast.show("사진을 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          PhotoStore.add(removed);
          renderTagFilterBar();
          renderGrid();
        },
      });
    }
  }

  function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    const removedPhotos = ids.map((id) => PhotoStore.getById(id)).filter(Boolean);
    PhotoStore.removeMany(ids);
    const count = removedPhotos.length;
    selectedIds.clear();
    selectMode = false;
    renderTagFilterBar();
    renderGrid();
    if (window.Toast) {
      window.Toast.show(`사진 ${count}장을 삭제했어요`, {
        actionLabel: "실행취소",
        onAction: () => {
          removedPhotos.forEach((p) => PhotoStore.add(p));
          renderTagFilterBar();
          renderGrid();
        },
      });
    }
  }

  async function handleUploadChange(e) {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      try {
        const dataUrl = await resizeImage(file);
        PhotoStore.add({ dataUrl });
      } catch {
        // skip files that fail to load
      }
    }
    e.target.value = "";
    renderTagFilterBar();
    renderGrid();
  }

  function toggleSelectMode() {
    selectMode = !selectMode;
    selectedIds.clear();
    const btn = document.getElementById("photoSelectModeBtn");
    if (btn) btn.textContent = selectMode ? "선택 취소" : "선택";
    renderGrid();
  }

  function init() {
    document.getElementById("addPhotoBtn").addEventListener("click", () => {
      document.getElementById("photoUploadInput").click();
    });
    document.getElementById("photoUploadInput").addEventListener("change", handleUploadChange);

    document.getElementById("photoForm").addEventListener("submit", handleSubmit);
    document.getElementById("cancelPhotoBtn").addEventListener("click", closeModal);
    document.getElementById("deletePhotoBtn").addEventListener("click", handleDelete);

    document.getElementById("photoModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "photoModalOverlay") closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.getElementById("photoModalOverlay").hidden) closeModal();
    });

    document.getElementById("photoSortSelect").addEventListener("change", (e) => {
      sortOrder = e.target.value;
      renderGrid();
    });

    document.getElementById("photoSelectModeBtn").addEventListener("click", toggleSelectMode);
    document.getElementById("photoDeleteSelectedBtn").addEventListener("click", handleDeleteSelected);

    renderTagFilterBar();
    renderGrid();
  }

  window.PhotoLibraryView = { init };
})();
