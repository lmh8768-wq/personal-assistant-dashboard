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
    const linkDoc = await db.collection("kakaoLinks").doc(uid).get();
    if (!linkDoc.exists) {
      // Already unlinked (or never linked) — not an error, so a settings
      // page that's slightly out of sync with the server doesn't show a
      // failure toast for an action that's effectively already done.
      res.status(200).json({ ok: true });
      return;
    }
    const { kakaoUserId } = linkDoc.data();
    // Both directions of the link have to go — leaving kakaoUserLinks
    // behind would let a stale reverse-lookup keep resolving future Kakao
    // messages to this uid after the user believed they'd disconnected it.
    await Promise.all([
      db.collection("kakaoLinks").doc(uid).delete(),
      kakaoUserId ? db.collection("kakaoUserLinks").doc(kakaoUserId).delete() : Promise.resolve(),
    ]);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("kakao-unlink failed", err);
    res.status(500).json({ error: "failed to unlink" });
  }
};
