(function () {
  let viewDate = new Date();
  let selectedDate = new Date();
  let editingId = null;
  let viewMode = "month"; // "month" | "week" | "agenda"
  let categoryFilter = null;
  let scheduleSelectMode = false;
  let scheduleSelectedIds = new Set();

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
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

  function applyHideCompleted(items) {
    if (!hideCompleted) return items;
    return items.filter((item) => !(item.completedDates || []).includes(item.occurrenceDate));
  }

  function applyCategoryFilter(items) {
    if (!categoryFilter) return items;
    return items.filter((item) => (item.category || "etc") === categoryFilter);
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

    const body = document.createElement("div");
    body.className = "schedule-item-body";

    const title = document.createElement("div");
    title.className = "schedule-item-title";
    title.textContent = item.title;
    if (item.repeat && item.repeat.type !== "none") {
      const badge = document.createElement("span");
      badge.className = "schedule-item-badge";
      badge.textContent = "🔁";
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
      items = applyCategoryFilter(applyHideCompleted(items));
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
    allChip.className = "schedule-filter-chip" + (!categoryFilter ? " active" : "");
    allChip.textContent = "전체";
    allChip.addEventListener("click", () => {
      categoryFilter = null;
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
    items = applyCategoryFilter(items);
    items = applyHideCompleted(items);

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
          memo: "",
          category: tpl.category,
          importance: tpl.importance,
          repeat: { type: "none", until: null },
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

    const displayItems = applyHideCompleted(items);
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

    const importantItems = items.filter((item) => (item.importance || 0) >= 4);
    const displayItems = applyHideCompleted(importantItems);
    list.innerHTML = "";
    if (displayItems.length === 0) {
      list.innerHTML = `<li class="schedule-empty">다가오는 중요 일정이 없어요</li>`;
      return;
    }
    displayItems.slice(0, 8).forEach((item) => {
      const li = renderScheduleItem(item, (it) => openModal("edit", it));
      const titleEl = li.querySelector(".schedule-item-title");
      if (titleEl) {
        const dateBadge = document.createElement("span");
        dateBadge.className = "schedule-item-upcoming-date";
        dateBadge.textContent = formatShortDate(item.occurrenceDate);
        titleEl.prepend(dateBadge);
      }
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
  }

  // ---------- Modal ----------
  function updateRepeatFieldsVisibility() {
    const repeatType = document.getElementById("scheduleRepeatInput").value;
    const isRepeating = repeatType !== "none";
    document.getElementById("repeatUntilRow").hidden = !isRepeating;
    document.getElementById("repeatNote").hidden = !isRepeating;
    updateRepeatUntilDateVisibility();
  }

  function updateRepeatUntilDateVisibility() {
    const mode = document.getElementById("scheduleRepeatUntilModeInput").value;
    document.getElementById("repeatUntilDateRow").hidden = mode !== "date";
  }

  function paintImportanceStars(value) {
    document.querySelectorAll("#scheduleImportanceStars .star-btn").forEach((btn) => {
      const starValue = Number(btn.dataset.value);
      btn.classList.toggle("filled", starValue <= value);
    });
    document.getElementById("scheduleImportanceInput").value = String(value);
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

  function openModal(mode, data) {
    editingId = mode === "edit" ? data.id : null;
    document.getElementById("modalTitle").textContent = mode === "edit" ? "일정 수정" : "일정 추가";
    document.getElementById("scheduleTitleInput").value = data?.title || "";
    document.getElementById("scheduleDateInput").value = data?.date || toDateStr(selectedDate);
    document.getElementById("scheduleMemoInput").value = data?.memo || "";
    document.getElementById("scheduleLocationInput").value = data?.location || "";
    document.getElementById("scheduleUrlInput").value = data?.url || "";
    document.getElementById("scheduleRepeatInput").value = data?.repeat?.type || "none";
    const repeatUntilValue = data?.repeat?.until || "";
    document.getElementById("scheduleRepeatUntilModeInput").value = repeatUntilValue ? "date" : "never";
    document.getElementById("scheduleRepeatUntilInput").value = repeatUntilValue;

    syncCategorySelectOptions();
    document.getElementById("scheduleCategoryInput").value = data?.category || "etc";
    paintImportanceStars(data?.importance || DEFAULT_IMPORTANCE);

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
    editingId = null;
  }

  function readPayloadFromForm() {
    const repeatType = document.getElementById("scheduleRepeatInput").value;
    const repeatUntilMode = document.getElementById("scheduleRepeatUntilModeInput").value;

    return {
      title: document.getElementById("scheduleTitleInput").value.trim(),
      date: document.getElementById("scheduleDateInput").value,
      memo: document.getElementById("scheduleMemoInput").value.trim(),
      location: document.getElementById("scheduleLocationInput").value.trim(),
      url: document.getElementById("scheduleUrlInput").value.trim(),
      repeat: {
        type: repeatType,
        until: repeatType !== "none" && repeatUntilMode === "date"
          ? (document.getElementById("scheduleRepeatUntilInput").value || null)
          : null,
      },
      importance: Number(document.getElementById("scheduleImportanceInput").value) || DEFAULT_IMPORTANCE,
      category: document.getElementById("scheduleCategoryInput").value,
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
    window.ScheduleStore.add(rest);
    closeModal();
    refreshAll();
    window.Toast.show(`"${original.title}" 일정을 복제했어요`);
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

  // ---------- iCalendar export ----------
  function escapeIcsText(s) {
    return (s || "").replace(/[\\;,]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
  }

  function formatIcsDate(dateStr) {
    return dateStr.replace(/-/g, "");
  }

  function buildIcsContent() {
    const items = window.ScheduleStore.getAll();
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Assistant//Schedule//KO"];

    items.forEach((item) => {
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${item.id}@assistant`);
      lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(item.date)}`);
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
    document.getElementById("scheduleRepeatUntilModeInput").addEventListener("change", updateRepeatUntilDateVisibility);

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
  };
})();
