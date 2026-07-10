(function () {
  const NOTES_KEY = "assistant.notes.v1";
  let editingId = null;

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
      const item = { id: createId(), pinned: false, createdAt: now, updatedAt: now, ...note };
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

    li.addEventListener("click", () => onClick(note));
    return li;
  }

  function renderList(containerId, limit) {
    const list = document.getElementById(containerId);
    if (!list) return;
    let notes = NotesStore.getAll();
    if (limit) notes = notes.slice(0, limit);

    list.innerHTML = "";
    if (notes.length === 0) {
      list.innerHTML = `<li class="schedule-empty">메모가 없어요</li>`;
      return;
    }
    notes.forEach((note) => list.appendChild(renderNoteItem(note, (n) => openModal("edit", n))));
  }

  function renderAll() {
    renderList("dashboardNotesList", 5);
    renderList("notesFullList", null);
    const weekEl = document.getElementById("statWeekNotesCount");
    if (weekEl) weekEl.textContent = NotesStore.countThisWeek();
  }

  function openModal(mode, data) {
    editingId = mode === "edit" ? data.id : null;
    document.getElementById("noteModalTitle").textContent = mode === "edit" ? "메모 수정" : "메모 추가";
    document.getElementById("noteTextInput").value = data?.text || "";
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

  function handleSubmit(e) {
    e.preventDefault();
    const payload = {
      text: document.getElementById("noteTextInput").value.trim(),
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

  function init() {
    document.getElementById("dashboardAddNoteBtn").addEventListener("click", () => openModal("add"));
    document.getElementById("addNoteBtn").addEventListener("click", () => openModal("add"));
    document.getElementById("noteForm").addEventListener("submit", handleSubmit);
    document.getElementById("cancelNoteBtn").addEventListener("click", closeModal);
    document.getElementById("deleteNoteBtn").addEventListener("click", handleDelete);

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
