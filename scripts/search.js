(function () {
  // Goal trees (practice curriculum, study) nest children arbitrarily deep —
  // flatten them all into a flat list of {type, label, view} candidates so
  // the same substring match below can just filter over that list.
  function collectGoalLabels(nodes, type, view, out) {
    (nodes || []).forEach((node) => {
      out.push({ type, label: node.label || "(제목 없음)", view });
      if (node.children && node.children.length) collectGoalLabels(node.children, type, view, out);
    });
  }

  function getResults(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results = [];

    if (window.ScheduleStore) {
      window.ScheduleStore.getAll().forEach((item) => {
        const hay = `${item.title} ${item.memo || ""}`.toLowerCase();
        if (hay.includes(q)) {
          results.push({ type: "일정", label: item.title, view: "schedule" });
        }
      });
    }
    if (window.PracticeStore) {
      window.PracticeStore.getAll().forEach((p) => {
        if ((p.text || "").toLowerCase().includes(q)) {
          const label = p.text.length > 30 ? p.text.slice(0, 30) + "…" : p.text;
          results.push({ type: "연습", label, view: "practice" });
        }
      });
    }
    if (window.PracticeCurriculumStore) {
      const goals = [];
      collectGoalLabels(window.PracticeCurriculumStore.getGoals(), "커리큘럼", "practice", goals);
      goals.forEach((g) => {
        if (g.label.toLowerCase().includes(q)) results.push(g);
      });
    }
    if (window.RoutineStore) {
      ["routine", "life"].forEach((type) => {
        (window.RoutineStore.getItems(type) || []).forEach((item) => {
          if ((item.label || "").toLowerCase().includes(q)) {
            results.push({ type: "루틴", label: item.label, view: "routine" });
          }
        });
      });
    }
    if (window.AcademicGoalStore) {
      window.AcademicGoalStore.getYears().forEach((year) => {
        window.AcademicGoalStore.getPeriods(year.id).forEach((period) => {
          const goals = [];
          collectGoalLabels(window.AcademicGoalStore.getGoals(year.id, period.id), "학업", "study", goals);
          goals.forEach((g) => {
            if (g.label.toLowerCase().includes(q)) results.push(g);
          });
        });
      });
    }
    if (window.LearnedExerciseStore) {
      window.LearnedExerciseStore.getAll().forEach((item) => {
        const hay = `${item.name || ""} ${item.bodyPart || ""}`.toLowerCase();
        if (hay.includes(q)) {
          results.push({ type: "운동", label: `${item.bodyPart} · ${item.name}`, view: "exercise" });
        }
      });
    }
    if (window.LedgerEntryStore && window.LedgerCategoryStore) {
      window.LedgerEntryStore.getAll().forEach((entry) => {
        const cat = window.LedgerCategoryStore.getByKey(entry.categoryKey);
        const label = cat ? cat.label : "";
        if (label.toLowerCase().includes(q)) {
          results.push({ type: "가계부", label: `${label} · ${entry.date}`, view: "ledger" });
        }
      });
    }
    [window.VongoleRecipeStore, window.VongoleCollectedRecipeStore].forEach((store) => {
      if (!store) return;
      store.getAll().forEach((r) => {
        const hay = `${r.title || ""} ${r.content || ""}`.toLowerCase();
        if (hay.includes(q)) {
          results.push({ type: "봉골레", label: r.title || "(제목 없음)", view: "vongole" });
        }
      });
    });
    if (window.VongoleLogStore) {
      window.VongoleLogStore.getAll().forEach((entry) => {
        const hay = `${entry.recipe || ""} ${entry.comment || ""}`.toLowerCase();
        if (hay.includes(q)) {
          results.push({ type: "봉골레", label: `시도 기록 · ${entry.date}`, view: "vongole" });
        }
      });
    }

    // 비서에게 묻기 has no data of its own to search, so it was previously
    // unreachable from global search entirely — a fixed keyword match at
    // least surfaces it for the obvious ways someone would look for it.
    const ASSISTANT_KEYWORDS = ["비서", "질문", "상담", "claude", "클로드", "챗봇", "물어보기"];
    if (ASSISTANT_KEYWORDS.some((k) => k.includes(q) || q.includes(k))) {
      results.push({ type: "비서", label: "비서에게 묻기", view: "assistant" });
    }

    return results.slice(0, 10);
  }

  function renderResults(results) {
    const container = document.getElementById("searchResults");
    if (!container) return;
    container.innerHTML = "";
    if (results.length === 0) {
      container.hidden = true;
      return;
    }
    results.forEach((r) => {
      const item = document.createElement("div");
      item.className = "search-result-item";

      const badge = document.createElement("span");
      badge.className = "search-result-badge";
      badge.textContent = r.type;
      item.appendChild(badge);

      const label = document.createElement("span");
      label.className = "search-result-label";
      label.textContent = r.label;
      item.appendChild(label);

      item.addEventListener("click", () => {
        document.querySelector(`.nav-item[data-view="${r.view}"]`)?.click();
        const input = document.getElementById("globalSearchInput");
        if (input) input.value = "";
        container.hidden = true;
      });

      container.appendChild(item);
    });
    container.hidden = false;
  }

  function init() {
    const input = document.getElementById("globalSearchInput");
    const container = document.getElementById("searchResults");
    const box = document.getElementById("searchBox");
    if (!input || !container || !box) return;

    input.addEventListener("input", () => {
      renderResults(getResults(input.value));
    });
    input.addEventListener("focus", () => {
      if (input.value.trim()) renderResults(getResults(input.value));
    });

    document.addEventListener("click", (e) => {
      if (!box.contains(e.target)) container.hidden = true;
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") container.hidden = true;
    });
  }

  window.GlobalSearch = { init, focusInput: () => document.getElementById("globalSearchInput")?.focus() };
})();
