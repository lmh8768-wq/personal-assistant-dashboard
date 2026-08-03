(function () {
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const CATEGORY_COLOR_PRESETS = [
    "#f97316", "#f43f5e", "#f472b6", "#a78bfa", "#6366f1",
    "#60a5fa", "#22d3ee", "#4ade80", "#84cc16", "#94a3b8",
  ];

  let calendarViewDate = new Date(); // which month the big calendar shows
  let selectedDate = new Date(); // which day the day-panel is showing
  let analysisMode = "month"; // "month" | "year" — always tied to calendarViewDate
  let editingId = null;
  let modalType = "expense"; // which tab is active in the add/edit modal
  let categoryProgressExpanded = false; // whether the per-category breakdown is shown

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

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

  // ---------- Calendar (the main view) ----------
  function buildCalendarCell(d, isOutside) {
    const dStr = toDateStr(d);
    const todayStr = toDateStr(new Date());
    const selectedStr = toDateStr(selectedDate);

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day ledger-calendar-day";
    if (isOutside) cell.classList.add("outside");
    if (dStr === todayStr) cell.classList.add("today");
    if (dStr === selectedStr) cell.classList.add("selected");
    if (d.getDay() === 0) cell.classList.add("weekday-sun");
    if (d.getDay() === 6) cell.classList.add("weekday-sat");

    const topRow = document.createElement("div");
    topRow.className = "calendar-day-top";
    const num = document.createElement("span");
    num.className = "day-number";
    num.textContent = d.getDate();
    topRow.appendChild(num);
    cell.appendChild(topRow);

    const { expense, income } = dayTotals(dStr);
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
      renderCalendar();
      renderDayPanel();
    });

    return cell;
  }

  function renderCalendar() {
    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const title = document.getElementById("ledgerCalendarTitle");
    if (title) title.textContent = `${year}년 ${month + 1}월`;

    const grid = document.getElementById("ledgerCalendarGrid");
    if (!grid) return;
    grid.innerHTML = "";
    buildMonthGrid(year, month).forEach((d) => {
      grid.appendChild(buildCalendarCell(d, d.getMonth() !== month));
    });
  }

  function shiftMonth(delta) {
    calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() + delta, 1);
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
      list.innerHTML = `<li class="schedule-empty"><span class="empty-icon">🧾</span>이 날의 기록이 없어요</li>`;
      return;
    }

    entries.forEach((entry) => {
      const li = document.createElement("li");
      li.className = "schedule-item ledger-entry-item";

      const dot = document.createElement("span");
      dot.className = "schedule-item-category-dot";
      dot.style.background = getCategoryColor(entry.categoryKey);
      li.appendChild(dot);

      const body = document.createElement("div");
      body.className = "ledger-entry-body";

      const title = document.createElement("div");
      title.className = "schedule-item-title";
      title.textContent = entry.memo || getCategoryLabel(entry.categoryKey);
      body.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "ledger-entry-meta";
      meta.textContent = entry.memo ? getCategoryLabel(entry.categoryKey) : (entryType(entry) === "income" ? "수입" : "지출");
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
      li.appendChild(remove);

      li.addEventListener("click", () => openModal("edit", entry));

      list.appendChild(li);
    });
  }

  // ---------- Entry modal ----------
  function setModalType(type) {
    modalType = type === "income" ? "income" : "expense";
    document.querySelectorAll("#ledgerTypeTabs .ledger-period-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.type === modalType);
    });
    syncCategorySelectOptions();
  }

  function syncCategorySelectOptions() {
    const select = document.getElementById("ledgerCategoryInput");
    if (!select) return;
    const current = select.value;
    select.innerHTML = "";
    window.LedgerCategoryStore.getByType(modalType).forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat.key;
      opt.textContent = cat.label;
      select.appendChild(opt);
    });
    if (current && [...select.options].some((o) => o.value === current)) select.value = current;
  }

  function setSettingsTab(tab) {
    document.querySelectorAll("#ledgerSettingsTabs .ledger-period-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
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
    const type = mode === "edit" ? entryType(data) : "expense";
    if (window.LedgerCategoryStore.getByType(type).length === 0) {
      window.Toast?.show("먼저 카테고리를 추가해주세요", { type: "warning" });
      openCategoryManager();
      return;
    }
    editingId = mode === "edit" ? data.id : null;
    document.getElementById("ledgerModalTitle").textContent = mode === "edit" ? "내역 수정" : "내역 추가";
    setModalType(type);
    document.getElementById("ledgerDateInput").value = data?.date || toDateStr(selectedDate);
    document.getElementById("ledgerAmountInput").value = data?.amount ?? "";
    document.getElementById("ledgerCategoryInput").value = data?.categoryKey || window.LedgerCategoryStore.getByType(type)[0].key;
    document.getElementById("ledgerMemoInput").value = data?.memo || "";
    document.getElementById("deleteLedgerEntryBtn").hidden = mode !== "edit";
    document.getElementById("ledgerModalOverlay").hidden = false;
    document.getElementById("ledgerAmountInput").focus();
  }

  function closeModal() {
    document.getElementById("ledgerModalOverlay").hidden = true;
    document.getElementById("ledgerForm").reset();
    editingId = null;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const amount = Number(document.getElementById("ledgerAmountInput").value);
    if (!amount || amount <= 0) {
      window.Toast?.show("금액을 입력해주세요", { type: "warning" });
      return;
    }
    const payload = {
      date: document.getElementById("ledgerDateInput").value,
      amount,
      categoryKey: document.getElementById("ledgerCategoryInput").value,
      memo: document.getElementById("ledgerMemoInput").value.trim(),
      type: modalType,
    };
    if (editingId) {
      window.LedgerEntryStore.update(editingId, payload);
      window.Toast?.show("내역을 수정했어요");
    } else {
      window.LedgerEntryStore.add(payload);
      window.Toast?.show("내역을 추가했어요");
    }
    closeModal();
    renderAll();
  }

  function handleDeleteFromModal() {
    if (!editingId) return;
    const id = editingId;
    closeModal();
    deleteEntry(id);
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

  // ---------- Category budget progress (expense categories, calendarViewDate's month) ----------
  function renderCategoryProgress() {
    const totalRow = document.getElementById("ledgerTotalBudgetRow");
    const rowsContainer = document.getElementById("ledgerCategoryRows");
    if (!totalRow || !rowsContainer) return;
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
      empty.innerHTML = `<span class="empty-icon">🏷️</span><p>지출 카테고리를 추가해주세요</p>`;
      totalRow.appendChild(empty);
      rowsContainer.hidden = true;
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
    fill.style.width = pct === null ? "0%" : `${Math.min(100, pct)}%`;
    track.appendChild(fill);
    trackRow.appendChild(track);

    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "ledger-expand-btn";
    expandBtn.setAttribute("aria-label", categoryProgressExpanded ? "카테고리별 목표 접기" : "카테고리별 목표 펼치기");
    expandBtn.innerHTML = `<span class="ledger-expand-icon${categoryProgressExpanded ? " expanded" : ""}">▾</span>`;
    expandBtn.addEventListener("click", () => {
      categoryProgressExpanded = !categoryProgressExpanded;
      renderCategoryProgress();
    });
    trackRow.appendChild(expandBtn);

    totalRow.appendChild(trackRow);

    rowsContainer.hidden = !categoryProgressExpanded;

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
    removeBtn.className = "checklist-item-remove";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `${cat.label} 카테고리 삭제`);
    removeBtn.addEventListener("click", () => {
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
      budgetInput.type = "number";
      budgetInput.min = "0";
      budgetInput.step = "1000";
      budgetInput.placeholder = "0";
      budgetInput.value = cat.budget || "";
      budgetInput.addEventListener("change", () => {
        window.LedgerCategoryStore.update(cat.key, { budget: Number(budgetInput.value) || 0 });
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

  function addCategory(type) {
    const existingCount = window.LedgerCategoryStore.getByType(type).length;
    const color = CATEGORY_COLOR_PRESETS[existingCount % CATEGORY_COLOR_PRESETS.length];
    const created = window.LedgerCategoryStore.add(type === "income" ? "새 수입 카테고리" : "새 카테고리", color, type);
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
        empty.innerHTML = `<span class="empty-icon">🧾</span><p>이 달엔 기록된 지출이 없어요</p>`;
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
        empty.innerHTML = `<span class="empty-icon">🧾</span><p>이 해엔 기록된 내역이 없어요</p>`;
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

  function renderAll() {
    renderCalendar();
    renderDayPanel();
    renderCategoryProgress();
    renderCategoryManager();
    renderAnalysis();
  }

  function init() {
    document.getElementById("addLedgerEntryBtn")?.addEventListener("click", () => openModal("add"));
    document.getElementById("cancelLedgerBtn")?.addEventListener("click", closeModal);
    document.getElementById("ledgerForm")?.addEventListener("submit", handleSubmit);
    document.getElementById("deleteLedgerEntryBtn")?.addEventListener("click", handleDeleteFromModal);
    document.getElementById("ledgerModalOverlay")?.addEventListener("click", (e) => {
      if (e.target.id === "ledgerModalOverlay") closeModal();
    });
    document.getElementById("ledgerCategoryModalOverlay")?.addEventListener("click", (e) => {
      if (e.target.id === "ledgerCategoryModalOverlay") closeCategoryManager();
    });
    document.getElementById("closeLedgerCategoryModalBtn")?.addEventListener("click", closeCategoryManager);
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
        document.querySelectorAll(".ledger-period-tabs .ledger-period-tab").forEach((b) => b.classList.toggle("active", b === btn));
        renderAnalysis();
      });
    });

    document.querySelectorAll("#ledgerSettingsTabs .ledger-period-tab").forEach((btn) => {
      btn.addEventListener("click", () => setSettingsTab(btn.dataset.tab));
    });

    renderAll();
  }

  window.LedgerView = { init };
})();
