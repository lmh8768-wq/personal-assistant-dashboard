const admin = require("firebase-admin");
const webpush = require("web-push");
const { pad2, getOccurrences } = require("../scripts/schedule-recurrence.js");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_SUBJECT_EMAIL}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

module.exports = async (req, res) => {
  // Without this check, a missing CRON_SECRET env var makes the comparison
  // below `authHeader !== "Bearer undefined"` — a fixed, guessable string
  // anyone reading this (public) source could send. Fail closed instead of
  // silently accepting a misconfigured deployment as "no secret required".
  if (!process.env.CRON_SECRET) {
    console.error("CRON_SECRET is not configured");
    res.status(500).json({ error: "server misconfigured" });
    return;
  }
  const authHeader = req.headers.authorization || "";
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // The server runs in UTC; compute "today" in KST (UTC+9) instead.
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = `${kst.getUTCFullYear()}-${pad2(kst.getUTCMonth() + 1)}-${pad2(kst.getUTCDate())}`;

  const usersSnap = await db.collection("users").get();

  // Fully sequential (one user, then one subscription, at a time) meant
  // wall-clock time grew linearly with total users × subscriptions — with
  // vercel.json now giving this function up to 60s (was the platform
  // default, as low as 10s on Hobby without an explicit maxDuration), a
  // large enough user base could still exceed it and get killed mid-run,
  // silently skipping everyone left in usersSnap.docs. Push notifications
  // are pure network I/O with no shared mutable state between
  // users/subscriptions, so running them concurrently is safe and turns
  // total time into roughly the slowest single send instead of the sum of
  // all of them.
  const perUserResults = await Promise.all(
    usersSnap.docs.map(async (userDoc) => {
      // Everything derived from this one user's stored data — including
      // getOccurrences() — is guarded here so an unexpected shape
      // (schedules parsing to something other than an array) can't throw
      // uncaught and abort the whole Promise.all, silently skipping every
      // other user.
      try {
        const payload = JSON.parse(userDoc.data().payload || "{}");
        const schedules = JSON.parse(payload["assistant.schedules.v1"] || "[]");
        const items = getOccurrences(schedules, todayStr);
        const title = "오늘의 할 일";
        const body =
          items.length === 0
            ? "오늘 등록된 일정이 없어요"
            : items
                .slice(0, 5)
                .map((item) => `• ${item.title}`)
                .join("\n") + (items.length > 5 ? `\n외 ${items.length - 5}개` : "");
        const payloadStr = JSON.stringify({ title, body, url: "/index.html#schedule" });

        const subsSnap = await userDoc.ref.collection("pushSubscriptions").get();
        const perSubResults = await Promise.all(
          subsSnap.docs.map(async (subDoc) => {
            const { subscription } = subDoc.data();
            // save-subscription.js validates this shape now, but a doc
            // saved before that validation existed can still have
            // missing/malformed keys — webpush.sendNotification throws a
            // plain validation error (no statusCode) for those, which used
            // to fall through to the generic catch below and never get
            // deleted, so it re-logged the same failure on every single
            // daily cron run forever. Catch it here instead, before ever
            // attempting a send.
            if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
              console.error("removing malformed push subscription", userDoc.id, subDoc.id);
              await subDoc.ref.delete();
              return { sent: 0, removed: 1 };
            }
            try {
              await webpush.sendNotification(subscription, payloadStr);
              return { sent: 1, removed: 0 };
            } catch (err) {
              if (err.statusCode === 404 || err.statusCode === 410) {
                // Subscription is gone (uninstalled/expired) — stop trying it.
                await subDoc.ref.delete();
                return { sent: 0, removed: 1 };
              }
              console.error("push send failed", userDoc.id, err.message);
              return { sent: 0, removed: 0 };
            }
          })
        );
        return {
          sent: perSubResults.reduce((sum, r) => sum + r.sent, 0),
          removed: perSubResults.reduce((sum, r) => sum + r.removed, 0),
          failed: 0,
        };
      } catch (err) {
        console.error("skipping user due to unexpected data", userDoc.id, err.message);
        return { sent: 0, removed: 0, failed: 1 };
      }
    })
  );

  const sent = perUserResults.reduce((sum, r) => sum + r.sent, 0);
  const removed = perUserResults.reduce((sum, r) => sum + r.removed, 0);
  const failed = perUserResults.reduce((sum, r) => sum + r.failed, 0);

  res.status(200).json({ ok: true, sent, removed, failed });
};
