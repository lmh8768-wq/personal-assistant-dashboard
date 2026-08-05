(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyBHP0n5-aVRvTbcdZOVwfz8Q9mYsiMtpi0",
    authDomain: "personal-assistant-ec8b5.firebaseapp.com",
    projectId: "personal-assistant-ec8b5",
    storageBucket: "personal-assistant-ec8b5.firebasestorage.app",
    messagingSenderId: "314496491668",
    appId: "1:314496491668:web:fff2ce56c3fe49f0c5d481",
  };

  // Persisted (not "assistant."-prefixed, so never synced/merged itself) so
  // every tab of the same browser profile shares one id. A fresh id per TAB
  // used to mean two tabs of the SAME device didn't recognize each other's
  // pushes as "own" — an edit in tab A looked like a genuine remote change
  // to tab B, triggering an unwanted merge + location.reload() that could
  // discard whatever tab B had mid-typed in a form.
  const DEVICE_ID_KEY = "__cloudSync.deviceId";
  function resolveDeviceId() {
    try {
      const existing = localStorage.getItem(DEVICE_ID_KEY);
      if (existing) return existing;
      const fresh = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(DEVICE_ID_KEY, fresh);
      return fresh;
    } catch {
      return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
  }
  const DEVICE_ID = resolveDeviceId();
  const OFFLINE_TIMEOUT_MS = 8000;
  const PUSH_DEBOUNCE_MS = 800;
  const LISTEN_RETRY_DELAY_MS = 10000;

  let auth;
  let db;
  let applyingRemote = false;
  let pushTimer = null;
  let unsubscribeSnapshot = null;
  let offlineTimer = null;
  let listenRetryTimer = null;
  let sizeWarningShown = false; // nag about a near-limit payload once per session, not every push attempt
  // Guards against the exact class of bug that once wiped a user's data: a
  // local write (e.g. a widget seeding its own cache key) racing ahead of
  // the very first Firestore pull and getting pushed up as if it were the
  // complete state, replacing everything that hadn't loaded into
  // localStorage yet. No push is allowed to reach the server until the
  // first snapshot for this sign-in has been fully handled.
  let initialSyncDone = false;

  function isAppKey(key) {
    return typeof key === "string" && key.startsWith("assistant.");
  }

  // weather.js used to write its cache under "assistant.weatherCache.v1"/
  // "assistant.weatherLocation.v1" (fixed in the commit that also added the
  // initialSyncDone guard above) — that bug let a fast per-device weather
  // write race ahead of the first pull and get pushed as if it were the
  // whole account, wiping schedules/practice/etc. The rename stopped new
  // damage, but never deleted the two now-dead keys it left behind: nothing
  // reads or writes them anymore, yet collectLocalState() still picks them
  // up (they still start with "assistant.") and re-uploads them on every
  // push, quietly wasting both local storage and sync payload — one
  // real-world case grew to ~1MB, right at Firestore's per-document limit,
  // and broke sync outright ("데이터가 너무 커서 동기화가 계속 실패"). One-time
  // cleanup so existing installs shed the dead weight instead of carrying it
  // forever; a fresh install never has these keys, so this is a no-op there.
  const LEGACY_ORPHANED_KEYS = ["assistant.weatherCache.v1", "assistant.weatherLocation.v1"];
  function cleanupLegacyKeys() {
    LEGACY_ORPHANED_KEYS.forEach((key) => {
      if (localStorage.getItem(key) !== null) localStorage.removeItem(key);
    });
  }

  // ---------- Debug log (visible in Settings, for remote troubleshooting) ----------
  const LOG_KEY = "__cloudSync.log";
  const MAX_LOG_ENTRIES = 60;

  // ---------- Persistent sync status indicator (sidebar footer) ----------
  // logSync() above already records everything into the settings-page debug
  // log, but that's only visible if you go dig for it — this surfaces the
  // current state (synced/syncing/offline/error) at a glance everywhere.
  function setSyncStatus(state, text) {
    const el = document.getElementById("syncStatus");
    const textEl = document.getElementById("syncStatusText");
    if (!el || !textEl) return;
    el.hidden = false;
    el.className = "sync-status sync-status-" + state;
    textEl.textContent = text;
  }

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
    try {
      for (const key in localStorage) {
        if (!Object.prototype.hasOwnProperty.call(localStorage, key)) continue;
        if (!isAppKey(key)) continue;
        data[key] = localStorage.getItem(key);
      }
    } catch (err) {
      logSync(`collectLocalState failed: ${err.message}`);
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

  function pollTick() {
    checkForLocalChanges();
    // Retry a push that was queued before sign-in/initial sync finished
    // (e.g. changes made in the offline-continue fallback) once we're ready.
    if (hasPendingLocalChanges() && !pushPending && !pushInFlight && auth && auth.currentUser && initialSyncDone) {
      pushPending = true;
      pushToCloud();
    }
  }

  // No UI interaction is possible while the tab is hidden, so nothing local
  // CAN change during that time — pausing here cuts out a scan+JSON.stringify
  // of the whole app-prefixed localStorage every 1.5s for however long the
  // tab sits backgrounded, with no loss of correctness (flushPushNow already
  // does one last check right as it hides, and resuming does an immediate
  // check rather than waiting up to POLL_INTERVAL_MS to notice anything that
  // changed while away, e.g. a remote push applied on reconnect).
  let pollTimer = setInterval(pollTick, POLL_INTERVAL_MS);

  // Counts only "assistant."-prefixed keys, same scope as everything else
  // that reasons about "the synced payload" — a stray non-prefixed field in
  // the remote doc (a hand edit in the Firestore console, or some future
  // bug) used to make this look non-empty even when zero real app keys were
  // present, which would let the anomalous-empty-payload guard below wave
  // through the exact wipe it exists to catch.
  function payloadKeyCount(payloadStr) {
    try {
      const parsed = JSON.parse(payloadStr || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;
      return Object.keys(parsed).filter(isAppKey).length;
    } catch {
      return 0;
    }
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
      // A non-string value (hand-edited Firestore doc, a future
      // serialization bug) would otherwise get coerced to the literal
      // "[object Object]" by localStorage.setItem and silently corrupt
      // that key — skip it instead of writing garbage.
      if (isAppKey(key) && typeof data[key] === "string") originalSetItem(key, data[key]);
    });
    applyingRemote = false;
    // The state we just wrote is already in sync — don't treat it as a
    // pending local change on the next poll tick.
    lastSnapshotStr = currentSnapshotStr();
  }

  // Per-key merge instead of a wholesale overwrite — used only for an
  // in-session update from another device (see the snapshot listener
  // below), never for the very first pull, where applyRemoteData's full
  // replace is exactly right (there's nothing local worth preserving yet).
  //
  // The bug this fixes: two devices editing DIFFERENT things close
  // together (device A adds a ledger entry, device B adds a recipe) used
  // to race at the whole-document level — whichever push landed second
  // would overwrite the *entire* payload with its own snapshot, silently
  // erasing the other device's change even though the two edits never
  // touched the same data. Every store in this app keeps its records as
  // either an array of {id, ...} objects or a plain settings-shaped
  // object, so merging generically per top-level key (array = union by id,
  // remote wins on a genuine same-id conflict; object = shallow spread,
  // remote wins per-field) recovers the common case without needing a
  // bespoke merge rule per store. It's still not a full CRDT — two devices
  // editing the *same* item's *same* field at the same time still has one
  // side win — but that's a much narrower window than before.
  function mergeStoredValue(existingRaw, incomingRaw) {
    let existing;
    let incoming;
    try {
      existing = existingRaw != null ? JSON.parse(existingRaw) : undefined;
    } catch {
      existing = undefined;
    }
    try {
      incoming = incomingRaw != null ? JSON.parse(incomingRaw) : undefined;
    } catch {
      incoming = undefined;
    }

    const bothMergeable =
      (Array.isArray(existing) && Array.isArray(incoming)) ||
      (existing && typeof existing === "object" && !Array.isArray(existing) &&
        incoming && typeof incoming === "object" && !Array.isArray(incoming));
    if (!bothMergeable) {
      // Not both mergeable the same way (or one side missing/unparseable) —
      // fall back to the old full-replace behavior for just this one key.
      return incomingRaw;
    }
    return JSON.stringify(window.DeepMerge.mergeValues(existing, incoming));
  }
  // Exposed purely so tests/cloud-sync-merge.test.js can exercise the real
  // shipped implementation instead of a duplicated copy — it's a stateless
  // string-in/string-out transform, nothing sensitive to expose.
  window.__mergeStoredValueForTest = mergeStoredValue;

  function mergeRemoteData(payloadStr) {
    let data;
    try {
      data = JSON.parse(payloadStr || "{}");
    } catch {
      return;
    }
    applyingRemote = true;
    const allKeys = new Set([...Object.keys(localStorage).filter(isAppKey), ...Object.keys(data).filter(isAppKey)]);
    allKeys.forEach((key) => {
      const existingRaw = localStorage.getItem(key);
      const incomingRaw = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
      if (incomingRaw == null || typeof incomingRaw !== "string") {
        // Remote doesn't have this key at all, or it's not the string every
        // store always writes (hand-edited doc / bug). Every store in this
        // app always re-setItem's its key (even to an empty array), never
        // removeItem's it — so a genuinely missing key here means the
        // *other* device just hasn't loaded whatever feature wrote this
        // key yet, not that it was deliberately cleared. Keep the local copy.
        return;
      }
      if (existingRaw == null) {
        originalSetItem(key, incomingRaw);
        return;
      }
      originalSetItem(key, mergeStoredValue(existingRaw, incomingRaw));
    });
    applyingRemote = false;
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
    try {
      return localStorage.getItem(PENDING_KEY) === "1";
    } catch {
      return false;
    }
  }

  let pushPending = false;
  // True from the moment a push's network write is issued until it
  // resolves/rejects. Without this, a push slower than the 1.5s poll
  // interval let pollTick's retry branch see "pending, and pushPending was
  // already reset to false at pushToCloud's start" and fire a second,
  // fully concurrent .set() to the same document — if the responses landed
  // out of order, the one queued first could win and silently revert the
  // newer local change.
  let pushInFlight = false;

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
    if (!initialSyncDone) {
      // Local state may still be missing data that the pull hasn't applied
      // yet — pushing now would overwrite the server with a partial state.
      // Stay pending; the poller retries once the first sync completes.
      logSync("push deferred: initial sync not complete yet");
      return;
    }
    if (pushInFlight) {
      // A previous push is still waiting on the network (slow connection) —
      // stay pending and let the poller retry once it resolves, instead of
      // firing a second write that could race the first one.
      logSync("push deferred: previous push still in flight");
      return;
    }
    pushPending = false;
    pushInFlight = true;
    const payload = JSON.stringify(collectLocalState());
    logSync(`pushing to cloud... (${payload.length} chars)`);
    setSyncStatus("syncing", "동기화 중...");
    if (payload.length > 800000) {
      // Firestore caps a document at ~1MiB; getting this close means the
      // next write could be rejected outright (most likely culprit: a big
      // PDF in the practice sheet library). Flag it clearly rather than
      // letting it fail with an opaque error later.
      logSync(`WARNING: payload is ${(payload.length / 1024).toFixed(0)}KB, nearing Firestore's 1MB doc limit`);
      // This used to only ever reach the debug log in Settings, which
      // nobody looks at unless something's already visibly wrong — the
      // whole point of catching it this early is to warn before that
      // happens. Once per session, not once per debounce cycle: this check
      // re-runs on every single push attempt while stuck near the limit.
      if (!sizeWarningShown) {
        sizeWarningShown = true;
        window.Toast?.show("동기화할 데이터가 많이 쌓였어요 — 곧 저장 공간 한계에 닿을 수 있어요", {
          type: "warning",
          duration: 6000,
        });
      }
    }
    db.collection("users").doc(user.uid).set({
      payload,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: DEVICE_ID,
    }).then(() => {
      pushInFlight = false;
      logSync("push CONFIRMED by server");
      clearPending();
      setSyncStatus("synced", "동기화됨");
    }).catch((err) => {
      pushInFlight = false;
      logSync(`push FAILED: ${err.code || err.message}`);
      console.error("cloud sync push failed:", err);
      // Leave the pending marker set so the next load retries instead of
      // risking an overwrite from a stale remote copy. If the payload was
      // already near Firestore's limit, retrying the exact same push won't
      // help — say so plainly instead of leaving the user staring at a
      // generic "동기화 실패" that gives no hint what to actually do.
      if (payload.length > 800000) {
        window.Toast?.show("데이터가 너무 커서 동기화가 계속 실패하고 있어요. 오래된 가계부/연습 기록을 정리해보세요.", {
          type: "error",
          duration: 8000,
        });
      }
      setSyncStatus("error", "동기화 실패");
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
    if (document.visibilityState === "hidden") {
      flushPushNow();
      clearInterval(pollTimer);
      pollTimer = null;
    } else if (!pollTimer) {
      pollTick(); // catch up immediately instead of waiting up to POLL_INTERVAL_MS
      pollTimer = setInterval(pollTick, POLL_INTERVAL_MS);
    }
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
    initialSyncDone = false;
    logSync(`startListening uid=${uid.slice(0, 6)}…`);
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    unsubscribeSnapshot = db.collection("users").doc(uid).onSnapshot(
      (doc) => {
        if (isFirst) {
          isFirst = false;
          // Any of the three branches below is itself the authoritative
          // first sync action (pull remote, resume a pending push, or seed
          // an empty doc) — allow them through, then close the window so
          // no unrelated write can sneak a push in ahead of them.
          initialSyncDone = true;
          logSync(`snapshot(first): pending=${hasPendingLocalChanges()} docExists=${doc.exists} fromCache=${doc.metadata.fromCache}`);
          if (hasPendingLocalChanges()) {
            // Last session made a local change we never confirmed reached
            // the server. Keep the local copy and retry pushing it instead
            // of pulling in a possibly-stale remote version over it.
            logSync("pending local change found -> re-pushing, NOT applying remote");
            pushPending = true;
            pushToCloud();
          } else if (doc.exists) {
            // A remote payload that's empty/unparseable while THIS device
            // still has real local data is far more likely to be a
            // corrupted or incomplete write than a genuinely empty
            // account — this is exactly the failure mode that once wiped
            // a user's data: some earlier bug (e.g. a push racing ahead of
            // the very first pull, since fixed by initialSyncDone above)
            // could have left the server holding an empty payload, and
            // every device that ever logs in afterward would otherwise
            // blindly apply that emptiness and lose everything. Refuse the
            // pull in that specific case and re-push the local copy
            // instead, so a bad server state can't cascade to every device.
            const remoteKeyCount = payloadKeyCount(doc.data().payload);
            const localKeyCount = payloadKeyCount(currentSnapshotStr());
            if (remoteKeyCount === 0 && localKeyCount > 0) {
              logSync(
                `REFUSED to apply remote data: server payload has 0 keys but this device has ${localKeyCount} — keeping local, re-pushing it`
              );
              console.error("cloud sync: refused an anomalous empty remote pull; local data preserved");
              window.Toast?.show(
                "서버의 동기화 데이터가 비어있어서 적용하지 않았어요. 이 기기의 데이터를 그대로 유지하고 다시 서버로 올려요.",
                { type: "warning", duration: 10000 }
              );
              pushPending = true;
              pushToCloud();
            } else {
              logSync("no pending change -> applying remote data");
              applyRemoteData(doc.data().payload);
              setSyncStatus("synced", "동기화됨");
            }
          } else {
            logSync("no remote doc yet -> pushing local as initial state");
            pushPending = true;
            pushToCloud();
          }
          // Runs after the branch above so a still-lingering legacy key
          // pulled back in via applyRemoteData gets swept up too, not just
          // one that was already gone locally — then, since removeItem is
          // patched and initialSyncDone/auth/db are already set at this
          // point, the removal schedules a real push that overwrites the
          // server copy without it, instead of just cleaning this device.
          cleanupLegacyKeys();
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
        // Another device changed the data — merge (not overwrite) it into
        // local storage, so a change this device made that the other
        // device's snapshot didn't know about yet doesn't get silently
        // erased, then reload so every view re-renders from the merged
        // result. markPending() (durable — survives the reload) means the
        // merged state gets pushed back up right after reload via the
        // existing "pending local change found -> re-push" first-snapshot
        // path below, so both devices converge on the same merged copy
        // instead of the merge staying local-only.
        logSync("merging remote update with local, then re-syncing");
        mergeRemoteData(d.payload);
        markPending();
        location.reload();
      },
      (err) => {
        logSync(`listen ERROR: ${err.code || err.message}`);
        console.error("cloud sync listen failed:", err);
        setSyncStatus("error", "동기화 연결 끊김");
        showApp();
        window.initFeatures && window.initFeatures();
        // A listen error used to leave initialSyncDone permanently false —
        // pushToCloud() (which checks it) and the local-change poller both
        // refuse to run until it's true, so every edit made for the rest of
        // the session queued as "pending" and silently never reached the
        // server, with no ongoing indication beyond this one-time status
        // text. Firestore's onSnapshot listener is dead after erroring (it
        // doesn't retry itself), so also schedule reattaching it — pushes
        // recover immediately via the flag below, and incoming updates
        // from other devices recover once the new listener attaches.
        initialSyncDone = true;
        clearTimeout(listenRetryTimer);
        listenRetryTimer = setTimeout(() => {
          if (auth && auth.currentUser) startListening(auth.currentUser.uid);
        }, LISTEN_RETRY_DELAY_MS);
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
    setSyncStatus("offline", "오프라인");
    cleanupLegacyKeys();
    showApp();
    window.initFeatures && window.initFeatures();
  }

  function init() {
    logSync(`--- init, device=${DEVICE_ID.slice(0, 10)} ---`);
    if (typeof firebase === "undefined") {
      // Firebase SDK failed to load: boot the app with whatever's local.
      logSync("firebase SDK not loaded, booting offline");
      setSyncStatus("offline", "오프라인");
      cleanupLegacyKeys();
      document.getElementById("appRoot").hidden = false;
      document.getElementById("authGate").hidden = true;
      window.initFeatures && window.initFeatures();
      return;
    }

    try {
      firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
    } catch (err) {
      // A partial CDN hiccup (the base SDK loads but firebase-auth-compat.js
      // or firebase-firestore-compat.js fails independently) used to leave
      // `typeof firebase` defined — so the offline branch above never
      // triggers — while firebase.auth()/firestore() throw because that
      // module never registered itself. The exception was uncaught, so
      // onAuthStateChanged never got wired up and window.initFeatures()
      // never ran: the user was stuck on the loading spinner forever with
      // no offline-fallback button. Boot offline the same way a fully
      // missing SDK does instead.
      logSync(`firebase partially loaded, booting offline: ${err.message}`);
      setSyncStatus("offline", "오프라인");
      cleanupLegacyKeys();
      document.getElementById("appRoot").hidden = false;
      document.getElementById("authGate").hidden = true;
      window.initFeatures && window.initFeatures();
      return;
    }
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

    // The listeners above only catch failures while actively talking to
    // Firestore — this also flags a plain loss of network connectivity
    // (e.g. wifi drops) even when nothing was mid-sync at the time.
    window.addEventListener("offline", () => setSyncStatus("offline", "오프라인"));
    window.addEventListener("online", () => setSyncStatus("syncing", "재연결 중..."));
  }

  window.CloudSync = { init, renderDebugLog };
  init();
})();
