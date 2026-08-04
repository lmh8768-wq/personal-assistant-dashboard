(function () {
  const VAPID_PUBLIC_KEY =
    "BFq2EH0eo-ALUr1izN9_P35NgAxsQl8OssBUudjbS583zzSm12c_Ojdo-nmhJjqtEdRD7yfQ5dKmTXorTigxKvA";
  const ENABLED_KEY = "notificationsEnabled";

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function isSupported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  function isEnabled() {
    try {
      return localStorage.getItem(ENABLED_KEY) === "true";
    } catch {
      return false;
    }
  }

  async function enableNotifications() {
    if (!isSupported()) {
      window.Toast?.show("이 기기/브라우저에서는 알림을 지원하지 않아요");
      return false;
    }

    const user = window.firebase?.auth && window.firebase.auth().currentUser;
    if (!user) {
      window.Toast?.show("로그인 후 다시 시도해주세요");
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        window.Toast?.show("알림 권한이 거부됐어요");
        return false;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const idToken = await user.getIdToken();
      const res = await fetch("/api/save-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, subscription: subscription.toJSON() }),
      });
      if (!res.ok) throw new Error("save-subscription failed");

      window.safeSetLocalStorage(ENABLED_KEY, "true");
      window.Toast?.show("매일 아침 8시에 오늘의 일정 알림을 보내드릴게요");
      return true;
    } catch (err) {
      console.error("enable notifications failed", err);
      window.Toast?.show("알림 설정에 실패했어요");
      return false;
    }
  }

  async function disableNotifications() {
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        // Delete the server-side copy too — otherwise it just sits in
        // Firestore until the next daily cron run happens to get a 404/410
        // from the push service and cleans it up incidentally. Best-effort:
        // the local unsubscribe() below is what actually stops notifications
        // from this device, so a failure here (offline, no signed-in user)
        // isn't worth blocking on or surfacing to the user.
        const user = window.firebase?.auth && window.firebase.auth().currentUser;
        if (user) {
          try {
            const idToken = await user.getIdToken();
            await fetch("/api/delete-subscription", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ idToken, endpoint: subscription.endpoint }),
            });
          } catch {
            // ignore — worst case the subscription just goes stale server-side
          }
        }
        await subscription.unsubscribe();
      }
    } catch {
      // ignore — worst case the subscription just goes stale server-side
    }
    window.safeSetLocalStorage(ENABLED_KEY, "false");
    window.Toast?.show("알림을 껐어요");
  }

  // sw.js's pushsubscriptionchange handler resubscribes on its own when the
  // browser rotates/expires a subscription, but has no Firebase Auth
  // session to push the new one to the server with — only this page-side
  // code does, so it relays the fresh subscription via the same
  // /api/save-subscription call enableNotifications() uses.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", async (event) => {
      if (event.data?.type !== "push-subscription-changed") return;
      const user = window.firebase?.auth && window.firebase.auth().currentUser;
      if (!user || !isEnabled()) return;
      try {
        const idToken = await user.getIdToken();
        await fetch("/api/save-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, subscription: event.data.subscription }),
        });
      } catch (err) {
        console.error("failed to relay rotated push subscription", err);
      }
    });
  }

  window.PushNotifications = { isSupported, isEnabled, enableNotifications, disableNotifications };
})();
