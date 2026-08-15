// Settings-page glue for linking a KakaoTalk account to this app — same
// idToken-over-fetch pattern notifications.js uses for its own /api calls
// (see enableNotifications there), just against the /api/kakao-* endpoints
// instead. All three calls are auth-gated server-side (verifyIdToken), so
// there's nothing sensitive to check client-side beyond "is someone signed
// in at all".
(function () {
  function currentUser() {
    return window.firebase?.auth && window.firebase.auth().currentUser;
  }

  async function requestLinkCode() {
    const user = currentUser();
    if (!user) {
      window.Toast?.show("로그인 후 다시 시도해주세요");
      return null;
    }
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/kakao-link-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) throw new Error("kakao-link-code failed");
      return await res.json(); // { code, expiresInSec }
    } catch (err) {
      console.error("kakao link code request failed", err);
      window.Toast?.show("연동 코드를 받아오지 못했어요");
      return null;
    }
  }

  async function checkLinkStatus() {
    const user = currentUser();
    if (!user) return { linked: false };
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/kakao-link-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) throw new Error("kakao-link-status failed");
      return await res.json(); // { linked, linkedAt? }
    } catch (err) {
      console.error("kakao link status check failed", err);
      return { linked: false, error: true };
    }
  }

  async function unlink() {
    const user = currentUser();
    if (!user) {
      window.Toast?.show("로그인 후 다시 시도해주세요");
      return false;
    }
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/kakao-unlink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) throw new Error("kakao-unlink failed");
      window.Toast?.show("카카오톡 연동을 해제했어요");
      return true;
    } catch (err) {
      console.error("kakao unlink failed", err);
      window.Toast?.show("연동 해제에 실패했어요");
      return false;
    }
  }

  window.KakaoLink = { requestLinkCode, checkLinkStatus, unlink };
})();
