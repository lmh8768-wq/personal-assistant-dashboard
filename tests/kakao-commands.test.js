"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseAmount,
  parseDateToken,
  matchLabel,
  parseCommand,
  formatTodayScheduleReply,
} = require("../scripts/kakao-commands.js");

test("parseAmount: plain digits and comma-separated forms", () => {
  assert.equal(parseAmount("12000"), 12000);
  assert.equal(parseAmount("12,000"), 12000);
  assert.equal(parseAmount("12000원"), 12000);
});

test("parseAmount: 만/천 shorthand", () => {
  assert.equal(parseAmount("1만"), 10000);
  assert.equal(parseAmount("5천"), 5000);
  assert.equal(parseAmount("1만2천"), 12000);
  assert.equal(parseAmount("1.5만"), 15000);
  assert.equal(parseAmount("1만2천원"), 12000);
});

test("parseAmount: garbage input returns null instead of NaN/0", () => {
  assert.equal(parseAmount("점심값"), null);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount("0"), 0); // caller rejects non-positive, not this function
});

test("parseAmount: clamps to the same MAX_LEDGER_AMOUNT store.js enforces", () => {
  assert.equal(parseAmount("9999999999999999"), 999999999999);
});

test("parseDateToken: relative-date words resolve against the given today", () => {
  assert.equal(parseDateToken("오늘", "2026-08-15"), "2026-08-15");
  assert.equal(parseDateToken("내일", "2026-08-15"), "2026-08-16");
  assert.equal(parseDateToken("모레", "2026-08-15"), "2026-08-17");
  assert.equal(parseDateToken("어제", "2026-08-15"), "2026-08-14");
  // Crosses a month boundary correctly (not a naive string increment).
  assert.equal(parseDateToken("내일", "2026-08-31"), "2026-09-01");
});

test("parseDateToken: M/D, M.D, M월D일, and full ISO forms", () => {
  assert.equal(parseDateToken("8/20", "2026-08-15"), "2026-08-20");
  assert.equal(parseDateToken("8.20", "2026-08-15"), "2026-08-20");
  assert.equal(parseDateToken("8월20일", "2026-08-15"), "2026-08-20");
  assert.equal(parseDateToken("2026-08-20", "2026-08-15"), "2026-08-20");
});

test("parseDateToken: an ordinary word (start of a title) is not mistaken for a date", () => {
  assert.equal(parseDateToken("치과", "2026-08-15"), null);
});

test("matchLabel: exact match wins over substring", () => {
  const list = [
    { key: "food", label: "식비" },
    { key: "fx", label: "식비/외식" },
  ];
  assert.equal(matchLabel(list, "식비").key, "food");
});

test("matchLabel: substring match either direction", () => {
  const list = [{ key: "chest", label: "가슴" }];
  assert.equal(matchLabel(list, "가슴운동").key, "chest");
});

test("matchLabel: no plausible match returns null, not a wrong guess", () => {
  const list = [{ key: "chest", label: "가슴" }];
  assert.equal(matchLabel(list, "하체"), null);
});

test("parseCommand: 날씨 intent matches by substring so natural phrasing works", () => {
  assert.equal(parseCommand("오늘 날씨 어때", "2026-08-15").type, "weather");
  assert.equal(parseCommand("날씨", "2026-08-15").type, "weather");
});

test("parseCommand: 오늘 일정 / 일정 alone is a read, not confused with 일정추가", () => {
  assert.equal(parseCommand("오늘의 일정", "2026-08-15").type, "today-schedule");
  assert.equal(parseCommand("오늘 일정 알려줘", "2026-08-15").type, "today-schedule");
  const add = parseCommand("일정추가 8/20 치과 예약", "2026-08-15");
  assert.equal(add.type, "add-schedule");
  assert.equal(add.date, "2026-08-20");
  assert.equal(add.title, "치과 예약");
});

test("parseCommand: 일정추가 with no date token defaults to today and keeps the whole title", () => {
  const add = parseCommand("일정추가 치과 예약", "2026-08-15");
  assert.equal(add.date, "2026-08-15");
  assert.equal(add.title, "치과 예약");
});

test("parseCommand: 일정추가 with a relative-date word", () => {
  const add = parseCommand("일정추가 내일 스터디 모임", "2026-08-15");
  assert.equal(add.date, "2026-08-16");
  assert.equal(add.title, "스터디 모임");
});

test("parseCommand: 일정추가 with nothing after it is a missing-title error", () => {
  assert.deepEqual(parseCommand("일정추가", "2026-08-15"), { type: "add-schedule", error: "missing-title" });
});

test("parseCommand: 지출/수입 extract amount and leave the rest as tokens for category/memo resolution", () => {
  const exp = parseCommand("지출 12000 식비 점심값", "2026-08-15");
  assert.equal(exp.type, "expense");
  assert.equal(exp.amount, 12000);
  assert.deepEqual(exp.restTokens, ["식비", "점심값"]);

  const inc = parseCommand("수입 5만 용돈", "2026-08-15");
  assert.equal(inc.type, "income");
  assert.equal(inc.amount, 50000);
  assert.deepEqual(inc.restTokens, ["용돈"]);
});

test("parseCommand: 지출 with an unparseable amount is an invalid-amount error, not silently 0", () => {
  const exp = parseCommand("지출 점심값", "2026-08-15");
  assert.equal(exp.type, "expense");
  assert.equal(exp.error, "invalid-amount");
});

test("parseCommand: 지출 with nothing after it is a missing-amount error", () => {
  assert.deepEqual(parseCommand("지출", "2026-08-15"), { type: "expense", error: "missing-amount" });
});

test("parseCommand: 베이스연습/연습 both trigger practice, keeping the free text", () => {
  assert.deepEqual(parseCommand("베이스연습 스케일 30분", "2026-08-15"), { type: "practice", text: "스케일 30분" });
  assert.deepEqual(parseCommand("연습 스케일 30분", "2026-08-15"), { type: "practice", text: "스케일 30분" });
});

test("parseCommand: 운동 extracts only the first token as the body part (rest is ignored, not folded into it)", () => {
  assert.deepEqual(parseCommand("운동 가슴", "2026-08-15"), { type: "exercise", bodyPartToken: "가슴" });
  assert.deepEqual(parseCommand("운동 가슴 오늘 힘들었다", "2026-08-15"), { type: "exercise", bodyPartToken: "가슴" });
});

test("parseCommand: 연동 extracts digits only from the code, tolerating a trailing space/typo", () => {
  assert.deepEqual(parseCommand("연동 123456", "2026-08-15"), { type: "link", code: "123456" });
  assert.deepEqual(parseCommand("연동", "2026-08-15"), { type: "link", error: "missing-code" });
});

test("parseCommand: unrecognized text falls back to unknown, not a crash", () => {
  assert.equal(parseCommand("ㅋㅋㅋㅋ", "2026-08-15").type, "unknown");
  assert.equal(parseCommand("", "2026-08-15").type, "unknown");
});

test("formatTodayScheduleReply: marks completed occurrences with ✓, others with •", () => {
  const items = [
    { title: "치과", occurrenceDate: "2026-08-15", completedDates: ["2026-08-15"] },
    { title: "스터디", occurrenceDate: "2026-08-15", completedDates: [] },
  ];
  const text = formatTodayScheduleReply(items, "8/15");
  assert.match(text, /✓ 치과/);
  assert.match(text, /• 스터디/);
});

test("parseCommand: 도움말/명령어 trigger help", () => {
  assert.equal(parseCommand("도움말", "2026-08-15").type, "help");
  assert.equal(parseCommand("명령어 알려줘", "2026-08-15").type, "help");
});
