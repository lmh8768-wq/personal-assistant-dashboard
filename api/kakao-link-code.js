const admin = require("firebase-admin");
const crypto = require("node:crypto");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();

const CODE_TTL_MS = 10 * 60 * 1000;
// Kept short enough to type comfortably into a KakaoTalk chat bubble
// ("연동 123456"), long enough (1M possibilities, 10-minute expiry) that
// guessing a stranger's live code before it expires isn't practical.
const MAX_GENERATE_ATTEMPTS = 5;

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
    // A fresh 6-digit code per request rather than reusing/extending one
    // already issued to this uid — a short, bounded retry loop against a
    // 1-in-a-million collision (astronomically unlikely, but cheap to guard)
    // beats letting a truly pathological collision silently overwrite
    // someone else's still-active code.
    let code;
    for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
      const candidate = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      const existing = await db.collection("kakaoLinkCodes").doc(candidate).get();
      if (!existing.exists) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      res.status(500).json({ error: "failed to generate a unique code, try again" });
      return;
    }

    const expiresAt = Date.now() + CODE_TTL_MS;
    await db.collection("kakaoLinkCodes").doc(code).set({ uid, expiresAt });
    res.status(200).json({ code, expiresInSec: CODE_TTL_MS / 1000 });
  } catch (err) {
    console.error("kakao-link-code failed", err);
    res.status(500).json({ error: "failed to generate link code" });
  }
};
