"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadStoreModule } = require("./helpers/load-store");

test("2026 holidays match the previously-confirmed hardcoded dates (regression check)", () => {
  const { KoreanHolidays } = loadStoreModule();

  assert.equal(KoreanHolidays["2026-01-01"], "신정");
  assert.equal(KoreanHolidays["2026-03-01"], "삼일절");
  assert.equal(KoreanHolidays["2026-03-02"], "대체공휴일"); // 3/1 falls on a Sunday in 2026
  assert.equal(KoreanHolidays["2026-05-05"], "어린이날");
  assert.equal(KoreanHolidays["2026-06-06"], "현충일");
  assert.equal(KoreanHolidays["2026-08-15"], "광복절");
  assert.equal(KoreanHolidays["2026-08-17"], "대체공휴일"); // 8/15 falls on a Saturday in 2026
  assert.equal(KoreanHolidays["2026-10-03"], "개천절");
  assert.equal(KoreanHolidays["2026-10-05"], "대체공휴일"); // 10/3 falls on a Saturday in 2026
  assert.equal(KoreanHolidays["2026-10-09"], "한글날"); // falls on a Friday — no substitute expected
  assert.equal(KoreanHolidays["2026-10-10"], undefined);
  assert.equal(KoreanHolidays["2026-12-25"], "크리스마스");
});

test("fixed-date holidays are still generated for years with no lunar-holiday entry", () => {
  const { KoreanHolidays } = loadStoreModule();

  assert.equal(KoreanHolidays["2030-01-01"], "신정");
  assert.equal(KoreanHolidays["2030-08-15"], "광복절");
  // no lunar entry exists for 2030 — 설날/추석 simply shouldn't appear, not throw
  assert.equal(KoreanHolidays["2030-02-01"], undefined);
});

test("holidays that never get a substitute day don't get one even when landing on a weekend", () => {
  const { KoreanHolidays } = loadStoreModule();

  // 2027-01-01 (신정) is a Friday, not a weekend — pick a year where a
  // no-substitute holiday actually falls on a weekend to prove the rule,
  // rather than the rule just never being exercised.
  // 2028-01-01 is a Saturday.
  assert.equal(KoreanHolidays["2028-01-01"], "신정");
  assert.equal(KoreanHolidays["2028-01-03"], undefined); // no 대체공휴일 for 신정
});
