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

  // ---------- localStorage interception (auto-push on any local write) ----------
  const originalSetItem = localStorage.setItem.bind(localStorage);
  const originalRemoveItem = localStorage.removeItem.bind(localStorage);

  localStorage.setItem = function (key, value) {
    originalSetItem(key, value);
    if (isAppKey(key)) schedulePush();
  };

  localStorage.removeItem = function (key) {
    originalRemoveItem(key);
    if (isAppKey(key)) schedulePush();
  };

  function collectLocalState() {
    const data = {};
    for (const key in localStorage) {
      if (!Object.prototype.hasOwnProperty.call(localStorage, key)) continue;
      if (!isAppKey(key)) continue;
      data[key] = localStorage.getItem(key);
    }
    return data;
  }

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
  }

  let pushPending = false;

  function schedulePush() {
    if (applyingRemote) return;
    pushPending = true;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushToCloud, PUSH_DEBOUNCE_MS);
  }

  function pushToCloud() {
    clearTimeout(pushTimer);
    if (!pushPending) return;
    const user = auth && auth.currentUser;
    if (!user || !db) return;
    pushPending = false;
    const payload = JSON.stringify(collectLocalState());
    db.collection("users").doc(user.uid).set({
      payload,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: DEVICE_ID,
    }).catch((err) => console.error("cloud sync push failed:", err));
  }

  // iOS can suspend a backgrounded tab's timers before a debounced push
  // fires, silently dropping the change. Flush immediately whenever the
  // page is about to be hidden/unloaded so nothing gets lost.
  function flushPushNow() {
    if (pushPending) pushToCloud();
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
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    unsubscribeSnapshot = db.collection("users").doc(uid).onSnapshot(
      (doc) => {
        if (isFirst) {
          isFirst = false;
          if (doc.exists) {
            applyRemoteData(doc.data().payload);
          } else {
            pushToCloud();
          }
          showApp();
          window.initFeatures && window.initFeatures();
          return;
        }
        const d = doc.data();
        if (!d || d.updatedBy === DEVICE_ID) return;
        // Another device changed the data — reload so every view re-renders
        // from the freshly-synced localStorage.
        applyRemoteData(d.payload);
        location.reload();
      },
      (err) => {
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
    } catch (err) {
      showLogin("로그인 실패: 이메일/비밀번호를 확인해주세요.");
    }
  }

  function handleOfflineContinue() {
    showApp();
    window.initFeatures && window.initFeatures();
  }

  function init() {
    if (typeof firebase === "undefined") {
      // Firebase SDK failed to load: boot the app with whatever's local.
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
      console.error("cloud sync: failed to set auth persistence:", err);
    });
    // Queue writes to durable on-device storage first, so a save survives
    // even if iOS kills the tab before the network request finishes — the
    // SDK re-sends it automatically next time the app is open and online.
    db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
      console.error("cloud sync: failed to enable offline persistence:", err);
    });

    document.getElementById("authLoginForm").addEventListener("submit", handleLogin);
    document.getElementById("authOfflineBtn").addEventListener("click", handleOfflineContinue);

    auth.onAuthStateChanged((user) => {
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

  window.CloudSync = { init };
  init();
})();
