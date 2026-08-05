(function () {
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  const DEFAULT_RECIPE_CONTENT = `[봉골레 파스타 (2인분)]

재료
- 링귀네 또는 스파게티 200g
- 바지락 400g (해감해두기)
- 마늘 4쪽 (편 썰기)
- 페페론치노 2개
- 화이트 와인 또는 청주 60ml
- 올리브오일 4큰술
- 파슬리(다진 것), 소금, 후추

만드는 법
1. 바지락은 소금물에 30분~1시간 해감한다.
2. 끓는 물에 소금을 넣고 파스타를 봉지 표시시간보다 1분 짧게 삶는다.
3. 팬에 올리브오일을 두르고 마늘, 페페론치노를 약불에서 향이 나게 볶는다.
4. 바지락을 넣고 와인을 부은 뒤 뚜껑을 덮어 조개가 입을 벌릴 때까지 익힌다.
5. 삶은 면과 면수 한 국자를 넣고 센불에서 유화시키듯 빠르게 섞는다.
6. 파슬리와 후추를 더하고 소금으로 간을 맞춰 마무리한다.`;

  // Two separate recipe lists — 대성공 (personally verified) and 수집한
  // (gathered from elsewhere, untried) — share identical card/modal
  // behavior, so both are driven off this one config instead of two
  // copies of the same render/open/submit/delete functions.
  const RECIPE_SECTIONS = {
    success: {
      store: () => window.VongoleRecipeStore,
      listId: "vongoleRecipeList",
      emptyIcon: "🏆",
      emptyText: "아직 등록된 레시피가 없어요",
    },
    collected: {
      store: () => window.VongoleCollectedRecipeStore,
      listId: "vongoleCollectedRecipeList",
      emptyIcon: "📎",
      emptyText: "아직 수집한 레시피가 없어요",
    },
  };

  let editingLogId = null;
  // In-memory only — a freshly opened tab starts with every recipe collapsed
  // except whichever one was just created via the + button.
  const expandedRecipeIds = new Set();
  // Single filter box (#vongoleFilterInput) narrows all three lists at once.
  let filterQuery = "";

  // Every debounced save currently waiting on its timer, so a re-render
  // triggered by something else (adding/deleting a recipe, changing the
  // filter) can flush them all first — see flushPendingRecipeEdits() below
  // for what this fixes.
  const pendingRecipeFlushes = new Set();

  // Returns a wrapped fn that waits `delay` ms of silence before actually
  // running — plus a .flush(...args) to run it (and cancel the pending
  // timer) immediately, used on blur so nothing's lost. Also self-registers
  // into pendingRecipeFlushes while a write is pending, so an external
  // flush (no args) can still replay the last-typed value via `lastArgs`.
  function debounce(fn, delay) {
    let timer = null;
    let lastArgs = null;
    function flushImpl(...args) {
      clearTimeout(timer);
      timer = null;
      pendingRecipeFlushes.delete(flushImpl);
      fn(...(args.length ? args : lastArgs));
    }
    function debounced(...args) {
      lastArgs = args;
      clearTimeout(timer);
      pendingRecipeFlushes.add(flushImpl);
      timer = setTimeout(flushImpl, delay);
    }
    debounced.flush = flushImpl;
    return debounced;
  }

  // A full re-render (renderRecipeSection below) tears down and rebuilds
  // every card from whatever's currently in the store — if another card
  // still had an unsaved debounced keystroke in flight, the rebuild used to
  // show that card's stale pre-keystroke value (the just-typed text visibly
  // reverting), while the orphaned timer then silently wrote the correct
  // value moments later, leaving the screen and the store out of sync in
  // between. Flushing everything pending right before any rebuild closes
  // that window.
  function flushPendingRecipeEdits() {
    [...pendingRecipeFlushes].forEach((flush) => flush());
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toDateStr(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  // Local-time-only date convention (why not `new Date(s)`) — see
  // scripts/schedule-recurrence.js's parseDateStr.
  function parseDateStr(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDateLabel(dateStr) {
    const d = parseDateStr(dateStr);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  }

  // A once-only flag, not just "is the list currently empty" — otherwise
  // deleting every 성공 레시피 (including this seeded one) on purpose would
  // bring it right back on the very next reload, with no way to actually
  // end up with zero.
  const DEFAULT_RECIPE_SEEDED_KEY = "assistant.vongoleDefaultRecipeSeeded.v1";

  function seedDefaultRecipeIfEmpty() {
    if (localStorage.getItem(DEFAULT_RECIPE_SEEDED_KEY)) return;
    if (window.VongoleRecipeStore.getAll().length === 0) {
      window.VongoleRecipeStore.add({ title: "기본 레시피", content: DEFAULT_RECIPE_CONTENT });
    }
    window.safeSetLocalStorage(DEFAULT_RECIPE_SEEDED_KEY, "true");
  }

  // ---------- Dashboard summary ----------
  function refreshDashboard() {
    const successEl = document.getElementById("dashboardVongoleSuccessCount");
    const collectedEl = document.getElementById("dashboardVongoleCollectedCount");
    const lastAttemptEl = document.getElementById("dashboardVongoleLastAttempt");
    if (!successEl || !collectedEl || !lastAttemptEl) return;

    successEl.textContent = `${window.VongoleRecipeStore.getAll().length}개`;
    collectedEl.textContent = `${window.VongoleCollectedRecipeStore.getAll().length}개`;

    const entries = window.VongoleLogStore.getAll();
    if (entries.length === 0) {
      lastAttemptEl.textContent = "기록 없음";
      return;
    }
    const latest = [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
    const d = parseDateStr(latest.date);
    lastAttemptEl.textContent = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  }

  // ---------- Recipes (collapsible cards, shared by both sections) ----------
  // Expanding a card puts it straight into edit mode — no modal, no
  // separate 수정 button. The title/content inputs save on every
  // keystroke; the header itself (anywhere except the × ) toggles collapse.
  // How many attempt-log entries are linked to each recipe — the whole
  // reason a log entry can point at a recipe by id (recipeId + recipeKind,
  // since the two recipe stores share nothing but shape) instead of just
  // free text is so this count can exist at all. Computed once per render
  // pass (not per card) — VongoleLogStore.getAll() reloads and JSON.parses
  // the whole log from localStorage, which doesn't need repeating once per
  // recipe on screen.
  function countAttemptsByRecipe() {
    const counts = new Map();
    window.VongoleLogStore.getAll().forEach((e) => {
      if (!e.recipeId || !e.recipeKind) return;
      const key = `${e.recipeKind}:${e.recipeId}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }

  function buildRecipeCard(recipe, kind, attemptCounts) {
    const store = RECIPE_SECTIONS[kind].store();
    const card = document.createElement("div");
    card.className = "vongole-recipe-card";

    // header (the collapse/expand toggle, made role="button" below) and
    // removeBtn (its own independent role="button") used to both live
    // inside header, an interactive-in-interactive nesting the ARIA/HTML
    // spec disallows and that made screen-reader virtual-cursor navigation
    // unreliable. headerRow is the actual flex row now; header only wraps
    // the title/badge (the part that's genuinely "click to expand").
    const headerRow = document.createElement("div");
    headerRow.className = "vongole-recipe-header-row";

    const header = document.createElement("div");
    header.className = "vongole-recipe-header";

    const title = document.createElement("h3");
    title.className = "vongole-recipe-title";
    title.textContent = recipe.title || "(제목 없음)";
    header.appendChild(title);

    const attemptCount = attemptCounts.get(`${kind}:${recipe.id}`) || 0;
    if (attemptCount > 0) {
      const badge = document.createElement("span");
      badge.className = "vongole-recipe-attempt-badge";
      badge.textContent = `${attemptCount}번 시도`;
      header.appendChild(badge);
    }
    headerRow.appendChild(header);

    const removeBtn = document.createElement("span");
    removeBtn.className = "checklist-item-remove";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("role", "button");
    removeBtn.setAttribute("aria-label", "레시피 삭제");
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteRecipe(kind, recipe.id);
    });
    window.makeKeyboardActivatable(removeBtn);
    headerRow.appendChild(removeBtn);
    card.appendChild(headerRow);

    const body = document.createElement("div");
    body.className = "vongole-recipe-body";
    body.hidden = !expandedRecipeIds.has(recipe.id);

    // Every keystroke updating title/textContent on screen is free, but
    // writing to localStorage on every single one isn't — a whole array of
    // recipes gets re-stringified each time. Debounce the actual store
    // write; flush immediately on blur so nothing's lost if the user
    // clicks away right after typing.
    const saveTitle = debounce((value) => store.update(recipe.id, { title: value }), 400);
    const saveContent = debounce((value) => store.update(recipe.id, { content: value }), 400);

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "vongole-recipe-title-input";
    titleInput.maxLength = 200;
    titleInput.placeholder = "제목";
    titleInput.value = recipe.title;
    titleInput.addEventListener("click", (e) => e.stopPropagation());
    titleInput.addEventListener("input", () => {
      title.textContent = titleInput.value || "(제목 없음)";
      saveTitle(titleInput.value);
    });
    titleInput.addEventListener("blur", () => saveTitle.flush(titleInput.value));
    body.appendChild(titleInput);

    const contentInput = document.createElement("textarea");
    contentInput.className = "vongole-recipe-content-input";
    contentInput.maxLength = 5000;
    contentInput.placeholder = "재료와 만드는 법을 적어보세요";
    contentInput.value = recipe.content || "";
    contentInput.addEventListener("click", (e) => e.stopPropagation());
    contentInput.addEventListener("input", () => saveContent(contentInput.value));
    contentInput.addEventListener("blur", () => saveContent.flush(contentInput.value));
    body.appendChild(contentInput);

    card.appendChild(body);

    // Was click-only — a real interactive control (toggles the recipe body
    // open/closed) with no keyboard path at all, unlike removeBtn right
    // next to it which already got makeKeyboardActivatable.
    header.setAttribute("aria-expanded", String(!body.hidden));
    window.makeKeyboardActivatable(header, recipe.title || "레시피");
    header.addEventListener("click", () => {
      if (expandedRecipeIds.has(recipe.id)) expandedRecipeIds.delete(recipe.id);
      else expandedRecipeIds.add(recipe.id);
      body.hidden = !expandedRecipeIds.has(recipe.id);
      header.setAttribute("aria-expanded", String(!body.hidden));
    });

    return card;
  }

  function renderRecipeSection(kind) {
    flushPendingRecipeEdits();
    const section = RECIPE_SECTIONS[kind];
    const list = document.getElementById(section.listId);
    if (!list) return;
    const all = section.store().getAll();
    const q = filterQuery.trim().toLowerCase();
    const recipes = q ? all.filter((r) => `${r.title} ${r.content}`.toLowerCase().includes(q)) : all;
    list.innerHTML = "";
    if (recipes.length === 0) {
      const icon = q ? "🔍" : section.emptyIcon;
      const text = q ? "검색 결과가 없어요" : section.emptyText;
      list.innerHTML = `<div class="empty-state"><span class="empty-icon">${icon}</span><p>${text}</p></div>`;
      refreshDashboard();
      return;
    }
    const attemptCounts = countAttemptsByRecipe();
    recipes.forEach((r) => list.appendChild(buildRecipeCard(r, kind, attemptCounts)));
    refreshDashboard();
  }

  function renderAllRecipes() {
    renderRecipeSection("success");
    renderRecipeSection("collected");
  }

  // + creates a blank recipe immediately (expanded, title focused) instead
  // of opening a modal first — same "instant create, edit inline" pattern
  // the 커리큘럼 goal tree's + button uses.
  function addRecipe(kind) {
    // Clear any active filter first — otherwise a brand-new blank recipe
    // wouldn't match the filter text and would render straight into the
    // "no results" empty state instead of showing up to be edited.
    clearFilter();
    const created = RECIPE_SECTIONS[kind].store().add({ title: "", content: "" });
    expandedRecipeIds.add(created.id);
    // clearFilter() just emptied the filter box, but only this one
    // section used to re-render — the OTHER recipe section and the
    // attempt log (both also filtered by the same query) kept showing
    // their old filtered results/empty-state until some unrelated
    // interaction happened to force a re-render.
    renderAllRecipes();
    renderLog();
    requestAnimationFrame(() => {
      const list = document.getElementById(RECIPE_SECTIONS[kind].listId);
      list?.querySelector(".vongole-recipe-card:last-child .vongole-recipe-title-input")?.focus();
    });
  }

  function deleteRecipe(kind, id) {
    const store = RECIPE_SECTIONS[kind].store();
    const removed = store.remove(id);
    renderRecipeSection(kind);
    if (removed && window.Toast) {
      window.Toast.show("레시피를 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          store.restore(removed.item, removed.index);
          renderRecipeSection(kind);
        },
      });
    }
  }

  // A log entry's linked recipe may since have been renamed or deleted —
  // look its current title up fresh each render rather than trusting
  // whatever the entry itself remembers, and fall back to a clear "no
  // longer exists" label rather than silently showing nothing.
  function resolveLinkedRecipeTitle(entry) {
    if (!entry.recipeId || !entry.recipeKind) return null;
    const section = RECIPE_SECTIONS[entry.recipeKind];
    const recipe = section && section.store().getAll().find((r) => r.id === entry.recipeId);
    return recipe ? recipe.title || "(제목 없음)" : "(삭제된 레시피)";
  }

  // ---------- Attempt log (below, diary-style) ----------
  function buildLogCard(entry) {
    const card = document.createElement("div");
    card.className = "diary-card";

    const date = document.createElement("div");
    date.className = "diary-card-date";
    date.textContent = formatDateLabel(entry.date);
    card.appendChild(date);

    const linkedTitle = resolveLinkedRecipeTitle(entry);
    if (linkedTitle) {
      const linkedEl = document.createElement("p");
      linkedEl.className = "diary-card-text";
      linkedEl.textContent = `레시피: ${linkedTitle}`;
      card.appendChild(linkedEl);
    }
    if (entry.recipe) {
      const recipeEl = document.createElement("p");
      recipeEl.className = "diary-card-text";
      recipeEl.textContent = `메모: ${entry.recipe}`;
      card.appendChild(recipeEl);
    }
    if (entry.comment) {
      const commentEl = document.createElement("p");
      commentEl.className = "diary-card-text";
      commentEl.textContent = `코멘트: ${entry.comment}`;
      card.appendChild(commentEl);
    }

    card.addEventListener("click", () => openLogModal("edit", entry));
    return card;
  }

  const LOG_PAGE_SIZE = 20;
  let logVisibleCount = LOG_PAGE_SIZE;

  function renderLog() {
    const feed = document.getElementById("vongoleLogFeed");
    if (!feed) return;
    const all = [...window.VongoleLogStore.getAll()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const q = filterQuery.trim().toLowerCase();
    const entries = q
      ? all.filter((e) => `${e.recipe || ""} ${e.comment || ""} ${e.date}`.toLowerCase().includes(q))
      : all;
    feed.innerHTML = "";
    if (entries.length === 0) {
      const icon = q ? "🔍" : "🍝";
      const text = q ? "검색 결과가 없어요" : "아직 시도 기록이 없어요";
      feed.innerHTML = `<div class="empty-state"><span class="empty-icon">${icon}</span><p>${text}</p></div>`;
      refreshDashboard();
      return;
    }
    entries.slice(0, logVisibleCount).forEach((entry) => feed.appendChild(buildLogCard(entry)));

    if (entries.length > logVisibleCount) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "ghost-btn diary-load-more-btn";
      more.textContent = `더 보기 (${entries.length - logVisibleCount}개 남음)`;
      more.addEventListener("click", () => {
        logVisibleCount += LOG_PAGE_SIZE;
        renderLog();
      });
      feed.appendChild(more);
    }

    refreshDashboard();
  }

  // Options are grouped by which of the two recipe lists they come from —
  // encoded as "<kind>:<id>" since that's the only way to tell apart a
  // VongoleRecipeStore id from a VongoleCollectedRecipeStore id sharing the
  // same <select> (their id prefixes differ in practice, but nothing
  // guarantees that, so don't rely on it).
  function syncLogRecipeSelectOptions(selectedValue) {
    const select = document.getElementById("vongoleLogRecipeSelectInput");
    if (!select) return;
    select.innerHTML = '<option value="">선택 안 함</option>';
    Object.entries(RECIPE_SECTIONS).forEach(([kind, section]) => {
      const recipes = section.store().getAll();
      if (recipes.length === 0) return;
      const group = document.createElement("optgroup");
      group.label = kind === "success" ? "🏆 대성공 레시피" : "📎 수집한 레시피";
      recipes.forEach((r) => {
        const opt = document.createElement("option");
        opt.value = `${kind}:${r.id}`;
        opt.textContent = r.title || "(제목 없음)";
        group.appendChild(opt);
      });
      select.appendChild(group);
    });
    select.value = selectedValue || "";
    // The previously-linked recipe may since have been deleted — in that
    // case the option no longer exists, so setting .value above is a no-op
    // and it silently falls back to "선택 안 함" rather than leaving a
    // dangling selection.
  }

  function openLogModal(mode, data) {
    editingLogId = mode === "edit" ? data.id : null;
    document.getElementById("vongoleLogModalTitle").textContent = mode === "edit" ? "시도 기록 수정" : "시도 기록 추가";
    document.getElementById("vongoleLogDateInput").value = data?.date || toDateStr(new Date());
    syncLogRecipeSelectOptions(data?.recipeId ? `${data.recipeKind}:${data.recipeId}` : "");
    document.getElementById("vongoleLogRecipeInput").value = data?.recipe || "";
    document.getElementById("vongoleLogCommentInput").value = data?.comment || "";
    document.getElementById("deleteVongoleLogBtn").hidden = mode !== "edit";
    document.getElementById("vongoleLogModalOverlay").hidden = false;
    document.getElementById("vongoleLogRecipeInput").focus();
  }

  function closeLogModal() {
    document.getElementById("vongoleLogModalOverlay").hidden = true;
    editingLogId = null;
  }

  function handleLogSubmit(e) {
    e.preventDefault();
    const date = document.getElementById("vongoleLogDateInput").value;
    if (!date) {
      window.Toast?.show("날짜를 입력해주세요", { type: "warning" });
      return;
    }
    const [recipeKind, recipeId] = document.getElementById("vongoleLogRecipeSelectInput").value.split(":");
    const payload = {
      date,
      recipeId: recipeId || null,
      recipeKind: recipeId ? recipeKind : null,
      recipe: document.getElementById("vongoleLogRecipeInput").value.trim(),
      comment: document.getElementById("vongoleLogCommentInput").value.trim(),
    };
    if (editingLogId) {
      window.VongoleLogStore.update(editingLogId, payload);
      window.Toast?.show("기록을 수정했어요");
    } else {
      window.VongoleLogStore.add(payload);
      window.Toast?.show("기록을 추가했어요");
    }
    closeLogModal();
    renderLog();
    renderAllRecipes();
  }

  function handleDeleteLog() {
    if (!editingLogId) return;
    const id = editingLogId;
    closeLogModal();
    const removed = window.VongoleLogStore.remove(id);
    renderLog();
    renderAllRecipes();
    if (removed && window.Toast) {
      window.Toast.show("기록을 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          window.VongoleLogStore.restore(removed.item, removed.index);
          renderLog();
          renderAllRecipes();
        },
      });
    }
  }

  function clearFilter() {
    filterQuery = "";
    const input = document.getElementById("vongoleFilterInput");
    if (input) input.value = "";
  }

  function init() {
    seedDefaultRecipeIfEmpty();
    renderAllRecipes();
    renderLog();

    document.getElementById("vongoleFilterInput")?.addEventListener("input", (e) => {
      filterQuery = e.target.value;
      renderAllRecipes();
      renderLog();
    });

    document.getElementById("addVongoleRecipeBtn")?.addEventListener("click", () => addRecipe("success"));
    document.getElementById("addVongoleCollectedRecipeBtn")?.addEventListener("click", () => addRecipe("collected"));

    document.getElementById("addVongoleLogBtn")?.addEventListener("click", () => openLogModal("add"));
    document.getElementById("cancelVongoleLogBtn")?.addEventListener("click", closeLogModal);
    document.getElementById("closeVongoleLogModalBtn")?.addEventListener("click", closeLogModal);
    document.getElementById("vongoleLogForm")?.addEventListener("submit", handleLogSubmit);
    document.getElementById("deleteVongoleLogBtn")?.addEventListener("click", handleDeleteLog);
    document.getElementById("vongoleLogModalOverlay")?.addEventListener("click", (e) => {
      if (e.target.id === "vongoleLogModalOverlay") closeLogModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!document.getElementById("vongoleLogModalOverlay").hidden) closeLogModal();
    });
  }

  // Same gap as practice.js's curriculum tree (see its onShow comment) —
  // this tab's recipe lists and attempt log only ever rendered once, at
  // app startup. seedDefaultRecipeIfEmpty() is deliberately NOT repeated
  // here — it already ran once at init(), and its own one-time-seeded flag
  // means calling it again would be a no-op anyway.
  window.VongoleView = {
    init,
    refreshDashboard,
    onShow: () => {
      renderAllRecipes();
      renderLog();
    },
  };
})();
