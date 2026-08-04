// ---------- Offline app-shell caching ----------
// Bump this on any deploy that changes one of the precached files below —
// it's the only thing that invalidates the old cache. skipWaiting() +
// clients.claim() below mean a new service worker takes over immediately
// (not "after all tabs are closed", the usual SW default), and activate()
// deletes every cache whose name doesn't match CACHE_VERSION — so a stale
// version can't linger and strand a user on old code the way an
// unversioned/cache-forever setup could.
//
// Strategy is network-first for every same-origin GET: online, this always
// serves the live deploy and just refreshes the cache alongside it — the
// cache only actually gets read from when the network request fails
// (offline). That trade deliberately favors "never see stale content while
// online" over "instant load from cache", since staleness is the specific
// failure mode this needs to avoid.
const CACHE_VERSION = "v6";
const CACHE_NAME = `assistant-shell-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/styles/base.css",
  "/styles/vongole.css",
  "/styles/schedule.css",
  "/styles/practice.css",
  "/styles/study.css",
  "/styles/routine.css",
  "/styles/exercise.css",
  "/styles/ledger.css",
  "/styles/settings.css",
  "/styles/components.css",
  "/styles/responsive.css",
  "/scripts/toast.js",
  "/scripts/modal-focus-trap.js",
  "/scripts/schedule-recurrence.js",
  "/scripts/calendar-fit.js",
  "/scripts/goal-label-editor.js",
  "/scripts/deep-merge.js",
  "/scripts/store.js",
  "/scripts/schedule.js",
  "/scripts/settings.js",
  "/scripts/notifications.js",
  "/scripts/weather.js",
  "/scripts/practice.js",
  "/scripts/study.js",
  "/scripts/exercise.js",
  "/scripts/ledger.js",
  "/scripts/vongole.js",
  "/scripts/routine.js",
  "/scripts/search.js",
  "/scripts/main.js",
  "/scripts/cloud-sync.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Precaching is best-effort — one missing/renamed file shouldn't
      // block the whole install and leave offline support entirely broken.
      Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only same-origin GETs — Firebase/Open-Meteo calls and anything
  // cross-origin must always go straight to the network, never cached.
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache successful responses — caching a transient 404/500
        // would mean that error page gets served as if it were real content
        // the next time this exact request happens while offline.
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          // Nothing cached for this exact request, and the network's down.
          // For a page navigation, index.html (the app shell — every route
          // here is a hash on that one HTML file) can still render, which
          // beats the browser's bare connection-error page. Anything else
          // (a JS/CSS/image request with nothing to substitute) just fails.
          if (request.mode === "navigate") {
            return caches
              .match("/index.html")
              .then((shell) => shell || Promise.reject(new Error("offline, no app shell cached")));
          }
          return Promise.reject(new Error("offline, not cached"));
        })
      )
  );
});

// ---------- Push notifications ----------
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "오늘의 할 일";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/index.html#schedule" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/index.html#schedule";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    })
  );
});
