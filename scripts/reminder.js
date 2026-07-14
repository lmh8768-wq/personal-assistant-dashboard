(function () {
  const NOTIFIED_KEY = "assistant.notified.v1";
  const SNOOZE_KEY = "assistant.snoozed.v1";
  const SOUND_KEY = "assistant.notifySound.v1";
  const SNOOZE_MINUTES = 10;

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

  function unmarkNotified(key) {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(loadNotified().filter((k) => k !== key)));
  }

  function isNotified(key) {
    return loadNotified().includes(key);
  }

  function loadSnoozeMap() {
    try {
      const raw = localStorage.getItem(SNOOZE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function setSnooze(key, minutes) {
    const map = loadSnoozeMap();
    map[key] = Date.now() + minutes * 60000;
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(map));
    unmarkNotified(key);
  }

  function isSnoozed(key) {
    const map = loadSnoozeMap();
    return typeof map[key] === "number" && Date.now() < map[key];
  }

  function isSoundEnabled() {
    return localStorage.getItem(SOUND_KEY) !== "false";
  }

  function playBeep() {
    if (!isSoundEnabled()) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.4);
    } catch {
      // ignore environments without audio support
    }
  }

  function fireNotification(occ, key) {
    const body = `${occ.startTime || ""} ${occ.title}${occ.memo ? " · " + occ.memo : ""}`.trim();
    playBeep();
    if (window.Notification && Notification.permission === "granted") {
      new Notification("🔔 일정 알림", { body });
      window.Toast.show(`🔔 ${body}`, {
        duration: 8000,
        actions: [{ label: `${SNOOZE_MINUTES}분 후 다시`, onAction: () => setSnooze(key, SNOOZE_MINUTES) }],
      });
    } else {
      window.Toast.show(`🔔 ${body}`, {
        duration: 8000,
        actions: [{ label: `${SNOOZE_MINUTES}분 후 다시`, onAction: () => setSnooze(key, SNOOZE_MINUTES) }],
      });
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

        if (now >= notifyAt && now < target && !isNotified(key) && !isSnoozed(key)) {
          fireNotification(occ, key);
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

  window.ReminderEngine = {
    init,
    check,
    isSoundEnabled,
    setSoundEnabled: (enabled) => localStorage.setItem(SOUND_KEY, String(enabled)),
  };
})();
