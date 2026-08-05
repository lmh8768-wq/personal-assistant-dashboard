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

  // Each category's contribution is capped BEFORE the sections are
  // concatenated — without this, a query that happened to match 10+
  // schedules alone (the first category checked) meant every later
  // category — including 가계부, 봉골레, and the 비서 keyword shortcut,
  // pushed last — was silently squeezed out of the final results.slice(0,
  // 10) entirely, regardless of how good a match they were.
  const PER_CATEGORY_CAP = 3;

  function getResults(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const sections = [];

    function addSection(items) {
      if (items.length) sections.push(items.slice(0, PER_CATEGORY_CAP));
    }

    if (window.ScheduleStore) {
      addSection(
        window.ScheduleStore.getAll()
          .filter((item) => `${item.title} ${item.memo || ""}`.toLowerCase().includes(q))
          .map((item) => ({ type: "일정", label: item.title, view: "schedule" }))
      );
    }
    if (window.PracticeStore) {
      addSection(
        window.PracticeStore.getAll()
          .filter((p) => (p.text || "").toLowerCase().includes(q))
          .map((p) => ({
            type: "연습",
            label: p.text.length > 30 ? p.text.slice(0, 30) + "…" : p.text,
            view: "practice",
          }))
      );
    }
    if (window.PracticeCurriculumStore) {
      const goals = [];
      collectGoalLabels(window.PracticeCurriculumStore.getGoals(), "커리큘럼", "practice", goals);
      addSection(goals.filter((g) => g.label.toLowerCase().includes(q)));
    }
    if (window.RoutineStore) {
      const items = [];
      ["routine", "life"].forEach((type) => {
        (window.RoutineStore.getItems(type) || []).forEach((item) => {
          if ((item.label || "").toLowerCase().includes(q)) {
            items.push({ type: "루틴", label: item.label, view: "routine" });
          }
        });
      });
      addSection(items);
    }
    if (window.AcademicGoalStore) {
      const goals = [];
      window.AcademicGoalStore.getYears().forEach((year) => {
        window.AcademicGoalStore.getPeriods(year.id).forEach((period) => {
          collectGoalLabels(window.AcademicGoalStore.getGoals(year.id, period.id), "학업", "study", goals);
        });
      });
      addSection(goals.filter((g) => g.label.toLowerCase().includes(q)));
    }
    if (window.LearnedExerciseStore) {
      addSection(
        window.LearnedExerciseStore.getAll()
          .filter((item) => `${item.name || ""} ${item.bodyPart || ""}`.toLowerCase().includes(q))
          .map((item) => ({ type: "운동", label: `${item.bodyPart} · ${item.name}`, view: "exercise" }))
      );
    }
    if (window.LedgerEntryStore && window.LedgerCategoryStore) {
      addSection(
        window.LedgerEntryStore.getAll()
          .map((entry) => ({ entry, label: window.LedgerCategoryStore.getByKey(entry.categoryKey)?.label || "" }))
          .filter(({ label }) => label.toLowerCase().includes(q))
          .map(({ entry, label }) => ({ type: "가계부", label: `${label} · ${entry.date}`, view: "ledger" }))
      );
    }
    const vongoleRecipes = [];
    [window.VongoleRecipeStore, window.VongoleCollectedRecipeStore].forEach((store) => {
      if (!store) return;
      store.getAll().forEach((r) => {
        if (`${r.title || ""} ${r.content || ""}`.toLowerCase().includes(q)) {
          vongoleRecipes.push({ type: "봉골레", label: r.title || "(제목 없음)", view: "vongole" });
        }
      });
    });
    addSection(vongoleRecipes);
    if (window.VongoleLogStore) {
      addSection(
        window.VongoleLogStore.getAll()
          .filter((entry) => `${entry.recipe || ""} ${entry.comment || ""}`.toLowerCase().includes(q))
          .map((entry) => ({ type: "봉골레", label: `시도 기록 · ${entry.date}`, view: "vongole" }))
      );
    }

    // 비서에게 묻기 has no data of its own to search, so it was previously
    // unreachable from global search entirely — a fixed keyword match at
    // least surfaces it for the obvious ways someone would look for it.
    // The two directions of the match need different confidence: a query
    // that CONTAINS a full keyword (e.g. typing "비서 어디") is always a
    // precise match regardless of length, but a short query that's merely
    // a SUBSTRING of a keyword ("c", "l", "e" are all substrings of
    // "claude") produced spurious matches on totally unrelated 1-character
    // searches — requiring at least 2 characters for that direction only.
    const ASSISTANT_KEYWORDS = ["비서", "질문", "상담", "claude", "클로드", "챗봇", "물어보기"];
    const matchesAssistant =
      ASSISTANT_KEYWORDS.some((k) => q.includes(k)) ||
      (q.length >= 2 && ASSISTANT_KEYWORDS.some((k) => k.includes(q)));

    // Handled separately from addSection()/PER_CATEGORY_CAP above instead of
    // being appended as just another section: being pushed last meant it
    // was exactly the item most likely to get squeezed out by the final
    // slice(0, 10) whenever enough earlier categories matched — the same
    // "later category starved out" bug the per-category cap fixed, just for
    // whichever category happens to be last. Reserving its slot up front
    // guarantees it survives whenever it's a real match.
    const flatResults = sections.flat();
    if (matchesAssistant) {
      return [...flatResults.slice(0, 9), { type: "비서", label: "비서에게 묻기", view: "assistant" }];
    }
    return flatResults.slice(0, 10);
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
