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

  const { idToken } = req.body || {};
  if (!idToken) {
    res.status(400).json({ error: "missing idToken" });
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

  try {
    // kakaoLinks/{uid} — the uid -> kakaoUserId side of the link, kept
    // separate from kakaoUserLinks/{kakaoUserId} (the reverse lookup
    // api/kakao-webhook.js uses) so each direction is an O(1) doc read
    // instead of a query. Both are admin-only (not readable by the client
    // SDK — see firestore.rules), which is why this endpoint exists at all
    // instead of the Settings page reading the doc directly.
    const doc = await db.collection("kakaoLinks").doc(uid).get();
    if (!doc.exists) {
      res.status(200).json({ linked: false });
      return;
    }
    const data = doc.data();
    res.status(200).json({ linked: true, linkedAt: data.linkedAt || null });
  } catch (err) {
    console.error("kakao-link-status failed", err);
    res.status(500).json({ error: "failed to read link status" });
  }
};
