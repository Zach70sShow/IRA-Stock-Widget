export async function onRequestGet(context) {
  const { request } = context;

  // Helper: cache per-URL for TTL seconds
  async function cachedJSON(cacheKey, ttlSeconds, fetcher) {
    const cache = caches.default;
    const keyReq = new Request(new URL(`/__cache/${cacheKey}`, request.url).toString());

    // Try cache first
    const cached = await cache.match(keyReq);
    if (cached) {
      const data = await cached.json();
      return { ok: true, cached: true, data };
    }

    // Fetch fresh
    try {
      const data = await fetcher();
      const resp = new Response(JSON.stringify(data), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${ttlSeconds}`,
        },
      });
      // Store in cache
      context.waitUntil(cache.put(keyReq, resp.clone()));
      return { ok: true, cached: false, data };
    } catch (e) {
      return { ok: false, cached: false, error: String(e?.message || e) };
    }
  }

  // === These are YOUR current endpoints that already exist and sometimes work ===
  // We wrap them in caching so the UI never spams them.
  const base = new URL(request.url);
  const url = (path) => new URL(path, base).toString();

  const [market, weather, news, net, cities, topstrip] = await Promise.all([
    cachedJSON("market", 60, async () => (await (await fetch(url("/api/market"), { cf: { cacheTtl: 60 } })).json())),
    cachedJSON("weather", 300, async () => (await (await fetch(url("/api/weather"), { cf: { cacheTtl: 300 } })).json())),
    cachedJSON("news", 180, async () => (await (await fetch(url("/api/news"), { cf: { cacheTtl: 180 } })).json())),
    cachedJSON("net", 120, async () => (await (await fetch(url("/api/net"), { cf: { cacheTtl: 120 } })).json())),
    cachedJSON("cities", 600, async () => (await (await fetch(url("/api/cities"), { cf: { cacheTtl: 600 } })).json())),
    cachedJSON("topstrip", 300, async () => (await (await fetch(url("/api/topstrip"), { cf: { cacheTtl: 300 } })).json())),
  ]);

  const payload = {
    ok: true,
    updatedAt: new Date().toISOString(),
    market,
    weather,
    news,
    net,
    cities,
    topstrip,
  };

  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      // prevent browser caching so you always see changes, while server caches upstream
      "Cache-Control": "no-store",
    },
  });
}
