(function () {
  const NOTES_KEY = "assistant.notes.v1";
  let editingId = null;
  let searchText = "";
  let tagFilter = null;

  function loadNotes() {
    try {
      const raw = localStorage.getItem(NOTES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveNotes(notes) {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  }

  function createId() {
    return `nt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function sortNotes(notes) {
    return [...notes].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || b.createdAt) < (a.updatedAt || a.createdAt) ? -1 : 1;
    });
  }

  const NotesStore = {
    getAll() {
      return sortNotes(loadNotes());
    },
    getById(id) {
      return loadNotes().find((n) => n.id === id) || null;
    },
    getAllTags() {
      const tags = new Set();
      loadNotes().forEach((n) => (n.tags || []).forEach((t) => tags.add(t)));
      return [...tags].sort();
    },
    countThisWeek() {
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      return loadNotes().filter((n) => new Date(n.createdAt) >= startOfWeek).length;
    },
    add(note) {
      const notes = loadNotes();
      const now = new Date().toISOString();
      const item = { id: createId(), pinned: false, tags: [], createdAt: now, updatedAt: now, ...note };
      notes.push(item);
      saveNotes(notes);
      return item;
    },
    update(id, patch) {
      const notes = loadNotes();
      const idx = notes.findIndex((n) => n.id === id);
      if (idx === -1) return null;
      notes[idx] = { ...notes[idx], ...patch, updatedAt: new Date().toISOString() };
      saveNotes(notes);
      return notes[idx];
    },
    remove(id) {
      saveNotes(loadNotes().filter((n) => n.id !== id));
    },
  };
  window.NotesStore = NotesStore;

  function renderNoteItem(note, onClick) {
    const li = document.createElement("li");
    li.className = "note-item";
    if (note.pinned) li.classList.add("pinned");

    if (note.pinned) {
      const pin = document.createElement("span");
      pin.className = "note-item-pin";
      pin.textContent = "📌";
      li.appendChild(pin);
    }

    const text = document.createElement("p");
    text.className = "note-item-text";
    text.textContent = note.text;
    li.appendChild(text);

    if (note.tags && note.tags.length > 0) {
      const tagRow = document.createElement("div");
      tagRow.className = "note-item-tags";
      note.tags.forEach((t) => {
        const tag = document.createElement("span");
        tag.className = "note-item-tag";
        tag.textContent = t;
        tagRow.appendChild(tag);
      });
      li.appendChild(tagRow);
    }

    li.addEventListener("click", () => onClick(note));
    return li;
  }

  function applyNoteFilters(notes) {
    let result = notes;
    if (searchText) {
      const q = searchText.toLowerCase();
      result = result.filter((n) => n.text.toLowerCase().includes(q));
    }
    if (tagFilter) {
      result = result.filter((n) => (n.tags || []).includes(tagFilter));
    }
    return result;
  }

  function renderList(containerId, limit) {
    const list = document.getElementById(containerId);
    if (!list) return;
    let notes = NotesStore.getAll();
    if (containerId === "notesFullList") notes = applyNoteFilters(notes);
    if (limit) notes = notes.slice(0, limit);

    list.innerHTML = "";
    if (notes.length === 0) {
      list.innerHTML = `<li class="schedule-empty">메모가 없어요</li>`;
      return;
    }
    notes.forEach((note) => list.appendChild(renderNoteItem(note, (n) => openModal("edit", n))));
  }

  function renderTagFilterBar() {
    const bar = document.getElementById("noteTagFilterBar");
    if (!bar) return;
    const tags = NotesStore.getAllTags();
    bar.innerHTML = "";
    if (tags.length === 0) return;

    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "schedule-filter-chip" + (!tagFilter ? " active" : "");
    allChip.textContent = "전체";
    allChip.addEventListener("click", () => {
      tagFilter = null;
      renderTagFilterBar();
      renderList("notesFullList", null);
    });
    bar.appendChild(allChip);

    tags.forEach((tag) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "schedule-filter-chip" + (tagFilter === tag ? " active" : "");
      chip.textContent = tag;
      chip.addEventListener("click", () => {
        tagFilter = tagFilter === tag ? null : tag;
        renderTagFilterBar();
        renderList("notesFullList", null);
      });
      bar.appendChild(chip);
    });
  }

  function renderAll() {
    renderList("dashboardNotesList", 5);
    renderList("notesFullList", null);
    renderTagFilterBar();
    const weekEl = document.getElementById("statWeekNotesCount");
    if (weekEl) weekEl.textContent = NotesStore.countThisWeek();
  }

  function openModal(mode, data) {
    editingId = mode === "edit" ? data.id : null;
    document.getElementById("noteModalTitle").textContent = mode === "edit" ? "메모 수정" : "메모 추가";
    document.getElementById("noteTextInput").value = data?.text || "";
    document.getElementById("noteTagsInput").value = (data?.tags || []).join(", ");
    document.getElementById("notePinnedInput").checked = !!data?.pinned;
    document.getElementById("deleteNoteBtn").hidden = mode !== "edit";
    document.getElementById("noteModalOverlay").hidden = false;
    document.getElementById("noteTextInput").focus();
  }

  function closeModal() {
    document.getElementById("noteModalOverlay").hidden = true;
    document.getElementById("noteForm").reset();
    editingId = null;
  }

  function readTags() {
    return document
      .getElementById("noteTagsInput")
      .value.split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  function handleSubmit(e) {
    e.preventDefault();
    const payload = {
      text: document.getElementById("noteTextInput").value.trim(),
      tags: readTags(),
      pinned: document.getElementById("notePinnedInput").checked,
    };
    if (!payload.text) return;

    if (editingId) {
      NotesStore.update(editingId, payload);
    } else {
      NotesStore.add(payload);
    }
    closeModal();
    renderAll();
    window.Toast.show("메모를 저장했어요");
  }

  function handleDelete() {
    if (!editingId) return;
    const removed = NotesStore.getById(editingId);
    NotesStore.remove(editingId);
    closeModal();
    renderAll();
    if (removed && window.Toast) {
      window.Toast.show("메모를 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          NotesStore.add(removed);
          renderAll();
        },
      });
    }
  }

  function handleConvertToSchedule() {
    const text = document.getElementById("noteTextInput").value.trim();
    if (!text) {
      window.Toast.show("변환하려면 메모 내용을 먼저 입력하세요");
      return;
    }
    const firstLine = text.split("\n")[0].slice(0, 60);
    const pad2 = (n) => String(n).padStart(2, "0");
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;

    window.ScheduleStore.add({
      title: firstLine,
      date: dateStr,
      startTime: "",
      endTime: "",
      memo: text,
      location: "",
      url: "",
      category: "etc",
      importance: 3,
      favorite: false,
      repeat: { type: "none", until: null },
      reminderMinutes: null,
      checklist: [],
    });

    closeModal();
    renderAll();
    window.Toast.show(`"${firstLine}"를 오늘 일정으로 추가했어요`);
  }

  function init() {
    document.getElementById("dashboardAddNoteBtn").addEventListener("click", () => openModal("add"));
    document.getElementById("addNoteBtn").addEventListener("click", () => openModal("add"));
    document.getElementById("noteForm").addEventListener("submit", handleSubmit);
    document.getElementById("cancelNoteBtn").addEventListener("click", closeModal);
    document.getElementById("deleteNoteBtn").addEventListener("click", handleDelete);
    document.getElementById("convertNoteToScheduleBtn").addEventListener("click", handleConvertToSchedule);

    document.getElementById("noteSearchInput").addEventListener("input", (e) => {
      searchText = e.target.value.trim();
      renderList("notesFullList", null);
    });

    document.getElementById("noteModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "noteModalOverlay") closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.getElementById("noteModalOverlay").hidden) closeModal();
    });

    renderAll();
  }

  window.NotesView = { init, refresh: renderAll };
})();
