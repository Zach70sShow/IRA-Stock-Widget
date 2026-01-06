function hhmm(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export async function onRequestGet() {
  const lat = 33.4484;
  const lon = -112.0740;

  // Weather forecast (no key)
  const wxUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,wind_speed_10m` +
    `&hourly=precipitation_probability` +
    `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset` +
    `&forecast_days=2` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FPhoenix`;

  // AQI (no key)
  const aqiUrl =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    `&current=us_aqi&timezone=America%2FPhoenix`;

  // RainViewer radar times (no key)
  const rvUrl = "https://api.rainviewer.com/public/weather-maps.json";

  const [wxRes, aqiRes, rvRes] = await Promise.all([fetch(wxUrl), fetch(aqiUrl), fetch(rvUrl)]);
  if (!wxRes.ok) return new Response("Weather fetch failed", { status: 502 });

  const wx = await wxRes.json();
  const aq = aqiRes.ok ? await aqiRes.json() : null;
  const rv = rvRes.ok ? await rvRes.json() : null;

  const tempF = wx?.current?.temperature_2m;
  const windMph = wx?.current?.wind_speed_10m;

  // Precip prob: take "current hour-ish"
  let precipProb = null;
  const hTimes = wx?.hourly?.time || [];
  const hProb = wx?.hourly?.precipitation_probability || [];
  if (hTimes.length && hProb.length) precipProb = hProb[0];

  // Tomorrow hi/lo
  const dMax = wx?.daily?.temperature_2m_max || [];
  const dMin = wx?.daily?.temperature_2m_min || [];
  const tomorrowHiF = dMax[1] ?? null;
  const tomorrowLoF = dMin[1] ?? null;

  const sunrise = hhmm(wx?.daily?.sunrise?.[0]);
  const sunset  = hhmm(wx?.daily?.sunset?.[0]);

  const aqiUS = aq?.current?.us_aqi ?? null;
  const aqiLabel =
    (aqiUS == null) ? null :
    (aqiUS <= 50) ? "Good" :
    (aqiUS <= 100) ? "Moderate" :
    (aqiUS <= 150) ? "Unhealthy (SG)" :
    (aqiUS <= 200) ? "Unhealthy" :
    (aqiUS <= 300) ? "Very Unhealthy" : "Hazardous";

  // Radar snapshot centered on Phoenix
  let radar = null;
  const ts = rv?.radar?.past?.slice(-1)?.[0]?.time || rv?.radar?.nowcast?.[0]?.time || null;
  if (ts) {
    // RainViewer tile: /v2/radar/{time}/256/{z}/{x}/{y}/2/1_1.png
    // We'll use a static map image via their "tile to image" trick: simplest is embed a prebuilt map image:
    // Use RainViewer "static map" style through a tile server aggregator is complex, so we’ll do a single tile-ish image:
    // We'll use a wide tile at z=7 around Phoenix.
    const z = 7;
    // rough tile conversion
    const latRad = lat * Math.PI / 180;
    const n = Math.pow(2, z);
    const xtile = Math.floor((lon + 180) / 360 * n);
    const ytile = Math.floor((1 - Math.log(Math.tan(latRad) + 1/Math.cos(latRad)) / Math.PI) / 2 * n);

    const img = `https://tilecache.rainviewer.com/v2/radar/${ts}/256/${z}/${xtile}/${ytile}/2/1_1.png`;
    radar = {
      img,
      when: new Date(ts * 1000).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })
    };
  }

  return Response.json({
    tempF,
    windMph,
    precipProb,
    tomorrowHiF,
    tomorrowLoF,
    sunrise,
    sunset,
    aqiUS,
    aqiLabel,
    radar
  });
}
