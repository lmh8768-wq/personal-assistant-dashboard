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
      const at = Math.min(index, items.length);
      items.splice(at, 0, item);
      saveLearned(items);
    },
  };
  window.LearnedExerciseStore = LearnedExerciseStore;

  // ---------- Collapsible sections ----------
  function toggleSection(contentEl, btn) {
    const collapsing = !contentEl.hidden;
    contentEl.hidden = collapsing;
    btn.textContent = collapsing ? "▸" : "▾";
    btn.setAttribute("aria-expanded", String(!collapsing));
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
      btn.addEventListener("click", () => showForm());
      container.appendChild(btn);
    }

    function showForm() {
      container.innerHTML = "";
      container.classList.add("expanded");

      const bodyPartInput = document.createElement("input");
      bodyPartInput.type = "text";
      bodyPartInput.placeholder = "부위 (예: 가슴)";
      bodyPartInput.setAttribute("list", "learnedExerciseBodyPartOptions");

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "운동 이름 (예: 벤치프레스)";

      const weightInput = document.createElement("input");
      weightInput.type = "number";
      weightInput.min = "0";
      weightInput.max = "500";
      weightInput.step = "0.5";
      weightInput.placeholder = "중량 (kg)";

      const setsInput = document.createElement("input");
      setsInput.type = "number";
      setsInput.min = "1";
      setsInput.max = "50";
      setsInput.step = "1";
      setsInput.placeholder = "세트 수";

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
        LearnedExerciseStore.add({
          bodyPart,
          name,
          weight: weightInput.value ? Number(weightInput.value) : null,
          sets: setsInput.value ? Number(setsInput.value) : null,
        });
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

    // Groups are derived from each entry's own 부위 field (not a separately
    // stored category), in first-seen order.
    const groups = new Map();
    items.forEach((item) => {
      const key = item.bodyPart || "기타";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    if (groups.size === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `<span class="empty-icon">🏋️</span><p>아직 등록된 운동이 없어요</p>`;
      container.appendChild(empty);
    } else {
      groups.forEach((groupItems, bodyPart) => {
        const group = document.createElement("div");
        group.className = "learned-exercise-group";

        const heading = document.createElement("div");
        heading.className = "learned-exercise-group-title";
        heading.textContent = bodyPart;
        group.appendChild(heading);

        const list = document.createElement("ul");
        list.className = "learned-exercise-list";
        groupItems.forEach((item) => {
          const li = document.createElement("li");
          li.className = "learned-exercise-item";

          const name = document.createElement("span");
          name.className = "learned-exercise-name";
          name.textContent = item.name;
          li.appendChild(name);

          const detailParts = [];
          if (item.weight) detailParts.push(`${item.weight}kg`);
          if (item.sets) detailParts.push(`${item.sets}세트`);
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

    const datalist = document.getElementById("learnedExerciseBodyPartOptions");
    if (datalist) {
      datalist.innerHTML = "";
      const uniqueParts = [...new Set(items.map((i) => i.bodyPart).filter(Boolean))];
      uniqueParts.forEach((part) => {
        const opt = document.createElement("option");
        opt.value = part;
        datalist.appendChild(opt);
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

  function handleRecordFieldChange() {
    ExerciseRecordStore.update({
      runDistance: document.getElementById("exerciseRecordRunDistanceInput").value,
      squat: document.getElementById("exerciseRecordSquatInput").value,
      bench: document.getElementById("exerciseRecordBenchInput").value,
      deadlift: document.getElementById("exerciseRecordDeadliftInput").value,
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
    document.getElementById("toggleLearnedExerciseBtn")?.addEventListener("click", (e) => {
      toggleSection(document.getElementById("learnedExerciseGroups"), e.currentTarget);
    });

    const addRow = document.getElementById("learnedExerciseAddRow");
    if (addRow) addRow.appendChild(makeLearnedExerciseAddTrigger());

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
      renderRecordsPanel();
      renderLearnedExercises();
    },
  };
})();
