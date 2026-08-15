// Pure Open-Meteo weather logic, shared between the browser client
// (scripts/weather.js's dashboard widget) and the Vercel serverless
// function that answers the KakaoTalk "날씨" command
// (api/kakao-webhook.js) — without this, the alert thresholds (rain/snow
// onset, heatwave levels) and the weather-code → emoji/label table would
// have to be hand-duplicated between the two, exactly the trap
// schedule-recurrence.js's own header comment already warns about.
//
// UMD-style export since there's no bundler here: scripts/*.js are plain
// browser <script> tags (no require/module.exports), while api/*.js runs
// as Node/CommonJS (no window) — this file works unmodified in both, same
// pattern as scripts/schedule-recurrence.js.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.WeatherCalc = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
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

  function buildForecastUrl(loc) {
    return (
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
      `&current=temperature_2m,weather_code` +
      `&hourly=precipitation_probability,rain,snowfall` +
      `&daily=temperature_2m_max,temperature_2m_min` +
      `&forecast_days=1&timezone=auto`
    );
  }

  // Shared by both callers, but each does its own fetch(): the browser
  // widget layers caching/geolocation/cross-tab-locking on top (see
  // weather.js), and the Kakao webhook has no browser fetch/geolocation
  // available at all — so only the URL-building and response-shaping logic
  // lives here, not the network call itself.
  function shapeForecastResponse(data) {
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

  return {
    describeCode,
    computeAlerts,
    buildForecastUrl,
    shapeForecastResponse,
    DEFAULT_LOCATION: { lat: 37.5665, lon: 126.978 },
  };
});
