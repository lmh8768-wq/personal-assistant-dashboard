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

  function formatDateLabel(dateStr) {
    const d = parseDateStr(dateStr);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  }

  function seedDefaultRecipeIfEmpty() {
    if (window.VongoleRecipeStore.getAll().length === 0) {
      window.VongoleRecipeStore.add("기본 레시피", DEFAULT_RECIPE_CONTENT);
    }
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
  function buildRecipeCard(recipe, kind) {
    const store = RECIPE_SECTIONS[kind].store();
    const card = document.createElement("div");
    card.className = "vongole-recipe-card";

    const header = document.createElement("div");
    header.className = "vongole-recipe-header";

    const title = document.createElement("h3");
    title.className = "vongole-recipe-title";
    title.textContent = recipe.title || "(제목 없음)";
    header.appendChild(title);

    const removeBtn = document.createElement("span");
    removeBtn.className = "checklist-item-remove";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("role", "button");
    removeBtn.setAttribute("aria-label", "레시피 삭제");
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteRecipe(kind, recipe.id);
    });
    header.appendChild(removeBtn);
    card.appendChild(header);

    const body = document.createElement("div");
    body.className = "vongole-recipe-body";
    body.hidden = !expandedRecipeIds.has(recipe.id);

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "vongole-recipe-title-input";
    titleInput.placeholder = "제목";
    titleInput.value = recipe.title;
    titleInput.addEventListener("click", (e) => e.stopPropagation());
    titleInput.addEventListener("input", () => {
      store.update(recipe.id, { title: titleInput.value });
      title.textContent = titleInput.value || "(제목 없음)";
    });
    body.appendChild(titleInput);

    const contentInput = document.createElement("textarea");
    contentInput.className = "vongole-recipe-content-input";
    contentInput.placeholder = "재료와 만드는 법을 적어보세요";
    contentInput.value = recipe.content || "";
    contentInput.addEventListener("click", (e) => e.stopPropagation());
    contentInput.addEventListener("input", () => {
      store.update(recipe.id, { content: contentInput.value });
    });
    body.appendChild(contentInput);

    card.appendChild(body);

    header.addEventListener("click", () => {
      if (expandedRecipeIds.has(recipe.id)) expandedRecipeIds.delete(recipe.id);
      else expandedRecipeIds.add(recipe.id);
      body.hidden = !expandedRecipeIds.has(recipe.id);
    });

    return card;
  }

  function renderRecipeSection(kind) {
    const section = RECIPE_SECTIONS[kind];
    const list = document.getElementById(section.listId);
    if (!list) return;
    const recipes = section.store().getAll();
    list.innerHTML = "";
    if (recipes.length === 0) {
      list.innerHTML = `<div class="empty-state"><span class="empty-icon">${section.emptyIcon}</span><p>${section.emptyText}</p></div>`;
      refreshDashboard();
      return;
    }
    recipes.forEach((r) => list.appendChild(buildRecipeCard(r, kind)));
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
    const created = RECIPE_SECTIONS[kind].store().add("", "");
    expandedRecipeIds.add(created.id);
    renderRecipeSection(kind);
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

  // ---------- Attempt log (below, diary-style) ----------
  function buildLogCard(entry) {
    const card = document.createElement("div");
    card.className = "diary-card";

    const date = document.createElement("div");
    date.className = "diary-card-date";
    date.textContent = formatDateLabel(entry.date);
    card.appendChild(date);

    if (entry.recipe) {
      const recipeEl = document.createElement("p");
      recipeEl.className = "diary-card-text";
      recipeEl.textContent = `레시피: ${entry.recipe}`;
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

  function renderLog() {
    const feed = document.getElementById("vongoleLogFeed");
    if (!feed) return;
    const entries = [...window.VongoleLogStore.getAll()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    feed.innerHTML = "";
    if (entries.length === 0) {
      feed.innerHTML = `<div class="empty-state"><span class="empty-icon">🍝</span><p>아직 시도 기록이 없어요</p></div>`;
      refreshDashboard();
      return;
    }
    entries.forEach((entry) => feed.appendChild(buildLogCard(entry)));
    refreshDashboard();
  }

  function openLogModal(mode, data) {
    editingLogId = mode === "edit" ? data.id : null;
    document.getElementById("vongoleLogModalTitle").textContent = mode === "edit" ? "시도 기록 수정" : "시도 기록 추가";
    document.getElementById("vongoleLogDateInput").value = data?.date || toDateStr(new Date());
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
    const payload = {
      date,
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
  }

  function handleDeleteLog() {
    if (!editingLogId) return;
    const id = editingLogId;
    closeLogModal();
    const removed = window.VongoleLogStore.remove(id);
    renderLog();
    if (removed && window.Toast) {
      window.Toast.show("기록을 삭제했어요", {
        actionLabel: "실행취소",
        onAction: () => {
          window.VongoleLogStore.restore(removed.item, removed.index);
          renderLog();
        },
      });
    }
  }

  function init() {
    seedDefaultRecipeIfEmpty();
    renderAllRecipes();
    renderLog();

    document.getElementById("addVongoleRecipeBtn")?.addEventListener("click", () => addRecipe("success"));
    document.getElementById("addVongoleCollectedRecipeBtn")?.addEventListener("click", () => addRecipe("collected"));

    document.getElementById("addVongoleLogBtn")?.addEventListener("click", () => openLogModal("add"));
    document.getElementById("cancelVongoleLogBtn")?.addEventListener("click", closeLogModal);
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

  window.VongoleView = { init, refreshDashboard };
})();
