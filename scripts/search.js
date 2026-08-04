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

  // -1 means nothing is highlighted yet (just opened / results just
  // changed) — arrow keys start from either end depending on direction.
  let highlightedIndex = -1;
  let currentResults = [];

  function activateResult(r) {
    const container = document.getElementById("searchResults");
    const input = document.getElementById("globalSearchInput");
    document.querySelector(`.nav-item[data-view="${r.view}"]`)?.click();
    if (input) {
      input.value = "";
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }
    if (container) container.hidden = true;
    highlightedIndex = -1;
  }

  function setHighlighted(index) {
    const container = document.getElementById("searchResults");
    const input = document.getElementById("globalSearchInput");
    if (!container) return;
    const items = [...container.children];
    if (items.length === 0) return;
    highlightedIndex = ((index % items.length) + items.length) % items.length; // wraps both directions
    items.forEach((el, i) => el.classList.toggle("highlighted", i === highlightedIndex));
    const current = items[highlightedIndex];
    current.scrollIntoView({ block: "nearest" });
    if (input) input.setAttribute("aria-activedescendant", current.id);
  }

  function renderResults(results) {
    const container = document.getElementById("searchResults");
    const input = document.getElementById("globalSearchInput");
    if (!container) return;
    container.innerHTML = "";
    highlightedIndex = -1;
    currentResults = results;
    if (results.length === 0) {
      container.hidden = true;
      if (input) input.setAttribute("aria-expanded", "false");
      return;
    }
    results.forEach((r, i) => {
      const item = document.createElement("div");
      item.className = "search-result-item";
      item.id = `search-result-${i}`;
      item.setAttribute("role", "option");

      const badge = document.createElement("span");
      badge.className = "search-result-badge";
      badge.textContent = r.type;
      item.appendChild(badge);

      const label = document.createElement("span");
      label.className = "search-result-label";
      label.textContent = r.label;
      item.appendChild(label);

      item.addEventListener("click", () => activateResult(r));
      item.addEventListener("mouseenter", () => setHighlighted(i));

      container.appendChild(item);
    });
    container.hidden = false;
    if (input) input.setAttribute("aria-expanded", "true");
  }

  // getResults() re-flattens every goal tree in the app from scratch — fine
  // for one search, wasteful to redo on every single keystroke while
  // someone is still typing. A short debounce (rendering feels instant to a
  // human well under ~150ms) cuts that down to once per pause instead of
  // once per character.
  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function init() {
    const input = document.getElementById("globalSearchInput");
    const container = document.getElementById("searchResults");
    const box = document.getElementById("searchBox");
    if (!input || !container || !box) return;

    const runSearch = debounce(() => renderResults(getResults(input.value)), 150);
    input.addEventListener("input", runSearch);
    input.addEventListener("focus", () => {
      if (input.value.trim()) renderResults(getResults(input.value));
    });

    document.addEventListener("click", (e) => {
      if (!box.contains(e.target)) container.hidden = true;
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        container.hidden = true;
        input.setAttribute("aria-expanded", "false");
      }
    });

    // Arrow-key/Enter navigation through results — the search box otherwise
    // had no keyboard path at all: results were plain non-focusable <div>s
    // with only a click listener, so a keyboard-only user who typed a query
    // could see results appear but had no way to actually choose one.
    input.addEventListener("keydown", (e) => {
      if (container.hidden || currentResults.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted(highlightedIndex + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted(highlightedIndex - 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = currentResults[highlightedIndex] ?? currentResults[0];
        if (target) activateResult(target);
      }
    });
  }

  window.GlobalSearch = { init, focusInput: () => document.getElementById("globalSearchInput")?.focus() };
})();
