export async function onRequest({ request, env, ctx }) {
  const url = new URL(request.url);

  // If you already use fixed Phoenix coords, you can hardcode them here.
  // Otherwise allow lat/lon from query params.
  const lat = Number(url.searchParams.get("lat") ?? 33.4484);
  const lon = Number(url.searchParams.get("lon") ?? -112.074);

  // ---- CACHE KEY (same request = same cache) ----
  const cacheKey = new Request(
    `${url.origin}/api/weather?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`,
    { method: "GET" }
  );

  // 1) Try cache first
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  // 2) If not cached, fetch upstream
  const upstream = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;

  const r = await fetch(upstream, {
    headers: { "accept": "application/json" }
  });

  if (!r.ok) {
    // Pass through upstream errors (429 etc)
    return new Response(JSON.stringify({
      ok: false,
      error: `Weather fetch failed (${r.status})`
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  const raw = await r.json();

  // Shape the response into a small JSON your UI can use
  const data = {
    ok: true,
    now: {
      temp: raw?.current?.temperature_2m ?? null,
      wind: raw?.current?.wind_speed_10m ?? null
    },
    tomorrow: {
      high: raw?.daily?.temperature_2m_max?.[1] ?? null,
      low: raw?.daily?.temperature_2m_min?.[1] ?? null
    },
    sun: {
      sunrise: raw?.daily?.sunrise?.[0] ?? null,
      sunset: raw?.daily?.sunset?.[0] ?? null
    },
    updatedAt: new Date().toISOString()
  };

  const response = new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
      // 60s cache inside Cloudflare
      "cache-control": "public, max-age=60"
    }
  });

  // 3) Save into Cloudflare cache (happens in the background)
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));

  return response;
}
