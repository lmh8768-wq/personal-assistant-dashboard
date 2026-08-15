"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { installFakeFirestoreAdmin, makeRes } = require("./helpers/mock-firestore");

process.env.FIREBASE_SERVICE_ACCOUNT = "{}";
process.env.KAKAO_WEBHOOK_SECRET = "test-webhook-secret";

// Same one-install-per-file reasoning as tests/api-subscriptions.test.js —
// api/*.js each bind their own `const admin = require("firebase-admin")`
// reference at first require, so the fake has to be in place before that
// first require happens.
const mock = installFakeFirestoreAdmin();

const kakaoLinkCode = require("../api/kakao-link-code.js");
const kakaoLinkStatus = require("../api/kakao-link-status.js");
const kakaoUnlink = require("../api/kakao-unlink.js");
const kakaoWebhook = require("../api/kakao-webhook.js");

function webhookReq(utterance, kakaoUserId, secret = "test-webhook-secret") {
  return {
    method: "POST",
    query: { secret },
    body: { userRequest: { utterance, user: { id: kakaoUserId } } },
  };
}

function replyText(res) {
  return res.body?.template?.outputs?.[0]?.simpleText?.text;
}

// ---------- kakao-link-code ----------

test("kakao-link-code: issues a 6-digit code for a valid idToken", async () => {
  const res = makeRes();
  await kakaoLinkCode({ method: "POST", body: { idToken: "x" } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.code, /^\d{6}$/);
  assert.equal(mock.read("kakaoLinkCodes", res.body.code).uid, "test-uid");
});

test("kakao-link-code: missing idToken is a 400", async () => {
  const res = makeRes();
  await kakaoLinkCode({ method: "POST", body: {} }, res);
  assert.equal(res.statusCode, 400);
});

test("kakao-link-code: invalid idToken is a 401", async () => {
  mock.setVerifyIdTokenImpl(async () => {
    throw new Error("bad token");
  });
  try {
    const res = makeRes();
    await kakaoLinkCode({ method: "POST", body: { idToken: "bad" } }, res);
    assert.equal(res.statusCode, 401);
  } finally {
    mock.setVerifyIdTokenImpl(async () => ({ uid: "test-uid" }));
  }
});

test("kakao-link-code: non-POST is a 405", async () => {
  const res = makeRes();
  await kakaoLinkCode({ method: "GET", body: {} }, res);
  assert.equal(res.statusCode, 405);
});

// ---------- kakao-link-status / kakao-unlink ----------

test("kakao-link-status: reports not linked when no link doc exists", async () => {
  const res = makeRes();
  await kakaoLinkStatus({ method: "POST", body: { idToken: "x" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.linked, false);
});

test("kakao-link-status: reports linked once a link doc exists", async () => {
  mock.seed("kakaoLinks", "test-uid", { kakaoUserId: "kakao-1", linkedAt: 1000 });
  const res = makeRes();
  await kakaoLinkStatus({ method: "POST", body: { idToken: "x" } }, res);
  assert.equal(res.body.linked, true);
  assert.equal(res.body.linkedAt, 1000);
});

test("kakao-unlink: removes both directions of the link", async () => {
  mock.seed("kakaoLinks", "test-uid", { kakaoUserId: "kakao-1", linkedAt: 1000 });
  mock.seed("kakaoUserLinks", "kakao-1", { uid: "test-uid", linkedAt: 1000 });
  const res = makeRes();
  await kakaoUnlink({ method: "POST", body: { idToken: "x" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(mock.read("kakaoLinks", "test-uid"), undefined);
  assert.equal(mock.read("kakaoUserLinks", "kakao-1"), undefined);
});

test("kakao-unlink: unlinking an already-unlinked account is still a 200, not an error", async () => {
  const res = makeRes();
  await kakaoUnlink({ method: "POST", body: { idToken: "x" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

// ---------- kakao-webhook ----------

test("kakao-webhook: wrong/missing secret is rejected with 401", async () => {
  const res = makeRes();
  await kakaoWebhook(webhookReq("날씨", "kakao-x", "wrong-secret"), res);
  assert.equal(res.statusCode, 401);
});

test("kakao-webhook: an unlinked user gets prompted to link, not a broken response", async () => {
  const res = makeRes();
  await kakaoWebhook(webhookReq("날씨", "kakao-unlinked"), res);
  assert.equal(res.statusCode, 200);
  assert.match(replyText(res), /연동/);
});

test("kakao-webhook: linking with a valid code creates both directions and lets the next message through", async () => {
  mock.seed("kakaoLinkCodes", "654321", { uid: "linked-uid", expiresAt: Date.now() + 60000 });
  const res = makeRes();
  await kakaoWebhook(webhookReq("연동 654321", "kakao-new"), res);
  assert.equal(res.statusCode, 200);
  assert.match(replyText(res), /연동됐어요/);
  assert.equal(mock.read("kakaoUserLinks", "kakao-new").uid, "linked-uid");
  assert.equal(mock.read("kakaoLinks", "linked-uid").kakaoUserId, "kakao-new");
  assert.equal(mock.read("kakaoLinkCodes", "654321"), undefined);
});

test("kakao-webhook: an expired code is rejected and does not link", async () => {
  mock.seed("kakaoLinkCodes", "111111", { uid: "some-uid", expiresAt: Date.now() - 1000 });
  const res = makeRes();
  await kakaoWebhook(webhookReq("연동 111111", "kakao-expired"), res);
  assert.match(replyText(res), /만료/);
  assert.equal(mock.read("kakaoUserLinks", "kakao-expired"), undefined);
});

test("kakao-webhook: linked user asking 날씨 gets a formatted reply using the mocked forecast", async (t) => {
  mock.seed("kakaoUserLinks", "kakao-weather", { uid: "weather-uid", linkedAt: 1 });
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      current: { temperature_2m: 21.4, weather_code: 1 },
      daily: { temperature_2m_max: [25], temperature_2m_min: [15] },
      hourly: { time: [], precipitation_probability: [], rain: [], snowfall: [] },
    }),
  });
  const res = makeRes();
  await kakaoWebhook(webhookReq("오늘 날씨 어때", "kakao-weather"), res);
  assert.match(replyText(res), /21°/);
  assert.match(replyText(res), /최고 25°/);
});

test("kakao-webhook: linked user asking 오늘 일정 lists today's occurrences", async () => {
  mock.seed("kakaoUserLinks", "kakao-sched", { uid: "sched-uid", linkedAt: 1 });
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  mock.seed("users", "sched-uid", {
    payload: JSON.stringify({
      "assistant.schedules.v1": JSON.stringify([
        { id: "sc_1", title: "치과", date: today, repeat: { type: "none" }, completedDates: [] },
      ]),
    }),
  });
  const res = makeRes();
  await kakaoWebhook(webhookReq("오늘 일정", "kakao-sched"), res);
  assert.match(replyText(res), /치과/);
});

test("kakao-webhook: 지출 command resolves the category by label and appends a new ledger entry without losing existing ones", async () => {
  mock.seed("kakaoUserLinks", "kakao-ledger", { uid: "ledger-uid", linkedAt: 1 });
  mock.seed("users", "ledger-uid", {
    payload: JSON.stringify({
      "assistant.ledgerEntries.v1": JSON.stringify([
        { id: "exp_old", date: "2020-01-01", amount: 1, categoryKey: "etc", memo: "", type: "expense" },
      ]),
      "assistant.ledgerCategories.v1": JSON.stringify([
        { key: "food", label: "식비", color: "#f97316", budget: 0, type: "expense" },
      ]),
    }),
  });
  const res = makeRes();
  await kakaoWebhook(webhookReq("지출 12000 식비 점심값", "kakao-ledger"), res);
  assert.match(replyText(res), /12,000원/);
  assert.match(replyText(res), /식비/);
  assert.match(replyText(res), /점심값/);

  const payload = JSON.parse(mock.read("users", "ledger-uid").payload);
  const entries = JSON.parse(payload["assistant.ledgerEntries.v1"]);
  assert.equal(entries.length, 2); // old entry preserved, not overwritten
  const newEntry = entries[1];
  assert.equal(newEntry.amount, 12000);
  assert.equal(newEntry.categoryKey, "food");
  assert.equal(newEntry.memo, "점심값");
  assert.equal(newEntry.type, "expense");
});

test("kakao-webhook: 지출 with an unmatched category token folds it back into the memo instead of dropping it", async () => {
  mock.seed("kakaoUserLinks", "kakao-ledger2", { uid: "ledger-uid-2", linkedAt: 1 });
  const res = makeRes();
  await kakaoWebhook(webhookReq("지출 5000 붕어빵두개", "kakao-ledger2"), res);
  const payload = JSON.parse(mock.read("users", "ledger-uid-2").payload);
  const entries = JSON.parse(payload["assistant.ledgerEntries.v1"]);
  assert.equal(entries[0].memo, "붕어빵두개");
  assert.equal(entries[0].categoryKey, "food"); // falls back to the first expense default
});

test("kakao-webhook: 일정추가 writes a schedule item shaped like the app's own ScheduleStore.add", async () => {
  mock.seed("kakaoUserLinks", "kakao-add-sched", { uid: "add-sched-uid", linkedAt: 1 });
  const res = makeRes();
  await kakaoWebhook(webhookReq("일정추가 8/20 치과 예약", "kakao-add-sched"), res);
  assert.match(replyText(res), /치과 예약/);
  const payload = JSON.parse(mock.read("users", "add-sched-uid").payload);
  const schedules = JSON.parse(payload["assistant.schedules.v1"]);
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].title, "치과 예약");
  assert.equal(schedules[0].date, `${new Date().getFullYear()}-08-20`);
  assert.equal(schedules[0].repeat.type, "none");
});

test("kakao-webhook: 베이스연습 writes a practice record for today", async () => {
  mock.seed("kakaoUserLinks", "kakao-practice", { uid: "practice-uid", linkedAt: 1 });
  const res = makeRes();
  await kakaoWebhook(webhookReq("베이스연습 스케일 30분", "kakao-practice"), res);
  assert.match(replyText(res), /저장했어요/);
  const payload = JSON.parse(mock.read("users", "practice-uid").payload);
  const records = JSON.parse(payload["assistant.practice.v1"]);
  assert.equal(records[0].text, "스케일 30분");
});

test("kakao-webhook: 운동 logs a body part once, then refuses a same-day duplicate", async () => {
  mock.seed("kakaoUserLinks", "kakao-exercise", { uid: "exercise-uid", linkedAt: 1 });
  const first = makeRes();
  await kakaoWebhook(webhookReq("운동 가슴", "kakao-exercise"), first);
  assert.match(replyText(first), /기록했어요/);

  const second = makeRes();
  await kakaoWebhook(webhookReq("운동 가슴", "kakao-exercise"), second);
  assert.match(replyText(second), /이미 기록했어요/);

  const payload = JSON.parse(mock.read("users", "exercise-uid").payload);
  const logs = JSON.parse(payload["assistant.exerciseLog.v1"]);
  assert.equal(logs.length, 1); // the duplicate never got appended
});

test("kakao-webhook: an unrecognized message replies with the command help, not an error", async () => {
  mock.seed("kakaoUserLinks", "kakao-unknown", { uid: "unknown-uid", linkedAt: 1 });
  const res = makeRes();
  await kakaoWebhook(webhookReq("ㅋㅋㅋ", "kakao-unknown"), res);
  assert.equal(res.statusCode, 200);
  assert.match(replyText(res), /이렇게 말해보세요/);
});
