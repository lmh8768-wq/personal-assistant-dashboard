(function () {
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const CATEGORY_COLOR_PRESETS = [
    "#f97316", "#f43f5e", "#f472b6", "#a78bfa", "#6366f1",
    "#60a5fa", "#22d3ee", "#4ade80", "#84cc16", "#94a3b8",
  ];

  let calendarViewDate = new Date(); // which month the big calendar shows
  // Set by the prev/next month buttons right before renderCalendar() runs,
  // so it knows which way to animate; 0 means "just redraw", no page-turn.
  // Same pattern schedule.js's month calendar already uses.
  let monthNavDirection = 0;
  let selectedDate = new Date(); // which day the day-panel is showing
  let analysisMode = "month"; // "month" | "year" — always tied to calendarViewDate
  let editingId = null;
  let modalType = "expense"; // which tab is active in the add/edit modal
  // Deleting a category orphans every entry still using it (they fall back
  // to a permanent "삭제된 카테고리" label with no way to reassign) —
  // exactly as cascading as deleting a whole study year, which already
  // needs an armed second click. Same pattern (click once to arm, click
  // again within a few seconds to actually act), not a native confirm().
  let categoryDeleteArmed = null; // category key currently armed, or null
  let categoryDeleteArmedTimer = null;
  // Bulk-select for the day panel — schedule.js already has this; the
  // ledger day list required deleting one entry at a time.
  let ledgerSelectMode = false;
  let ledgerSelectedIds = new Set();
  // The budget bar (refreshDashboard) only ever warned passively — visible
  // only if the ledger tab happened to be open. Nagging on every single add
  // past the threshold would be worse than the silence it replaces, so each
  // threshold only ever fires once per *month* — tracked against
  // budgetAlertMonthKey so a session that survives a month rollover (a PWA
  // tab left open for days) still gets a fresh warning for the new month
  // instead of staying silenced by last month's flags forever.
  let budgetAlertMonthKey = null;
  let budgetAlert80Shown = false;
  let budgetAlert100Shown = false;
  // Persisted (device-local UI state, not synced) — used to reset to
  // collapsed on every reload/tab-switch even after the user deliberately
  // expanded it.
  const CATEGORY_PROGRESS_EXPANDED_KEY = "ledgerCategoryProgressExpanded";
  let categoryProgressExpanded = localStorage.getItem(CATEGORY_PROGRESS_EXPANDED_KEY) === "true";

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  // getFullYear/getMonth/getDate (local time), never toISOString (UTC) —
  // local-time-only date convention, see scripts/schedule-recurrence.js's
  // parseDateStr for why.
  function toDateStr(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function formatWon(n) {
    return `${Math.round(n || 0).toLocaleString("ko-KR")}원`;
  }

  // Compact form for the small calendar cells — "15,000" doesn't fit, "1.5만" does.
  function formatCompact(n) {
    if (n >= 10000) {
      const man = Math.round((n / 10000) * 10) / 10;
      return `${man}만`;
    }
    return n.toLocaleString("ko-KR");
  }

  // ---------- Live thousands-separator formatting for amount inputs ----------
  // A plain <input type="number"> can't show "12,000" while typing — commas
  // aren't valid there — so these amount fields are type="text" instead,
  // reformatted with commas on every keystroke, with the digits-only value
  // parsed back out via parseAmountInput() wherever it's read for saving.
  // Digits-only text had no upper bound at all — one extra zero fat-fingered
  // in would silently go through as-is. 999,999,999,999원 is far past any
  // real entry but still catches typos.
  const MAX_LEDGER_AMOUNT = 999999999999;

  function formatAmountForInput(value) {
    const digits = String(value ?? "").replace(/[^\d]/g, "");
    if (!digits) return "";
    return Math.min(Number(digits), MAX_LEDGER_AMOUNT).toLocaleString("ko-KR");
  }

  function parseAmountInput(el) {
    const amount = Number((el.value || "").replace(/[^\d]/g, "")) || 0;
    return Math.min(amount, MAX_LEDGER_AMOUNT);
  }

  function bindLiveAmountFormatting(input) {
    input.type = "text";
    input.inputMode = "numeric";
    input.addEventListener("input", () => {
      input.value = formatAmountForInput(input.value);
    });
  }

  function getCategory(key) {
    return window.LedgerCategoryStore.getByKey(key);
  }

  function getCategoryLabel(key) {
    const cat = getCategory(key);
    return cat ? cat.label : "삭제된 카테고리";
  }

  function getCategoryColor(key) {
    const cat = getCategory(key);
    return cat ? cat.color : "#94a3b8";
  }

  function entryType(entry) {
    return entry.type === "income" ? "income" : "expense";
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

  function entriesForDate(dateStr) {
    return window.LedgerEntryStore.getAll().filter((e) => e.date === dateStr);
  }

  function dayTotals(dateStr) {
    const entries = entriesForDate(dateStr);
    let expense = 0;
    let income = 0;
    entries.forEach((e) => {
      if (entryType(e) === "income") income += e.amount;
      else expense += e.amount;
    });
    return { expense, income };
  }

  // Groups every entry by date once, in a single pass — buildCalendarCell
  // used to call dayTotals()/entriesForDate() once per cell, and each of
  // those calls did a fresh LedgerEntryStore.getAll() + full-array .filter()
  // of its own, so rendering one month (42 cells) meant 42 separate full
  // scans of every ledger entry ever recorded. Building this map once per
  // renderCalendar() call and looking up each cell's date in it turns that
  // into a single O(n) pass plus 42 O(1) map lookups.
  function groupEntriesByDate(entries) {
    const map = new Map();
    entries.forEach((e) => {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date).push(e);
    });
    return map;
  }

  function dayTotalsFromEntries(entries) {
    let expense = 0;
    let income = 0;
    entries.forEach((e) => {
      if (entryType(e) === "income") income += e.amount;
      else expense += e.amount;
    });
    return { expense, income };
  }

  // ---------- Calendar (the main view) ----------
  function buildCalendarCell(d, isOutside, entriesByDate) {
    const dStr = toDateStr(d);
    const todayStr = toDateStr(new Date());
    const selectedStr = toDateStr(selectedDate);

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day ledger-calendar-day";
    if (isOutside) cell.classList.add("outside");
    if (dStr === todayStr) cell.classList.add("today");
    if (dStr === selectedStr) cell.classList.add("selected");
    window.CalendarFit.applyWeekendClass(cell, d);
    const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
    const dateLabel = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAY_NAMES[d.getDay()]}요일`;
    cell.setAttribute(
      "aria-label",
      dateLabel + (dStr === todayStr ? " (오늘)" : "") + (dStr === selectedStr ? " (선택됨)" : "")
    );
    if (dStr === todayStr) cell.setAttribute("aria-current", "date");
    cell.setAttribute("aria-pressed", String(dStr === selectedStr));

    const topRow = document.createElement("div");
    topRow.className = "calendar-day-top";
    const num = document.createElement("span");
    num.className = "day-number";
    num.textContent = d.getDate();
    topRow.appendChild(num);
    cell.appendChild(topRow);

    const { expense, income } = dayTotalsFromEntries(entriesByDate.get(dStr) || []);
    if (expense > 0 || income > 0) {
      const amounts = document.createElement("div");
      amounts.className = "ledger-calendar-day-amounts";
      if (expense > 0) {
        const exp = document.createElement("span");
        exp.className = "ledger-calendar-day-expense";
        exp.textContent = `-${formatCompact(expense)}`;
        amounts.appendChild(exp);
      }
      if (income > 0) {
        const inc = document.createElement("span");
        inc.className = "ledger-calendar-day-income";
        inc.textContent = `+${formatCompact(income)}`;
        amounts.appendChild(inc);
      }
      cell.appendChild(amounts);
    }

    cell.addEventListener("click", () => {
      selectedDate = d;
      // Selecting a day outside the shown month brings that month into view.
      if (isOutside) calendarViewDate = new Date(d.getFullYear(), d.getMonth(), 1);
      // Switching days while a bulk selection is active used to leave it
      // silently armed on the PREVIOUS day's entries — a later "전체 선택"
      // then 삭제 could delete entries from two different days at once with
      // no visual cue the older selection was still armed.
      if (ledgerSelectMode && ledgerSelectedIds.size > 0) {
        ledgerSelectedIds.clear();
        updateLedgerSelectToolbar();
      }
      renderCalendar();
      renderDayPanel();
    });

    return cell;
  }

  // Page-turn effect ported from schedule.js's identical month calendar
  // (same .calendar-grid-viewport/.calendar-grid markup and CSS, already
  // shared via calendar-fit.js) — freezes the outgoing month as a ghost
  // that slides out over the grid while the grid (already holding the new
  // month) slides in from the entry side. Without this, rebuilding the
  // grid's innerHTML just swapped content instantly with nothing for a
  // transition to animate.
  function renderCalendar() {
    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const title = document.getElementById("ledgerCalendarTitle");
    if (title) title.textContent = `${year}년 ${month + 1}월`;

    const grid = document.getElementById("ledgerCalendarGrid");
    if (!grid) return;
    const direction = monthNavDirection;
    monthNavDirection = 0;

    grid.parentElement.querySelectorAll(".calendar-grid-ghost").forEach((el) => el.remove());

    let ghost = null;
    if (direction && grid.children.length) {
      ghost = grid.cloneNode(true);
      ghost.removeAttribute("id");
      ghost.classList.add("calendar-grid-ghost");
      grid.parentElement.appendChild(ghost);
    }

    if (ghost) {
      grid.classList.remove("month-nav-animating");
      grid.style.transform = `translateX(${direction > 0 ? "100%" : "-100%"})`;
      grid.style.opacity = "0";
    }

    grid.innerHTML = "";
    const entriesByDate = groupEntriesByDate(window.LedgerEntryStore.getAll());
    buildMonthGrid(year, month).forEach((d) => {
      grid.appendChild(buildCalendarCell(d, d.getMonth() !== month, entriesByDate));
    });

    if (ghost) {
      void grid.offsetWidth;
      grid.classList.add("month-nav-animating");
      grid.style.transform = "translateX(0)";
      grid.style.opacity = "1";
      let gridAnimFallbackTimer;
      const finishGridAnim = () => {
        clearTimeout(gridAnimFallbackTimer);
        grid.removeEventListener("transitionend", finishGridAnim);
        grid.classList.remove("month-nav-animating");
        grid.style.transform = "";
        grid.style.opacity = "";
      };
      grid.addEventListener("transitionend", finishGridAnim, { once: true });
      gridAnimFallbackTimer = setTimeout(finishGridAnim, 500);

      requestAnimationFrame(() => {
        ghost.style.transform = `translateX(${direction > 0 ? "-100%" : "100%"})`;
        ghost.style.opacity = "0";
      });
      ghost.addEventListener("transitionend", () => ghost.remove(), { once: true });
      setTimeout(() => ghost.remove(), 500);
    }
  }

  function shiftMonth(delta) {
    calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() + delta, 1);
    monthNavDirection = delta;
    renderCalendar();
    renderCategoryProgress();
    renderAnalysis();
  }

  // ---------- Day panel (selected date's entries) ----------
  function renderDayPanel() {
    const label = document.getElementById("ledgerSelectedDateLabel");
    if (label) {
      label.textContent = `${selectedDate.getMonth() + 1}월 ${selectedDate.getDate()}일 (${WEEKDAYS[selectedDate.getDay()]})`;
    }

    const dStr = toDateStr(selectedDate);
    const entries = entriesForDate(dStr);

    const summary = document.getElementById("ledgerDaySummary");
    if (summary) {
      const { expense, income } = dayTotals(dStr);
      summary.innerHTML = "";
      if (expense > 0 || income > 0) {
        if (expense > 0) {
          const exp = document.createElement("span");
          exp.className = "ledger-day-summary-expense";
          exp.textContent = `지출 ${formatWon(expense)}`;
          summary.appendChild(exp);
        }
        if (income > 0) {
          const inc = document.createElement("span");
          inc.className = "ledger-day-summary-income";
          inc.textContent = `수입 ${formatWon(income)}`;
          summary.appendChild(inc);
        }
      }
    }

    const list = document.getElementById("ledgerDayEntryList");
    if (!list) return;
    list.innerHTML = "";

    if (entries.length === 0) {
      list.innerHTML = `<li class="schedule-empty"><span class="empty-icon" aria-hidden="true">🧾</span>이 날의 기록이 없어요</li>`;
      return;
    }

    entries.forEach((entry) => {
      const li = document.createElement("li");
      li.className = "schedule-item ledger-entry-item" + (ledgerSelectMode ? " selectable" : "");
      if (ledgerSelectMode && ledgerSelectedIds.has(entry.id)) li.classList.add("selected");

      if (ledgerSelectMode) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "schedule-item-checkbox";
        checkbox.checked = ledgerSelectedIds.has(entry.id);
        checkbox.setAttribute("aria-label", "선택");
        checkbox.addEventListener("click", (e) => e.stopPropagation());
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) ledgerSelectedIds.add(entry.id);
          else ledgerSelectedIds.delete(entry.id);
          li.classList.toggle("selected", checkbox.checked);
          updateLedgerSelectToolbar();
        });
        li.appendChild(checkbox);
      }

      const dot = document.createElement("span");
      dot.className = "schedule-item-category-dot";
      dot.style.background = getCategoryColor(entry.categoryKey);
      // Same fix as schedule.js's identical dot — color alone conveyed the
      // category, with no accessible name at all (not even a title tooltip).
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", `카테고리: ${getCategoryLabel(entry.categoryKey)}`);
      li.appendChild(dot);

      const body = document.createElement("div");
      body.className = "ledger-entry-body";

      const title = document.createElement("div");
      title.className = "schedule-item-title";
      title.textContent = entry.memo || getCategoryLabel(entry.categoryKey);
      body.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "ledger-entry-meta";
      // Once the item name is the title, the category still needs to show
      // up somewhere — folded into the meta line alongside 지출/수입 instead
      // of getting its own line, so entries stay a compact two-line row.
      meta.textContent = entry.memo
        ? `${getCategoryLabel(entry.categoryKey)} · ${entryType(entry) === "income" ? "수입" : "지출"}`
        : entryType(entry) === "income" ? "수입" : "지출";
      body.appendChild(meta);

      li.appendChild(body);

      const amount = document.createElement("span");
      amount.className = "ledger-entry-amount" + (entryType(entry) === "income" ? " income" : "");
      amount.textContent = `${entryType(entry) === "income" ? "+" : "-"}${formatWon(entry.amount)}`;
      li.appendChild(amount);

      const remove = document.createElement("span");
      remove.className = "schedule-item-delete";
      remove.textContent = "×";
      remove.setAttribute("role", "button");
      remove.setAttribute("aria-label", "삭제");
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteEntry(entry.id);
      });
      window.makeKeyboardActivatable(remove);
      li.appendChild(remove);

      li.addEventListener("click", () => {
        if (ledgerSelectMode) {
          const nowSelected = !ledgerSelectedIds.has(entry.id);
          if (nowSelected) ledgerSelectedIds.add(entry.id);
          else ledgerSelectedIds.delete(entry.id);
          li.classList.toggle("selected", nowSelected);
          const checkbox = li.querySelector(".schedule-item-checkbox");
          if (checkbox) checkbox.checked = nowSelected;
          updateLedgerSelectToolbar();
          return;
        }
        openModal("edit", entry);
      });
      // The checkbox/delete controls were already keyboard-reachable, but
      // the row's own primary "open to edit" action (its click listener
      // above) was mouse-only — matches the same fix applied to
      // schedule.js's day-list rows.
      window.makeKeyboardActivatable(li, `${entry.memo || getCategoryLabel(entry.categoryKey)} 내역 편집`);

      list.appendChild(li);
    });
  }

  // ---------- Bulk select ----------
  function updateLedgerSelectToolbar() {
    const toolbar = document.getElementById("ledgerSelectToolbar");
    if (!toolbar) return;
    toolbar.hidden = !ledgerSelectMode;
    const countEl = document.getElementById("ledgerSelectCount");
    if (countEl) countEl.textContent = `${ledgerSelectedIds.size}개 선택됨`;
  }

  function toggleLedgerSelectMode() {
    ledgerSelectMode = !ledgerSelectMode;
    ledgerSelectedIds.clear();
    document.getElementById("ledgerSelectModeBtn").textContent = ledgerSelectMode ? "선택 취소" : "선택";
    updateLedgerSelectToolbar();
    renderDayPanel();
  }

  function handleLedgerSelectAll() {
    const dStr = toDateStr(selectedDate);
    entriesForDate(dStr).forEach((entry) => ledgerSelectedIds.add(entry.id));
    updateLedgerSelectToolbar();
    renderDayPanel();
  }

  function handleLedgerBulkDelete() {
    const ids = [...ledgerSelectedIds];
    // One load+save for the whole batch instead of one full array
    // read/write PER id (was O(k·n), and even worse — getAll() itself was
    // being re-called fresh for every single id too).
    const removedItems = window.LedgerEntryStore.removeMany(ids);
    const count = removedItems.length;
    ledgerSelectedIds.clear();
    ledgerSelectMode = false;
    document.getElementById("ledgerSelectModeBtn").textContent = "선택";
    updateLedgerSelectToolbar();
    renderAll();
    window.Toast?.show(`내역 ${count}개를 삭제했어요`, {
      actionLabel: "실행취소",
      onAction: () => {
        window.LedgerEntryStore.addMany(removedItems);
        renderAll();
      },
    });
  }

  // ---------- Entry modal ----------
  function setModalType(type) {
    modalType = type === "income" ? "income" : "expense";
    document.querySelectorAll("#ledgerTypeTabs .ledger-period-tab").forEach((btn) => {
      const isActive = btn.dataset.type === modalType;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
    });
    syncAllRowCategoryOptions();
  }

  // Switching the 지출/수입 tab swaps out every row's category list for the
  // other type's — the two types never share categories, so there's no
  // matching option to preserve, only the amount each row already has.
  function syncAllRowCategoryOptions() {
    document.querySelectorAll("#ledgerEntryRows .ledger-row-category").forEach((select) => {
      select.innerHTML = "";
      window.LedgerCategoryStore.getByType(modalType).forEach((cat) => {
        const opt = document.createElement("option");
        opt.value = cat.key;
        opt.textContent = cat.label;
        select.appendChild(opt);
      });
    });
  }

  // A row can only be removed down to the last one — with zero rows there'd
  // be nothing to submit, so the last remaining row's × is hidden instead.
  function updateRowRemoveVisibility() {
    const rows = document.querySelectorAll("#ledgerEntryRows .ledger-entry-row");
    rows.forEach((row) => {
      const removeBtn = row.querySelector(".ledger-row-remove");
      if (removeBtn) removeBtn.hidden = rows.length <= 1;
    });
  }

  function buildEntryRow(data) {
    const row = document.createElement("div");
    row.className = "ledger-entry-row";

    const select = document.createElement("select");
    select.className = "ledger-row-category";
    select.setAttribute("aria-label", "카테고리");
    const categories = window.LedgerCategoryStore.getByType(modalType);
    categories.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat.key;
      opt.textContent = cat.label;
      select.appendChild(opt);
    });
    // The entry's saved category may since have been deleted — setting
    // select.value to a key with no matching <option> just leaves nothing
    // selected, so add a synthetic option for it instead of silently
    // reassigning the entry to whatever category happens to be first the
    // next time it's saved. This used to only kick in when EVERY category
    // of the type was gone; the far more common case (deleting just one of
    // several categories, then editing an entry that used it) fell through
    // to the "pick categories[0]" fallback instead, silently re-tagging the
    // entry to an unrelated category the moment any other field was edited.
    const hasMatch = data?.categoryKey && categories.some((c) => c.key === data.categoryKey);
    const isOrphaned = !hasMatch && !!data?.categoryKey;
    if (isOrphaned) {
      const opt = document.createElement("option");
      opt.value = data.categoryKey;
      opt.textContent = "삭제된 카테고리";
      select.appendChild(opt);
    }
    select.value = hasMatch || isOrphaned ? data.categoryKey : categories[0]?.key || "";
    row.appendChild(select);

    const name = document.createElement("input");
    name.type = "text";
    name.className = "ledger-row-name";
    name.placeholder = "항목 이름 (선택)";
    name.maxLength = 60;
    name.setAttribute("aria-label", "항목 이름");
    if (data?.memo) name.value = data.memo;
    row.appendChild(name);

    const amount = document.createElement("input");
    bindLiveAmountFormatting(amount);
    amount.className = "ledger-row-amount";
    amount.placeholder = "예: 12,000";
    amount.setAttribute("aria-label", "금액 (원)");
    if (data?.amount != null) amount.value = formatAmountForInput(data.amount);
    row.appendChild(amount);

    const removeBtn = document.createElement("span");
    removeBtn.className = "checklist-item-remove ledger-row-remove";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("role", "button");
    removeBtn.setAttribute("aria-label", "이 항목 제거");
    removeBtn.addEventListener("click", () => {
      row.remove();
      updateRowRemoveVisibility();
    });
    window.makeKeyboardActivatable(removeBtn);
    row.appendChild(removeBtn);

    return row;
  }

  function addEntryRow() {
    const rowsContainer = document.getElementById("ledgerEntryRows");
    if (!rowsContainer) return;
    const row = buildEntryRow(null);
    rowsContainer.appendChild(row);
    updateRowRemoveVisibility();
    row.querySelector(".ledger-row-amount")?.focus();
  }

  function setSettingsTab(tab) {
    document.querySelectorAll("#ledgerSettingsTabs .ledger-period-tab").forEach((btn) => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
    });
    const categoriesPanel = document.getElementById("ledgerSettingsCategoriesPanel");
    const analysisPanel = document.getElementById("ledgerSettingsAnalysisPanel");
    if (categoriesPanel) categoriesPanel.hidden = tab !== "categories";
    if (analysisPanel) analysisPanel.hidden = tab !== "analysis";
  }

  function openCategoryManager() {
    const overlay = document.getElementById("ledgerCategoryModalOverlay");
    if (!overlay) return;
    setSettingsTab("categories");
    overlay.hidden = false;
  }

  function closeCategoryManager() {
    const overlay = document.getElementById("ledgerCategoryModalOverlay");
    if (overlay) overlay.hidden = true;
  }

  function buildCategorySettingsButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ledger-settings-btn";
    btn.setAttribute("aria-label", "설정 열기");
    btn.innerHTML = `<span aria-hidden="true">⚙️</span>`;
    btn.addEventListener("click", openCategoryManager);
    return btn;
  }

  function openModal(mode, data) {
    let type = mode === "edit" ? entryType(data) : "expense";
    // Editing an existing entry must stay reachable even if every category
    // of its type has since been deleted — otherwise those entries become
    // permanently stuck (viewable and deletable, but not editable at all)
    // until the user recreates a category first. Adding a brand-new entry
    // genuinely can't proceed with nowhere to categorize it — but the add
    // modal itself has both 지출/수입 tabs, so a user with zero expense
    // categories but real income categories can still add an income entry;
    // only redirect when BOTH types are empty, and default to whichever
    // type actually has something to pick from.
    if (mode !== "edit") {
      const hasExpense = window.LedgerCategoryStore.getByType("expense").length > 0;
      const hasIncome = window.LedgerCategoryStore.getByType("income").length > 0;
      if (!hasExpense && !hasIncome) {
        window.Toast?.show("먼저 카테고리를 추가해주세요", { type: "warning" });
        openCategoryManager();
        return;
      }
      if (!hasExpense && hasIncome) type = "income";
    }
    editingId = mode === "edit" ? data.id : null;
    document.getElementById("ledgerModalTitle").textContent = mode === "edit" ? "내역 수정" : "내역 추가";
    setModalType(type);
    document.getElementById("ledgerDateInput").value = data?.date || toDateStr(selectedDate);

    const rowsContainer = document.getElementById("ledgerEntryRows");
    rowsContainer.innerHTML = "";
    rowsContainer.appendChild(buildEntryRow(mode === "edit" ? { categoryKey: data.categoryKey, amount: data.amount, memo: data.memo } : null));
    updateRowRemoveVisibility();

    // Adding several entries at once only makes sense when creating new
    // ones — editing is always about a single already-existing entry.
    document.getElementById("ledgerAddRowBtn").hidden = mode === "edit";
    document.getElementById("deleteLedgerEntryBtn").hidden = mode !== "edit";
    document.getElementById("duplicateLedgerEntryBtn").hidden = mode !== "edit";
    document.getElementById("ledgerModalOverlay").hidden = false;
    rowsContainer.querySelector(".ledger-row-amount")?.focus();
  }

  function closeModal() {
    document.getElementById("ledgerModalOverlay").hidden = true;
    editingId = null;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const date = document.getElementById("ledgerDateInput").value;
    const rows = [...document.querySelectorAll("#ledgerEntryRows .ledger-entry-row")];

    if (editingId) {
      const row = rows[0];
      const amount = parseAmountInput(row.querySelector(".ledger-row-amount"));
      if (!amount || amount <= 0) {
        window.Toast?.show("금액을 입력해주세요", { type: "warning" });
        return;
      }
      window.LedgerEntryStore.update(editingId, {
        date,
        amount,
        categoryKey: row.querySelector(".ledger-row-category").value,
        memo: row.querySelector(".ledger-row-name").value.trim(),
        type: modalType,
      });
      window.Toast?.show("내역을 수정했어요");
      closeModal();
      renderAll();
      // Was only checked on the add-new path — correcting an existing
      // entry's amount upward (e.g. fixing a typo'd 10,000 into 100,000)
      // could push the month over budget with no warning at all, even
      // though a brand-new entry doing the same thing triggers one.
      if (modalType === "expense") checkBudgetAlert();
      return;
    }

    // Rows left at 0/empty are treated as abandoned, not an error — only
    // an entirely empty submission (nothing filled in at all) is rejected.
    const entries = rows
      .map((row) => ({
        date,
        amount: parseAmountInput(row.querySelector(".ledger-row-amount")),
        categoryKey: row.querySelector(".ledger-row-category").value,
        memo: row.querySelector(".ledger-row-name").value.trim(),
        type: modalType,
      }))
      .filter((entry) => entry.amount > 0);

    if (entries.length === 0) {
      window.Toast?.show("금액을 입력해주세요", { type: "warning" });
      return;
    }

    window.LedgerEntryStore.addMany(entries);
    window.Toast?.show(entries.length > 1 ? `${entries.length}건 추가했어요` : "내역을 추가했어요");
    closeModal();
    renderAll();
    if (entries.some((entry) => entryType(entry) === "expense")) checkBudgetAlert();
  }

  // Fires once per session per threshold, right when an expense addition is
  // what pushes the current month over it — separate from the passive
  // budget bar (refreshDashboard), which only ever informs someone already
  // looking at the ledger tab.
  function checkBudgetAlert() {
    const totalBudget = window.LedgerCategoryStore.getByType("expense").reduce((sum, c) => sum + (c.budget || 0), 0);
    if (totalBudget === 0) return;
    const mKey = toDateStr(new Date()).slice(0, 7);
    if (mKey !== budgetAlertMonthKey) {
      budgetAlertMonthKey = mKey;
      budgetAlert80Shown = false;
      budgetAlert100Shown = false;
    }
    const totalSpent = window.LedgerEntryStore.getAll()
      .filter((e) => e.date.slice(0, 7) === mKey && entryType(e) === "expense")
      .reduce((sum, e) => sum + e.amount, 0);
    const pct = Math.round((totalSpent / totalBudget) * 100);
    if (pct >= 100 && !budgetAlert100Shown) {
      budgetAlert100Shown = true;
      window.Toast?.show(`이번 달 지출이 목표(${formatWon(totalBudget)})를 넘었어요`, { type: "error", duration: 8000 });
    } else if (pct >= 80 && !budgetAlert80Shown) {
      budgetAlert80Shown = true;
      window.Toast?.show(`이번 달 지출이 목표의 ${pct}%에 도달했어요`, { type: "warning", duration: 8000 });
    }
  }

  function handleDeleteFromModal() {
    if (!editingId) return;
    const id = editingId;
    closeModal();
    deleteEntry(id);
  }

  // A recurring purchase (e.g. a subscription) used to have to be re-typed
  // from scratch every time — schedule.js already has this same "⧉ 복제"
  // pattern for its own edit modal.
  function handleDuplicateEntry() {
    if (!editingId) return;
    // Reads the CURRENTLY-open form fields, not the last-saved entry — a
    // user who edited a field and clicked 복제 instead of 저장 used to have
    // that edit silently discarded (the duplicate copied the pre-edit data,
    // and the original was never saved either).
    const row = document.querySelector("#ledgerEntryRows .ledger-entry-row");
    if (!row) return;
    const amount = parseAmountInput(row.querySelector(".ledger-row-amount"));
    if (!amount || amount <= 0) {
      window.Toast?.show("금액을 입력해주세요", { type: "warning" });
      return;
    }
    window.LedgerEntryStore.add({
      date: document.getElementById("ledgerDateInput").value,
      amount,
      categoryKey: row.querySelector(".ledger-row-category").value,
      memo: row.querySelector(".ledger-row-name").value.trim(),
      type: modalType,
    });
    closeModal();
    renderAll();
    window.Toast?.show("내역을 복제했어요");
  }

  function deleteEntry(id) {
    const removed = window.LedgerEntryStore.remove(id);
    renderAll();
    if (removed && window.Toast) {
      window.Toast.show("내역을 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          window.LedgerEntryStore.restore(removed.item, removed.index);
          renderAll();
        },
      });
    }
  }

  // The actual compute/apply logic lives in scripts/calendar-fit.js now —
  // shared with schedule.js, which used to hand-maintain an identical copy.
  // The one thing this view needs on top: the 목표 소비 budget section sits
  // above the calendar here (schedule has nothing above its layout), so its
  // rendered height has to be subtracted from the space the calendar gets
  // to fit into as well.
  function applyLedgerCalendarFit() {
    window.CalendarFit.apply({
      layoutId: "ledgerLayout",
      panelId: "ledgerCalendarPanel",
      gridId: "ledgerCalendarGrid",
      extraHeight: () => {
        // Its own margin-bottom (20px, see .ledger-total-budget-section)
        // needs to come along — that gap disappears too if absent.
        const budgetSection = document.getElementById("ledgerTotalBudgetSection");
        return budgetSection ? budgetSection.getBoundingClientRect().height + 20 : 0;
      },
    });
  }

  let ledgerResizeTimer = null;

  // ---------- Category budget progress (expense categories, calendarViewDate's month) ----------
  function renderCategoryProgress() {
    const totalRow = document.getElementById("ledgerTotalBudgetRow");
    const rowsContainer = document.getElementById("ledgerCategoryRows");
    // The expand/collapse toggle button's own icon rotation was already
    // smoothly animated (.ledger-expand-icon), but the content it reveals
    // just snapped open/closed via rowsContainer.hidden with nothing to
    // animate from — toggling .collapsed on this wrapping .collapse-region
    // instead (same grid-rows trick the goal trees already use) lets the
    // content's height animate too, in step with the icon.
    const rowsRegion = document.getElementById("ledgerCategoryRowsRegion");
    if (!totalRow || !rowsContainer) return;
    // Same reasoning as settings.js's storage gauge: totalRow gets rebuilt
    // via innerHTML on every entry add/edit/delete and month change, so the
    // fill's own `transition: width` never had an old value to animate
    // from — a brand-new element with the final width already set just
    // snapped there instantly every time. Capture whatever was already
    // on-screen before it gets wiped below.
    const previousFillWidth = totalRow.querySelector(".ledger-total-budget-fill")?.style.width || "0%";
    totalRow.innerHTML = "";
    rowsContainer.innerHTML = "";

    const categories = window.LedgerCategoryStore.getByType("expense");
    if (categories.length === 0) {
      const header = document.createElement("div");
      header.className = "ledger-total-budget-header";
      const titleGroup = document.createElement("div");
      titleGroup.className = "ledger-total-budget-title-group";
      const title = document.createElement("span");
      title.className = "ledger-total-budget-title";
      title.textContent = `${calendarViewDate.getMonth() + 1}월 목표 소비`;
      titleGroup.appendChild(title);
      titleGroup.appendChild(buildCategorySettingsButton());
      header.appendChild(titleGroup);
      totalRow.appendChild(header);

      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `<span class="empty-icon" aria-hidden="true">🏷️</span><p>지출 카테고리를 추가해주세요</p>`;
      totalRow.appendChild(empty);
      if (rowsRegion) rowsRegion.classList.add("collapsed");
      applyLedgerCalendarFit();
      return;
    }

    const mKey = toDateStr(calendarViewDate).slice(0, 7);
    const monthEntries = window.LedgerEntryStore.getAll().filter(
      (e) => e.date.slice(0, 7) === mKey && entryType(e) === "expense"
    );

    const totalSpent = monthEntries.reduce((sum, e) => sum + e.amount, 0);
    const totalBudget = categories.reduce((sum, c) => sum + (c.budget || 0), 0);
    const pct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : null;

    const header = document.createElement("div");
    header.className = "ledger-total-budget-header";

    const titleGroup = document.createElement("div");
    titleGroup.className = "ledger-total-budget-title-group";

    const title = document.createElement("span");
    title.className = "ledger-total-budget-title";
    title.textContent = `${calendarViewDate.getMonth() + 1}월 목표 소비`;
    titleGroup.appendChild(title);
    titleGroup.appendChild(buildCategorySettingsButton());
    header.appendChild(titleGroup);

    const value = document.createElement("span");
    value.className = "ledger-total-budget-value";
    value.textContent = pct === null ? "목표 미설정" : `${formatWon(totalSpent)} / ${formatWon(totalBudget)} · ${pct}%`;
    header.appendChild(value);

    totalRow.appendChild(header);

    const trackRow = document.createElement("div");
    trackRow.className = "ledger-total-budget-track-row";

    const track = document.createElement("div");
    track.className = "ledger-total-budget-track";
    const fill = document.createElement("div");
    fill.className = "ledger-total-budget-fill" + (pct !== null && pct >= 100 ? " over" : pct !== null && pct >= 80 ? " warning" : "");
    const targetWidth = pct === null ? "0%" : `${Math.min(100, pct)}%`;
    fill.style.width = previousFillWidth;
    fill.setAttribute("role", "progressbar");
    fill.setAttribute("aria-valuenow", String(pct === null ? 0 : Math.min(100, pct)));
    fill.setAttribute("aria-valuemin", "0");
    fill.setAttribute("aria-valuemax", "100");
    track.appendChild(fill);
    requestAnimationFrame(() => {
      fill.style.width = targetWidth;
    });
    trackRow.appendChild(track);

    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "ledger-expand-btn";
    expandBtn.setAttribute("aria-label", categoryProgressExpanded ? "카테고리별 목표 접기" : "카테고리별 목표 펼치기");
    expandBtn.innerHTML = `<span class="ledger-expand-icon${categoryProgressExpanded ? " expanded" : ""}">▾</span>`;
    expandBtn.addEventListener("click", () => {
      categoryProgressExpanded = !categoryProgressExpanded;
      // safeSetLocalStorage, not a bare setItem — every other persisted
      // write in this app goes through it specifically because a bare
      // setItem throws under quota-exceeded/Safari-private-mode; this one
      // used to be the one exception, which would abort this handler before
      // ever reaching renderCategoryProgress() below, leaving the arrow
      // icon and the variable disagreeing about the expanded state.
      window.safeSetLocalStorage(CATEGORY_PROGRESS_EXPANDED_KEY, String(categoryProgressExpanded));
      renderCategoryProgress();
    });
    trackRow.appendChild(expandBtn);

    totalRow.appendChild(trackRow);

    if (rowsRegion) rowsRegion.classList.toggle("collapsed", !categoryProgressExpanded);

    categories.forEach((cat) => {
      const spent = monthEntries
        .filter((e) => e.categoryKey === cat.key)
        .reduce((sum, e) => sum + e.amount, 0);

      const row = document.createElement("div");
      row.className = "ledger-category-row";

      const top = document.createElement("div");
      top.className = "ledger-category-row-top";

      const dot = document.createElement("span");
      dot.className = "ledger-category-dot";
      dot.style.background = cat.color;
      top.appendChild(dot);

      const label = document.createElement("span");
      label.className = "ledger-category-row-label";
      label.textContent = cat.label;
      top.appendChild(label);

      const amountText = document.createElement("span");
      amountText.className = "ledger-category-row-amount";
      amountText.textContent = cat.budget > 0 ? `${formatWon(spent)} / ${formatWon(cat.budget)}` : formatWon(spent);
      top.appendChild(amountText);

      row.appendChild(top);

      if (cat.budget > 0) {
        const pct = Math.round((spent / cat.budget) * 100);
        const trackRow = document.createElement("div");
        trackRow.className = "ledger-progress-row";

        const track = document.createElement("div");
        track.className = "ledger-progress-track";
        const fill = document.createElement("div");
        fill.className = "ledger-progress-fill" + (pct >= 100 ? " over" : pct >= 80 ? " warning" : "");
        fill.style.width = `${Math.min(100, pct)}%`;
        fill.style.background = cat.color;
        fill.setAttribute("role", "progressbar");
        fill.setAttribute("aria-valuenow", String(Math.min(100, pct)));
        fill.setAttribute("aria-valuemin", "0");
        fill.setAttribute("aria-valuemax", "100");
        fill.setAttribute("aria-label", cat.label);
        track.appendChild(fill);
        trackRow.appendChild(track);

        const pctLabel = document.createElement("span");
        pctLabel.className = "ledger-progress-pct";
        pctLabel.textContent = `${pct}%`;
        trackRow.appendChild(pctLabel);

        row.appendChild(trackRow);
      } else {
        const noGoal = document.createElement("span");
        noGoal.className = "ledger-progress-pct ledger-progress-pct-muted";
        noGoal.textContent = "목표 미설정";
        row.appendChild(noGoal);
      }

      rowsContainer.appendChild(row);
    });

    applyLedgerCalendarFit();
  }

  // ---------- Category manager (add / rename / recolor / set budget / delete) ----------
  function buildCategoryEditRow(cat) {
    const row = document.createElement("div");
    row.className = "category-edit-row";
    row.dataset.key = cat.key;

    const topRow = document.createElement("div");
    topRow.className = "ledger-category-edit-top";

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.value = cat.label;
    labelInput.maxLength = 10;
    labelInput.addEventListener("change", () => {
      window.LedgerCategoryStore.update(cat.key, { label: labelInput.value.trim() || cat.label });
      renderAll();
    });
    topRow.appendChild(labelInput);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    const armed = categoryDeleteArmed === cat.key;
    removeBtn.className = "checklist-item-remove goal-year-remove" + (armed ? " confirm-armed" : "");
    removeBtn.textContent = armed ? "확인" : "×";
    removeBtn.setAttribute("aria-label", armed ? `${cat.label} 카테고리 삭제 확인 (다시 누르면 삭제됩니다)` : `${cat.label} 카테고리 삭제`);
    removeBtn.addEventListener("click", () => {
      if (categoryDeleteArmed !== cat.key) {
        categoryDeleteArmed = cat.key;
        clearTimeout(categoryDeleteArmedTimer);
        categoryDeleteArmedTimer = setTimeout(() => {
          if (categoryDeleteArmed === cat.key) {
            categoryDeleteArmed = null;
            renderCategoryManager();
          }
        }, 4000);
        renderCategoryManager();
        return;
      }
      clearTimeout(categoryDeleteArmedTimer);
      categoryDeleteArmed = null;
      const removed = window.LedgerCategoryStore.remove(cat.key);
      renderAll();
      if (removed && window.Toast) {
        window.Toast.show(`"${cat.label}" 카테고리를 삭제했어요`, {
          actionLabel: "실행취소",
          onAction: () => {
            window.LedgerCategoryStore.restore(removed.item, removed.index);
            renderAll();
          },
        });
      }
    });
    topRow.appendChild(removeBtn);

    row.appendChild(topRow);

    if (cat.type === "expense") {
      const budgetRow = document.createElement("label");
      budgetRow.className = "ledger-category-budget-row";
      const budgetText = document.createElement("span");
      budgetText.textContent = "월 목표";
      budgetRow.appendChild(budgetText);
      const budgetInput = document.createElement("input");
      bindLiveAmountFormatting(budgetInput);
      budgetInput.placeholder = "0";
      budgetInput.value = cat.budget ? formatAmountForInput(cat.budget) : "";
      budgetInput.addEventListener("change", () => {
        window.LedgerCategoryStore.update(cat.key, { budget: parseAmountInput(budgetInput) });
        renderAll();
      });
      budgetRow.appendChild(budgetInput);
      const budgetUnit = document.createElement("span");
      budgetUnit.textContent = "원";
      budgetRow.appendChild(budgetUnit);
      row.appendChild(budgetRow);
    }

    const swatchGroup = document.createElement("div");
    swatchGroup.className = "category-color-swatches";
    const palette = CATEGORY_COLOR_PRESETS.includes(cat.color)
      ? CATEGORY_COLOR_PRESETS
      : [cat.color, ...CATEGORY_COLOR_PRESETS];
    palette.forEach((color) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "category-color-swatch" + (color === cat.color ? " active" : "");
      swatch.style.background = color;
      swatch.setAttribute("aria-label", `색상 ${color}`);
      swatch.addEventListener("click", () => {
        window.LedgerCategoryStore.update(cat.key, { color });
        renderAll();
      });
      swatchGroup.appendChild(swatch);
    });
    row.appendChild(swatchGroup);

    return row;
  }

  function renderCategoryManager() {
    const expenseContainer = document.getElementById("ledgerExpenseCategoryEditRows");
    const incomeContainer = document.getElementById("ledgerIncomeCategoryEditRows");
    if (!expenseContainer || !incomeContainer) return;
    expenseContainer.innerHTML = "";
    incomeContainer.innerHTML = "";
    window.LedgerCategoryStore.getByType("expense").forEach((cat) => expenseContainer.appendChild(buildCategoryEditRow(cat)));
    window.LedgerCategoryStore.getByType("income").forEach((cat) => incomeContainer.appendChild(buildCategoryEditRow(cat)));
  }

  // Repeated "+" clicks without renaming used to pile up several
  // identically-named categories with no way to tell them apart — number
  // the placeholder ("새 카테고리 2", "새 카테고리 3", ...) when the base
  // name's already taken.
  function uniqueCategoryLabel(base, existingLabels) {
    if (!existingLabels.includes(base)) return base;
    let n = 2;
    while (existingLabels.includes(`${base} ${n}`)) n += 1;
    return `${base} ${n}`;
  }

  function addCategory(type) {
    const existing = window.LedgerCategoryStore.getByType(type);
    const color = CATEGORY_COLOR_PRESETS[existing.length % CATEGORY_COLOR_PRESETS.length];
    const baseLabel = type === "income" ? "새 수입 카테고리" : "새 카테고리";
    const label = uniqueCategoryLabel(baseLabel, existing.map((c) => c.label));
    const created = window.LedgerCategoryStore.add(label, color, type);
    renderAll();
    requestAnimationFrame(() => {
      const row = document.querySelector(`.category-edit-row[data-key="${created.key}"]`);
      const input = row?.querySelector('input[type="text"]');
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  // ---------- Month/year analysis (always tied to calendarViewDate) ----------
  function buildBarList(items) {
    const wrap = document.createElement("div");
    wrap.className = "ledger-bar-list";
    const max = Math.max(...items.map((i) => i.value), 1);
    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "ledger-bar-row";

      const label = document.createElement("span");
      label.className = "ledger-bar-label";
      label.textContent = item.label;
      row.appendChild(label);

      const track = document.createElement("div");
      track.className = "ledger-bar-track";
      const fill = document.createElement("div");
      fill.className = "ledger-bar-fill";
      fill.style.width = `${Math.max(2, (item.value / max) * 100)}%`;
      fill.style.background = item.color;
      track.appendChild(fill);
      row.appendChild(track);

      const value = document.createElement("span");
      value.className = "ledger-bar-value";
      value.textContent = formatWon(item.value);
      row.appendChild(value);

      wrap.appendChild(row);
    });
    return wrap;
  }

  function renderAnalysis() {
    const body = document.getElementById("ledgerAnalysisBody");
    const totalLabel = document.getElementById("ledgerTotalLabel");
    const totalValue = document.getElementById("ledgerTotalValue");
    if (!body) return;

    const allEntries = window.LedgerEntryStore.getAll();
    const expenseCategories = window.LedgerCategoryStore.getByType("expense");
    body.innerHTML = "";

    if (analysisMode === "month") {
      const mKey = toDateStr(calendarViewDate).slice(0, 7);
      totalLabel.textContent = `${calendarViewDate.getMonth() + 1}월 지출`;

      const monthEntries = allEntries.filter((e) => e.date.slice(0, 7) === mKey);
      const expense = monthEntries.filter((e) => entryType(e) === "expense").reduce((s, e) => s + e.amount, 0);
      const income = monthEntries.filter((e) => entryType(e) === "income").reduce((s, e) => s + e.amount, 0);
      totalValue.textContent = formatWon(expense);

      const incomeNote = document.createElement("p");
      incomeNote.className = "ledger-category-progress-note";
      incomeNote.textContent = `수입 ${formatWon(income)}`;
      body.appendChild(incomeNote);

      const byCategory = expenseCategories
        .map((cat) => ({
          label: cat.label,
          color: cat.color,
          value: monthEntries.filter((e) => e.categoryKey === cat.key && entryType(e) === "expense").reduce((s, e) => s + e.amount, 0),
        }))
        .filter((c) => c.value > 0)
        .sort((a, b) => b.value - a.value);

      if (byCategory.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.innerHTML = `<span class="empty-icon" aria-hidden="true">🧾</span><p>이 달엔 기록된 지출이 없어요</p>`;
        body.appendChild(empty);
      } else {
        body.appendChild(buildBarList(byCategory));
      }
    } else {
      const year = calendarViewDate.getFullYear();
      totalLabel.textContent = `${year}년 지출`;

      const yearEntries = allEntries.filter((e) => e.date.slice(0, 4) === String(year));
      const expense = yearEntries.filter((e) => entryType(e) === "expense").reduce((s, e) => s + e.amount, 0);
      const income = yearEntries.filter((e) => entryType(e) === "income").reduce((s, e) => s + e.amount, 0);
      totalValue.textContent = formatWon(expense);

      const incomeNote = document.createElement("p");
      incomeNote.className = "ledger-category-progress-note";
      incomeNote.textContent = `수입 ${formatWon(income)}`;
      body.appendChild(incomeNote);

      if (yearEntries.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.innerHTML = `<span class="empty-icon" aria-hidden="true">🧾</span><p>이 해엔 기록된 내역이 없어요</p>`;
        body.appendChild(empty);
        return;
      }

      const byMonth = Array.from({ length: 12 }, (_, i) => {
        const mm = pad2(i + 1);
        const value = yearEntries
          .filter((e) => e.date.slice(5, 7) === mm && entryType(e) === "expense")
          .reduce((sum, e) => sum + e.amount, 0);
        return { label: `${i + 1}월`, value, color: "var(--accent)" };
      });

      const byCategory = expenseCategories
        .map((cat) => ({
          label: cat.label,
          color: cat.color,
          value: yearEntries.filter((e) => e.categoryKey === cat.key && entryType(e) === "expense").reduce((s, e) => s + e.amount, 0),
        }))
        .filter((c) => c.value > 0)
        .sort((a, b) => b.value - a.value);

      const monthHeading = document.createElement("p");
      monthHeading.className = "ledger-analysis-subheading";
      monthHeading.textContent = "월별 지출";
      body.appendChild(monthHeading);
      body.appendChild(buildBarList(byMonth));

      if (byCategory.length > 0) {
        const catHeading = document.createElement("p");
        catHeading.className = "ledger-analysis-subheading";
        catHeading.textContent = "카테고리별";
        body.appendChild(catHeading);
        body.appendChild(buildBarList(byCategory));
      }
    }
  }

  // ---------- Dashboard (이번 달 목표 소비) ----------
  // Always the real current month, unlike renderCategoryProgress()'s bar
  // (tied to whichever month calendarViewDate happens to be showing).
  function refreshDashboard() {
    const fillEl = document.getElementById("budgetRateFill");
    const valueEl = document.getElementById("budgetRateValue");
    if (!fillEl || !valueEl) return;

    const totalBudget = window.LedgerCategoryStore.getByType("expense").reduce((sum, c) => sum + (c.budget || 0), 0);
    const mKey = toDateStr(new Date()).slice(0, 7);
    const totalSpent = window.LedgerEntryStore.getAll()
      .filter((e) => e.date.slice(0, 7) === mKey && entryType(e) === "expense")
      .reduce((sum, e) => sum + e.amount, 0);

    fillEl.classList.remove("warning", "over");
    fillEl.setAttribute("role", "progressbar");
    fillEl.setAttribute("aria-valuemin", "0");
    fillEl.setAttribute("aria-valuemax", "100");
    if (totalBudget === 0) {
      fillEl.style.width = "0%";
      fillEl.setAttribute("aria-valuenow", "0");
      valueEl.textContent = "목표 미설정";
      return;
    }

    const pct = Math.round((totalSpent / totalBudget) * 100);
    fillEl.style.width = `${Math.min(100, pct)}%`;
    fillEl.setAttribute("aria-valuenow", String(Math.min(100, pct)));
    if (pct >= 100) fillEl.classList.add("over");
    else if (pct >= 80) fillEl.classList.add("warning");
    valueEl.textContent = `${formatWon(totalSpent)} / ${formatWon(totalBudget)} · ${pct}%`;
  }

  function renderAll() {
    renderCalendar();
    renderDayPanel();
    renderCategoryProgress();
    renderCategoryManager();
    renderAnalysis();
    refreshDashboard();
  }

  function init() {
    document.getElementById("addLedgerEntryBtn")?.addEventListener("click", () => openModal("add"));
    document.getElementById("ledgerSelectModeBtn")?.addEventListener("click", toggleLedgerSelectMode);
    document.getElementById("ledgerSelectAllBtn")?.addEventListener("click", handleLedgerSelectAll);
    document.getElementById("ledgerBulkDeleteBtn")?.addEventListener("click", handleLedgerBulkDelete);
    document.getElementById("ledgerAddRowBtn")?.addEventListener("click", addEntryRow);
    document.getElementById("cancelLedgerBtn")?.addEventListener("click", closeModal);
    document.getElementById("closeLedgerModalBtn")?.addEventListener("click", closeModal);
    document.getElementById("ledgerForm")?.addEventListener("submit", handleSubmit);
    document.getElementById("deleteLedgerEntryBtn")?.addEventListener("click", handleDeleteFromModal);
    document.getElementById("duplicateLedgerEntryBtn")?.addEventListener("click", handleDuplicateEntry);
    document.getElementById("ledgerModalOverlay")?.addEventListener("click", (e) => {
      if (e.target.id === "ledgerModalOverlay") closeModal();
    });
    document.getElementById("ledgerCategoryModalOverlay")?.addEventListener("click", (e) => {
      if (e.target.id === "ledgerCategoryModalOverlay") closeCategoryManager();
    });
    document.getElementById("closeLedgerCategoryModalBtn")?.addEventListener("click", closeCategoryManager);
    document.getElementById("closeLedgerCategoryModalTopBtn")?.addEventListener("click", closeCategoryManager);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!document.getElementById("ledgerModalOverlay").hidden) closeModal();
      else if (!document.getElementById("ledgerCategoryModalOverlay").hidden) closeCategoryManager();
    });

    document.querySelectorAll("#ledgerTypeTabs .ledger-period-tab").forEach((btn) => {
      btn.addEventListener("click", () => setModalType(btn.dataset.type));
    });

    document.getElementById("addLedgerExpenseCategoryBtn")?.addEventListener("click", () => addCategory("expense"));
    document.getElementById("addLedgerIncomeCategoryBtn")?.addEventListener("click", () => addCategory("income"));

    document.getElementById("ledgerPrevMonthBtn")?.addEventListener("click", () => shiftMonth(-1));
    document.getElementById("ledgerNextMonthBtn")?.addEventListener("click", () => shiftMonth(1));
    document.getElementById("ledgerTodayBtn")?.addEventListener("click", () => {
      const now = new Date();
      calendarViewDate = new Date(now.getFullYear(), now.getMonth(), 1);
      selectedDate = now;
      renderCalendar();
      renderDayPanel();
    });

    document.querySelectorAll(".ledger-period-tabs .ledger-period-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.classList.contains("active")) return;
        analysisMode = btn.dataset.period;
        document.querySelectorAll(".ledger-period-tabs .ledger-period-tab").forEach((b) => {
          b.classList.toggle("active", b === btn);
          b.setAttribute("aria-selected", String(b === btn));
        });
        renderAnalysis();
      });
    });

    document.querySelectorAll("#ledgerSettingsTabs .ledger-period-tab").forEach((btn) => {
      btn.addEventListener("click", () => setSettingsTab(btn.dataset.tab));
    });

    renderAll();
    applyLedgerCalendarFit();

    window.addEventListener("resize", () => {
      clearTimeout(ledgerResizeTimer);
      ledgerResizeTimer = setTimeout(applyLedgerCalendarFit, 200);
    });
  }

  // onShow used to be just applyLedgerCalendarFit (a layout-fit check), so
  // a change made elsewhere (e.g. cloud sync pulling in another device's
  // edits) while this tab wasn't active never showed up until a full page
  // reload — same gap already fixed for practice/study/vongole/exercise,
  // just missed here since this tab already had *some* onShow.
  window.LedgerView = {
    init,
    onShow: () => {
      renderAll();
      applyLedgerCalendarFit();
    },
    refreshDashboard,
    // Used by global search (search.js) — a result used to only switch to
    // this tab, landing on whatever month/date happened to already be
    // selected rather than the found entry's actual date.
    goToDate: (dateStr) => {
      const [y, m, d] = dateStr.split("-").map(Number);
      const target = new Date(y, m - 1, d);
      calendarViewDate = new Date(y, m - 1, 1);
      selectedDate = target;
      renderAll();
    },
  };
})();
