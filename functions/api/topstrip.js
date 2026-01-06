export async function onRequestGet() {
  // Phoenix, AZ
  const lat = 33.4484;
  const lon = -112.0740;

  // Open-Meteo weather (no key)
  const wxUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,wind_speed_10m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FPhoenix`;

  // Open-Meteo air quality (no key)
  const aqiUrl =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    `&current=us_aqi&timezone=America%2FPhoenix`;

  const [wxRes, aqiRes] = await Promise.all([fetch(wxUrl), fetch(aqiUrl)]);
  if (!wxRes.ok) return new Response("Weather fetch failed", { status: 502 });
  if (!aqiRes.ok) return new Response("AQI fetch failed", { status: 502 });

  const wx = await wxRes.json();
  const aq = await aqiRes.json();

  const tempF = wx?.current?.temperature_2m;
  const windMph = wx?.current?.wind_speed_10m;
  const aqiUS = aq?.current?.us_aqi;

  const aqiLabel =
    (aqiUS == null) ? null :
    (aqiUS <= 50) ? "Good" :
    (aqiUS <= 100) ? "Moderate" :
    (aqiUS <= 150) ? "Unhealthy (SG)" :
    (aqiUS <= 200) ? "Unhealthy" :
    (aqiUS <= 300) ? "Very Unhealthy" : "Hazardous";

  return Response.json({
    city: "Phoenix",
    tempF,
    windMph,
    aqiUS,
    aqiLabel
  });
}
