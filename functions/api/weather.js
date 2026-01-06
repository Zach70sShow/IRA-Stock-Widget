export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));

    if (!isFinite(lat) || !isFinite(lon)) {
      return json({ ok: false, error: "Missing/invalid lat/lon" }, 400);
    }

    // Weather (no key) — Open-Meteo forecast
    const wxUrl =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${encodeURIComponent(lat)}` +
      `&longitude=${encodeURIComponent(lon)}` +
      "&current=temperature_2m,wind_speed_10m" +
      "&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,weather_code" +
      "&temperature_unit=fahrenheit" +
      "&wind_speed_unit=mph" +
      "&timezone=auto";

    // AQI (no key) — Open-Meteo Air Quality
    const aqiUrl =
      "https://air-quality-api.open-meteo.com/v1/air-quality" +
      `?latitude=${encodeURIComponent(lat)}` +
      `&longitude=${encodeURIComponent(lon)}` +
      "&current=us_aqi" +
      "&timezone=auto";

    const [wxRes, aqiRes] = await Promise.all([fetch(wxUrl), fetch(aqiUrl)]);
    if (!wxRes.ok) return json({ ok: false, error: `Weather fetch failed (${wxRes.status})` }, 502);
    if (!aqiRes.ok) return json({ ok: false, error: `AQI fetch failed (${aqiRes.status})` }, 502);

    const wx = await wxRes.json();
    const aq = await aqiRes.json();

    const nowTemp = wx?.current?.temperature_2m;
    const nowWind = wx?.current?.wind_speed_10m;

    const daily = wx?.daily || {};
    const tmax = daily?.temperature_2m_max || [];
    const tmin = daily?.temperature_2m_min || [];
    const sunrise = daily?.sunrise || [];
    const sunset = daily?.sunset || [];
    const rainMax = daily?.precipitation_probability_max || [];
    const wcode = daily?.weather_code || [];

    const aqiVal = aq?.current?.us_aqi;

    const out = {
      ok: true,
      now: {
        tempF: isFinite(nowTemp) ? Math.round(nowTemp) : null,
        windMph: isFinite(nowWind) ? Math.round(nowWind) : null,
        rainChancePct: isFinite(rainMax?.[0]) ? Math.round(rainMax[0]) : null,
        sunrise: sunrise?.[0] ? toTime(sunrise[0]) : null,
        sunset: sunset?.[0] ? toTime(sunset[0]) : null,
      },
      tomorrow: {
        highF: isFinite(tmax?.[1]) ? Math.round(tmax[1]) : null,
        lowF: isFinite(tmin?.[1]) ? Math.round(tmin[1]) : null,
        summary: isFinite(wcode?.[1]) ? weatherLabel(wcode[1]) : null,
      },
      aqi: isFinite(aqiVal) ? { value: Math.round(aqiVal), label: aqiLabel(aqiVal) } : null,
      updatedAt: new Date().toISOString(),
    };

    return json(out);
  } catch (e) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
}

function toTime(iso) {
  // iso like "2026-01-05T07:32"
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function aqiLabel(v) {
  if (!isFinite(v)) return "";
  if (v <= 50) return "Good";
  if (v <= 100) return "Moderate";
  if (v <= 150) return "Unhealthy (SG)";
  if (v <= 200) return "Unhealthy";
  if (v <= 300) return "Very Unhealthy";
  return "Hazardous";
}

// Simple readable mapping for Open-Meteo weather_code
function weatherLabel(code) {
  const c = Number(code);
  if (c === 0) return "Clear";
  if (c === 1 || c === 2) return "Partly Cloudy";
  if (c === 3) return "Overcast";
  if (c === 45 || c === 48) return "Fog";
  if (c >= 51 && c <= 57) return "Drizzle";
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return "Rain";
  if (c >= 71 && c <= 77) return "Snow";
  if (c >= 95) return "Thunder";
  return "Mixed";
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
