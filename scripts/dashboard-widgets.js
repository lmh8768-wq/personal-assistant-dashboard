(function () {
  const QUOTES = [
    "오늘 할 수 있는 일을 내일로 미루지 말자.",
    "작은 진전도 진전이다.",
    "완벽함보다 꾸준함이 이긴다.",
    "오늘 하루도 나에게 친절하게.",
    "시작이 반이다.",
    "쉬어가는 것도 계획의 일부다.",
    "기록은 기억보다 강하다.",
    "천 리 길도 한 걸음부터.",
    "오늘의 작은 습관이 내일의 나를 만든다.",
    "실수해도 괜찮다, 멈추지만 않으면 된다.",
    "가장 큰 위험은 아무 위험도 감수하지 않는 것이다.",
    "지금 이 순간에 집중하자.",
    "나만의 속도로 나아가면 된다.",
    "오늘 하나라도 끝냈다면 충분하다.",
    "휴식도 생산성의 일부다.",
  ];

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toDateStr(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function dayOfYear(d) {
    const start = new Date(d.getFullYear(), 0, 0);
    const diff = d - start;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  function renderQuote() {
    const el = document.getElementById("dashboardQuoteText");
    if (!el) return;
    const idx = dayOfYear(new Date()) % QUOTES.length;
    el.textContent = `“${QUOTES[idx]}”`;
  }

  function renderMonthlySummary() {
    const list = document.getElementById("monthlySummaryList");
    if (!list) return;

    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;

    let completedSchedules = 0;
    if (window.ScheduleStore) {
      window.ScheduleStore.getAll().forEach((item) => {
        (item.completedDates || []).forEach((date) => {
          if (date.startsWith(monthPrefix)) completedSchedules += 1;
        });
      });
    }

    const diaryThisMonth = window.DiaryStore
      ? window.DiaryStore.getAll().filter((e) => (e.date || "").startsWith(monthPrefix)).length
      : 0;

    const photosThisMonth = window.PhotoStore
      ? window.PhotoStore.getAll().filter((p) => (p.createdAt || "").startsWith(monthPrefix)).length
      : 0;

    const rows = [
      ["완료한 일정", completedSchedules],
      ["작성한 일기", diaryThisMonth],
      ["추가한 사진", photosThisMonth],
    ];

    list.innerHTML = "";
    rows.forEach(([label, value]) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
      list.appendChild(li);
    });
  }

  function refresh() {
    renderQuote();
    renderMonthlySummary();
  }

  window.DashboardWidgets = { init: refresh, refresh };
})();
