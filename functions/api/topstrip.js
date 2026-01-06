export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);
    const name = url.searchParams.get("name") || "Phoenix";
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));

    if (!isFinite(lat) || !isFinite(lon)) {
      return json({ ok: false, error: "Missing/invalid lat/lon" }, 400);
    }

    // Pull from the SAME sources as /api/weather to keep it consistent
    const wxUrl =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${encodeURIComponent(lat)}` +
      `&longitude=${encodeURIComponent(lon)}` +
      "&current=temperature_2m,wind_speed_10m" +
      "&temperature_unit=fahrenheit" +
      "&wind_speed_unit=mph" +
      "&timezone=auto";

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

    const temp = wx?.current?.temperature_2m;
    const wind = wx?.current?.wind_speed_10m;
    const aqiVal = aq?.current?.us_aqi;

    return json({
      ok: true,
      location: name,
      tempF: isFinite(temp) ? Math.round(temp) : null,
      windMph: isFinite(wind) ? Math.round(wind) : null,
      aqiValue: isFinite(aqiVal) ? Math.round(aqiVal) : null,
      aqiLabel: isFinite(aqiVal) ? aqiLabel(aqiVal) : null,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
