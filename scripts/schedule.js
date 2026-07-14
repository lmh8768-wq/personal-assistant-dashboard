(function () {
  let viewDate = new Date();
  let selectedDate = new Date();
  let editingId = null;
  let viewMode = "month"; // "month" | "week" | "agenda"
  let categoryFilter = null;
  let favoritesOnly = false;
  let scheduleSelectMode = false;
  let scheduleSelectedIds = new Set();
  let pendingChecklist = [];

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const REMINDER_PRESETS = ["10", "30", "60", "1440"];
  const DEFAULT_IMPORTANCE = 3;
  const HIDE_COMPLETED_KEY = "assistant.hideCompleted.v1";

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

  function buildWeekGrid(date) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
    const days = [];
    for (let i = 0; i < 7; i++) {
      days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }
    return days;
  }

  function formatDayLabel(d) {
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  }

  function getCategoryColor(key) {
    return (window.CategoryStore && window.CategoryStore.getByKey(key || "etc").color) || "#94a3b8";
  }

  function getCategoryLabel(key) {
    return (window.CategoryStore && window.CategoryStore.getByKey(key || "etc").label) || "기타";
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

  function applyCategoryFilter(items) {
    if (!categoryFilter) return items;
    return items.filter((item) => (item.category || "etc") === categoryFilter);
  }

  function applyFavoritesFilter(items) {
    if (!favoritesOnly) return items;
    return items.filter((item) => item.favorite);
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
    categoryDot.style.background = getCategoryColor(item.category);
    categoryDot.title = getCategoryLabel(item.category);
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
    if (item.checklist && item.checklist.length > 0) {
      const done = item.checklist.filter((c) => c.done).length;
      const badge = document.createElement("span");
      badge.className = "schedule-item-checklist-badge";
      badge.textContent = `☑ ${done}/${item.checklist.length}`;
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

    if (item.location) {
      const loc = document.createElement("div");
      loc.className = "schedule-item-memo";
      loc.textContent = `📍 ${item.location}`;
      body.appendChild(loc);
    }

    if (item.url) {
      const link = document.createElement("a");
      link.className = "schedule-item-memo schedule-item-link";
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = `🔗 ${item.url}`;
      link.addEventListener("click", (e) => e.stopPropagation());
      body.appendChild(link);
    }

    li.appendChild(time);
    li.appendChild(body);
    li.addEventListener("click", () => onClick(item));
    return li;
  }

  // ---------- Calendar area (month / week / agenda) ----------
  function renderCalendarArea() {
    if (viewMode === "week") {
      renderWeekView();
    } else if (viewMode === "agenda") {
      renderAgendaList();
    } else {
      renderCalendar();
    }
  }

  function buildCalendarCell(d, isOutside) {
    const dStr = toDateStr(d);
    const todayStr = toDateStr(new Date());
    const selectedStr = toDateStr(selectedDate);

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day";
    if (isOutside) cell.classList.add("outside");
    if (dStr === todayStr) cell.classList.add("today");
    if (dStr === selectedStr) cell.classList.add("selected");

    const num = document.createElement("span");
    num.className = "day-number";
    num.textContent = d.getDate();
    cell.appendChild(num);

    const holidayName = window.KoreanHolidays && window.KoreanHolidays[dStr];
    if (holidayName) {
      cell.classList.add("holiday");
      const holiday = document.createElement("span");
      holiday.className = "calendar-day-holiday";
      holiday.textContent = holidayName;
      holiday.title = holidayName;
      cell.appendChild(holiday);
    }

    if (window.ScheduleStore.countOccurrences(dStr) > 0) {
      const dot = document.createElement("span");
      dot.className = "dot";
      cell.appendChild(dot);
    }

    cell.addEventListener("click", () => {
      selectedDate = d;
      if (viewMode === "month" && d.getMonth() !== viewDate.getMonth()) {
        viewDate = new Date(d.getFullYear(), d.getMonth(), 1);
      }
      renderCalendarArea();
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

    return cell;
  }

  function renderCalendar() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    document.getElementById("calendarTitle").textContent = `${year}년 ${month + 1}월`;

    const grid = document.getElementById("calendarGrid");
    grid.innerHTML = "";

    buildMonthGrid(year, month).forEach((d) => {
      grid.appendChild(buildCalendarCell(d, d.getMonth() !== month));
    });
  }

  function renderWeekView() {
    const days = buildWeekGrid(selectedDate);
    const first = days[0];
    const last = days[6];
    document.getElementById("calendarTitle").textContent =
      `${first.getMonth() + 1}월 ${first.getDate()}일 – ${last.getMonth() + 1}월 ${last.getDate()}일`;

    const grid = document.getElementById("calendarGrid");
    grid.innerHTML = "";
    days.forEach((d) => grid.appendChild(buildCalendarCell(d, false)));
  }

  function renderAgendaList() {
    document.getElementById("calendarTitle").textContent = "다가오는 일정";
    const container = document.getElementById("agendaList");
    container.innerHTML = "";

    const today = new Date();
    const todayStr = toDateStr(today);
    let hasAny = false;

    for (let i = 0; i < 60; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const dStr = toDateStr(d);
      let items = window.ScheduleStore.getOccurrences(dStr);
      items = applyFavoritesFilter(applyCategoryFilter(applyHideCompleted(items)));
      items = sortForDisplay(items);
      if (items.length === 0) continue;
      hasAny = true;

      const label = document.createElement("div");
      label.className = "agenda-group-label";
      label.textContent = formatDayLabel(d) + (dStr === todayStr ? " · 오늘" : "");
      container.appendChild(label);

      const list = document.createElement("ul");
      list.className = "schedule-list";
      items.forEach((item) => list.appendChild(renderScheduleItem(item, (it) => openModal("edit", it))));
      container.appendChild(list);
    }

    if (!hasAny) {
      container.innerHTML = `<div class="empty-state"><span class="empty-icon">▤</span><p>다가오는 일정이 없어요</p></div>`;
    }
  }

  function setViewMode(mode) {
    viewMode = mode;
    document.querySelectorAll(".view-mode-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.mode === mode);
    });
    const isAgenda = mode === "agenda";
    document.getElementById("calendarGrid").hidden = isAgenda;
    document.getElementById("calendarWeekdays").hidden = isAgenda;
    document.getElementById("agendaList").hidden = !isAgenda;
    document.getElementById("prevMonthBtn").hidden = isAgenda;
    document.getElementById("nextMonthBtn").hidden = isAgenda;
    document.getElementById("todayBtn").hidden = isAgenda;
    renderCalendarArea();
  }

  // ---------- Filter bar ----------
  function renderScheduleFilterBar() {
    const bar = document.getElementById("scheduleFilterBar");
    if (!bar) return;
    bar.innerHTML = "";

    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "schedule-filter-chip" + (!categoryFilter && !favoritesOnly ? " active" : "");
    allChip.textContent = "전체";
    allChip.addEventListener("click", () => {
      categoryFilter = null;
      favoritesOnly = false;
      renderScheduleFilterBar();
      renderDayList();
      if (viewMode === "agenda") renderAgendaList();
    });
    bar.appendChild(allChip);

    window.CategoryStore.getAll().forEach((cat) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "schedule-filter-chip" + (categoryFilter === cat.key ? " active" : "");

      const dot = document.createElement("span");
      dot.className = "schedule-filter-chip-dot";
      dot.style.background = cat.color;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(cat.label));

      chip.addEventListener("click", () => {
        categoryFilter = categoryFilter === cat.key ? null : cat.key;
        renderScheduleFilterBar();
        renderDayList();
        if (viewMode === "agenda") renderAgendaList();
      });
      bar.appendChild(chip);
    });

    const favChip = document.createElement("button");
    favChip.type = "button";
    favChip.className = "schedule-filter-chip" + (favoritesOnly ? " active" : "");
    favChip.textContent = "⭐ 즐겨찾기";
    favChip.addEventListener("click", () => {
      favoritesOnly = !favoritesOnly;
      renderScheduleFilterBar();
      renderDayList();
      if (viewMode === "agenda") renderAgendaList();
    });
    bar.appendChild(favChip);
  }

  // ---------- Day panel ----------
  function toggleScheduleSelection(key) {
    if (scheduleSelectedIds.has(key)) scheduleSelectedIds.delete(key);
    else scheduleSelectedIds.add(key);
    updateScheduleSelectToolbar();
    renderDayList();
  }

  function updateScheduleSelectToolbar() {
    const toolbar = document.getElementById("scheduleSelectToolbar");
    if (!toolbar) return;
    toolbar.hidden = !scheduleSelectMode;
    const countEl = document.getElementById("scheduleSelectCount");
    if (countEl) countEl.textContent = `${scheduleSelectedIds.size}개 선택됨`;
  }

  function renderDayList() {
    document.getElementById("selectedDateLabel").textContent = formatDayLabel(selectedDate);

    const list = document.getElementById("scheduleList");
    list.innerHTML = "";

    let items = window.ScheduleStore.getOccurrences(toDateStr(selectedDate));
    items = applyFavoritesFilter(applyCategoryFilter(items));
    items = sortForDisplay(applyHideCompleted(items));

    if (items.length === 0) {
      list.innerHTML = `<li class="schedule-empty">이 날에는 일정이 없어요</li>`;
      return;
    }

    items.forEach((item) => {
      const key = `${item.id}::${item.occurrenceDate}`;
      const onClick = scheduleSelectMode
        ? (it) => toggleScheduleSelection(`${it.id}::${it.occurrenceDate}`)
        : (it) => openModal("edit", it);
      const li = renderScheduleItem(item, onClick);
      if (scheduleSelectMode) {
        li.classList.add("selectable");
        if (scheduleSelectedIds.has(key)) li.classList.add("selected");
      }
      list.appendChild(li);
    });
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
      chip.style.borderColor = getCategoryColor(tpl.category);

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
          checklist: [],
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
    renderCalendarArea();
    renderDayList();
    renderTemplateChips();
    renderScheduleFilterBar();
    refreshDashboard();
    if (window.ReminderEngine) window.ReminderEngine.check();
  }

  // ---------- Modal ----------
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

  function syncCategorySelectOptions() {
    const select = document.getElementById("scheduleCategoryInput");
    const current = select.value;
    select.innerHTML = "";
    window.CategoryStore.getAll().forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat.key;
      opt.textContent = cat.label;
      select.appendChild(opt);
    });
    if (current) select.value = current;
  }

  function renderChecklistItems() {
    const list = document.getElementById("scheduleChecklistItems");
    list.innerHTML = "";
    pendingChecklist.forEach((entry, idx) => {
      const li = document.createElement("li");
      li.className = "checklist-item" + (entry.done ? " done" : "");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = entry.done;
      checkbox.addEventListener("change", () => {
        pendingChecklist[idx].done = checkbox.checked;
        renderChecklistItems();
      });
      li.appendChild(checkbox);

      const span = document.createElement("span");
      span.textContent = entry.text;
      li.appendChild(span);

      const remove = document.createElement("span");
      remove.className = "checklist-item-remove";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        pendingChecklist.splice(idx, 1);
        renderChecklistItems();
      });
      li.appendChild(remove);

      list.appendChild(li);
    });
  }

  function handleAddChecklistItem() {
    const input = document.getElementById("scheduleChecklistInput");
    const text = input.value.trim();
    if (!text) return;
    pendingChecklist.push({ text, done: false });
    input.value = "";
    renderChecklistItems();
  }

  function openModal(mode, data) {
    editingId = mode === "edit" ? data.id : null;
    document.getElementById("modalTitle").textContent = mode === "edit" ? "일정 수정" : "일정 추가";
    document.getElementById("scheduleTitleInput").value = data?.title || "";
    document.getElementById("scheduleDateInput").value = data?.date || toDateStr(selectedDate);
    document.getElementById("scheduleStartInput").value = data?.startTime || "";
    document.getElementById("scheduleEndInput").value = data?.endTime || "";
    document.getElementById("scheduleMemoInput").value = data?.memo || "";
    document.getElementById("scheduleLocationInput").value = data?.location || "";
    document.getElementById("scheduleUrlInput").value = data?.url || "";
    document.getElementById("scheduleRepeatInput").value = data?.repeat?.type || "none";
    document.getElementById("scheduleRepeatUntilInput").value = data?.repeat?.until || "";

    syncCategorySelectOptions();
    document.getElementById("scheduleCategoryInput").value = data?.category || "etc";
    document.getElementById("scheduleFavoriteInput").checked = !!data?.favorite;
    paintImportanceStars(data?.importance || DEFAULT_IMPORTANCE);

    pendingChecklist = data?.checklist ? data.checklist.map((c) => ({ ...c })) : [];
    renderChecklistItems();

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
    document.getElementById("duplicateScheduleBtn").hidden = mode !== "edit";
    document.getElementById("scheduleModalOverlay").hidden = false;
    document.getElementById("scheduleTitleInput").focus();
  }

  function closeModal() {
    document.getElementById("scheduleModalOverlay").hidden = true;
    document.getElementById("scheduleForm").reset();
    updateRepeatFieldsVisibility();
    paintImportanceStars(DEFAULT_IMPORTANCE);
    updateReminderCustomVisibility();
    pendingChecklist = [];
    renderChecklistItems();
    editingId = null;
  }

  function readPayloadFromForm() {
    const repeatType = document.getElementById("scheduleRepeatInput").value;
    const reminderValue = document.getElementById("scheduleReminderInput").value;

    let reminderMinutes = null;
    if (reminderValue === "custom") {
      const customMinutes = Number(document.getElementById("scheduleReminderCustomInput").value);
      reminderMinutes = customMinutes > 0 ? customMinutes : null;
    } else if (reminderValue) {
      reminderMinutes = Number(reminderValue);
    }

    return {
      title: document.getElementById("scheduleTitleInput").value.trim(),
      date: document.getElementById("scheduleDateInput").value,
      startTime: document.getElementById("scheduleStartInput").value,
      endTime: document.getElementById("scheduleEndInput").value,
      memo: document.getElementById("scheduleMemoInput").value.trim(),
      location: document.getElementById("scheduleLocationInput").value.trim(),
      url: document.getElementById("scheduleUrlInput").value.trim(),
      repeat: {
        type: repeatType,
        until: repeatType !== "none" ? (document.getElementById("scheduleRepeatUntilInput").value || null) : null,
      },
      reminderMinutes,
      importance: Number(document.getElementById("scheduleImportanceInput").value) || DEFAULT_IMPORTANCE,
      category: document.getElementById("scheduleCategoryInput").value,
      favorite: document.getElementById("scheduleFavoriteInput").checked,
      checklist: [...pendingChecklist],
    };
  }

  function handleSubmit(e) {
    e.preventDefault();
    const payload = readPayloadFromForm();
    if (!payload.title || !payload.date) return;

    if (editingId) {
      window.ScheduleStore.update(editingId, payload);
    } else {
      window.ScheduleStore.add(payload);
    }

    selectedDate = parseDateStr(payload.date);
    viewDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const wasEditing = !!editingId;
    closeModal();
    refreshAll();
    window.Toast.show(wasEditing ? "일정을 수정했어요" : "일정을 추가했어요");
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

  function handleDuplicate() {
    if (!editingId) return;
    const original = window.ScheduleStore.getById(editingId);
    if (!original) return;
    const { id, completedDates, ...rest } = original;
    window.ScheduleStore.add({ ...rest, favorite: false });
    closeModal();
    refreshAll();
    window.Toast.show(`"${original.title}" 일정을 복제했어요`);
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

  // ---------- Bulk select ----------
  function toggleScheduleSelectMode() {
    scheduleSelectMode = !scheduleSelectMode;
    scheduleSelectedIds.clear();
    document.getElementById("scheduleSelectModeBtn").textContent = scheduleSelectMode ? "선택 취소" : "선택";
    updateScheduleSelectToolbar();
    renderDayList();
  }

  function splitKey(key) {
    const idx = key.lastIndexOf("::");
    return [key.slice(0, idx), key.slice(idx + 2)];
  }

  function handleBulkComplete() {
    scheduleSelectedIds.forEach((key) => {
      const [id, occurrenceDate] = splitKey(key);
      const item = window.ScheduleStore.getById(id);
      if (!item) return;
      const isDone = (item.completedDates || []).includes(occurrenceDate);
      if (!isDone) window.ScheduleStore.toggleCompleted(id, occurrenceDate);
    });
    const count = scheduleSelectedIds.size;
    scheduleSelectedIds.clear();
    scheduleSelectMode = false;
    document.getElementById("scheduleSelectModeBtn").textContent = "선택";
    updateScheduleSelectToolbar();
    refreshAll();
    window.Toast.show(`일정 ${count}개를 완료 처리했어요`);
  }

  function handleBulkDelete() {
    const ids = [...new Set([...scheduleSelectedIds].map((key) => splitKey(key)[0]))];
    const removedItems = ids.map((id) => window.ScheduleStore.getById(id)).filter(Boolean);
    ids.forEach((id) => window.ScheduleStore.remove(id));
    const count = removedItems.length;
    scheduleSelectedIds.clear();
    scheduleSelectMode = false;
    document.getElementById("scheduleSelectModeBtn").textContent = "선택";
    updateScheduleSelectToolbar();
    refreshAll();
    window.Toast.show(`일정 ${count}개를 삭제했어요`, {
      actionLabel: "실행취소",
      onAction: () => {
        removedItems.forEach((it) => window.ScheduleStore.add(it));
        refreshAll();
      },
    });
  }

  // ---------- Natural language quick add ----------
  function parseNaturalLanguage(raw) {
    let text = raw.trim();
    const today = new Date();
    let date = toDateStr(today);
    let startTime = "";

    const relDayMap = { "오늘": 0, "내일": 1, "모레": 2, "글피": 3 };
    for (const [word, offset] of Object.entries(relDayMap)) {
      if (text.includes(word)) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
        date = toDateStr(d);
        text = text.replace(word, "");
        break;
      }
    }

    const weekdayMatch = text.match(/(다음\s*주|이번\s*주)?\s*(일|월|화|수|목|금|토)요일/);
    if (weekdayMatch) {
      const targetDay = WEEKDAYS.indexOf(weekdayMatch[2]);
      const isNextWeek = !!weekdayMatch[1] && weekdayMatch[1].replace(/\s/g, "") === "다음주";
      let diff = targetDay - today.getDay();
      if (diff < 0 || (diff === 0 && !weekdayMatch[1])) diff += 7;
      if (isNextWeek) diff += 7;
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + diff);
      date = toDateStr(d);
      text = text.replace(weekdayMatch[0], "");
    }

    const hhmmMatch = text.match(/(\d{1,2}):(\d{2})/);
    const koreanTimeMatch = text.match(/(오전|오후)?\s*(\d{1,2})시\s*(\d{1,2})?분?/);
    if (hhmmMatch) {
      startTime = `${pad2(Number(hhmmMatch[1]))}:${hhmmMatch[2]}`;
      text = text.replace(hhmmMatch[0], "");
    } else if (koreanTimeMatch) {
      let hour = Number(koreanTimeMatch[2]);
      const minute = koreanTimeMatch[3] ? Number(koreanTimeMatch[3]) : 0;
      if (koreanTimeMatch[1] === "오후" && hour < 12) hour += 12;
      if (koreanTimeMatch[1] === "오전" && hour === 12) hour = 0;
      // No AM/PM given: assume typical daytime hours (1~6시) mean afternoon,
      // since that's the more common reading for casual schedule entries.
      if (!koreanTimeMatch[1] && hour >= 1 && hour <= 6) hour += 12;
      startTime = `${pad2(hour)}:${pad2(minute)}`;
      text = text.replace(koreanTimeMatch[0], "");
    }

    const title = text
      .replace(/\s+/g, " ")
      .replace(/^[에\s]+|[에\s]+$/g, "")
      .trim();

    return { title, date, startTime };
  }

  function handleQuickAdd() {
    const input = document.getElementById("quickAddInput");
    const raw = input.value.trim();
    if (!raw) return;

    const parsed = parseNaturalLanguage(raw);
    if (!parsed.title) {
      window.Toast.show("일정 제목을 인식하지 못했어요");
      return;
    }

    window.ScheduleStore.add({
      title: parsed.title,
      date: parsed.date,
      startTime: parsed.startTime,
      endTime: "",
      memo: "",
      location: "",
      url: "",
      category: "etc",
      importance: DEFAULT_IMPORTANCE,
      favorite: false,
      repeat: { type: "none", until: null },
      reminderMinutes: null,
      checklist: [],
    });

    input.value = "";
    selectedDate = parseDateStr(parsed.date);
    viewDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    refreshAll();
    window.Toast.show(`"${parsed.title}" 일정을 추가했어요 (${parsed.date}${parsed.startTime ? " " + parsed.startTime : ""})`);
  }

  // ---------- iCalendar export ----------
  function escapeIcsText(s) {
    return (s || "").replace(/[\\;,]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
  }

  function formatIcsDate(dateStr, timeStr) {
    if (timeStr) {
      const [h, m] = timeStr.split(":").map(Number);
      return `${dateStr.replace(/-/g, "")}T${pad2(h)}${pad2(m)}00`;
    }
    return dateStr.replace(/-/g, "");
  }

  function buildIcsContent() {
    const items = window.ScheduleStore.getAll();
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Assistant//Schedule//KO"];

    items.forEach((item) => {
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${item.id}@assistant`);
      if (item.startTime) {
        lines.push(`DTSTART:${formatIcsDate(item.date, item.startTime)}`);
        if (item.endTime) lines.push(`DTEND:${formatIcsDate(item.date, item.endTime)}`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(item.date)}`);
      }
      lines.push(`SUMMARY:${escapeIcsText(item.title)}`);
      if (item.memo) lines.push(`DESCRIPTION:${escapeIcsText(item.memo)}`);
      if (item.location) lines.push(`LOCATION:${escapeIcsText(item.location)}`);
      if (item.url) lines.push(`URL:${item.url}`);

      const repeat = item.repeat || { type: "none" };
      const freqMap = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" };
      if (repeat.type !== "none" && freqMap[repeat.type]) {
        let rrule = `FREQ=${freqMap[repeat.type]}`;
        if (repeat.until) rrule += `;UNTIL=${repeat.until.replace(/-/g, "")}T235959Z`;
        lines.push(`RRULE:${rrule}`);
      }
      lines.push("END:VEVENT");
    });

    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  function handleExportIcs() {
    const content = buildIcsContent();
    const blob = new Blob([content], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "schedule.ics";
    a.click();
    URL.revokeObjectURL(url);
    window.Toast.show("일정을 캘린더 파일(.ics)로 내보냈어요");
  }

  function init() {
    document.getElementById("toggleHideCompletedBtn").textContent = hideCompleted
      ? "완료 항목 보기"
      : "완료 항목 숨기기";
    document.getElementById("toggleHideCompletedBtn").addEventListener("click", toggleHideCompleted);
    document.getElementById("saveAsTemplateBtn").addEventListener("click", handleSaveAsTemplate);
    document.getElementById("duplicateScheduleBtn").addEventListener("click", handleDuplicate);
    document.getElementById("printScheduleBtn").addEventListener("click", () => window.print());
    document.getElementById("exportIcsBtn").addEventListener("click", handleExportIcs);

    document.querySelectorAll(".view-mode-tab").forEach((tab) => {
      tab.addEventListener("click", () => setViewMode(tab.dataset.mode));
    });

    document.getElementById("prevMonthBtn").addEventListener("click", () => {
      if (viewMode === "week") {
        selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() - 7);
      } else {
        viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
      }
      renderCalendarArea();
    });

    document.getElementById("nextMonthBtn").addEventListener("click", () => {
      if (viewMode === "week") {
        selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 7);
      } else {
        viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
      }
      renderCalendarArea();
    });

    document.getElementById("todayBtn").addEventListener("click", () => {
      const now = new Date();
      viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
      selectedDate = now;
      renderCalendarArea();
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

    document.getElementById("scheduleChecklistAddBtn").addEventListener("click", handleAddChecklistItem);
    document.getElementById("scheduleChecklistInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddChecklistItem();
      }
    });

    document.getElementById("quickAddBtn").addEventListener("click", handleQuickAdd);
    document.getElementById("quickAddInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleQuickAdd();
      }
    });

    document.getElementById("scheduleSelectModeBtn").addEventListener("click", toggleScheduleSelectMode);
    document.getElementById("scheduleBulkCompleteBtn").addEventListener("click", handleBulkComplete);
    document.getElementById("scheduleBulkDeleteBtn").addEventListener("click", handleBulkDelete);

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

  window.ScheduleView = {
    init,
    refreshDashboard,
    refreshAll,
    openAddModal: () => openModal("add"),
    goToToday: () => {
      const now = new Date();
      viewDate = new Date(now.getFullYear(), now.getMonth(), 1);
      selectedDate = now;
      setViewMode("month");
      renderDayList();
    },
    goToDate: (dateStr) => {
      const d = parseDateStr(dateStr);
      viewDate = new Date(d.getFullYear(), d.getMonth(), 1);
      selectedDate = d;
      setViewMode("month");
      renderDayList();
    },
  };
})();
