const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const { idToken, subscription } = req.body || {};
  if (!idToken || !subscription || !subscription.endpoint) {
    res.status(400).json({ error: "missing idToken or subscription" });
    return;
  }

  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    res.status(401).json({ error: "invalid idToken" });
    return;
  }

  // Stable per-subscription doc id, so re-subscribing the same device just
  // overwrites its own entry instead of piling up duplicates.
  const subId = Buffer.from(subscription.endpoint).toString("base64url").slice(-64);

  try {
    await db
      .collection("users")
      .doc(uid)
      .collection("pushSubscriptions")
      .doc(subId)
      .set({ subscription, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("save-subscription failed", err);
    res.status(500).json({ error: "failed to save subscription" });
  }
};
