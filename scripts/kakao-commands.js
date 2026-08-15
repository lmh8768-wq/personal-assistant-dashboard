// Pure command parsing + reply formatting for the KakaoTalk chatbot
// (api/kakao-webhook.js). Deliberately has NO Firestore/network access of
// its own and never needs the user's actual category/body-part lists —
// this only turns raw utterance text into a structured intent (or a
// structured parse error), and turns structured results back into Korean
// reply text. Everything that needs live per-user data (which ledger
// category "식비" resolves to, whether a body part label exists) stays in
// api/kakao-webhook.js, which is what makes this file cheaply unit-testable
// without a fake Firestore.
//
// Node-only (CommonJS) — unlike scripts/schedule-recurrence.js and
// scripts/weather-calc.js, nothing in the browser app needs this, so it's
// not loaded via a <script> tag in index.html and doesn't need the UMD
// dual-export wrapper those two use.
"use strict";

const { parseDateStr, pad2 } = require("./schedule-recurrence.js");

const MAX_LEDGER_AMOUNT = 999999999999; // matches store.js's LedgerEntryStore clamp

// "12000", "12,000", "12000원", "1만2천", "1만2천원", "1.5만", "5천" all
// resolve to a plain won amount — typing a bare number is the common case,
// but "만/천" shorthand is how amounts actually get typed in casual KakaoTalk
// chat, and rejecting it would make the expense/income commands annoying
// enough that nobody would actually use them from a phone keyboard.
function parseAmount(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/,/g, "").replace(/원/g, "").trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    return Math.min(Math.round(Number(s)), MAX_LEDGER_AMOUNT);
  }
  const segRe = /(\d+(?:\.\d+)?)(만|천)/g;
  let total = 0;
  let matchedAny = false;
  let lastIndex = 0;
  let m;
  while ((m = segRe.exec(s)) !== null) {
    matchedAny = true;
    total += Number(m[1]) * (m[2] === "만" ? 10000 : 1000);
    lastIndex = segRe.lastIndex;
  }
  if (!matchedAny) return null;
  const trailingDigits = s.slice(lastIndex).replace(/[^\d]/g, "");
  if (trailingDigits) total += Number(trailingDigits);
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.min(Math.round(total), MAX_LEDGER_AMOUNT);
}

// "오늘"/"내일"/… , "8/20", "8-20", "8.20", "8월20일", "2026-08-20" — anything
// else (including plain words that are actually the start of a title, e.g.
// "치과" in "일정추가 치과 예약") returns null so the caller knows to treat
// the WHOLE remainder as the title with today's date, not eat a real word.
function parseDateToken(token, todayStr) {
  const RELATIVE_OFFSETS = { 오늘: 0, 내일: 1, 모레: 2, 글피: 3, 어제: -1, 그제: -2 };
  if (token in RELATIVE_OFFSETS) {
    const d = parseDateStr(todayStr);
    d.setDate(d.getDate() + RELATIVE_OFFSETS[token]);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  const year = Number(todayStr.slice(0, 4));

  let m = token.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`;

  m = token.match(/^(\d{1,2})월(\d{1,2})일?$/);
  if (m) return `${year}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}`;

  m = token.match(/^(\d{1,2})[/.\-](\d{1,2})$/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  return null;
}

function todayStrIn(tz) {
  // The webhook always passes a KST "today" (see api/kakao-webhook.js) —
  // this fallback only exists so this module never crashes if a caller
  // forgets to pass one, defaulting to the server's own clock/UTC.
  const d = tz ? new Date(tz) : new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Generic fuzzy match used for both ledger categories ({key,label}) and
// exercise body parts ({key,label}) — exact label match first, then
// substring either direction (so "식비" matches a stored "식비/외식" label,
// and a stored "식비" matches typing "식비 지출" as one token). Returns null
// (not a fallback) when nothing plausible matches — the caller decides what
// "no match" means for its own command (fall back to a default category vs.
// reject the exercise log outright).
function matchLabel(list, token) {
  if (!token || !Array.isArray(list) || list.length === 0) return null;
  const needle = token.trim().toLowerCase();
  if (!needle) return null;
  const exact = list.find((item) => item.label.toLowerCase() === needle);
  if (exact) return exact;
  const contains = list.find(
    (item) => item.label.toLowerCase().includes(needle) || needle.includes(item.label.toLowerCase())
  );
  return contains || null;
}

function stripPrefix(utterance, prefixes) {
  for (const prefix of prefixes) {
    if (utterance.startsWith(prefix)) return utterance.slice(prefix.length).trim();
  }
  return null;
}

// The single entry point: turns raw utterance text into a structured
// intent. `todayStr` (YYYY-MM-DD, KST) drives both the schedule-add default
// date and the relative-date words above.
function parseCommand(utterance, todayStr) {
  const text = (utterance || "").trim();
  const today = todayStr || todayStrIn();
  if (!text) return { type: "unknown" };

  const linkRest = stripPrefix(text, ["연동"]);
  if (linkRest !== null) {
    const code = linkRest.replace(/[^\d]/g, "");
    if (!code) return { type: "link", error: "missing-code" };
    return { type: "link", code };
  }

  if (text.includes("날씨")) return { type: "weather" };

  const addScheduleRest = stripPrefix(text, ["일정추가", "일정 추가"]);
  if (addScheduleRest !== null) {
    if (!addScheduleRest) return { type: "add-schedule", error: "missing-title" };
    const tokens = addScheduleRest.split(/\s+/);
    const dateGuess = parseDateToken(tokens[0], today);
    const date = dateGuess || today;
    const title = (dateGuess ? tokens.slice(1) : tokens).join(" ").trim();
    if (!title) return { type: "add-schedule", error: "missing-title" };
    return { type: "add-schedule", date, title };
  }

  // Checked AFTER "일정추가" (which also contains "일정") so adding a
  // schedule never falls through to being read back as a schedule query.
  if (text.includes("일정") || text.includes("할일") || text.includes("할 일")) {
    return { type: "today-schedule" };
  }

  const expenseRest = stripPrefix(text, ["지출"]);
  if (expenseRest !== null) return parseLedgerCommand("expense", expenseRest);

  const incomeRest = stripPrefix(text, ["수입"]);
  if (incomeRest !== null) return parseLedgerCommand("income", incomeRest);

  const practiceRest = stripPrefix(text, ["베이스연습", "베이스 연습", "연습"]);
  if (practiceRest !== null) {
    if (!practiceRest) return { type: "practice", error: "missing-text" };
    return { type: "practice", text: practiceRest };
  }

  const exerciseRest = stripPrefix(text, ["운동"]);
  if (exerciseRest !== null) {
    if (!exerciseRest) return { type: "exercise", error: "missing-body-part" };
    return { type: "exercise", bodyPartToken: exerciseRest.split(/\s+/)[0] };
  }

  if (text.includes("도움말") || text.toLowerCase() === "help" || text.includes("명령어")) {
    return { type: "help" };
  }

  return { type: "unknown" };
}

function parseLedgerCommand(kind, rest) {
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { type: kind, error: "missing-amount" };
  const amount = parseAmount(tokens[0]);
  if (amount === null) return { type: kind, error: "invalid-amount", raw: tokens[0] };
  return { type: kind, amount, restTokens: tokens.slice(1) };
}

// ---------- Reply formatting ----------
// Every reply is plain text for Kakao's simpleText output — kept short
// (KakaoTalk truncates very long bubbles) and consistent with this app's
// own voice (see toast.js's messages) rather than terse API-error text.

function formatWeatherReply(weather, WeatherCalc) {
  const [emoji, label] = WeatherCalc.describeCode(weather.code);
  const lines = [`${emoji} 서울 날씨: ${label}, ${weather.temp}°`, `최고 ${weather.max}° · 최저 ${weather.min}°`];
  if (weather.alerts && weather.alerts.length > 0) {
    lines.push("", "⚠️ 유의사항", ...weather.alerts.map((a) => `${a.icon} ${a.text}`));
  }
  return lines.join("\n");
}

function formatTodayScheduleReply(items, todayLabel) {
  if (!items || items.length === 0) return `오늘(${todayLabel}) 등록된 일정이 없어요`;
  const lines = [
    `오늘(${todayLabel})의 일정`,
    ...items.map((item) => `${item.completedDates?.includes(item.occurrenceDate) ? "✓" : "•"} ${item.title}`),
  ];
  return lines.join("\n");
}

function formatHelpReply() {
  return [
    "이렇게 말해보세요",
    "· 날씨 — 오늘 날씨와 유의사항",
    "· 오늘 일정 — 오늘의 일정 목록",
    "· 지출 12000 식비 점심값 — 지출 기록",
    "· 수입 50000 용돈 — 수입 기록",
    "· 일정추가 8/20 치과 예약 — 일정 추가 (날짜 생략 시 오늘)",
    "· 베이스연습 스케일 30분 — 연습 기록",
    "· 운동 가슴 — 운동 기록",
    "· 연동 123456 — 앱 설정에서 받은 연동 코드 등록",
  ].join("\n");
}

function formatNotLinkedReply() {
  return "아직 연동이 안 되어 있어요. 앱 설정 > 카카오톡 연동에서 연동 코드를 받은 뒤 '연동 123456'처럼 보내주세요.";
}

function formatLinkSuccessReply() {
  return "연동됐어요! 이제 '날씨', '오늘 일정', '지출 12000 식비'처럼 채팅으로 물어보거나 기록할 수 있어요.";
}

function formatLinkFailureReply(reason) {
  if (reason === "missing-code") return "연동 코드를 함께 보내주세요. 예: 연동 123456";
  if (reason === "expired") return "연동 코드가 만료됐어요. 앱 설정에서 코드를 다시 받아주세요.";
  return "연동 코드를 찾을 수 없어요. 앱 설정에서 코드를 다시 확인해주세요.";
}

function formatExpenseConfirmReply(kind, entry, categoryLabel) {
  const verb = kind === "income" ? "수입" : "지출";
  const memoPart = entry.memo ? ` (${entry.memo})` : "";
  return `${verb} ${entry.amount.toLocaleString("ko-KR")}원 [${categoryLabel}]${memoPart} 기록했어요`;
}

function formatScheduleAddConfirmReply(item, dateLabel) {
  return `${dateLabel} "${item.title}" 일정을 추가했어요`;
}

function formatPracticeConfirmReply(dateLabel) {
  return `${dateLabel} 베이스 연습 기록을 저장했어요`;
}

function formatExerciseConfirmReply(dateLabel, bodyPartLabel) {
  return `${dateLabel} ${bodyPartLabel} 운동을 기록했어요`;
}

function formatAlreadyLoggedExerciseReply(dateLabel, bodyPartLabel) {
  return `${dateLabel} ${bodyPartLabel}은(는) 이미 기록했어요`;
}

function formatErrorReply(kind, error) {
  if (kind === "add-schedule" && error === "missing-title")
    return "일정 제목을 함께 보내주세요. 예: 일정추가 8/20 치과 예약";
  if ((kind === "expense" || kind === "income") && error === "missing-amount") {
    return `금액을 함께 보내주세요. 예: ${kind === "income" ? "수입" : "지출"} 12000 식비`;
  }
  if ((kind === "expense" || kind === "income") && error === "invalid-amount")
    return "금액을 알아듣지 못했어요. 숫자로 다시 보내주세요.";
  if (kind === "practice" && error === "missing-text") return "연습 내용을 함께 보내주세요. 예: 베이스연습 스케일 30분";
  if (kind === "exercise" && error === "missing-body-part") return "운동 부위를 함께 보내주세요. 예: 운동 가슴";
  if (kind === "exercise" && error === "no-body-part-match")
    return "등록된 운동 부위 중에 맞는 게 없어요. 앱에서 부위를 먼저 추가해주세요.";
  return formatHelpReply();
}

module.exports = {
  parseAmount,
  parseDateToken,
  matchLabel,
  parseCommand,
  todayStrIn,
  formatWeatherReply,
  formatTodayScheduleReply,
  formatHelpReply,
  formatNotLinkedReply,
  formatLinkSuccessReply,
  formatLinkFailureReply,
  formatExpenseConfirmReply,
  formatScheduleAddConfirmReply,
  formatPracticeConfirmReply,
  formatExerciseConfirmReply,
  formatAlreadyLoggedExerciseReply,
  formatErrorReply,
};
