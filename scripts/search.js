(function () {
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
    if (window.NotesStore) {
      window.NotesStore.getAll().forEach((n) => {
        if ((n.text || "").toLowerCase().includes(q)) {
          results.push({ type: "메모", label: n.text.length > 30 ? n.text.slice(0, 30) + "…" : n.text, view: "notes" });
        }
      });
    }
    if (window.DiaryStore) {
      window.DiaryStore.getAll().forEach((d) => {
        if ((d.text || "").toLowerCase().includes(q)) {
          const label = d.text ? (d.text.length > 30 ? d.text.slice(0, 30) + "…" : d.text) : d.date;
          results.push({ type: "일기", label, view: "diary" });
        }
      });
    }
    if (window.PhotoStore) {
      const seenTags = new Set();
      window.PhotoStore.getAll().forEach((p) => {
        (p.tags || []).forEach((tag) => {
          if (tag.toLowerCase().includes(q) && !seenTags.has(tag)) {
            seenTags.add(tag);
            results.push({ type: "사진", label: `#${tag}`, view: "photos" });
          }
        });
      });
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
