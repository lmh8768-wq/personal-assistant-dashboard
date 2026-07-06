(function () {
  let viewDate = new Date();
  let selectedDate = new Date();
  let editingId = null;

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const REMINDER_PRESETS = ["10", "30", "60", "1440"];
  const DEFAULT_IMPORTANCE = 3;

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

  function renderScheduleItem(item, onClick) {
    const li = document.createElement("li");
    li.className = "schedule-item";

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

      grid.appendChild(cell);
    });
  }

  function renderDayList() {
    document.getElementById("selectedDateLabel").textContent = formatDayLabel(selectedDate);

    const list = document.getElementById("scheduleList");
    list.innerHTML = "";
    const items = window.ScheduleStore.getOccurrences(toDateStr(selectedDate));

    if (items.length === 0) {
      list.innerHTML = `<li class="schedule-empty">이 날에는 일정이 없어요</li>`;
      return;
    }
    items.forEach((item) => list.appendChild(renderScheduleItem(item, (it) => openModal("edit", it))));
  }

  function renderDashboardSchedule() {
    const list = document.getElementById("dashboardScheduleList");
    if (!list) return;

    const items = window.ScheduleStore.getOccurrences(toDateStr(new Date()));
    const statEl = document.getElementById("statTodayCount");
    if (statEl) statEl.textContent = items.length;

    list.innerHTML = "";
    if (items.length === 0) {
      list.innerHTML = `<li class="schedule-empty">오늘 등록된 일정이 없어요</li>`;
      return;
    }
    items.forEach((item) => list.appendChild(renderScheduleItem(item, (it) => openModal("edit", it))));
  }

  function refreshAll() {
    renderCalendar();
    renderDayList();
    renderDashboardSchedule();
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
    if (editingId) window.ScheduleStore.remove(editingId);
    closeModal();
    refreshAll();
  }

  function init() {
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

  window.ScheduleView = { init, refreshDashboard: renderDashboardSchedule };
})();
