(function () {
  let viewDate = new Date();
  let selectedDate = new Date();
  let editingId = null;

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const REMINDER_PRESETS = ["10", "30", "60", "1440"];
  const DEFAULT_IMPORTANCE = 3;
  const HIDE_COMPLETED_KEY = "assistant.hideCompleted.v1";
  const CATEGORY_COLORS = {
    work: "#60a5fa",
    personal: "#a78bfa",
    health: "#f87171",
    study: "#4ade80",
    etc: "#94a3b8",
  };

  let hideCompleted = localStorage.getItem(HIDE_COMPLETED_KEY) === "true";

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

  function buildMonthGrid(year, month) {
    const firstOfMonth = new Date(year, month, 1);
    const start = new Date(year, month, 1 - firstOfMonth.getDay());
    const days = [];
    for (let i = 0; i < 42; i++) {
      days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }
    return days;
  }

  function formatDayLabel(d) {
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  }

  function buildImportanceStars(importance) {
    const value = importance || DEFAULT_IMPORTANCE;
    const wrap = document.createElement("span");
    wrap.className = "schedule-item-stars";
    for (let i = 1; i <= 5; i++) {
      const star = document.createElement("span");
      star.className = i <= value ? "star-filled" : "star-empty";
      star.textContent = "★";
      wrap.appendChild(star);
    }
    return wrap;
  }

  function sortForDisplay(items) {
    return [...items].sort((a, b) => {
      if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
      return (a.startTime || "").localeCompare(b.startTime || "");
    });
  }

  function applyHideCompleted(items) {
    if (!hideCompleted) return items;
    return items.filter((item) => !(item.completedDates || []).includes(item.occurrenceDate));
  }

  function renderScheduleItem(item, onClick) {
    const li = document.createElement("li");
    li.className = "schedule-item";
    li.draggable = true;
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", item.id);
      e.dataTransfer.effectAllowed = "move";
    });

    const isDone = (item.completedDates || []).includes(item.occurrenceDate);
    if (isDone) li.classList.add("completed");

    const categoryDot = document.createElement("span");
    categoryDot.className = "schedule-item-category-dot";
    categoryDot.style.background = CATEGORY_COLORS[item.category] || CATEGORY_COLORS.etc;
    li.appendChild(categoryDot);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "schedule-item-checkbox";
    checkbox.checked = isDone;
    checkbox.setAttribute("aria-label", "완료 표시");
    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      window.ScheduleStore.toggleCompleted(item.id, item.occurrenceDate);
      refreshAll();
    });
    li.appendChild(checkbox);

    const time = document.createElement("div");
    time.className = "schedule-item-time";
    time.textContent = item.startTime
      ? item.startTime + (item.endTime ? `–${item.endTime}` : "")
      : "종일";

    const body = document.createElement("div");
    body.className = "schedule-item-body";

    const title = document.createElement("div");
    title.className = "schedule-item-title";
    title.textContent = item.title;
    if (item.favorite) {
      const badge = document.createElement("span");
      badge.className = "schedule-item-badge";
      badge.textContent = "⭐";
      title.appendChild(badge);
    }
    if (item.repeat && item.repeat.type !== "none") {
      const badge = document.createElement("span");
      badge.className = "schedule-item-badge";
      badge.textContent = "🔁";
      title.appendChild(badge);
    }
    if (item.reminderMinutes) {
      const badge = document.createElement("span");
      badge.className = "schedule-item-badge";
      badge.textContent = "🔔";
      title.appendChild(badge);
    }
    title.appendChild(buildImportanceStars(item.importance));
    body.appendChild(title);

    if (item.memo) {
      const memo = document.createElement("div");
      memo.className = "schedule-item-memo";
      memo.textContent = item.memo;
      body.appendChild(memo);
    }

    li.appendChild(time);
    li.appendChild(body);
    li.addEventListener("click", () => onClick(item));
    return li;
  }

  function renderCalendar() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    document.getElementById("calendarTitle").textContent = `${year}년 ${month + 1}월`;

    const grid = document.getElementById("calendarGrid");
    grid.innerHTML = "";

    const todayStr = toDateStr(new Date());
    const selectedStr = toDateStr(selectedDate);

    buildMonthGrid(year, month).forEach((d) => {
      const dStr = toDateStr(d);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "calendar-day";
      if (d.getMonth() !== month) cell.classList.add("outside");
      if (dStr === todayStr) cell.classList.add("today");
      if (dStr === selectedStr) cell.classList.add("selected");

      const num = document.createElement("span");
      num.className = "day-number";
      num.textContent = d.getDate();
      cell.appendChild(num);

      if (window.ScheduleStore.countOccurrences(dStr) > 0) {
        const dot = document.createElement("span");
        dot.className = "dot";
        cell.appendChild(dot);
      }

      cell.addEventListener("click", () => {
        selectedDate = d;
        if (d.getMonth() !== month) {
          viewDate = new Date(d.getFullYear(), d.getMonth(), 1);
        }
        renderCalendar();
        renderDayList();
      });

      cell.addEventListener("dragover", (e) => {
        e.preventDefault();
        cell.classList.add("drag-over");
      });
      cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
      cell.addEventListener("drop", (e) => {
        e.preventDefault();
        cell.classList.remove("drag-over");
        const id = e.dataTransfer.getData("text/plain");
        if (!id) return;
        window.ScheduleStore.update(id, { date: dStr });
        refreshAll();
      });

      grid.appendChild(cell);
    });
  }

  function renderDayList() {
    document.getElementById("selectedDateLabel").textContent = formatDayLabel(selectedDate);

    const list = document.getElementById("scheduleList");
    list.innerHTML = "";
    const items = sortForDisplay(applyHideCompleted(window.ScheduleStore.getOccurrences(toDateStr(selectedDate))));

    if (items.length === 0) {
      list.innerHTML = `<li class="schedule-empty">이 날에는 일정이 없어요</li>`;
      return;
    }
    items.forEach((item) => list.appendChild(renderScheduleItem(item, (it) => openModal("edit", it))));
  }

  function renderTemplateChips() {
    const row = document.getElementById("templateChipRow");
    if (!row) return;
    const templates = window.TemplateStore.getAll();
    row.innerHTML = "";

    templates.forEach((tpl) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "template-chip";
      chip.style.borderColor = CATEGORY_COLORS[tpl.category] || CATEGORY_COLORS.etc;

      const label = document.createElement("span");
      label.textContent = tpl.title;
      chip.appendChild(label);

      const remove = document.createElement("span");
      remove.className = "template-chip-remove";
      remove.textContent = "×";
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        window.TemplateStore.remove(tpl.id);
        renderTemplateChips();
      });
      chip.appendChild(remove);

      chip.addEventListener("click", () => {
        window.ScheduleStore.add({
          title: tpl.title,
          date: toDateStr(selectedDate),
          startTime: "",
          endTime: "",
          memo: "",
          category: tpl.category,
          importance: tpl.importance,
          repeat: { type: "none", until: null },
          reminderMinutes: null,
        });
        refreshAll();
        window.Toast.show(`"${tpl.title}" 일정을 추가했어요`);
      });

      row.appendChild(chip);
    });
  }

  function renderDashboardSchedule() {
    const list = document.getElementById("dashboardScheduleList");
    if (!list) return;

    const items = window.ScheduleStore.getOccurrences(toDateStr(new Date()));
    const statEl = document.getElementById("statTodayCount");
    if (statEl) statEl.textContent = items.length;

    const completedCount = items.filter((item) =>
      (item.completedDates || []).includes(item.occurrenceDate)
    ).length;

    const pendingCount = items.length - completedCount;
    const pendingEl = document.getElementById("statPendingCount");
    if (pendingEl) pendingEl.textContent = pendingCount;

    document.title = pendingCount > 0 ? `(${pendingCount}) 비서 | 개인 대시보드` : "비서 | 개인 대시보드";

    const rateEl = document.getElementById("statCompletionRate");
    if (rateEl) {
      rateEl.textContent = items.length === 0 ? "—" : `${Math.round((completedCount / items.length) * 100)}%`;
    }

    const displayItems = sortForDisplay(applyHideCompleted(items));
    list.innerHTML = "";
    if (displayItems.length === 0) {
      list.innerHTML = `<li class="schedule-empty">오늘 등록된 일정이 없어요</li>`;
      return;
    }
    displayItems.forEach((item) => list.appendChild(renderScheduleItem(item, (it) => openModal("edit", it))));
  }

  function formatShortDate(dateStr) {
    const d = parseDateStr(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
  }

  function renderUpcoming() {
    const list = document.getElementById("dashboardUpcomingList");
    if (!list) return;

    const today = new Date();
    const items = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      items.push(...window.ScheduleStore.getOccurrences(toDateStr(d)));
    }

    const displayItems = sortForDisplay(applyHideCompleted(items));
    list.innerHTML = "";
    if (displayItems.length === 0) {
      list.innerHTML = `<li class="schedule-empty">다가오는 일정이 없어요</li>`;
      return;
    }
    displayItems.slice(0, 8).forEach((item) => {
      const li = renderScheduleItem(item, (it) => openModal("edit", it));
      const timeEl = li.querySelector(".schedule-item-time");
      if (timeEl) timeEl.textContent = formatShortDate(item.occurrenceDate);
      list.appendChild(li);
    });
  }

  function refreshDashboard() {
    renderDashboardSchedule();
    renderUpcoming();
  }

  function refreshAll() {
    renderCalendar();
    renderDayList();
    renderTemplateChips();
    refreshDashboard();
    if (window.ReminderEngine) window.ReminderEngine.check();
  }

  function updateRepeatFieldsVisibility() {
    const repeatType = document.getElementById("scheduleRepeatInput").value;
    const isRepeating = repeatType !== "none";
    document.getElementById("repeatUntilRow").hidden = !isRepeating;
    document.getElementById("repeatNote").hidden = !isRepeating;
  }

  function paintImportanceStars(value) {
    document.querySelectorAll("#scheduleImportanceStars .star-btn").forEach((btn) => {
      const starValue = Number(btn.dataset.value);
      btn.classList.toggle("filled", starValue <= value);
    });
    document.getElementById("scheduleImportanceInput").value = String(value);
  }

  function updateReminderCustomVisibility() {
    const isCustom = document.getElementById("scheduleReminderInput").value === "custom";
    document.getElementById("reminderCustomRow").hidden = !isCustom;
  }

  function openModal(mode, data) {
    editingId = mode === "edit" ? data.id : null;
    document.getElementById("modalTitle").textContent = mode === "edit" ? "일정 수정" : "일정 추가";
    document.getElementById("scheduleTitleInput").value = data?.title || "";
    document.getElementById("scheduleDateInput").value = data?.date || toDateStr(selectedDate);
    document.getElementById("scheduleStartInput").value = data?.startTime || "";
    document.getElementById("scheduleEndInput").value = data?.endTime || "";
    document.getElementById("scheduleMemoInput").value = data?.memo || "";
    document.getElementById("scheduleRepeatInput").value = data?.repeat?.type || "none";
    document.getElementById("scheduleRepeatUntilInput").value = data?.repeat?.until || "";
    document.getElementById("scheduleCategoryInput").value = data?.category || "etc";
    document.getElementById("scheduleFavoriteInput").checked = !!data?.favorite;
    paintImportanceStars(data?.importance || DEFAULT_IMPORTANCE);

    const reminderMinutes = data?.reminderMinutes;
    if (reminderMinutes && REMINDER_PRESETS.includes(String(reminderMinutes))) {
      document.getElementById("scheduleReminderInput").value = String(reminderMinutes);
      document.getElementById("scheduleReminderCustomInput").value = "";
    } else if (reminderMinutes) {
      document.getElementById("scheduleReminderInput").value = "custom";
      document.getElementById("scheduleReminderCustomInput").value = String(reminderMinutes);
    } else {
      document.getElementById("scheduleReminderInput").value = "";
      document.getElementById("scheduleReminderCustomInput").value = "";
    }
    updateReminderCustomVisibility();

    updateRepeatFieldsVisibility();
    document.getElementById("deleteScheduleBtn").hidden = mode !== "edit";
    document.getElementById("scheduleModalOverlay").hidden = false;
    document.getElementById("scheduleTitleInput").focus();
  }

  function closeModal() {
    document.getElementById("scheduleModalOverlay").hidden = true;
    document.getElementById("scheduleForm").reset();
    updateRepeatFieldsVisibility();
    paintImportanceStars(DEFAULT_IMPORTANCE);
    updateReminderCustomVisibility();
    editingId = null;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const repeatType = document.getElementById("scheduleRepeatInput").value;
    const reminderValue = document.getElementById("scheduleReminderInput").value;

    let reminderMinutes = null;
    if (reminderValue === "custom") {
      const customMinutes = Number(document.getElementById("scheduleReminderCustomInput").value);
      reminderMinutes = customMinutes > 0 ? customMinutes : null;
    } else if (reminderValue) {
      reminderMinutes = Number(reminderValue);
    }

    const payload = {
      title: document.getElementById("scheduleTitleInput").value.trim(),
      date: document.getElementById("scheduleDateInput").value,
      startTime: document.getElementById("scheduleStartInput").value,
      endTime: document.getElementById("scheduleEndInput").value,
      memo: document.getElementById("scheduleMemoInput").value.trim(),
      repeat: {
        type: repeatType,
        until: repeatType !== "none" ? (document.getElementById("scheduleRepeatUntilInput").value || null) : null,
      },
      reminderMinutes,
      importance: Number(document.getElementById("scheduleImportanceInput").value) || DEFAULT_IMPORTANCE,
      category: document.getElementById("scheduleCategoryInput").value,
      favorite: document.getElementById("scheduleFavoriteInput").checked,
    };
    if (!payload.title || !payload.date) return;

    if (editingId) {
      window.ScheduleStore.update(editingId, payload);
    } else {
      window.ScheduleStore.add(payload);
    }

    selectedDate = parseDateStr(payload.date);
    viewDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    closeModal();
    refreshAll();
  }

  function handleDelete() {
    if (!editingId) return;
    const removed = window.ScheduleStore.getById(editingId);
    window.ScheduleStore.remove(editingId);
    closeModal();
    refreshAll();
    if (removed && window.Toast) {
      window.Toast.show("일정을 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          window.ScheduleStore.add(removed);
          refreshAll();
        },
      });
    }
  }

  function handleSaveAsTemplate() {
    const title = document.getElementById("scheduleTitleInput").value.trim();
    if (!title) {
      window.Toast.show("템플릿으로 저장하려면 제목을 먼저 입력하세요");
      return;
    }
    window.TemplateStore.add({
      title,
      category: document.getElementById("scheduleCategoryInput").value,
      importance: Number(document.getElementById("scheduleImportanceInput").value) || DEFAULT_IMPORTANCE,
    });
    renderTemplateChips();
    window.Toast.show(`"${title}" 템플릿을 저장했어요`);
  }

  function toggleHideCompleted() {
    hideCompleted = !hideCompleted;
    localStorage.setItem(HIDE_COMPLETED_KEY, String(hideCompleted));
    document.getElementById("toggleHideCompletedBtn").textContent = hideCompleted
      ? "완료 항목 보기"
      : "완료 항목 숨기기";
    refreshAll();
  }

  function init() {
    document.getElementById("toggleHideCompletedBtn").textContent = hideCompleted
      ? "완료 항목 보기"
      : "완료 항목 숨기기";
    document.getElementById("toggleHideCompletedBtn").addEventListener("click", toggleHideCompleted);
    document.getElementById("saveAsTemplateBtn").addEventListener("click", handleSaveAsTemplate);
    document.getElementById("printScheduleBtn").addEventListener("click", () => window.print());

    document.getElementById("prevMonthBtn").addEventListener("click", () => {
      viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
      renderCalendar();
    });

    document.getElementById("nextMonthBtn").addEventListener("click", () => {
      viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
      renderCalendar();
    });

    document.getElementById("todayBtn").addEventListener("click", () => {
      const now = new Date();
      viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
      selectedDate = now;
      renderCalendar();
      renderDayList();
    });

    document.getElementById("addScheduleBtn").addEventListener("click", () => openModal("add"));

    document.getElementById("dashboardAddScheduleBtn").addEventListener("click", () => {
      selectedDate = new Date();
      openModal("add");
    });

    document.getElementById("scheduleForm").addEventListener("submit", handleSubmit);
    document.getElementById("cancelScheduleBtn").addEventListener("click", closeModal);
    document.getElementById("deleteScheduleBtn").addEventListener("click", handleDelete);
    document.getElementById("scheduleRepeatInput").addEventListener("change", updateRepeatFieldsVisibility);
    document.getElementById("scheduleReminderInput").addEventListener("change", updateReminderCustomVisibility);

    document.querySelectorAll("#scheduleImportanceStars .star-btn").forEach((btn) => {
      btn.addEventListener("click", () => paintImportanceStars(Number(btn.dataset.value)));
    });

    document.getElementById("scheduleModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "scheduleModalOverlay") closeModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.getElementById("scheduleModalOverlay").hidden) closeModal();
    });

    refreshAll();
  }

  window.ScheduleView = { init, refreshDashboard, openAddModal: () => openModal("add") };
})();
