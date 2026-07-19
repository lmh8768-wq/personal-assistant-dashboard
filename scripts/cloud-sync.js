(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyBHP0n5-aVRvTbcdZOVwfz8Q9mYsiMtpi0",
    authDomain: "personal-assistant-ec8b5.firebaseapp.com",
    projectId: "personal-assistant-ec8b5",
    storageBucket: "personal-assistant-ec8b5.firebasestorage.app",
    messagingSenderId: "314496491668",
    appId: "1:314496491668:web:fff2ce56c3fe49f0c5d481",
  };

  const DEVICE_ID = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const OFFLINE_TIMEOUT_MS = 8000;
  const PUSH_DEBOUNCE_MS = 800;

  let auth;
  let db;
  let applyingRemote = false;
  let pushTimer = null;
  let unsubscribeSnapshot = null;
  let offlineTimer = null;

  function isAppKey(key) {
    return typeof key === "string" && key.startsWith("assistant.");
  }

  // ---------- Debug log (visible in Settings, for remote troubleshooting) ----------
  const LOG_KEY = "__cloudSync.log";
  const MAX_LOG_ENTRIES = 60;

  function logSync(msg) {
    let entries = [];
    try {
      entries = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    } catch {
      entries = [];
    }
    const time = new Date().toTimeString().slice(0, 8);
    entries.push(`[${time}] ${msg}`);
    if (entries.length > MAX_LOG_ENTRIES) entries = entries.slice(-MAX_LOG_ENTRIES);
    originalSetItem(LOG_KEY, JSON.stringify(entries));
    renderDebugLog();
  }

  function renderDebugLog() {
    const el = document.getElementById("cloudSyncLog");
    if (!el) return;
    let entries = [];
    try {
      entries = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    } catch {
      entries = [];
    }
    el.textContent = entries.length ? entries.join("\n") : "(로그 없음)";
  }

  // ---------- localStorage change detection ----------
  // We *try* to intercept localStorage.setItem/removeItem so a local write
  // triggers a push immediately, but Safari can silently ignore reassigning
  // Storage methods (no error, the override just never takes effect). So
  // this is a best-effort optimization only — the real, browser-agnostic
  // detection is the poller below, which just diffs a snapshot of the
  // assistant.* keys on an interval and can never fail to notice a change.
  const originalSetItem = localStorage.setItem.bind(localStorage);
  const originalRemoveItem = localStorage.removeItem.bind(localStorage);

  try {
    localStorage.setItem = function (key, value) {
      originalSetItem(key, value);
      if (isAppKey(key)) schedulePush();
    };
    localStorage.removeItem = function (key) {
      originalRemoveItem(key);
      if (isAppKey(key)) schedulePush();
    };
  } catch (err) {
    logSync(`localStorage patch failed (relying on poller): ${err.message}`);
  }

  const POLL_INTERVAL_MS = 1500;
  let lastSnapshotStr = null;

  function collectLocalState() {
    const data = {};
    for (const key in localStorage) {
      if (!Object.prototype.hasOwnProperty.call(localStorage, key)) continue;
      if (!isAppKey(key)) continue;
      data[key] = localStorage.getItem(key);
    }
    return data;
  }

  function currentSnapshotStr() {
    return JSON.stringify(collectLocalState());
  }

  function checkForLocalChanges() {
    if (applyingRemote) return;
    const snap = currentSnapshotStr();
    if (lastSnapshotStr !== null && snap !== lastSnapshotStr) {
      lastSnapshotStr = snap;
      schedulePush();
    } else {
      lastSnapshotStr = snap;
    }
  }

  setInterval(() => {
    checkForLocalChanges();
    // Retry a push that was queued before sign-in finished (e.g. changes
    // made in the offline-continue fallback) once we do have a session.
    if (hasPendingLocalChanges() && !pushPending && auth && auth.currentUser) {
      pushPending = true;
      pushToCloud();
    }
  }, POLL_INTERVAL_MS);

  function applyRemoteData(payloadStr) {
    let data;
    try {
      data = JSON.parse(payloadStr || "{}");
    } catch {
      return;
    }
    applyingRemote = true;
    Object.keys(localStorage)
      .filter(isAppKey)
      .forEach((key) => {
        if (!(key in data)) originalRemoveItem(key);
      });
    Object.keys(data).forEach((key) => {
      if (isAppKey(key)) originalSetItem(key, data[key]);
    });
    applyingRemote = false;
    // The state we just wrote is already in sync — don't treat it as a
    // pending local change on the next poll tick.
    lastSnapshotStr = currentSnapshotStr();
  }

  // Durable marker (survives reload/app-kill): "local storage may contain
  // changes the server hasn't confirmed yet." As long as this is set, we
  // must never let a pulled remote snapshot overwrite local data — that's
  // exactly how a not-yet-synced change gets silently destroyed.
  const PENDING_KEY = "__cloudSync.pendingPush";

  function markPending() {
    originalSetItem(PENDING_KEY, "1");
  }

  function clearPending() {
    originalRemoveItem(PENDING_KEY);
  }

  function hasPendingLocalChanges() {
    return localStorage.getItem(PENDING_KEY) === "1";
  }

  let pushPending = false;

  function schedulePush() {
    if (applyingRemote) return;
    pushPending = true;
    markPending();
    logSync(`change detected, push scheduled (${PUSH_DEBOUNCE_MS}ms)`);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushToCloud, PUSH_DEBOUNCE_MS);
  }

  function pushToCloud() {
    clearTimeout(pushTimer);
    if (!pushPending) return;
    const user = auth && auth.currentUser;
    if (!user || !db) {
      logSync("push skipped: not signed in yet");
      return;
    }
    pushPending = false;
    const payload = JSON.stringify(collectLocalState());
    logSync(`pushing to cloud... (${payload.length} chars)`);
    db.collection("users").doc(user.uid).set({
      payload,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: DEVICE_ID,
    }).then(() => {
      logSync("push CONFIRMED by server");
      clearPending();
    }).catch((err) => {
      logSync(`push FAILED: ${err.code || err.message}`);
      console.error("cloud sync push failed:", err);
      // Leave the pending marker set so the next load retries instead of
      // risking an overwrite from a stale remote copy.
    });
  }

  // iOS can suspend a backgrounded tab's timers before a debounced push
  // fires, silently dropping the change. Flush immediately whenever the
  // page is about to be hidden/unloaded so nothing gets lost.
  function flushPushNow() {
    checkForLocalChanges();
    if (pushPending) {
      logSync("page hiding, flushing pending push now");
      pushToCloud();
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPushNow();
  });
  window.addEventListener("pagehide", flushPushNow);

  // ---------- UI helpers ----------
  function showLoading() {
    document.getElementById("authLoading").hidden = false;
    document.getElementById("authLoginForm").hidden = true;
    document.getElementById("authGate").hidden = false;
  }

  function showLogin(message) {
    clearOfflineTimer();
    document.getElementById("authLoading").hidden = true;
    document.getElementById("authLoginForm").hidden = false;
    document.getElementById("authGate").hidden = false;
    document.getElementById("authError").textContent = message || "";
  }

  function showApp() {
    clearOfflineTimer();
    document.getElementById("authGate").hidden = true;
    document.getElementById("appRoot").hidden = false;
  }

  function clearOfflineTimer() {
    clearTimeout(offlineTimer);
    const btn = document.getElementById("authOfflineBtn");
    if (btn) btn.hidden = true;
  }

  function armOfflineFallback() {
    clearTimeout(offlineTimer);
    const btn = document.getElementById("authOfflineBtn");
    offlineTimer = setTimeout(() => {
      if (btn) btn.hidden = false;
    }, OFFLINE_TIMEOUT_MS);
  }

  // ---------- Sync lifecycle ----------
  function startListening(uid) {
    let isFirst = true;
    logSync(`startListening uid=${uid.slice(0, 6)}…`);
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    unsubscribeSnapshot = db.collection("users").doc(uid).onSnapshot(
      (doc) => {
        if (isFirst) {
          isFirst = false;
          logSync(`snapshot(first): pending=${hasPendingLocalChanges()} docExists=${doc.exists} fromCache=${doc.metadata.fromCache}`);
          if (hasPendingLocalChanges()) {
            // Last session made a local change we never confirmed reached
            // the server. Keep the local copy and retry pushing it instead
            // of pulling in a possibly-stale remote version over it.
            logSync("pending local change found -> re-pushing, NOT applying remote");
            pushPending = true;
            pushToCloud();
          } else if (doc.exists) {
            logSync("no pending change -> applying remote data");
            applyRemoteData(doc.data().payload);
          } else {
            logSync("no remote doc yet -> pushing local as initial state");
            pushPending = true;
            pushToCloud();
          }
          showApp();
          window.initFeatures && window.initFeatures();
          return;
        }
        const d = doc.data();
        if (!d || d.updatedBy === DEVICE_ID) {
          logSync("snapshot(update): own echo, ignored");
          return;
        }
        logSync(`snapshot(update): from another device (fromCache=${doc.metadata.fromCache})`);
        if (hasPendingLocalChanges()) {
          // We have our own unconfirmed local change in flight — don't let
          // an incoming remote update clobber it. Our pending push will
          // land shortly and become the new authoritative version.
          return;
        }
        // Another device changed the data — reload so every view re-renders
        // from the freshly-synced localStorage.
        logSync("applying remote update + reloading");
        applyRemoteData(d.payload);
        location.reload();
      },
      (err) => {
        logSync(`listen ERROR: ${err.code || err.message}`);
        console.error("cloud sync listen failed:", err);
        showApp();
        window.initFeatures && window.initFeatures();
      }
    );
  }

  async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById("authEmailInput").value.trim();
    const password = document.getElementById("authPasswordInput").value;
    document.getElementById("authError").textContent = "";
    try {
      await auth.signInWithEmailAndPassword(email, password);
      logSync(`login OK: ${email}`);
    } catch (err) {
      logSync(`login FAILED: ${err.code || err.message}`);
      showLogin("로그인 실패: 이메일/비밀번호를 확인해주세요.");
    }
  }

  function handleOfflineContinue() {
    logSync("user clicked offline-continue");
    showApp();
    window.initFeatures && window.initFeatures();
  }

  function init() {
    logSync(`--- init, device=${DEVICE_ID.slice(0, 10)} ---`);
    if (typeof firebase === "undefined") {
      // Firebase SDK failed to load: boot the app with whatever's local.
      logSync("firebase SDK not loaded, booting offline");
      document.getElementById("appRoot").hidden = false;
      document.getElementById("authGate").hidden = true;
      window.initFeatures && window.initFeatures();
      return;
    }

    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    // Keep the session across restarts/reloads (this is Firebase's default,
    // but set it explicitly so a stale login never gets treated as "logged out").
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((err) => {
      logSync(`setPersistence FAILED: ${err.code || err.message}`);
    });
    // Queue writes to durable on-device storage first, so a save survives
    // even if iOS kills the tab before the network request finishes — the
    // SDK re-sends it automatically next time the app is open and online.
    db.enablePersistence({ synchronizeTabs: true }).then(() => {
      logSync("offline persistence enabled");
    }).catch((err) => {
      logSync(`enablePersistence FAILED: ${err.code || err.message}`);
    });

    document.getElementById("authLoginForm").addEventListener("submit", handleLogin);
    document.getElementById("authOfflineBtn").addEventListener("click", handleOfflineContinue);

    auth.onAuthStateChanged((user) => {
      logSync(`authStateChanged: ${user ? "signed in as " + user.email : "signed out"}`);
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }
      if (user) {
        showLoading();
        armOfflineFallback();
        startListening(user.uid);
      } else {
        showLogin();
      }
    });
  }

  window.CloudSync = { init, renderDebugLog };
  init();
})();
