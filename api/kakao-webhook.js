const admin = require("firebase-admin");
const { getOccurrences, pad2 } = require("../scripts/schedule-recurrence.js");
const WeatherCalc = require("../scripts/weather-calc.js");
const Commands = require("../scripts/kakao-commands.js");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();

// Kakao i 오픈빌더 has no way to attach a custom Authorization header to a
// skill server call (unlike the CRON_SECRET header check in
// send-daily-notifications.js) — the webhook URL itself (with this as a
// query string, e.g. https://.../api/kakao-webhook?secret=xxxx) is the only
// place a shared secret can travel, so it's checked as a query param
// instead. Same fail-closed reasoning as CRON_SECRET: a missing env var
// must never make the check trivially bypassable.
function isAuthorized(req) {
  if (!process.env.KAKAO_WEBHOOK_SECRET) return false;
  return req.query?.secret === process.env.KAKAO_WEBHOOK_SECRET;
}

// Defaults used only when a brand-new/never-customized account is missing
// the corresponding synced key entirely — mirrors the DEFAULTS arrays in
// scripts/store.js (ledger/schedule categories) and
// scripts/exercise.js (body parts) exactly, so a category/body-part typed
// in KakaoTalk before ever opening the category manager in-app still
// resolves the same way the app itself would show it.
const DEFAULT_LEDGER_CATEGORIES = [
  { key: "food", label: "식비", type: "expense" },
  { key: "transport", label: "교통", type: "expense" },
  { key: "shopping", label: "쇼핑", type: "expense" },
  { key: "culture", label: "문화/여가", type: "expense" },
  { key: "living", label: "주거/생활", type: "expense" },
  { key: "etc", label: "기타", type: "expense" },
  { key: "salary", label: "급여", type: "income" },
  { key: "allowance", label: "용돈", type: "income" },
  { key: "etc_income", label: "기타수입", type: "income" },
];
const DEFAULT_SCHEDULE_CATEGORY_KEY = "etc";
const DEFAULT_SCHEDULE_IMPORTANCE = 3; // matches schedule.js's DEFAULT_IMPORTANCE
const DEFAULT_BODY_PARTS = [
  { key: "chest", label: "가슴" },
  { key: "back", label: "등" },
  { key: "shoulder", label: "어깨" },
  { key: "arm", label: "팔" },
  { key: "leg", label: "하체" },
  { key: "abs", label: "복근" },
];

function createId(prefix) {
  // Same scheme every scripts/*.js store uses (see store.js/practice.js/
  // exercise.js) — an id minted here needs to look exactly like one the
  // app itself would have minted, since it lands in the same synced array.
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parsePayload(userDoc) {
  if (!userDoc.exists) return {};
  try {
    const parsed = JSON.parse(userDoc.data().payload || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readKey(payload, key, fallback) {
  const raw = payload[key];
  if (raw === undefined) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writeUserPayload(tx, userRef, payload) {
  // A plain .set() (not {merge:true}) — matching cloud-sync.js's own
  // pushToCloud(), which does the exact same whole-document overwrite from
  // the browser. `updatedBy: "kakao"` doesn't match any real device's
  // DEVICE_ID, so any tab with the app open treats this write as a genuine
  // remote change (mergeRemoteData's union-by-id merge) rather than its own
  // echo — exactly the same as any other second device would be treated.
  //
  // KNOWN LIMITATION: this is a read-modify-write inside a Firestore
  // transaction, which protects against two concurrent Kakao/admin-SDK
  // writes racing each other, but NOT against racing a browser tab's own
  // pushToCloud() — that's a separate, non-transactional .set() the
  // transaction has no visibility into. In the rare case both land within
  // the same instant, whichever commits last wins the whole document. This
  // is the same last-write-wins limitation the app already accepts between
  // two browser devices; occasional manual KakaoTalk messages make the
  // window small in practice.
  tx.set(userRef, {
    payload: JSON.stringify(payload),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: "kakao",
  });
}

function formatDateLabel(dateStr) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}/${d}`;
}

function todayStrKST() {
  // Server runs in UTC — same KST-shift trick send-daily-notifications.js
  // uses, so "오늘" means the same calendar day here as it does there.
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${pad2(kst.getUTCMonth() + 1)}-${pad2(kst.getUTCDate())}`;
}

function skillText(text) {
  return { version: "2.0", template: { outputs: [{ simpleText: { text } }] } };
}

async function fetchWeatherServerSide() {
  // No browser here for weather.js's geolocation/localStorage cache — every
  // "날씨" message is a fresh Open-Meteo call for the fixed default location
  // (Seoul; per-device location from the app is deliberately never synced,
  // see weather.js's comment on weatherLocation.v1). Open-Meteo has no rate
  // limit that occasional chat messages would come close to.
  const res = await fetch(WeatherCalc.buildForecastUrl(WeatherCalc.DEFAULT_LOCATION));
  if (!res.ok) throw new Error("weather fetch failed");
  const data = await res.json();
  return WeatherCalc.shapeForecastResponse(data);
}

async function tryLink(kakaoUserId, code) {
  const codeRef = db.collection("kakaoLinkCodes").doc(code);
  const codeDoc = await codeRef.get();
  if (!codeDoc.exists) return { ok: false, reason: "not-found" };
  const { uid, expiresAt } = codeDoc.data();
  if (!uid || !expiresAt || Date.now() > expiresAt) {
    await codeRef.delete().catch(() => {});
    return { ok: false, reason: "expired" };
  }
  const linkedAt = Date.now();
  // Both directions written together: kakaoUserLinks is this webhook's own
  // fast lookup (kakao id -> uid, checked on every message), kakaoLinks is
  // what api/kakao-link-status.js and api/kakao-unlink.js read (uid ->
  // kakao id, since only the signed-in browser side can ask "am I linked?").
  await Promise.all([
    db.collection("kakaoUserLinks").doc(kakaoUserId).set({ uid, linkedAt }),
    db.collection("kakaoLinks").doc(uid).set({ kakaoUserId, linkedAt }),
    codeRef.delete(),
  ]);
  return { ok: true };
}

async function addLedgerEntry(userRef, kind, cmd, todayStr) {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(userRef);
    const payload = parsePayload(doc);
    const allCategories = readKey(payload, "assistant.ledgerCategories.v1", DEFAULT_LEDGER_CATEGORIES);
    const categories = (Array.isArray(allCategories) ? allCategories : DEFAULT_LEDGER_CATEGORIES).filter(
      (c) => c.type === kind
    );
    const entries = readKey(payload, "assistant.ledgerEntries.v1", []);

    // First remaining token after the amount is tried as a category label;
    // if it doesn't match anything real, it's folded back into the memo
    // instead of being silently dropped — see kakao-commands.js's
    // matchLabel doc comment for why this can't be resolved in the pure
    // parser (it needs this user's actual category list).
    let category = cmd.restTokens.length > 0 ? Commands.matchLabel(categories, cmd.restTokens[0]) : null;
    const memoTokens = category ? cmd.restTokens.slice(1) : cmd.restTokens;
    if (!category) category = categories[0] || { key: "etc", label: "기타" };

    const entry = {
      id: createId("exp"),
      date: todayStr,
      amount: cmd.amount,
      categoryKey: category.key,
      memo: memoTokens.join(" "),
      type: kind,
    };
    const next = Array.isArray(entries) ? entries : [];
    next.push(entry);
    payload["assistant.ledgerEntries.v1"] = JSON.stringify(next);
    writeUserPayload(tx, userRef, payload);
    return Commands.formatExpenseConfirmReply(kind, entry, category.label);
  });
}

async function addSchedule(userRef, cmd) {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(userRef);
    const payload = parsePayload(doc);
    const schedules = readKey(payload, "assistant.schedules.v1", []);
    const item = {
      id: createId("sc"),
      title: cmd.title,
      date: cmd.date,
      endDate: null,
      memo: "",
      repeat: { type: "none", until: null },
      importance: DEFAULT_SCHEDULE_IMPORTANCE,
      category: DEFAULT_SCHEDULE_CATEGORY_KEY,
      pinned: false,
    };
    const next = Array.isArray(schedules) ? schedules : [];
    next.push(item);
    payload["assistant.schedules.v1"] = JSON.stringify(next);
    writeUserPayload(tx, userRef, payload);
    return Commands.formatScheduleAddConfirmReply(item, formatDateLabel(cmd.date));
  });
}

async function addPractice(userRef, cmd, todayStr) {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(userRef);
    const payload = parsePayload(doc);
    const records = readKey(payload, "assistant.practice.v1", []);
    const checklist = readKey(payload, "assistant.practiceChecklist.v1", []);
    const record = {
      id: createId("pr"),
      date: todayStr,
      text: cmd.text,
      checkedIds: [],
      checklistTotal: Array.isArray(checklist) ? checklist.length : 0,
    };
    const next = Array.isArray(records) ? records : [];
    next.push(record);
    payload["assistant.practice.v1"] = JSON.stringify(next);
    writeUserPayload(tx, userRef, payload);
    return Commands.formatPracticeConfirmReply(formatDateLabel(todayStr));
  });
}

async function addExercise(userRef, cmd, todayStr) {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(userRef);
    const payload = parsePayload(doc);
    const allBodyParts = readKey(payload, "assistant.exerciseBodyParts.v1", DEFAULT_BODY_PARTS);
    const bodyParts = Array.isArray(allBodyParts) && allBodyParts.length > 0 ? allBodyParts : DEFAULT_BODY_PARTS;
    const bodyPart = Commands.matchLabel(bodyParts, cmd.bodyPartToken);
    if (!bodyPart) {
      return Commands.formatErrorReply("exercise", "no-body-part-match");
    }

    const logs = readKey(payload, "assistant.exerciseLog.v1", []);
    const next = Array.isArray(logs) ? logs : [];
    // Same "one log per date+bodyPart" rule exercise.js's handleExerciseLogAdd
    // enforces client-side — without it, a second "운동 가슴" text the same
    // day would just clutter the log with a duplicate that adds no
    // information (the log is a plain did/didn't-do checkbox, not a
    // sets/reps tracker).
    const alreadyLogged = next.some((e) => e.date === todayStr && e.bodyPart === bodyPart.key);
    if (alreadyLogged) {
      return Commands.formatAlreadyLoggedExerciseReply(formatDateLabel(todayStr), bodyPart.label);
    }
    next.push({ id: createId("exlog"), date: todayStr, bodyPart: bodyPart.key });
    payload["assistant.exerciseLog.v1"] = JSON.stringify(next);
    writeUserPayload(tx, userRef, payload);
    return Commands.formatExerciseConfirmReply(formatDateLabel(todayStr), bodyPart.label);
  });
}

async function handleLinked(uid, utterance, todayStr) {
  const userRef = db.collection("users").doc(uid);
  const cmd = Commands.parseCommand(utterance, todayStr);

  switch (cmd.type) {
    case "weather": {
      const weather = await fetchWeatherServerSide();
      return Commands.formatWeatherReply(weather, WeatherCalc);
    }
    case "today-schedule": {
      const doc = await userRef.get();
      const payload = parsePayload(doc);
      const schedules = readKey(payload, "assistant.schedules.v1", []);
      const items = getOccurrences(Array.isArray(schedules) ? schedules : [], todayStr);
      return Commands.formatTodayScheduleReply(items, formatDateLabel(todayStr));
    }
    case "expense":
    case "income":
      if (cmd.error) return Commands.formatErrorReply(cmd.type, cmd.error);
      return addLedgerEntry(userRef, cmd.type, cmd, todayStr);
    case "add-schedule":
      if (cmd.error) return Commands.formatErrorReply(cmd.type, cmd.error);
      return addSchedule(userRef, cmd);
    case "practice":
      if (cmd.error) return Commands.formatErrorReply(cmd.type, cmd.error);
      return addPractice(userRef, cmd, todayStr);
    case "exercise":
      if (cmd.error) return Commands.formatErrorReply(cmd.type, cmd.error);
      return addExercise(userRef, cmd, todayStr);
    case "link":
      return "이미 연동되어 있어요. '날씨', '오늘 일정'처럼 바로 말해보세요.";
    case "help":
    default:
      return Commands.formatHelpReply();
  }
}

async function handleUnlinked(kakaoUserId, utterance, todayStr) {
  const cmd = Commands.parseCommand(utterance, todayStr);
  if (cmd.type !== "link") return Commands.formatNotLinkedReply();
  if (cmd.error) return Commands.formatLinkFailureReply(cmd.error);
  const result = await tryLink(kakaoUserId, cmd.code);
  if (!result.ok) return Commands.formatLinkFailureReply(result.reason);
  return Commands.formatLinkSuccessReply();
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const utterance = req.body?.userRequest?.utterance;
  const kakaoUserId = req.body?.userRequest?.user?.id;
  if (typeof utterance !== "string" || typeof kakaoUserId !== "string" || !kakaoUserId) {
    res.status(200).json(skillText("요청을 이해하지 못했어요"));
    return;
  }

  const todayStr = todayStrKST();

  try {
    const userLinkDoc = await db.collection("kakaoUserLinks").doc(kakaoUserId).get();
    const replyText = userLinkDoc.exists
      ? await handleLinked(userLinkDoc.data().uid, utterance, todayStr)
      : await handleUnlinked(kakaoUserId, utterance, todayStr);
    res.status(200).json(skillText(replyText));
  } catch (err) {
    console.error("kakao-webhook failed", err);
    // Kakao's skill protocol expects a 200 with a valid response body even
    // on failure — returning a 5xx here just shows the user a generic
    // "봇이 응답하지 않습니다" from Kakao's own client with no useful text,
    // where a normal-looking reply at least tells them to retry.
    res.status(200).json(skillText("일시적인 오류가 발생했어요. 잠시 후 다시 시도해주세요."));
  }
};
