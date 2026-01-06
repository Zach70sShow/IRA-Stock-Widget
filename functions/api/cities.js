const CITIES = [
  { name:"Phoenix",           lat:33.4484, lon:-112.0740, tz:"America/Phoenix" },
  { name:"Flagstaff",         lat:35.1983, lon:-111.6513, tz:"America/Phoenix" },
  { name:"Washington, DC",    lat:38.9072, lon:-77.0369,  tz:"America/New_York" },
  { name:"Boston",            lat:42.3601, lon:-71.0589,  tz:"America/New_York" },
  { name:"Frederick, MD",     lat:39.4143, lon:-77.4105,  tz:"America/New_York" },
  { name:"Winchester, VA",    lat:39.1857, lon:-78.1633,  tz:"America/New_York" },
  { name:"Berlin",            lat:52.5200, lon:13.4050,   tz:"Europe/Berlin" }
];

async function fetchCurrent(lat, lon, tz) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,wind_speed_10m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=${encodeURIComponent(tz)}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  return r.json();
}

export async function onRequestGet() {
  const results = await Promise.all(CITIES.map(async c => {
    const data = await fetchCurrent(c.lat, c.lon, c.tz);
    const tempF = data?.current?.temperature_2m ?? null;
    const wind  = data?.current?.wind_speed_10m ?? null;

    const now = new Date(new Date().toLocaleString("en-US", { timeZone: c.tz }));
    const time = now.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });

    return {
      name: c.name,
      time,
      tempF,
      extra: (wind != null) ? `Wind ${Math.round(wind)} mph` : ""
    };
  }));

  return Response.json({ items: results });
}
