(function () {
  const RECORDS_KEY = "assistant.exerciseRecords.v1";
  const LEARNED_KEY = "assistant.learnedExercises.v1";

  function createId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ---------- Personal records (러닝 / 삼대운동) ----------
  function loadRecords() {
    try {
      const raw = localStorage.getItem(RECORDS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveRecords(records) {
    window.safeSetLocalStorage(RECORDS_KEY, JSON.stringify(records));
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

  // ---------- Learned exercises (grouped by body part) ----------
  function loadLearned() {
    try {
      const raw = localStorage.getItem(LEARNED_KEY);
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function saveLearned(items) {
    window.safeSetLocalStorage(LEARNED_KEY, JSON.stringify(items));
  }

  const LearnedExerciseStore = {
    getAll() {
      return loadLearned();
    },
    add(entry) {
      const items = loadLearned();
      const item = { id: createId("lex"), ...entry };
      items.push(item);
      saveLearned(items);
      return item;
    },
    update(id, patch) {
      const items = loadLearned();
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1) return null;
      items[idx] = { ...items[idx], ...patch };
      saveLearned(items);
      return items[idx];
    },
    remove(id) {
      const items = loadLearned();
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1) return null;
      const [removed] = items.splice(idx, 1);
      saveLearned(items);
      return { item: removed, index: idx };
    },
    restore(item, index) {
      const items = loadLearned();
      // Only the upper bound was clamped — see store.js's createKeyedStore/
      // createEntityStore.restore for the same fix and why it matters.
      const at = Math.min(Math.max(0, index), items.length);
      items.splice(at, 0, item);
      saveLearned(items);
    },
  };
  window.LearnedExerciseStore = LearnedExerciseStore;

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

  function loadBodyParts() {
    try {
      const raw = localStorage.getItem(BODY_PART_KEY);
      if (!raw) return DEFAULT_BODY_PARTS.map((p) => ({ ...p }));
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : DEFAULT_BODY_PARTS.map((p) => ({ ...p }));
    } catch {
      return DEFAULT_BODY_PARTS.map((p) => ({ ...p }));
    }
  }

  function saveBodyParts(parts) {
    window.safeSetLocalStorage(BODY_PART_KEY, JSON.stringify(parts));
  }

  window.BodyPartStore = {
    ...window.createKeyedStore(loadBodyParts, saveBodyParts),
    add(label) {
      const parts = loadBodyParts();
      const item = { key: createBodyPartKey(), label };
      parts.push(item);
      saveBodyParts(parts);
      return item;
    },
  };

  function getBodyPartLabel(key) {
    return window.BodyPartStore.getByKey(key)?.label || "삭제된 부위";
  }

  // Migration: 배운 운동/운동 기록's 부위 field used to be free text typed
  // directly into an input, so an entry from before this change holds a
  // label string (e.g. "가슴") instead of a real BodyPartStore key. Rewrites
  // any such entry to reference a key instead — reusing a matching body
  // part's key when the label happens to match one, minting a fresh one
  // otherwise — so renaming a body part later actually updates everywhere
  // it's used, which a plain string never could.
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

    const learned = LearnedExerciseStore.getAll();
    const logs = window.ExerciseLogStore.getAll();
    const routines = loadBodyPartRoutines();

    const labelsToMigrate = new Set();
    learned.forEach((item) => item.bodyPart && !existingKeys.has(item.bodyPart) && labelsToMigrate.add(item.bodyPart));
    logs.forEach((entry) => entry.bodyPart && !existingKeys.has(entry.bodyPart) && labelsToMigrate.add(entry.bodyPart));
    Object.keys(routines).forEach((label) => !existingKeys.has(label) && labelsToMigrate.add(label));

    if (labelsToMigrate.size === 0) return;

    const labelToKey = new Map();
    labelsToMigrate.forEach((label) => {
      labelToKey.set(label, existingByLabel.has(label) ? existingByLabel.get(label) : window.BodyPartStore.add(label).key);
    });

    learned.forEach((item) => {
      if (item.bodyPart && labelToKey.has(item.bodyPart)) {
        LearnedExerciseStore.update(item.id, { bodyPart: labelToKey.get(item.bodyPart) });
      }
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

  function loadBodyPartRoutines() {
    try {
      const raw = localStorage.getItem(BODY_PART_ROUTINE_KEY);
      const data = raw ? JSON.parse(raw) : {};
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  }

  function saveBodyPartRoutines(data) {
    window.safeSetLocalStorage(BODY_PART_ROUTINE_KEY, JSON.stringify(data));
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

  // ---------- Collapsible sections ----------
  // `storageKey`, when given, persists the collapsed state (device-local UI
  // state, not synced) — this section used to always reopen expanded on
  // every reload regardless of what the user last chose.
  function toggleSection(contentEl, btn, storageKey) {
    const collapsing = !contentEl.hidden;
    contentEl.hidden = collapsing;
    btn.textContent = collapsing ? "▸" : "▾";
    btn.setAttribute("aria-expanded", String(!collapsing));
    if (storageKey) localStorage.setItem(storageKey, String(collapsing));
  }

  function applyStoredCollapse(contentEl, btn, storageKey) {
    const collapsed = localStorage.getItem(storageKey) === "true";
    contentEl.hidden = collapsed;
    btn.textContent = collapsed ? "▸" : "▾";
    btn.setAttribute("aria-expanded", String(!collapsed));
  }

  // getFullYear/getMonth/getDate (local time), never toISOString (UTC) —
  // same local-time-only date convention the rest of the app uses (see
  // schedule-recurrence.js's parseDateStr for why).
  function todayStr() {
    const d = new Date();
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

  function renderExerciseLog() {
    const list = document.getElementById("exerciseLogList");
    if (!list) return;
    list.innerHTML = "";
    // Most recent first — the log can now span any date, not just today.
    const entries = [...window.ExerciseLogStore.getAll()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    if (entries.length === 0) {
      list.innerHTML = `<li class="schedule-empty"><span class="empty-icon" aria-hidden="true">💪</span>기록된 운동이 없어요</li>`;
      return;
    }

    entries.forEach((entry) => {
      const li = document.createElement("li");
      li.className = "checklist-item";

      const span = document.createElement("span");
      const label = getBodyPartLabel(entry.bodyPart);
      span.textContent = `${formatShortDateLabel(entry.date)} · ${label}`;
      li.appendChild(span);

      const remove = document.createElement("span");
      remove.className = "checklist-item-remove";
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        const removed = window.ExerciseLogStore.remove(entry.id);
        renderExerciseLog();
        renderLearnedExercises();
        if (removed && window.Toast) {
          window.Toast.show(`"${label}" 기록을 삭제했어요`, {
            actionLabel: "실행취소",
            onAction: () => {
              window.ExerciseLogStore.restore(removed.item, removed.index);
              renderExerciseLog();
              renderLearnedExercises();
            },
          });
        }
      });
      window.makeKeyboardActivatable(remove, `${formatShortDateLabel(entry.date)} ${label} 기록 삭제`);
      li.appendChild(remove);

      list.appendChild(li);
    });
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
    renderExerciseLog();
    renderLearnedExercises();
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
        renderExerciseLog();
        renderLearnedExercises();
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
        renderExerciseLog();
        renderLearnedExercises();
        populateBodyPartSelect(document.getElementById("exerciseLogBodyPartInput"));
        if (removed && window.Toast) {
          window.Toast.show(`"${part.label}" 부위를 삭제했어요`, {
            actionLabel: "실행취소",
            onAction: () => {
              window.BodyPartStore.restore(removed.item, removed.index);
              renderBodyPartManager();
              renderExerciseLog();
              renderLearnedExercises();
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

  // ---------- Learned exercises (grouped by body part) ----------
  // Starts as a single compact "+" button; clicking it swaps in a small
  // 부위/운동 이름/중량/세트 수 form (Enter or the 추가 button commits,
  // Escape cancels back to the button). Lives next to the "배운 운동"
  // heading (created once in init()), not inside the re-rendered group
  // list, so it must reset itself back to button view after a commit.
  function makeLearnedExerciseAddTrigger() {
    const container = document.createElement("span");
    container.className = "learned-exercise-add-row";

    function showButton() {
      container.innerHTML = "";
      container.classList.remove("expanded");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghost-btn goal-add-trigger-btn";
      btn.textContent = "+";
      btn.addEventListener("click", () => {
        if (window.BodyPartStore.getAll().length === 0) {
          window.Toast?.show("먼저 부위를 추가해주세요", { type: "warning" });
          return;
        }
        showForm();
      });
      container.appendChild(btn);
    }

    function showForm() {
      container.innerHTML = "";
      container.classList.add("expanded");

      const bodyPartInput = document.createElement("select");
      bodyPartInput.setAttribute("aria-label", "부위");
      populateBodyPartSelect(bodyPartInput);

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "운동 이름 (예: 벤치프레스)";
      nameInput.setAttribute("aria-label", "운동 이름");

      const weightInput = document.createElement("input");
      weightInput.type = "number";
      weightInput.min = "0";
      weightInput.max = "500";
      weightInput.step = "0.5";
      weightInput.placeholder = "중량 (kg)";
      weightInput.setAttribute("aria-label", "중량 (kg)");

      const setsInput = document.createElement("input");
      setsInput.type = "number";
      setsInput.min = "1";
      setsInput.max = "50";
      setsInput.step = "1";
      setsInput.placeholder = "세트 수";
      setsInput.setAttribute("aria-label", "세트 수");

      const submitBtn = document.createElement("button");
      submitBtn.type = "button";
      submitBtn.className = "ghost-btn";
      submitBtn.textContent = "추가";

      let settled = false;
      function commit() {
        if (settled) return;
        const bodyPart = bodyPartInput.value.trim();
        const name = nameInput.value.trim();
        if (!bodyPart || !name) {
          if (window.Toast) window.Toast.show("부위와 운동 이름을 입력해주세요", { type: "warning" });
          return;
        }
        settled = true;
        // min/max on a number input only constrain the spinner arrows, not
        // typed/pasted values — clamp explicitly so e.g. "9999" doesn't save
        // as a real-looking 9999kg record.
        const weight = weightInput.value ? Math.min(500, Math.max(0, Number(weightInput.value))) : null;
        const sets = setsInput.value ? Math.min(50, Math.max(1, Number(setsInput.value))) : null;
        LearnedExerciseStore.add({ bodyPart, name, weight, sets });
        renderLearnedExercises();
        showButton();
      }
      function cancel() {
        if (settled) return;
        settled = true;
        showButton();
      }

      [bodyPartInput, nameInput, weightInput, setsInput].forEach((input) => {
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        });
      });
      submitBtn.addEventListener("click", commit);

      container.appendChild(bodyPartInput);
      container.appendChild(nameInput);
      container.appendChild(weightInput);
      container.appendChild(setsInput);
      container.appendChild(submitBtn);
      bodyPartInput.focus();
    }

    showButton();
    return container;
  }

  function renderLearnedExercises() {
    const container = document.getElementById("learnedExerciseGroups");
    if (!container) return;
    container.innerHTML = "";

    const items = LearnedExerciseStore.getAll();

    // Groups are derived from each entry's own 부위 field, which is a
    // BodyPartStore key (not a raw label — see migrateBodyPartsToKeys),
    // in first-seen order.
    const groups = new Map();
    items.forEach((item) => {
      const key = item.bodyPart || "기타";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    const lastWorked = lastWorkedDateByBodyPart();

    if (groups.size === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `<span class="empty-icon" aria-hidden="true">🏋️</span><p>아직 등록된 운동이 없어요</p>`;
      container.appendChild(empty);
    } else {
      groups.forEach((groupItems, bodyPartKey) => {
        const bodyPartLabel = bodyPartKey === "기타" ? "기타" : getBodyPartLabel(bodyPartKey);
        const group = document.createElement("div");
        group.className = "learned-exercise-group";

        const headingRow = document.createElement("div");
        headingRow.className = "learned-exercise-group-heading-row";

        const heading = document.createElement("div");
        heading.className = "learned-exercise-group-title";
        heading.textContent = bodyPartLabel;
        headingRow.appendChild(heading);

        // Days since this body part was last logged via 운동 기록 above —
        // lets you see at a glance which parts need a rest day and which
        // are overdue.
        const lastDate = lastWorked[bodyPartKey];
        if (lastDate) {
          const badge = document.createElement("span");
          badge.className = "learned-exercise-last-worked";
          const days = daysSince(lastDate);
          badge.textContent = days <= 0 ? "오늘" : `${days}일 전`;
          headingRow.appendChild(badge);
        }
        group.appendChild(headingRow);

        const routineInput = document.createElement("input");
        routineInput.type = "text";
        routineInput.className = "learned-exercise-routine-input";
        routineInput.placeholder = `${bodyPartLabel} 루틴 (예: 벤치프레스 3세트, 딥스 3세트)`;
        routineInput.setAttribute("aria-label", `${bodyPartLabel} 루틴`);
        routineInput.value = window.BodyPartRoutineStore.get(bodyPartKey);
        routineInput.addEventListener("change", () => {
          window.BodyPartRoutineStore.update(bodyPartKey, routineInput.value.trim());
        });
        group.appendChild(routineInput);

        const list = document.createElement("ul");
        list.className = "learned-exercise-list";
        groupItems.forEach((item) => {
          const li = document.createElement("li");
          li.className = "learned-exercise-item";

          const name = document.createElement("span");
          name.className = "learned-exercise-name";
          name.textContent = item.name;
          li.appendChild(name);

          // `!= null` (not truthy) — weight/sets are stored as `null` when
          // never entered, but a real 0 (e.g. "0kg" for a bodyweight
          // exercise) is a legitimate value the user explicitly typed in.
          // A plain truthy check treated that 0 exactly like "never
          // entered", silently dropping it from the display.
          const detailParts = [];
          if (item.weight != null) detailParts.push(`${item.weight}kg`);
          if (item.sets != null) detailParts.push(`${item.sets}세트`);
          const detail = document.createElement("span");
          detail.className = "learned-exercise-detail";
          detail.textContent = detailParts.join(" · ");
          li.appendChild(detail);

          const remove = document.createElement("span");
          remove.className = "checklist-item-remove";
          remove.textContent = "×";
          remove.addEventListener("click", () => {
            const removed = LearnedExerciseStore.remove(item.id);
            renderLearnedExercises();
            if (removed && window.Toast) {
              window.Toast.show("운동을 삭제했어요", {
                actionLabel: "실행취소",
                onAction: () => {
                  LearnedExerciseStore.restore(removed.item, removed.index);
                  renderLearnedExercises();
                },
              });
            }
          });
          window.makeKeyboardActivatable(remove, `${item.name} 삭제`);
          li.appendChild(remove);

          list.appendChild(li);
        });
        group.appendChild(list);
        container.appendChild(group);
      });
    }
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
  function renderDashboardExercise() {
    const runEl = document.getElementById("dashboardExerciseRun");
    const squatEl = document.getElementById("dashboardExerciseSquat");
    const benchEl = document.getElementById("dashboardExerciseBench");
    const deadliftEl = document.getElementById("dashboardExerciseDeadlift");
    if (!runEl || !squatEl || !benchEl || !deadliftEl) return;

    const records = ExerciseRecordStore.get();

    runEl.textContent =
      records.runDistance && records.runPace
        ? `${records.runDistance}km · ${records.runPace}/km`
        : records.runDistance
        ? `${records.runDistance}km`
        : records.runPace
        ? `${records.runPace}/km`
        : "기록 없음";

    squatEl.textContent = records.squat ? `${records.squat}kg` : "기록 없음";
    benchEl.textContent = records.bench ? `${records.bench}kg` : "기록 없음";
    deadliftEl.textContent = records.deadlift ? `${records.deadlift}kg` : "기록 없음";
  }

  function init() {
    migrateBodyPartsToKeys();

    const learnedToggleBtn = document.getElementById("toggleLearnedExerciseBtn");
    const learnedGroupsEl = document.getElementById("learnedExerciseGroups");
    if (learnedToggleBtn && learnedGroupsEl) {
      applyStoredCollapse(learnedGroupsEl, learnedToggleBtn, "learnedExerciseGroupsCollapsed");
      learnedToggleBtn.addEventListener("click", (e) => {
        toggleSection(learnedGroupsEl, e.currentTarget, "learnedExerciseGroupsCollapsed");
      });
    }

    const addRow = document.getElementById("learnedExerciseAddRow");
    if (addRow) addRow.appendChild(makeLearnedExerciseAddTrigger());

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
    renderExerciseLog();
    renderLearnedExercises();
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
      renderExerciseLog();
      renderLearnedExercises();
    },
  };
})();
