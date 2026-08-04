// Pure schedule-recurrence matching logic, shared between the browser
// client (scripts/store.js's ScheduleStore) and the Vercel serverless
// function that sends the daily notification (api/send-daily-notifications.js)
// — previously hand-duplicated between the two, which meant a repeat-rule
// bug fixed on one side would never automatically apply to the other.
//
// UMD-style export since there's no bundler here: scripts/*.js are plain
// browser <script> tags (no require/module.exports), while api/*.js runs
// as Node/CommonJS (no window) — this file works unmodified in both.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ScheduleRecurrence = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  // Deliberately NOT `new Date(s)` — passing a bare "YYYY-MM-DD" string to
  // the Date constructor parses it as UTC midnight, which then renders as
  // the *previous* day in any timezone behind UTC (most of the US, for
  // instance). The (year, monthIndex, day) constructor form used here
  // builds the date in the local timezone instead, matching how every
  // "YYYY-MM-DD" string in this app is produced (toDateStr-style: from
  // getFullYear/getMonth/getDate, never toISOString). Every parseDateStr /
  // toDateStr pair across scripts/*.js (schedule.js, practice.js,
  // vongole.js, routine.js, ledger.js) follows this same local-time-only
  // convention — duplicated per file rather than centralized here, since
  // this is the one module of the bunch also loaded server-side by
  // api/send-daily-notifications.js, and the others are small enough that
  // sharing them isn't worth the extra indirection.
  function parseDateStr(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  // Day 0 of the FOLLOWING month is the last day of `monthIndex` — a cheap
  // way to get a month's actual length (28-31) without a lookup table.
  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  // A schedule item is a "series": one anchor date + an optional repeat
  // rule. Occurrences are derived on demand instead of being stored
  // individually, so editing/deleting a series affects every occurrence
  // at once.
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
      case "monthly": {
        // An anchor day that doesn't exist in the target month (e.g. the
        // 31st, anchored against Feb/Apr/Jun/Sep/Nov) used to just never
        // match that month at all — silently skipped, with no occurrence
        // and no indication anything was skipped. Rolls to that month's
        // last day instead, matching how Google Calendar/Outlook handle
        // the same "일" 31, 30, 30, 31 gap.
        const anchorDate = parseDateStr(item.date).getDate();
        const target = parseDateStr(dateStr);
        const effectiveAnchorDate = Math.min(anchorDate, daysInMonth(target.getFullYear(), target.getMonth()));
        return target.getDate() === effectiveAnchorDate;
      }
      case "yearly": {
        const anchor = parseDateStr(item.date);
        const target = parseDateStr(dateStr);
        // A Feb 29 anchor only exists once every 4 years — roll it to Feb
        // 28 in a non-leap target year instead of silently never firing
        // that year (same reasoning as monthly's day-doesn't-exist case).
        if (anchor.getMonth() === 1 && anchor.getDate() === 29) {
          const effectiveDate = daysInMonth(target.getFullYear(), 1) === 29 ? 29 : 28;
          return target.getMonth() === 1 && target.getDate() === effectiveDate;
        }
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

  return { matchesDate, getOccurrences, parseDateStr, pad2 };
});
