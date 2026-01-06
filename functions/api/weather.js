export async function onRequestGet(ctx) {
  const url = new URL(ctx.request.url);
  const cacheKey = new Request(url.origin + url.pathname + url.search);
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    // Phoenix coords
    const lat = 33.4484;
    const lon = -112.0740;

    // Weather (current + daily sunrise/sunset + tomorrow hi/low)
    const wUrl = new URL("https://api.open-meteo.com/v1/forecast");
    wUrl.searchParams.set("latitude", String(lat));
    wUrl.searchParams.set("longitude", String(lon));
    wUrl.searchParams.set("temperature_unit", "fahrenheit");
    wUrl.searchParams.set("wind_speed_unit", "mph");
    wUrl.searchParams.set("timezone", "America/Phoenix");
    wUrl.searchParams.set("current", "temperature_2m,wind_speed_10m,weather_code");
    wUrl.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max");
    wUrl.searchParams.set("forecast_days", "2");

    const wRes = await fetch(wUrl.toString(), { cf: { cacheTtl: 120, cacheEverything: true } });
    const w = await wRes.json();

    // AQI via Open-Meteo Air Quality
    const aUrl = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
    aUrl.searchParams.set("latitude", String(lat));
    aUrl.searchParams.set("longitude", String(lon));
    aUrl.searchParams.set("timezone", "America/Phoenix");
    aUrl.searchParams.set("current", "us_aqi");

    const aRes = await fetch(aUrl.toString(), { cf: { cacheTtl: 300, cacheEverything: true } });
    const a = await aRes.json().catch(() => null);

    const nowTemp = w?.current?.temperature_2m ?? null;
    const nowWind = w?.current?.wind_speed_10m ?? null;

    const rainChance = w?.daily?.precipitation_probability_max?.[0] ?? null;

    const sunriseISO = w?.daily?.sunrise?.[0] ?? null;
    const sunsetISO  = w?.daily?.sunset?.[0] ?? null;

    const tomorrowHigh = w?.daily?.temperature_2m_max?.[1] ?? null;
    const tomorrowLow  = w?.daily?.temperature_2m_min?.[1] ?? null;

    const aqiVal = a?.current?.us_aqi ?? null;

    const payload = {
      ok: true,
      now: {
        tempF: (nowTemp!=null ? Math.round(nowTemp) : null),
        windMph: (nowWind!=null ? Math.round(nowWind) : null),
        rainChancePct: rainChance
      },
      tomorrow: {
        highF: (tomorrowHigh!=null ? Math.round(tomorrowHigh) : null),
        lowF: (tomorrowLow!=null ? Math.round(tomorrowLow) : null),
        summary: "—"
      },
      aqi: {
        value: (aqiVal!=null ? Math.round(aqiVal) : null),
        label: aqiLabel(aqiVal)
      },
      sunrise: fmtShortTime(sunriseISO),
      sunset: fmtShortTime(sunsetISO),
      updatedAt: new Date().toISOString()
    };

    // Move sunrise/sunset into now for edge.html expectations
    payload.now.sunrise = payload.sunrise;
    payload.now.sunset  = payload.sunset;

    const res = json(payload, 200, { "Cache-Control":"public, max-age=0" });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;

  } catch (e) {
    const res = json({ ok:false, error: "Weather fetch failed (" + (e?.message || e) + ")" }, 200, { "Cache-Control":"no-store" });
    return res;
  }
}

function aqiLabel(v){
  if (v==null || !isFinite(v)) return "—";
  if (v <= 50) return "Good";
  if (v <= 100) return "Moderate";
  if (v <= 150) return "Unhealthy (SG)";
  if (v <= 200) return "Unhealthy";
  if (v <= 300) return "Very Unhealthy";
  return "Hazardous";
}

function fmtShortTime(iso){
  if (!iso) return "—";
  try{
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
  }catch{ return "—"; }
}

function json(obj, status=200, headers={}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", ...headers }
  });
}
