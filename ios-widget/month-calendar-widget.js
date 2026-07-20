// Variables used by Scriptable.
// icon-color: deep-purple; icon-glyph: calendar;
//
// 아이폰 홈 화면 위젯: 이번 달 전체를 한 눈에 보여주는 캘린더 위젯.
// 일정이 있는 날짜에 점이 표시되고, 오늘 날짜는 강조돼요.
// personal-assistant-dashboard와 같은 Firebase 계정에서 데이터를 읽어옵니다.
//
// ※ 큰(Large) 위젯 크기에서만 제대로 보여요. Small/Medium에서는 안내 문구만 표시됩니다.
// 설치 방법은 이 폴더의 README.md를 참고하세요 (today-schedule-widget.js와 동일한 로그인 절차).

const FIREBASE_API_KEY = "AIzaSyBHP0n5-aVRvTbcdZOVwfz8Q9mYsiMtpi0";
const FIREBASE_PROJECT_ID = "personal-assistant-ec8b5";
const DASHBOARD_URL = "https://personal-assistant-dashboard-five.vercel.app";

const KEYCHAIN_EMAIL_KEY = "assistantDashboard.email";
const KEYCHAIN_PASSWORD_KEY = "assistantDashboard.password";

const BG_COLOR = "#15171c";
const ACCENT_COLOR = "#7c9cff";
const TEXT_COLOR = "#ffffff";
const FAINT_TEXT_COLOR = "#4b5160";
const MUTED_TEXT_COLOR = "#9aa0ab";
const SUNDAY_COLOR = "#ff6b6b";
const SATURDAY_COLOR = "#7c9cff";

const CELL_W = 38;
const CELL_H = 28;
const COL_GAP = 2;
const ROW_GAP = 1;

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
  alert.message = "personal-assistant-dashboard 로그인에 쓰는 이메일/비밀번호를 입력하세요.\n이 기기의 키체인에만 안전하게 저장돼요. (today-schedule-widget.js와 로그인 정보를 공유해요)";
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

// ---------- Schedule logic (ported from scripts/store.js) ----------
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

function countOccurrences(schedules, dateStr) {
  return schedules.filter((item) => matchesDate(item, dateStr)).length;
}

function buildMonthGrid(year, month) {
  const firstOfMonth = new Date(year, month, 1);
  const start = new Date(year, month, 1 - firstOfMonth.getDay());
  const days = [];
  for (let i = 0; i < 42; i++) {
    days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }
  return days;
}

// ---------- Widget rendering ----------
function buildMessageWidget(title, message) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color(BG_COLOR);
  const t = widget.addText(title);
  t.textColor = Color.white();
  t.font = Font.boldSystemFont(13);
  widget.addSpacer(6);
  const m = widget.addText(message);
  m.textColor = new Color(MUTED_TEXT_COLOR);
  m.font = Font.systemFont(11);
  return widget;
}

function addCell(row, { label, textColor, dotColor, highlight }) {
  const cell = row.addStack();
  cell.layoutVertically();
  cell.centerAlignContent();
  cell.size = new Size(CELL_W, CELL_H);
  if (highlight) {
    cell.backgroundColor = new Color(ACCENT_COLOR);
    cell.cornerRadius = 6;
  }

  const labelText = cell.addText(label);
  labelText.font = Font.systemFont(11);
  labelText.textColor = highlight ? Color.white() : new Color(textColor);
  labelText.centerAlignText();

  cell.addSpacer(2);

  const dot = cell.addText("●");
  dot.font = Font.systemFont(6);
  dot.textColor = dotColor ? (highlight ? Color.white() : new Color(dotColor)) : new Color(BG_COLOR, 0);
  dot.centerAlignText();
}

function addRow(widget) {
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  return row;
}

async function buildCalendarWidget() {
  if (config.widgetFamily && config.widgetFamily !== "large") {
    return buildMessageWidget("📅 큰 위젯으로 추가해주세요", "홈 화면에서 이 위젯을 Large 크기로 추가하면 한 달 캘린더가 보여요.");
  }

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
  try {
    schedules = JSON.parse(data["assistant.schedules.v1"] || "[]");
  } catch {}

  const today = new Date();
  const todayStr = toDateStr(today);
  const year = today.getFullYear();
  const month = today.getMonth();

  const widget = new ListWidget();
  widget.backgroundColor = new Color(BG_COLOR);
  widget.url = DASHBOARD_URL;

  const header = widget.addText(`${year}년 ${month + 1}월`);
  header.textColor = Color.white();
  header.font = Font.boldSystemFont(15);
  widget.addSpacer(8);

  const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];
  const weekdayRow = addRow(widget);
  weekdayLabels.forEach((label, i) => {
    if (i > 0) weekdayRow.addSpacer(COL_GAP);
    const color = i === 0 ? SUNDAY_COLOR : i === 6 ? SATURDAY_COLOR : MUTED_TEXT_COLOR;
    addCell(weekdayRow, { label, textColor: color, dotColor: null, highlight: false });
  });
  widget.addSpacer(4);

  const days = buildMonthGrid(year, month);
  let monthTotal = 0;
  for (let week = 0; week < 6; week++) {
    const weekRow = addRow(widget);
    for (let i = 0; i < 7; i++) {
      const d = days[week * 7 + i];
      const dStr = toDateStr(d);
      const isCurrentMonth = d.getMonth() === month;
      const isToday = dStr === todayStr;
      const count = countOccurrences(schedules, dStr);
      if (isCurrentMonth) monthTotal += count;

      if (i > 0) weekRow.addSpacer(COL_GAP);
      const weekday = d.getDay();
      const baseColor = !isCurrentMonth
        ? FAINT_TEXT_COLOR
        : weekday === 0
        ? SUNDAY_COLOR
        : weekday === 6
        ? SATURDAY_COLOR
        : TEXT_COLOR;
      addCell(weekRow, {
        label: String(d.getDate()),
        textColor: baseColor,
        dotColor: count > 0 ? ACCENT_COLOR : null,
        highlight: isToday,
      });
    }
    widget.addSpacer(ROW_GAP);
  }

  widget.addSpacer(4);
  const footer = widget.addText(`이번 달 일정 ${monthTotal}개`);
  footer.textColor = new Color(MUTED_TEXT_COLOR);
  footer.font = Font.systemFont(10);

  return widget;
}

// ---------- Entry point ----------
await maybeResetCredentials();
const widget = await buildCalendarWidget();

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentLarge();
}
Script.complete();
