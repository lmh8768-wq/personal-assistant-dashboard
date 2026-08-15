(function () {
  // Deliberately NOT prefixed with "assistant." — cloud-sync.js treats that
  // prefix as user data to sync/overwrite across devices, and this is just a
  // local device cache (per-device location, refreshed every 30min) that must
  // never be written into the synced payload or pushed to Firestore.
  const LOCATION_KEY = "weatherLocation.v1";
  const CACHE_KEY = "weatherCache.v1";
  const CACHE_TTL_MS = 30 * 60 * 1000;

  // Same-device cross-tab lock — two tabs opening the dashboard around the
  // same moment both see the same stale cache and would otherwise both
  // fire an API call. Whichever tab grabs this first fetches; the other
  // just waits briefly for the cache that fetch produces.
  const FETCH_LOCK_KEY = "weatherFetchLock.v1";
  const FETCH_LOCK_TTL_MS = 5000;

  function tryAcquireFetchLock() {
    try {
      const raw = localStorage.getItem(FETCH_LOCK_KEY);
      if (raw && Date.now() - (JSON.parse(raw).at || 0) < FETCH_LOCK_TTL_MS) return false;
      localStorage.setItem(FETCH_LOCK_KEY, JSON.stringify({ at: Date.now() }));
      return true;
    } catch {
      return true; // storage broken — don't block fetching, just skip the coordination
    }
  }

  function releaseFetchLock() {
    try {
      localStorage.removeItem(FETCH_LOCK_KEY);
    } catch {
      // not worth surfacing — it'll just expire on its own via the TTL check above
    }
  }

  // WEATHER_CODES/describeCode and the rain/snow/heatwave alert thresholds
  // now live in scripts/weather-calc.js — shared with api/kakao-webhook.js's
  // "날씨" command, which has no browser to load this file's DOM-rendering/
  // geolocation/caching logic into. Load order (index.html) puts
  // weather-calc.js before this file.
  const { describeCode, buildForecastUrl, shapeForecastResponse, DEFAULT_LOCATION } = window.WeatherCalc;

  // Re-requesting geolocation on every load would mean a permission-prompt
  // (or at least a location fix) every single time, which is its own
  // annoyance — but caching it forever meant a user who granted this once
  // while traveling, then came home, kept seeing weather for wherever they
  // were when they first allowed it, with no way to fix that short of
  // manually clearing localStorage. A day is long enough to not re-prompt
  // constantly, short enough that a traveling user's weather catches up
  // within it.
  const LOCATION_TTL_MS = 24 * 60 * 60 * 1000;

  function loadLocation() {
    try {
      const raw = localStorage.getItem(LOCATION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.at !== "number" || Date.now() - parsed.at > LOCATION_TTL_MS) return null;
      return { lat: parsed.lat, lon: parsed.lon };
    } catch {
      return null;
    }
  }

  function saveLocation(loc) {
    window.safeSetLocalStorage(LOCATION_KEY, JSON.stringify({ ...loc, at: Date.now() }));
  }

  // Exposed purely so tests/weather-location.test.js can exercise the real
  // shipped TTL logic directly instead of driving the whole app through a
  // real browser (geolocation/weather-fetch timing during app startup made
  // that unreliable to assert against) — same reasoning cloud-sync.js's
  // __mergeStoredValueForTest already uses.
  window.__weatherLocationForTest = { loadLocation, saveLocation };

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveCache(entry) {
    window.safeSetLocalStorage(CACHE_KEY, JSON.stringify(entry));
  }

  function resolveLocation() {
    const cached = loadLocation();
    if (cached) return Promise.resolve(cached);

    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(DEFAULT_LOCATION);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          saveLocation(loc);
          resolve(loc);
        },
        () => resolve(DEFAULT_LOCATION),
        { timeout: 8000 }
      );
    });
  }

  async function fetchWeather(loc) {
    const res = await fetch(buildForecastUrl(loc));
    if (!res.ok) throw new Error("weather fetch failed");
    const data = await res.json();
    return shapeForecastResponse(data);
  }

  function render(weather, note) {
    const bodyEl = document.getElementById("weatherBody");
    const iconEl = document.getElementById("weatherIcon");
    const tempEl = document.getElementById("weatherTemp");
    const descEl = document.getElementById("weatherDesc");
    const rangeEl = document.getElementById("weatherRange");
    const alertsEl = document.getElementById("weatherAlerts");
    const noteEl = document.getElementById("weatherNote");
    if (!iconEl) return;

    if (weather) {
      const [emoji, label] = describeCode(weather.code);
      iconEl.textContent = emoji;
      tempEl.textContent = `${weather.temp}°`;
      descEl.textContent = label;
      rangeEl.textContent = `최고 ${weather.max}° · 최저 ${weather.min}°`;

      alertsEl.innerHTML = "";
      for (const alert of weather.alerts || []) {
        const badge = document.createElement("span");
        badge.className = "weather-alert-badge";
        badge.textContent = `${alert.icon} ${alert.text}`;
        alertsEl.appendChild(badge);
      }
    }
    noteEl.textContent = note || "";
    // Dims slightly whenever what's showing isn't confirmed-fresh (a stale
    // cached reading during a background refresh, or a failure) — a soft
    // stand-in for a real crossfade, since the temp/desc/range text just
    // gets replaced in place with no transition of its own to hook into.
    bodyEl?.classList.toggle("weather-stale", !!note);
  }

  async function refreshDashboard() {
    const cache = loadCache();
    const isFresh = cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
    if (isFresh) {
      render(cache.weather, "");
      return;
    }
    if (cache) render(cache.weather, "업데이트 중…");
    // First-ever load (no cache at all yet) previously showed nothing but
    // the static "—" placeholder for however long geolocation + the fetch
    // took (up to several seconds) with zero indication anything was
    // happening — at least a text cue now, and .weather-stale's dim from
    // render() applies here too.
    else render(null, "날씨 정보를 불러오는 중…");

    if (!tryAcquireFetchLock()) {
      // Another tab already grabbed the lock and is fetching right now —
      // poll for the cache it writes instead of also hitting the API
      // ourselves. Polls up to the lock's own TTL, not a shorter fixed
      // wait — a wait shorter than FETCH_LOCK_TTL_MS meant a fetch that was
      // simply a normal amount slow (well within the lock's own TTL) still
      // made this tab give up and fetch independently too, doubling the
      // exact API call the lock exists to prevent.
      const deadline = Date.now() + FETCH_LOCK_TTL_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const latest = loadCache();
        if (latest && Date.now() - latest.fetchedAt < CACHE_TTL_MS) {
          render(latest.weather, "");
          return;
        }
      }
      // The other tab didn't finish (or failed) within the lock's own TTL —
      // fall through and fetch ourselves rather than leaving the view stuck
      // on stale data.
    }

    try {
      const loc = await resolveLocation();
      const weather = await fetchWeather(loc);
      saveCache({ weather, fetchedAt: Date.now() });
      render(weather, "");
    } catch {
      if (cache) {
        render(cache.weather, "최신 정보를 불러오지 못했어요");
      } else {
        render(null, "날씨 정보를 불러오지 못했어요");
      }
    } finally {
      releaseFetchLock();
    }
  }

  window.WeatherView = { refreshDashboard };
})();
