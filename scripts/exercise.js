(function () {
  const RECORDS_KEY = "assistant.exerciseRecords.v1";

  // ---------- Personal records (러닝 / 삼대운동) ----------
  let recordsCache = null;
  window.__resetStoreCaches.push(() => {
    recordsCache = null;
  });

  function loadRecords() {
    if (recordsCache) return { ...recordsCache };
    try {
      const raw = localStorage.getItem(RECORDS_KEY);
      recordsCache = raw ? JSON.parse(raw) : {};
    } catch {
      recordsCache = {};
    }
    return { ...recordsCache };
  }

  function saveRecords(records) {
    if (window.safeSetLocalStorage(RECORDS_KEY, JSON.stringify(records))) {
      recordsCache = records;
    }
  }

  const ExerciseRecordStore = {
    get() {
      return loadRecords();
    },
    update(patch) {
      const records = { ...loadRecords(), ...patch };
      saveRecords(records);
      return records;
    },
  };
  window.ExerciseRecordStore = ExerciseRecordStore;

  // ---------- Body parts (a proper, manageable category — like ledger/
  // schedule categories, not free text) ----------
  const BODY_PART_KEY = "assistant.exerciseBodyParts.v1";
  const DEFAULT_BODY_PARTS = [
    { key: "chest", label: "가슴" },
    { key: "back", label: "등" },
    { key: "shoulder", label: "어깨" },
    { key: "arm", label: "팔" },
    { key: "leg", label: "하체" },
    { key: "abs", label: "복근" },
  ];

  function createBodyPartKey() {
    return `bp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  let bodyPartsCache = null;
  window.__resetStoreCaches.push(() => {
    bodyPartsCache = null;
  });

  function loadBodyParts() {
    if (bodyPartsCache) return bodyPartsCache.map((p) => ({ ...p }));
    try {
      const raw = localStorage.getItem(BODY_PART_KEY);
      if (!raw) {
        bodyPartsCache = DEFAULT_BODY_PARTS.map((p) => ({ ...p }));
        return bodyPartsCache.map((p) => ({ ...p }));
      }
      const parsed = JSON.parse(raw);
      bodyPartsCache = Array.isArray(parsed) ? parsed : DEFAULT_BODY_PARTS.map((p) => ({ ...p }));
    } catch {
      bodyPartsCache = DEFAULT_BODY_PARTS.map((p) => ({ ...p }));
    }
    return bodyPartsCache.map((p) => ({ ...p }));
  }

  function saveBodyParts(parts) {
    if (window.safeSetLocalStorage(BODY_PART_KEY, JSON.stringify(parts))) {
      bodyPartsCache = parts;
    }
  }

  window.BodyPartStore = {
    ...window.createKeyedStore(loadBodyParts, saveBodyParts),
    add(label) {
      const parts = loadBodyParts();
      const item = { key: createBodyPartKey(), label };
      parts.push(item);
      saveBodyParts(parts);
      window.DeletionTombstones.forget([item.key]);
      return item;
    },
  };

  function getBodyPartLabel(key) {
    return window.BodyPartStore.getByKey(key)?.label || "삭제된 부위";
  }

  // Migration: 운동 기록's 부위 field used to be free text typed directly
  // into an input, so an entry from before this change holds a label string
  // (e.g. "가슴") instead of a real BodyPartStore key. Rewrites any such
  // entry to reference a key instead — reusing a matching body part's key
  // when the label happens to match one, minting a fresh one otherwise — so
  // renaming a body part later actually updates everywhere it's used, which
  // a plain string never could.
  //
  // Deliberately NOT gated behind a one-time-ever flag: this function is
  // naturally idempotent (it only ever touches a bodyPart value that ISN'T
  // already a real key, so a fully-migrated entry is never touched again),
  // and a flag would wrongly mark migration "done" the very first time this
  // runs against empty data (e.g. before the exercise tab was ever used) —
  // permanently skipping it for data that arrives later (a second device
  // still on an older version syncing in more free-text entries, etc).
  function migrateBodyPartsToKeys() {
    const existingKeys = new Set(window.BodyPartStore.getAll().map((p) => p.key));
    const existingByLabel = new Map(window.BodyPartStore.getAll().map((p) => [p.label, p.key]));

    const logs = window.ExerciseLogStore.getAll();
    const routines = loadBodyPartRoutines();

    const labelsToMigrate = new Set();
    logs.forEach((entry) => entry.bodyPart && !existingKeys.has(entry.bodyPart) && labelsToMigrate.add(entry.bodyPart));
    Object.keys(routines).forEach((label) => !existingKeys.has(label) && labelsToMigrate.add(label));

    if (labelsToMigrate.size === 0) return;

    const labelToKey = new Map();
    labelsToMigrate.forEach((label) => {
      labelToKey.set(label, existingByLabel.has(label) ? existingByLabel.get(label) : window.BodyPartStore.add(label).key);
    });

    logs.forEach((entry) => {
      if (entry.bodyPart && labelToKey.has(entry.bodyPart)) {
        window.ExerciseLogStore.update(entry.id, { bodyPart: labelToKey.get(entry.bodyPart) });
      }
    });
    const migratedRoutines = { ...routines };
    Object.keys(routines).forEach((label) => {
      if (!labelToKey.has(label)) return;
      const key = labelToKey.get(label);
      migratedRoutines[key] = routines[label];
      if (key !== label) delete migratedRoutines[label];
    });
    saveBodyPartRoutines(migratedRoutines);
  }

  // ---------- Exercise log (which body part(s) were worked, and when) ----------
  // A dated, id-keyed list — createEntityStore (store.js, loaded before this
  // file) gives it the same in-memory cache, deletion-tombstone handling,
  // and safe-write behavior every other list-shaped store in the app already
  // has, instead of hand-rolling another copy of that here.
  window.ExerciseLogStore = window.createEntityStore("assistant.exerciseLog.v1", "exlog");

  // ---------- Per-body-part routine notes (keyed by BodyPartStore key) ----------
  const BODY_PART_ROUTINE_KEY = "assistant.bodyPartRoutines.v1";

  let bodyPartRoutinesCache = null;
  window.__resetStoreCaches.push(() => {
    bodyPartRoutinesCache = null;
  });

  function loadBodyPartRoutines() {
    // A fresh copy every time — update() below writes directly onto
    // whatever object it gets back (data[key] = text / delete data[key]),
    // so returning the cache itself here would corrupt it before
    // saveBodyPartRoutines() ever confirms the write persisted.
    if (bodyPartRoutinesCache) return { ...bodyPartRoutinesCache };
    try {
      const raw = localStorage.getItem(BODY_PART_ROUTINE_KEY);
      const data = raw ? JSON.parse(raw) : {};
      bodyPartRoutinesCache = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch {
      bodyPartRoutinesCache = {};
    }
    return { ...bodyPartRoutinesCache };
  }

  function saveBodyPartRoutines(data) {
    if (window.safeSetLocalStorage(BODY_PART_ROUTINE_KEY, JSON.stringify(data))) {
      bodyPartRoutinesCache = data;
    }
  }

  const BodyPartRoutineStore = {
    get(bodyPartKey) {
      return loadBodyPartRoutines()[bodyPartKey] || "";
    },
    update(bodyPartKey, text) {
      const data = loadBodyPartRoutines();
      if (text) data[bodyPartKey] = text;
      else delete data[bodyPartKey];
      saveBodyPartRoutines(data);
    },
  };
  window.BodyPartRoutineStore = BodyPartRoutineStore;

  // getFullYear/getMonth/getDate (local time), never toISOString (UTC) —
  // same local-time-only date convention the rest of the app uses (see
  // schedule-recurrence.js's parseDateStr for why).
  function todayStr() {
    return toDateStr(new Date());
  }

  function toDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function formatShortDateLabel(dateStr) {
    const [, m, d] = dateStr.split("-").map(Number);
    return `${m}월 ${d}일`;
  }

  function daysSince(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const then = new Date(y, m - 1, d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((today - then) / 86400000);
  }

  // Every registered body part, longest-idle first — a part with no record
  // at all sorts last, since "never logged" isn't the same signal as "N
  // days overdue" and shouldn't crowd out the parts that actually need
  // attention soonest. Shared by the exercise tab's own top-of-tab summary
  // and the dashboard panel mirroring it.
  function sortedBodyPartsByLastWorked() {
    const parts = window.BodyPartStore.getAll();
    const lastWorked = lastWorkedDateByBodyPart();
    return [...parts].sort((a, b) => {
      const aDate = lastWorked[a.key];
      const bDate = lastWorked[b.key];
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return daysSince(bDate) - daysSince(aDate);
    });
  }

  // Every registered body part's days-since-last-worked, shown as a row of
  // chips at the very top of the exercise tab — the per-group "며칠 전"
  // badge inside 배운 운동 only ever showed up for a body part that already
  // had a learned exercise registered under it, and only after scrolling
  // past the log list to find its group, so at-a-glance "what's overdue"
  // needed both data (every registered body part, not just ones with a
  // 배운 운동 group) and placement (top of the tab, not buried mid-page).
  function renderLastWorkedSummary() {
    const container = document.getElementById("exerciseLastWorkedSummary");
    if (!container) return;
    container.innerHTML = "";

    const sorted = sortedBodyPartsByLastWorked();
    if (sorted.length === 0) return;

    const lastWorked = lastWorkedDateByBodyPart();
    sorted.forEach((part) => {
      const chip = document.createElement("div");
      chip.className = "exercise-last-worked-chip";

      const label = document.createElement("span");
      label.className = "exercise-last-worked-chip-label";
      label.textContent = part.label;
      chip.appendChild(label);

      const value = document.createElement("span");
      value.className = "exercise-last-worked-chip-value";
      const lastDate = lastWorked[part.key];
      if (lastDate) {
        const days = daysSince(lastDate);
        value.textContent = days <= 0 ? "오늘" : `${days}일 전`;
      } else {
        value.textContent = "기록 없음";
        chip.classList.add("no-record");
      }
      chip.appendChild(value);

      container.appendChild(chip);
    });
  }

  // Latest logged date per body part, for the "며칠 전" badge next to each
  // 배운 운동 group heading.
  function lastWorkedDateByBodyPart() {
    const map = {};
    window.ExerciseLogStore.getAll().forEach((entry) => {
      if (!map[entry.bodyPart] || entry.date > map[entry.bodyPart]) {
        map[entry.bodyPart] = entry.date;
      }
    });
    return map;
  }

  // ---------- Exercise log (date + body part, freely chosen — not just today) ----------
  // Shared by both the log's own 부위 select and 배운 운동's add-exercise
  // form — a plain <select> populated fresh from BodyPartStore every render,
  // instead of a free-text input with datalist autocomplete, so a logged/
  // learned entry can only ever reference a body part that actually exists.
  function populateBodyPartSelect(select, selectedKey) {
    if (!select) return;
    select.innerHTML = "";
    window.BodyPartStore.getAll().forEach((part) => {
      const opt = document.createElement("option");
      opt.value = part.key;
      opt.textContent = part.label;
      select.appendChild(opt);
    });
    if (selectedKey && select.querySelector(`option[value="${selectedKey}"]`)) {
      select.value = selectedKey;
    }
  }

  // Shows the current calendar week plus the two weeks before it (21 days:
  // Sunday of two weeks ago through Saturday of this week) — replaces the
  // old always-visible flat list of every log entry ever recorded, opened
  // on demand from a calendar button next to the 운동 기록 heading instead
  // of taking up permanent space on the tab. A logged day's date number
  // turns green (.has-log); the body part(s) logged that day show beneath
  // it, each one itself a button that deletes that entry (with undo) —
  // the only way to remove a log entry now that the flat list is gone.
  function renderExerciseLogCalendar() {
    const grid = document.getElementById("exerciseLogCalendarGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const today = new Date();
    const currentWeekSunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    const start = new Date(currentWeekSunday.getFullYear(), currentWeekSunday.getMonth(), currentWeekSunday.getDate() - 14);

    const entriesByDate = {};
    window.ExerciseLogStore.getAll().forEach((entry) => {
      if (!entriesByDate[entry.date]) entriesByDate[entry.date] = [];
      entriesByDate[entry.date].push(entry);
    });

    const todayStrValue = todayStr();
    for (let i = 0; i < 21; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const dStr = toDateStr(d);
      const dayEntries = entriesByDate[dStr] || [];

      const cell = document.createElement("div");
      cell.className = "calendar-day";
      if (dStr === todayStrValue) cell.classList.add("today");
      if (d.getDay() === 0) cell.classList.add("weekday-sun");
      if (d.getDay() === 6) cell.classList.add("weekday-sat");

      const topRow = document.createElement("div");
      topRow.className = "calendar-day-top";
      const num = document.createElement("span");
      num.className = "day-number" + (dayEntries.length > 0 ? " has-log" : "");
      num.textContent = d.getDate();
      topRow.appendChild(num);
      cell.appendChild(topRow);

      if (dayEntries.length > 0) {
        const eventsWrap = document.createElement("div");
        eventsWrap.className = "calendar-day-events";
        dayEntries.forEach((entry) => {
          const label = getBodyPartLabel(entry.bodyPart);
          const partBtn = document.createElement("button");
          partBtn.type = "button";
          partBtn.className = "exercise-log-calendar-day-part";
          partBtn.textContent = label;
          partBtn.setAttribute("aria-label", `${formatShortDateLabel(entry.date)} ${label} 기록 삭제`);
          partBtn.addEventListener("click", () => {
            const removed = window.ExerciseLogStore.remove(entry.id);
            renderExerciseLogCalendar();
            renderBodyPartRoutines();
            if (removed && window.Toast) {
              window.Toast.show(`"${label}" 기록을 삭제했어요`, {
                actionLabel: "실행취소",
                onAction: () => {
                  window.ExerciseLogStore.restore(removed.item, removed.index);
                  renderExerciseLogCalendar();
                  renderBodyPartRoutines();
                },
              });
            }
          });
          eventsWrap.appendChild(partBtn);
        });
        cell.appendChild(eventsWrap);
      }

      grid.appendChild(cell);
    }
  }

  function openExerciseLogCalendarModal() {
    document.getElementById("exerciseLogCalendarModalOverlay").hidden = false;
    renderExerciseLogCalendar();
  }

  function closeExerciseLogCalendarModal() {
    document.getElementById("exerciseLogCalendarModalOverlay").hidden = true;
  }

  function handleExerciseLogAdd() {
    if (window.BodyPartStore.getAll().length === 0) {
      window.Toast?.show("먼저 부위를 추가해주세요", { type: "warning" });
      return;
    }
    const dateInput = document.getElementById("exerciseLogDateInput");
    const bodyPartSelect = document.getElementById("exerciseLogBodyPartInput");
    const date = dateInput.value || todayStr();
    const bodyPart = bodyPartSelect.value;
    if (!bodyPart) return;
    // A repeated submit of the same part on the same day would just clutter
    // the log with no new information — the date is already granular enough.
    const alreadyLogged = window.ExerciseLogStore.getAll().some((e) => e.date === date && e.bodyPart === bodyPart);
    if (alreadyLogged) {
      window.Toast?.show("이미 기록한 날짜/부위예요", { type: "warning" });
      return;
    }
    window.ExerciseLogStore.add({ date, bodyPart });
    renderBodyPartRoutines();
    // The flat log list this used to refresh into view is gone — a toast
    // is now the only feedback that the record actually saved, since the
    // calendar showing it only renders when opened.
    window.Toast?.show(`${formatShortDateLabel(date)} ${getBodyPartLabel(bodyPart)} 기록을 저장했어요`);
  }

  // ---------- Body part manager (add / rename / delete) ----------
  // Deleting is armed-then-confirm (click once to arm, click again within a
  // few seconds to actually delete) rather than a native confirm() — same
  // pattern ledger.js's own category manager already uses, since deleting a
  // body part orphans every learned exercise/log entry still referencing it
  // (they fall back to "삭제된 부위", same as a deleted ledger/schedule
  // category falls back to its own placeholder label).
  let bodyPartDeleteArmed = null;
  let bodyPartDeleteArmedTimer = null;

  function renderBodyPartManager() {
    const list = document.getElementById("exerciseBodyPartManagerList");
    if (!list) return;
    list.innerHTML = "";

    window.BodyPartStore.getAll().forEach((part) => {
      const row = document.createElement("li");
      row.className = "checklist-item";

      const labelInput = document.createElement("input");
      labelInput.type = "text";
      labelInput.value = part.label;
      labelInput.maxLength = 10;
      labelInput.setAttribute("aria-label", `${part.label} 이름 수정`);
      labelInput.addEventListener("change", () => {
        const label = labelInput.value.trim();
        if (!label) {
          labelInput.value = part.label;
          return;
        }
        window.BodyPartStore.update(part.key, { label });
        renderBodyPartRoutines();
        populateBodyPartSelect(document.getElementById("exerciseLogBodyPartInput"));
      });
      row.appendChild(labelInput);

      const armed = bodyPartDeleteArmed === part.key;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "checklist-item-remove goal-year-remove" + (armed ? " confirm-armed" : "");
      removeBtn.textContent = armed ? "확인" : "×";
      removeBtn.setAttribute("aria-label", armed ? `${part.label} 삭제 확인 (다시 누르면 삭제됩니다)` : `${part.label} 삭제`);
      removeBtn.addEventListener("click", () => {
        if (bodyPartDeleteArmed !== part.key) {
          bodyPartDeleteArmed = part.key;
          clearTimeout(bodyPartDeleteArmedTimer);
          bodyPartDeleteArmedTimer = setTimeout(() => {
            if (bodyPartDeleteArmed === part.key) {
              bodyPartDeleteArmed = null;
              renderBodyPartManager();
            }
          }, 4000);
          renderBodyPartManager();
          return;
        }
        clearTimeout(bodyPartDeleteArmedTimer);
        bodyPartDeleteArmed = null;
        const removed = window.BodyPartStore.remove(part.key);
        renderBodyPartManager();
        renderBodyPartRoutines();
        populateBodyPartSelect(document.getElementById("exerciseLogBodyPartInput"));
        if (removed && window.Toast) {
          window.Toast.show(`"${part.label}" 부위를 삭제했어요`, {
            actionLabel: "실행취소",
            onAction: () => {
              window.BodyPartStore.restore(removed.item, removed.index);
              renderBodyPartManager();
              renderBodyPartRoutines();
              populateBodyPartSelect(document.getElementById("exerciseLogBodyPartInput"));
            },
          });
        }
      });
      row.appendChild(removeBtn);

      list.appendChild(row);
    });
  }

  // Repeated "+" clicks without renaming would otherwise pile up several
  // identically-named "새 부위" entries with no way to tell them apart —
  // same fix ledger.js/settings.js's own category "+" buttons already have.
  function uniqueBodyPartLabel() {
    const existing = window.BodyPartStore.getAll().map((p) => p.label);
    const base = "새 부위";
    if (!existing.includes(base)) return base;
    let n = 2;
    while (existing.includes(`${base} ${n}`)) n += 1;
    return `${base} ${n}`;
  }

  function handleAddBodyPart() {
    window.BodyPartStore.add(uniqueBodyPartLabel());
    renderBodyPartManager();
    populateBodyPartSelect(document.getElementById("exerciseLogBodyPartInput"));
  }

  // ---------- Personal records panel ----------
  function renderRecordsPanel() {
    const records = ExerciseRecordStore.get();
    document.getElementById("exerciseRecordRunDistanceInput").value = records.runDistance ?? "";
    document.getElementById("exerciseRecordRunPaceInput").value = records.runPace ?? "";
    document.getElementById("exerciseRecordSquatInput").value = records.squat ?? "";
    document.getElementById("exerciseRecordBenchInput").value = records.bench ?? "";
    document.getElementById("exerciseRecordDeadliftInput").value = records.deadlift ?? "";
  }

  // ---------- Per-body-part routine list ----------
  // One row per registered body part (not just ones with logged history),
  // in BodyPartStore's own order — replaces the old 배운 운동 (name/weight/
  // sets tracking, grouped by body part) with a plain "what's the routine
  // for this part" note, which is all BodyPartRoutineStore ever stored
  // anyway; 배운 운동's per-exercise tracking is gone, not folded in here.
  function renderBodyPartRoutines() {
    // Every call site that mutates the log, a body part, or a routine
    // already calls this right alongside (or instead of) its own render —
    // piggybacking here keeps the top summary in sync everywhere without
    // having to thread a separate call into each of those sites.
    renderLastWorkedSummary();

    const list = document.getElementById("bodyPartRoutineList");
    if (!list) return;
    list.innerHTML = "";

    const parts = window.BodyPartStore.getAll();
    if (parts.length === 0) {
      list.innerHTML = `<li class="schedule-empty"><span class="empty-icon" aria-hidden="true">📋</span>먼저 부위를 추가해주세요</li>`;
      return;
    }

    parts.forEach((part) => {
      const li = document.createElement("li");
      li.className = "body-part-routine-row";

      const label = document.createElement("span");
      label.className = "body-part-routine-label";
      label.textContent = part.label;
      li.appendChild(label);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "body-part-routine-input";
      input.setAttribute("aria-label", `${part.label} 루틴`);
      input.value = window.BodyPartRoutineStore.get(part.key);
      input.addEventListener("change", () => {
        window.BodyPartRoutineStore.update(part.key, input.value.trim());
      });
      li.appendChild(input);

      list.appendChild(li);
    });
  }

  // "5'30\"" (분'초"/km) — minutes 1-2 digits, seconds 00-59.
  const RUN_PACE_PATTERN = /^\d{1,2}'[0-5]\d"$/;

  // Kept separate from handleRecordFieldChange (below) so an invalid pace
  // being typed doesn't block saving the other 4 fields, which all share
  // that one "change" handler.
  function handlePaceFieldChange() {
    const paceInput = document.getElementById("exerciseRecordRunPaceInput");
    const paceValue = paceInput.value.trim();
    if (paceValue && !RUN_PACE_PATTERN.test(paceValue)) {
      if (window.Toast) window.Toast.show("페이스는 분'초\" 형식으로 입력해주세요 (예: 5'30\")", { type: "warning" });
      paceInput.value = ExerciseRecordStore.get().runPace ?? "";
      return;
    }
    ExerciseRecordStore.update({ runPace: paceValue });
    renderDashboardExercise();
  }

  // A number input's min/max attributes only apply to the spinner arrows —
  // typing (or pasting) a value outside that range is accepted as-is by the
  // browser. Without this, e.g. "-50" in 스쿼트 saved and displayed as a
  // personal record.
  function clampFieldValue(id, min, max) {
    const el = document.getElementById(id);
    const raw = el.value.trim();
    if (raw === "") return "";
    const num = Number(raw);
    if (Number.isNaN(num)) return "";
    const clamped = Math.min(max, Math.max(min, num));
    if (clamped !== num) el.value = String(clamped);
    return String(clamped);
  }

  function handleRecordFieldChange() {
    ExerciseRecordStore.update({
      runDistance: clampFieldValue("exerciseRecordRunDistanceInput", 0, 500),
      squat: clampFieldValue("exerciseRecordSquatInput", 0, 500),
      bench: clampFieldValue("exerciseRecordBenchInput", 0, 500),
      deadlift: clampFieldValue("exerciseRecordDeadliftInput", 0, 500),
    });
    renderDashboardExercise();
  }

  // ---------- Dashboard panel ----------
  // Mirrors the exercise tab's own top-of-tab summary (renderLastWorkedSummary)
  // instead of the personal-records display this replaced — oldest-worked
  // body part first, so it's visible at a glance without opening the tab.
  function renderDashboardExercise() {
    const container = document.getElementById("dashboardExerciseBodyPartStatus");
    if (!container) return;
    container.innerHTML = "";

    const sorted = sortedBodyPartsByLastWorked();
    if (sorted.length === 0) {
      container.innerHTML = `<div class="practice-status-row"><span>등록된 부위가 없어요</span></div>`;
      return;
    }

    const lastWorked = lastWorkedDateByBodyPart();
    sorted.forEach((part) => {
      const row = document.createElement("div");
      row.className = "practice-status-row";

      const label = document.createElement("strong");
      label.textContent = part.label;
      row.appendChild(label);

      const value = document.createElement("span");
      const lastDate = lastWorked[part.key];
      if (lastDate) {
        const days = daysSince(lastDate);
        value.textContent = days <= 0 ? "오늘" : `${days}일 전`;
      } else {
        value.textContent = "기록 없음";
      }
      row.appendChild(value);

      container.appendChild(row);
    });
  }

  function init() {
    migrateBodyPartsToKeys();

    const bodyPartManageBtn = document.getElementById("exerciseBodyPartManageBtn");
    const bodyPartManager = document.getElementById("exerciseBodyPartManager");
    if (bodyPartManageBtn && bodyPartManager) {
      bodyPartManageBtn.addEventListener("click", () => {
        bodyPartManager.hidden = !bodyPartManager.hidden;
        bodyPartManageBtn.setAttribute("aria-expanded", String(!bodyPartManager.hidden));
        if (!bodyPartManager.hidden) renderBodyPartManager();
      });
    }
    document.getElementById("exerciseBodyPartAddBtn")?.addEventListener("click", handleAddBodyPart);

    const dateInput = document.getElementById("exerciseLogDateInput");
    if (dateInput) dateInput.value = todayStr();
    document.getElementById("exerciseLogAddBtn")?.addEventListener("click", handleExerciseLogAdd);

    document.getElementById("exerciseLogCalendarBtn")?.addEventListener("click", openExerciseLogCalendarModal);
    document.getElementById("closeExerciseLogCalendarModalBtn")?.addEventListener("click", closeExerciseLogCalendarModal);
    document.getElementById("exerciseLogCalendarModalOverlay")?.addEventListener("click", (e) => {
      if (e.target.id === "exerciseLogCalendarModalOverlay") closeExerciseLogCalendarModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!document.getElementById("exerciseLogCalendarModalOverlay").hidden) closeExerciseLogCalendarModal();
    });

    [
      "exerciseRecordRunDistanceInput",
      "exerciseRecordSquatInput",
      "exerciseRecordBenchInput",
      "exerciseRecordDeadliftInput",
    ].forEach((id) => {
      document.getElementById(id).addEventListener("change", handleRecordFieldChange);
    });
    document.getElementById("exerciseRecordRunPaceInput").addEventListener("change", handlePaceFieldChange);

    renderRecordsPanel();
    populateBodyPartSelect(document.getElementById("exerciseLogBodyPartInput"));
    renderBodyPartRoutines();
    renderDashboardExercise();
  }

  // Same gap as practice.js's curriculum tree (see its onShow comment) —
  // this tab's records panel and learned-exercise list only ever rendered
  // once, at app startup.
  window.ExerciseView = {
    init,
    refreshDashboard: renderDashboardExercise,
    onShow: () => {
      migrateBodyPartsToKeys();
      renderRecordsPanel();
      populateBodyPartSelect(document.getElementById("exerciseLogBodyPartInput"));
      renderBodyPartRoutines();
    },
  };
})();
