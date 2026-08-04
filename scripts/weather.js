(function () {
  // Deliberately NOT prefixed with "assistant." — cloud-sync.js treats that
  // prefix as user data to sync/overwrite across devices, and this is just a
  // local device cache (per-device location, refreshed every 30min) that must
  // never be written into the synced payload or pushed to Firestore.
  const LOCATION_KEY = "weatherLocation.v1";
  const CACHE_KEY = "weatherCache.v1";
  const CACHE_TTL_MS = 30 * 60 * 1000;
  const DEFAULT_LOCATION = { lat: 37.5665, lon: 126.978 }; // Seoul, used when geolocation is unavailable/denied

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

  const WEATHER_CODES = {
    0: ["☀️", "맑음"],
    1: ["🌤️", "대체로 맑음"],
    2: ["⛅", "구름 조금"],
    3: ["☁️", "흐림"],
    45: ["🌫️", "안개"],
    48: ["🌫️", "짙은 안개"],
    51: ["🌦️", "약한 이슬비"],
    53: ["🌦️", "이슬비"],
    55: ["🌧️", "강한 이슬비"],
    56: ["🌧️", "약한 어는비"],
    57: ["🌧️", "어는비"],
    61: ["🌧️", "약한 비"],
    63: ["🌧️", "비"],
    65: ["🌧️", "강한 비"],
    66: ["🌨️", "약한 어는비"],
    67: ["🌨️", "어는비"],
    71: ["❄️", "약한 눈"],
    73: ["❄️", "눈"],
    75: ["❄️", "강한 눈"],
    77: ["❄️", "가루눈"],
    80: ["🌦️", "약한 소나기"],
    81: ["🌧️", "소나기"],
    82: ["🌧️", "강한 소나기"],
    85: ["🌨️", "약한 눈 소나기"],
    86: ["🌨️", "강한 눈 소나기"],
    95: ["⛈️", "뇌우"],
    96: ["⛈️", "우박 동반 뇌우"],
    99: ["⛈️", "강한 우박 동반 뇌우"],
  };

  function describeCode(code) {
    return WEATHER_CODES[code] || ["🌡️", "날씨"];
  }

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

  const RAIN_THRESHOLD_MM = 0.1;
  const SNOW_THRESHOLD_CM = 0.1;
  const RAIN_PROBABILITY_THRESHOLD = 60;
  const HEATWAVE_WARNING_C = 33;
  const HEATWAVE_ALERT_C = 35;

  // Earliest hour (from now onward, today only) where the given hourly
  // series crosses its threshold. Open-Meteo's precipitation_probability
  // covers rain and snow combined, so it's only a valid fallback signal
  // for the rain check — using it for snow too would flag snow from a
  // purely rainy forecast.
  function findOnsetHour(hourly, amountKey, threshold, currentHour, useProbabilityFallback) {
    for (let i = 0; i < hourly.time.length; i++) {
      const hour = Number(hourly.time[i].slice(11, 13));
      if (hour < currentHour) continue;
      const amount = hourly[amountKey]?.[i] ?? 0;
      const probability = hourly.precipitation_probability?.[i] ?? 0;
      if (amount >= threshold || (useProbabilityFallback && probability >= RAIN_PROBABILITY_THRESHOLD)) {
        return hour;
      }
    }
    return null;
  }

  function computeAlerts(hourly, dailyMax, currentHour) {
    const alerts = [];

    const rainHour = findOnsetHour(hourly, "rain", RAIN_THRESHOLD_MM, currentHour, true);
    if (rainHour !== null) {
      alerts.push({
        icon: "☔",
        text: rainHour === currentHour ? "지금 비가 오고 있어요" : `${rainHour}시경 비 예보`,
      });
    }

    const snowHour = findOnsetHour(hourly, "snowfall", SNOW_THRESHOLD_CM, currentHour, false);
    if (snowHour !== null) {
      alerts.push({
        icon: "❄️",
        text: snowHour === currentHour ? "지금 눈이 오고 있어요" : `${snowHour}시경 눈 예보`,
      });
    }

    if (dailyMax >= HEATWAVE_ALERT_C) {
      alerts.push({ icon: "🥵", text: `폭염경보 수준 (최고 ${dailyMax}°)` });
    } else if (dailyMax >= HEATWAVE_WARNING_C) {
      alerts.push({ icon: "🥵", text: `폭염주의보 수준 (최고 ${dailyMax}°)` });
    }

    return alerts;
  }

  async function fetchWeather(loc) {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
      `&current=temperature_2m,weather_code` +
      `&hourly=precipitation_probability,rain,snowfall` +
      `&daily=temperature_2m_max,temperature_2m_min` +
      `&forecast_days=1&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("weather fetch failed");
    const data = await res.json();
    const max = Math.round(data.daily.temperature_2m_max[0]);
    const currentHour = new Date().getHours();
    return {
      temp: Math.round(data.current.temperature_2m),
      code: data.current.weather_code,
      max,
      min: Math.round(data.daily.temperature_2m_min[0]),
      alerts: computeAlerts(data.hourly, max, currentHour),
    };
  }

  function render(weather, note) {
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
  }

  async function refreshDashboard() {
    const cache = loadCache();
    const isFresh = cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
    if (isFresh) {
      render(cache.weather, "");
      return;
    }
    if (cache) render(cache.weather, "업데이트 중…");

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
