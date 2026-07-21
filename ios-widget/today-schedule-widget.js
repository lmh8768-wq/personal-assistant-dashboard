// Variables used by Scriptable.
// icon-color: deep-purple; icon-glyph: calendar-alt;
//
// 아이폰 홈 화면 위젯: "오늘의 일정"을 대시보드(personal-assistant-dashboard)와
// 같은 Firebase 계정에서 읽어와 보여줍니다.
//
// 설치 방법은 이 폴더의 README.md를 참고하세요.

const FIREBASE_API_KEY = "AIzaSyBHP0n5-aVRvTbcdZOVwfz8Q9mYsiMtpi0";
const FIREBASE_PROJECT_ID = "personal-assistant-ec8b5";
const DASHBOARD_URL = "https://personal-assistant-dashboard-five.vercel.app";

const KEYCHAIN_EMAIL_KEY = "assistantDashboard.email";
const KEYCHAIN_PASSWORD_KEY = "assistantDashboard.password";

// ---------- Credentials (stored in the device Keychain, not in this script) ----------
async function getCredentials() {
  if (Keychain.contains(KEYCHAIN_EMAIL_KEY) && Keychain.contains(KEYCHAIN_PASSWORD_KEY)) {
    return {
      email: Keychain.get(KEYCHAIN_EMAIL_KEY),
      password: Keychain.get(KEYCHAIN_PASSWORD_KEY),
    };
  }
  if (config.runsInWidget) return null; // widgets can't show a prompt

  const alert = new Alert();
  alert.title = "대시보드 로그인";
  alert.message = "personal-assistant-dashboard 로그인에 쓰는 이메일/비밀번호를 입력하세요.\n이 기기의 키체인에만 안전하게 저장되고, 위젯을 새로고침할 때마다 다시 로그인하는 데 쓰여요.";
  alert.addTextField("이메일");
  alert.addSecureTextField("비밀번호");
  alert.addAction("저장");
  alert.addCancelAction("취소");
  const idx = await alert.present();
  if (idx === -1) return null;

  const email = alert.textFieldValue(0).trim();
  const password = alert.textFieldValue(1);
  if (!email || !password) return null;

  Keychain.set(KEYCHAIN_EMAIL_KEY, email);
  Keychain.set(KEYCHAIN_PASSWORD_KEY, password);
  return { email, password };
}

// 비밀번호를 바꿨거나 로그인 정보를 다시 입력하고 싶을 때, 앱에서(위젯이 아니라)
// 스크립트를 실행하면 매번 이 확인창이 뜹니다.
async function maybeResetCredentials() {
  if (config.runsInWidget) return;
  if (!Keychain.contains(KEYCHAIN_EMAIL_KEY)) return;
  const alert = new Alert();
  alert.title = "로그인 정보 재설정";
  alert.message = `현재 저장된 이메일: ${Keychain.get(KEYCHAIN_EMAIL_KEY)}\n다시 입력할까요?`;
  alert.addAction("다시 입력");
  alert.addCancelAction("그대로 두기");
  const idx = await alert.present();
  if (idx === 0) {
    Keychain.remove(KEYCHAIN_EMAIL_KEY);
    Keychain.remove(KEYCHAIN_PASSWORD_KEY);
  }
}

// ---------- Firebase (REST, no SDK needed in Scriptable) ----------
async function signIn(email, password) {
  const req = new Request(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`
  );
  req.method = "POST";
  req.headers = { "Content-Type": "application/json" };
  req.body = JSON.stringify({ email, password, returnSecureToken: true });
  const res = await req.loadJSON();
  if (res.error) throw new Error(res.error.message || "로그인 실패");
  return { idToken: res.idToken, uid: res.localId };
}

async function fetchPayload(idToken, uid) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}`;
  const req = new Request(url);
  req.headers = { Authorization: `Bearer ${idToken}` };
  const res = await req.loadJSON();
  if (res.error) throw new Error(res.error.message || "데이터를 불러오지 못했어요");
  const raw = res.fields && res.fields.payload && res.fields.payload.stringValue;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ---------- Schedule logic (ported from scripts/store.js matchesDate/getOccurrences) ----------
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

function matchesDate(item, dateStr) {
  if (dateStr < item.date) return false;
  const repeat = item.repeat || { type: "none" };
  if (repeat.until && dateStr > repeat.until) return false;
  if ((item.excludedDates || []).includes(dateStr)) return false;

  switch (repeat.type) {
    case "daily":
      return true;
    case "weekdays": {
      const day = parseDateStr(dateStr).getDay();
      return day >= 1 && day <= 5;
    }
    case "every10days": {
      const diffDays = Math.round((parseDateStr(dateStr) - parseDateStr(item.date)) / 86400000);
      return diffDays % 10 === 0;
    }
    case "weekly":
      return parseDateStr(item.date).getDay() === parseDateStr(dateStr).getDay();
    case "monthly":
      return parseDateStr(item.date).getDate() === parseDateStr(dateStr).getDate();
    case "yearly": {
      const anchor = parseDateStr(item.date);
      const target = parseDateStr(dateStr);
      return anchor.getMonth() === target.getMonth() && anchor.getDate() === target.getDate();
    }
    default:
      return dateStr === item.date;
  }
}

function getOccurrences(schedules, dateStr) {
  return schedules
    .filter((item) => matchesDate(item, dateStr))
    .map((item) => {
      const override = (item.overrides || {})[dateStr];
      return { ...item, ...(override || {}), occurrenceDate: dateStr };
    });
}

const DEFAULT_CATEGORY_COLOR = "#94a3b8";

function getCategoryColor(categories, key) {
  const found = categories.find((c) => c.key === (key || "etc"));
  return (found && found.color) || DEFAULT_CATEGORY_COLOR;
}

// ---------- Widget rendering ----------
function buildMessageWidget(title, message) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#15171c");
  const t = widget.addText(title);
  t.textColor = Color.white();
  t.font = Font.boldSystemFont(13);
  widget.addSpacer(6);
  const m = widget.addText(message);
  m.textColor = new Color("#9aa0ab");
  m.font = Font.systemFont(11);
  return widget;
}

async function buildScheduleWidget() {
  const creds = await getCredentials();
  if (!creds) {
    return buildMessageWidget("⚠️ 로그인 필요", "Scriptable 앱에서 이 스크립트를 한 번 실행해 로그인해주세요.");
  }

  let idToken, uid;
  try {
    ({ idToken, uid } = await signIn(creds.email, creds.password));
  } catch (err) {
    return buildMessageWidget("⚠️ 로그인 실패", err.message);
  }

  let data;
  try {
    data = await fetchPayload(idToken, uid);
  } catch (err) {
    return buildMessageWidget("⚠️ 불러오기 실패", err.message);
  }

  let schedules = [];
  let categories = [];
  try {
    schedules = JSON.parse(data["assistant.schedules.v1"] || "[]");
  } catch {}
  try {
    categories = JSON.parse(data["assistant.categories.v1"] || "[]");
  } catch {}

  const today = new Date();
  const todayStr = toDateStr(today);
  const items = getOccurrences(schedules, todayStr).sort(
    (a, b) => (b.importance || 0) - (a.importance || 0)
  );

  const widget = new ListWidget();
  widget.backgroundColor = new Color("#15171c");
  widget.url = `${DASHBOARD_URL}#schedule`;

  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const header = widget.addText(
    `오늘의 일정 · ${today.getMonth() + 1}/${today.getDate()}(${weekdays[today.getDay()]})`
  );
  header.textColor = Color.white();
  header.font = Font.boldSystemFont(13);
  widget.addSpacer(8);

  const maxItems = config.widgetFamily === "small" ? 3 : 6;

  if (items.length === 0) {
    const empty = widget.addText("오늘 등록된 일정이 없어요");
    empty.textColor = new Color("#9aa0ab");
    empty.font = Font.systemFont(12);
  } else {
    items.slice(0, maxItems).forEach((item) => {
      const row = widget.addStack();
      row.centerAlignContent();

      const dot = row.addText("●");
      dot.textColor = new Color(getCategoryColor(categories, item.category));
      dot.font = Font.systemFont(10);
      row.addSpacer(6);

      const isDone = (item.completedDates || []).includes(item.occurrenceDate);
      const title = row.addText(item.title || "(제목 없음)");
      title.textColor = isDone ? new Color("#5b6070") : Color.white();
      title.font = Font.systemFont(12);
      title.lineLimit = 1;

      widget.addSpacer(5);
    });

    if (items.length > maxItems) {
      const more = widget.addText(`외 ${items.length - maxItems}개`);
      more.textColor = new Color("#6b7280");
      more.font = Font.systemFont(10);
    }
  }

  return widget;
}

// ---------- Entry point ----------
await maybeResetCredentials();
const widget = await buildScheduleWidget();

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
