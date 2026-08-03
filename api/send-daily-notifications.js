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
  const authHeader = req.headers.authorization || "";
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // The server runs in UTC; compute "today" in KST (UTC+9) instead.
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = `${kst.getUTCFullYear()}-${pad2(kst.getUTCMonth() + 1)}-${pad2(kst.getUTCDate())}`;

  const usersSnap = await db.collection("users").get();
  let sent = 0;
  let removed = 0;

  for (const userDoc of usersSnap.docs) {
    let schedules = [];
    try {
      const payload = JSON.parse(userDoc.data().payload || "{}");
      schedules = JSON.parse(payload["assistant.schedules.v1"] || "[]");
    } catch {
      continue;
    }

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
    for (const subDoc of subsSnap.docs) {
      const { subscription } = subDoc.data();
      try {
        await webpush.sendNotification(subscription, payloadStr);
        sent += 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Subscription is gone (uninstalled/expired) — stop trying it.
          await subDoc.ref.delete();
          removed += 1;
        } else {
          console.error("push send failed", userDoc.id, err.message);
        }
      }
    }
  }

  res.status(200).json({ ok: true, sent, removed });
};
