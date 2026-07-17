(function () {
  const SUBJECTS_KEY = "assistant.studySubjects.v1";
  const CHECKLIST_KEY = "assistant.studyChecklist.v1";
  const EXAMS_KEY = "assistant.exams.v1";
  const DIARY_KEY = "assistant.studyDiary.v1";

  let editingId = null;
  let pendingChecked = new Set();
  let editingExamId = null;

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

  // ---------- Subjects ----------
  function loadSubjects() {
    try {
      const raw = localStorage.getItem(SUBJECTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveSubjects(subjects) {
    localStorage.setItem(SUBJECTS_KEY, JSON.stringify(subjects));
  }

  const StudySubjectStore = {
    getAll() {
      return loadSubjects();
    },
    getById(id) {
      return loadSubjects().find((s) => s.id === id) || null;
    },
    add(name) {
      const subjects = loadSubjects();
      const item = { id: createId("sub"), name };
      subjects.push(item);
      saveSubjects(subjects);
      return item;
    },
    remove(id) {
      saveSubjects(loadSubjects().filter((s) => s.id !== id));
      StudyChecklistStore.removeBySubject(id);
      ExamStore.clearSubject(id);
    },
  };
  window.StudySubjectStore = StudySubjectStore;

  // ---------- Checklist template (per subject, recurring) ----------
  function loadChecklist() {
    try {
      const raw = localStorage.getItem(CHECKLIST_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveChecklist(items) {
    localStorage.setItem(CHECKLIST_KEY, JSON.stringify(items));
  }

  const StudyChecklistStore = {
    getAll() {
      return loadChecklist();
    },
    getBySubject(subjectId) {
      return loadChecklist().filter((c) => c.subjectId === subjectId);
    },
    add(subjectId, label) {
      const items = loadChecklist();
      const item = { id: createId("sc"), subjectId, label };
      items.push(item);
      saveChecklist(items);
      return item;
    },
    remove(id) {
      saveChecklist(loadChecklist().filter((c) => c.id !== id));
    },
    removeBySubject(subjectId) {
      saveChecklist(loadChecklist().filter((c) => c.subjectId !== subjectId));
    },
  };
  window.StudyChecklistStore = StudyChecklistStore;

  // ---------- Exams / deadlines ----------
  function loadExams() {
    try {
      const raw = localStorage.getItem(EXAMS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveExams(exams) {
    localStorage.setItem(EXAMS_KEY, JSON.stringify(exams));
  }

  const ExamStore = {
    getAll() {
      return loadExams().sort((a, b) => (a.date < b.date ? -1 : 1));
    },
    getById(id) {
      return loadExams().find((e) => e.id === id) || null;
    },
    add(exam) {
      const exams = loadExams();
      const item = { id: createId("ex"), ...exam };
      exams.push(item);
      saveExams(exams);
      return item;
    },
    update(id, patch) {
      const exams = loadExams();
      const idx = exams.findIndex((e) => e.id === id);
      if (idx === -1) return null;
      exams[idx] = { ...exams[idx], ...patch };
      saveExams(exams);
      return exams[idx];
    },
    remove(id) {
      saveExams(loadExams().filter((e) => e.id !== id));
    },
    clearSubject(subjectId) {
      saveExams(loadExams().map((e) => (e.subjectId === subjectId ? { ...e, subjectId: "" } : e)));
    },
  };
  window.ExamStore = ExamStore;

  // ---------- Study diary entries ----------
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

  const StudyDiaryStore = {
    getAll() {
      return loadEntries().sort((a, b) => (a.date < b.date ? 1 : -1));
    },
    getById(id) {
      return loadEntries().find((e) => e.id === id) || null;
    },
    add(entry) {
      const entries = loadEntries();
      const item = { id: createId("sd"), ...entry };
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
  window.StudyDiaryStore = StudyDiaryStore;

  // ---------- Subject management UI ----------
  function renderSubjectList() {
    const list = document.getElementById("subjectList");
    const subjects = StudySubjectStore.getAll();
    list.innerHTML = "";
    if (subjects.length === 0) {
      list.innerHTML = `<li class="empty-state"><span class="empty-icon">📚</span><p>아직 등록된 과목이 없어요</p></li>`;
      return;
    }
    subjects.forEach((subject) => {
      const li = document.createElement("li");

      const name = document.createElement("span");
      name.textContent = subject.name;
      li.appendChild(name);

      const remove = document.createElement("span");
      remove.className = "remove";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        StudySubjectStore.remove(subject.id);
        renderSubjectList();
        renderExamList();
        renderStudyFeed();
      });
      li.appendChild(remove);

      list.appendChild(li);
    });
  }

  function handleAddSubject(e) {
    e.preventDefault();
    const input = document.getElementById("subjectNameInput");
    const name = input.value.trim();
    if (!name) return;
    StudySubjectStore.add(name);
    input.value = "";
    renderSubjectList();
  }

  // ---------- Exam list ----------
  function computeDday(dateStr) {
    const target = parseDateStr(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((target - today) / 86400000);
    if (diffDays === 0) return { label: "D-DAY", diffDays };
    if (diffDays > 0) return { label: `D-${diffDays}`, diffDays };
    return { label: `D+${Math.abs(diffDays)}`, diffDays };
  }

  function renderExamList() {
    const list = document.getElementById("examList");
    const exams = ExamStore.getAll();
    list.innerHTML = "";
    if (exams.length === 0) {
      list.innerHTML = `<div class="empty-state"><span class="empty-icon">📅</span><p>등록된 시험·마감이 없어요</p></div>`;
      return;
    }
    exams.forEach((exam) => {
      const { label, diffDays } = computeDday(exam.date);
      const item = document.createElement("div");
      item.className = "exam-item";
      if (diffDays < 0) item.classList.add("past");
      if (diffDays >= 0 && diffDays <= 3) item.classList.add("urgent");

      const badge = document.createElement("span");
      badge.className = "exam-dday-badge";
      badge.textContent = label;
      item.appendChild(badge);

      const title = document.createElement("span");
      title.className = "exam-item-title";
      title.textContent = exam.title;
      item.appendChild(title);

      const subject = exam.subjectId ? StudySubjectStore.getById(exam.subjectId) : null;
      const meta = document.createElement("span");
      meta.className = "exam-item-meta";
      meta.textContent = `${exam.date}${subject ? ` · ${subject.name}` : ""}`;
      item.appendChild(meta);

      item.addEventListener("click", () => openExamModal("edit", exam));
      list.appendChild(item);
    });
  }

  function populateSubjectSelect(select, includeBlank, selectedId) {
    select.innerHTML = "";
    if (includeBlank) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "선택 안 함";
      select.appendChild(opt);
    }
    StudySubjectStore.getAll().forEach((subject) => {
      const opt = document.createElement("option");
      opt.value = subject.id;
      opt.textContent = subject.name;
      select.appendChild(opt);
    });
    select.value = selectedId || "";
  }

  function openExamModal(mode, data) {
    editingExamId = mode === "edit" ? data.id : null;
    document.getElementById("examModalTitle").textContent = mode === "edit" ? "시험 · 마감 수정" : "시험 · 마감 추가";
    document.getElementById("examNameInput").value = data?.title || "";
    document.getElementById("examDateInput").value = data?.date || toDateStr(new Date());
    populateSubjectSelect(document.getElementById("examSubjectInput"), true, data?.subjectId);
    document.getElementById("deleteExamBtn").hidden = mode !== "edit";
    document.getElementById("examModalOverlay").hidden = false;
  }

  function closeExamModal() {
    document.getElementById("examModalOverlay").hidden = true;
    document.getElementById("examForm").reset();
    editingExamId = null;
  }

  function handleExamSubmit(e) {
    e.preventDefault();
    const payload = {
      title: document.getElementById("examNameInput").value.trim(),
      date: document.getElementById("examDateInput").value,
      subjectId: document.getElementById("examSubjectInput").value,
    };
    if (!payload.title || !payload.date) return;

    if (editingExamId) {
      ExamStore.update(editingExamId, payload);
    } else {
      ExamStore.add(payload);
    }
    closeExamModal();
    renderExamList();
    window.Toast.show("시험·마감 일정을 저장했어요");
  }

  function handleExamDelete() {
    if (!editingExamId) return;
    const removed = ExamStore.getById(editingExamId);
    ExamStore.remove(editingExamId);
    closeExamModal();
    renderExamList();
    if (removed && window.Toast) {
      window.Toast.show("시험·마감 일정을 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          ExamStore.add(removed);
          renderExamList();
        },
      });
    }
  }

  // ---------- Study checklist rendering (in entry modal) ----------
  function renderStudyChecklistItems() {
    const list = document.getElementById("studyChecklistItems");
    const addRow = document.querySelector("#studyForm .checklist-add-row");
    const note = document.getElementById("studyNoSubjectNote");
    const subjects = StudySubjectStore.getAll();

    list.innerHTML = "";
    if (subjects.length === 0) {
      addRow.hidden = true;
      note.hidden = false;
      return;
    }
    addRow.hidden = false;
    note.hidden = true;

    subjects.forEach((subject) => {
      const items = StudyChecklistStore.getBySubject(subject.id);
      if (items.length === 0) return;

      const groupLabel = document.createElement("li");
      groupLabel.className = "checklist-group-label";
      groupLabel.textContent = subject.name;
      list.appendChild(groupLabel);

      items.forEach((item) => {
        const checked = pendingChecked.has(item.id);
        const li = document.createElement("li");
        li.className = "checklist-item" + (checked ? " done" : "");

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = checked;
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) pendingChecked.add(item.id);
          else pendingChecked.delete(item.id);
          renderStudyChecklistItems();
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
          StudyChecklistStore.remove(item.id);
          pendingChecked.delete(item.id);
          renderStudyChecklistItems();
        });
        li.appendChild(remove);

        list.appendChild(li);
      });
    });
  }

  function handleAddStudyChecklistItem() {
    const subjectId = document.getElementById("studyChecklistSubjectInput").value;
    const input = document.getElementById("studyChecklistInput");
    const label = input.value.trim();
    if (!subjectId || !label) return;
    const item = StudyChecklistStore.add(subjectId, label);
    pendingChecked.add(item.id);
    input.value = "";
    renderStudyChecklistItems();
  }

  // ---------- Study diary feed ----------
  function renderCard(entry, onClick) {
    const card = document.createElement("div");
    card.className = "diary-card";

    const date = document.createElement("div");
    date.className = "diary-card-date";
    date.textContent = formatDateLabel(entry.date);
    card.appendChild(date);

    const template = StudyChecklistStore.getAll();
    if (template.length > 0) {
      const checkedIds = new Set(entry.checkedIds || []);
      const doneLabels = template
        .filter((t) => checkedIds.has(t.id))
        .map((t) => {
          const subject = StudySubjectStore.getById(t.subjectId);
          return subject ? `${subject.name}: ${t.label}` : t.label;
        });
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

  function renderStudyFeed() {
    const feed = document.getElementById("studyFeed");
    const entries = StudyDiaryStore.getAll();

    feed.innerHTML = "";
    if (entries.length === 0) {
      feed.innerHTML = `<div class="empty-state"><span class="empty-icon">📖</span><p>아직 공부 기록이 없어요</p></div>`;
      return;
    }
    entries.forEach((entry) => feed.appendChild(renderCard(entry, (e) => openStudyModal("edit", e))));
  }

  // ---------- Streak ----------
  function renderStreak() {
    const el = document.getElementById("studyStreak");
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
      el.textContent = `🔥 ${streak}일 연속 공부 중`;
    } else {
      el.hidden = true;
    }
  }

  // ---------- Study entry modal ----------
  function openStudyModal(mode, data) {
    editingId = mode === "edit" ? data.id : null;
    pendingChecked = new Set(data?.checkedIds || []);

    document.getElementById("studyModalTitle").textContent = mode === "edit" ? "공부 기록 수정" : "공부 기록";
    document.getElementById("studyDateInput").value = data?.date || toDateStr(new Date());
    document.getElementById("studyTextInput").value = data?.text || "";
    document.getElementById("deleteStudyBtn").hidden = mode !== "edit";

    populateSubjectSelect(document.getElementById("studyChecklistSubjectInput"), false);
    renderStudyChecklistItems();
    document.getElementById("studyModalOverlay").hidden = false;
  }

  function closeStudyModal() {
    document.getElementById("studyModalOverlay").hidden = true;
    document.getElementById("studyForm").reset();
    pendingChecked = new Set();
    editingId = null;
  }

  function handleStudySubmit(e) {
    e.preventDefault();
    const payload = {
      date: document.getElementById("studyDateInput").value,
      text: document.getElementById("studyTextInput").value.trim(),
      checkedIds: [...pendingChecked],
    };
    if (!payload.date) return;

    if (editingId) {
      StudyDiaryStore.update(editingId, payload);
    } else {
      StudyDiaryStore.add(payload);
    }

    closeStudyModal();
    renderStudyFeed();
    renderStreak();
    window.Toast.show("공부 기록을 저장했어요");
  }

  function handleStudyDelete() {
    if (!editingId) return;
    const removed = StudyDiaryStore.getById(editingId);
    StudyDiaryStore.remove(editingId);
    closeStudyModal();
    renderStudyFeed();
    renderStreak();
    if (removed && window.Toast) {
      window.Toast.show("공부 기록을 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          StudyDiaryStore.add(removed);
          renderStudyFeed();
          renderStreak();
        },
      });
    }
  }

  // ---------- Collapsible sections ----------
  function toggleSection(contentEl, btn) {
    const collapsing = !contentEl.hidden;
    contentEl.hidden = collapsing;
    btn.textContent = collapsing ? "▸" : "▾";
    btn.setAttribute("aria-expanded", String(!collapsing));
  }

  function init() {
    document.getElementById("addStudyBtn").addEventListener("click", () => openStudyModal("add"));
    document.getElementById("studyForm").addEventListener("submit", handleStudySubmit);
    document.getElementById("cancelStudyBtn").addEventListener("click", closeStudyModal);
    document.getElementById("deleteStudyBtn").addEventListener("click", handleStudyDelete);
    document.getElementById("studyChecklistAddBtn").addEventListener("click", handleAddStudyChecklistItem);
    document.getElementById("studyChecklistInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddStudyChecklistItem();
      }
    });
    document.getElementById("studyModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "studyModalOverlay") closeStudyModal();
    });

    document.getElementById("addExamBtn").addEventListener("click", () => openExamModal("add"));
    document.getElementById("examForm").addEventListener("submit", handleExamSubmit);
    document.getElementById("cancelExamBtn").addEventListener("click", closeExamModal);
    document.getElementById("deleteExamBtn").addEventListener("click", handleExamDelete);
    document.getElementById("examModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "examModalOverlay") closeExamModal();
    });

    document.getElementById("subjectForm").addEventListener("submit", handleAddSubject);

    document.getElementById("toggleExamsBtn").addEventListener("click", (e) => {
      toggleSection(document.getElementById("examList"), e.currentTarget);
    });
    document.getElementById("toggleSubjectsBtn").addEventListener("click", (e) => {
      toggleSection(document.getElementById("subjectManageSection"), e.currentTarget);
    });
    document.getElementById("toggleStudyFeedBtn").addEventListener("click", (e) => {
      toggleSection(document.getElementById("studyFeed"), e.currentTarget);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!document.getElementById("studyModalOverlay").hidden) closeStudyModal();
        if (!document.getElementById("examModalOverlay").hidden) closeExamModal();
      }
    });

    renderSubjectList();
    renderExamList();
    renderStudyFeed();
    renderStreak();
  }

  window.StudyView = { init };
})();
