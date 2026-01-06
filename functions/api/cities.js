export async function onRequestGet(ctx) {
  const url = new URL(ctx.request.url);
  const cacheKey = new Request(url.origin + url.pathname + url.search);
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    // Your favorites:
    const cities = [
      { name:"Phoenix", lat:33.4484, lon:-112.0740, tz:"America/Phoenix" },
      { name:"Washington, DC", lat:38.9072, lon:-77.0369, tz:"America/New_York" },
      { name:"Flagstaff", lat:35.1983, lon:-111.6513, tz:"America/Phoenix" },
      { name:"Boston", lat:42.3601, lon:-71.0589, tz:"America/New_York" },
      { name:"Frederick, MD", lat:39.4143, lon:-77.4105, tz:"America/New_York" },
      { name:"Winchester, VA", lat:39.1857, lon:-78.1633, tz:"America/New_York" },
      { name:"Berlin", lat:52.5200, lon:13.4050, tz:"Europe/Berlin" },
    ];

    const items = await Promise.all(cities.map(async c => {
      const wUrl = new URL("https://api.open-meteo.com/v1/forecast");
      wUrl.searchParams.set("latitude", String(c.lat));
      wUrl.searchParams.set("longitude", String(c.lon));
      wUrl.searchParams.set("temperature_unit", "fahrenheit");
      wUrl.searchParams.set("timezone", c.tz);
      wUrl.searchParams.set("current", "temperature_2m");
      wUrl.searchParams.set("forecast_days", "1");

      const w = await fetch(wUrl.toString(), { cf:{ cacheTtl: 300, cacheEverything:true } }).then(r => r.json());
      const temp = w?.current?.temperature_2m;
      const time = new Date().toLocaleTimeString("en-US", { timeZone: c.tz, hour:"2-digit", minute:"2-digit" });

      return {
        name: c.name,
        time,
        tempF: (temp!=null && isFinite(temp)) ? Math.round(temp) : null
      };
    }));

    const res = json({ ok:true, items, updatedAt:new Date().toISOString() }, 200, { "Cache-Control":"public, max-age=0" });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;

  } catch (e) {
    return json({ ok:false, error:"Cities fetch failed (" + (e?.message || e) + ")" }, 200, { "Cache-Control":"no-store" });
  }
}

function json(obj, status=200, headers={}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", ...headers }
  });
}
