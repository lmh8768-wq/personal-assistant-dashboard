(function () {
  const NOTIFIED_KEY = "assistant.notified.v1";

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

  function loadNotified() {
    try {
      const raw = localStorage.getItem(NOTIFIED_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function markNotified(key) {
    const arr = loadNotified();
    arr.push(key);
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(arr.slice(-500)));
  }

  function isNotified(key) {
    return loadNotified().includes(key);
  }

  function fireNotification(occ) {
    const body = `${occ.startTime || ""} ${occ.title}${occ.memo ? " · " + occ.memo : ""}`.trim();
    if (window.Notification && Notification.permission === "granted") {
      new Notification("🔔 일정 알림", { body });
    } else {
      window.Toast.show(`🔔 ${body}`, { duration: 6000 });
    }
  }

  function check() {
    if (!window.ScheduleStore) return;
    const now = new Date();
    const dateStrs = [
      toDateStr(now),
      toDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)),
    ];

    dateStrs.forEach((dateStr) => {
      window.ScheduleStore.getOccurrences(dateStr).forEach((occ) => {
        if (!occ.reminderMinutes || !occ.startTime) return;
        const [h, m] = occ.startTime.split(":").map(Number);
        const target = parseDateStr(dateStr);
        target.setHours(h, m, 0, 0);
        const notifyAt = new Date(target.getTime() - occ.reminderMinutes * 60000);
        const key = `${occ.id}_${dateStr}`;

        if (now >= notifyAt && now < target && !isNotified(key)) {
          fireNotification(occ);
          markNotified(key);
        }
      });
    });
  }

  function updateToggleUI() {
    const btn = document.getElementById("notifyToggle");
    if (!btn) return;
    if (!("Notification" in window)) {
      btn.title = "이 브라우저는 알림을 지원하지 않아요";
      btn.disabled = true;
      return;
    }
    if (Notification.permission === "granted") {
      btn.classList.add("active");
      btn.title = "일정 알림 켜짐";
    } else {
      btn.classList.remove("active");
      btn.title = "일정 알림 켜기 (브라우저를 열어둔 동안 알려드려요)";
    }
  }

  function init() {
    updateToggleUI();
    const btn = document.getElementById("notifyToggle");
    if (btn) {
      btn.addEventListener("click", () => {
        if (!("Notification" in window)) return;
        if (Notification.permission === "granted") {
          window.Toast.show("이미 알림이 켜져 있어요. 끄려면 브라우저 사이트 설정에서 변경하세요.");
          return;
        }
        Notification.requestPermission().then(updateToggleUI);
      });
    }
    check();
    setInterval(check, 30000);
  }

  window.ReminderEngine = { init, check };
})();
