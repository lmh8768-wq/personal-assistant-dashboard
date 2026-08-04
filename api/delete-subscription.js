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

  const { idToken, endpoint } = req.body || {};
  // typeof check, not just truthiness — a non-string endpoint (number,
  // object, ...) used to pass this check and then crash Buffer.from()
  // below uncaught, outside any try/catch, giving the client a generic
  // platform 500 instead of this endpoint's normal {error} shape.
  if (!idToken || typeof endpoint !== "string") {
    res.status(400).json({ error: "missing idToken or endpoint" });
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

  // Same derivation save-subscription.js uses, so this deletes the exact
  // doc that subscription was saved under.
  const subId = Buffer.from(endpoint).toString("base64url").slice(-64);

  try {
    await db.collection("users").doc(uid).collection("pushSubscriptions").doc(subId).delete();
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("delete-subscription failed", err);
    res.status(500).json({ error: "failed to delete subscription" });
  }
};
