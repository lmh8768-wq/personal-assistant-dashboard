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

  function parseDateStr(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
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

  return { matchesDate, getOccurrences, parseDateStr, pad2 };
});
