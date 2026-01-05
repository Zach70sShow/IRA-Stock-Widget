export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const symbols = (url.searchParams.get("symbols") || "").trim();
  if (!symbols) {
    return new Response(JSON.stringify({ error: "Missing symbols" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  const apiKey = env.FMP_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing FMP_API_KEY env var" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }

  const cacheSeconds = 45;
  const fmpUrl = `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(symbols)}?apikey=${apiKey}`;

  const cacheKey = new Request(fmpUrl, { method: "GET" });
  const cache = caches.default;

  let resp = await cache.match(cacheKey);
  if (!resp) {
    const upstream = await fetch(fmpUrl, { cf: { cacheTtl: cacheSeconds } });
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: "Upstream failed", status: upstream.status }), {
        status: 502,
        headers: { "content-type": "application/json" }
      });
    }

    const arr = await upstream.json();
    const quotes = {};
    for (const item of arr) {
      quotes[item.symbol] = {
        price: item.price,
        change: item.change,
        changesPercentage: item.changesPercentage
      };
    }

    resp = new Response(JSON.stringify({ quotes }), {
      headers: {
        "content-type": "application/json",
        "cache-control": `public, max-age=${cacheSeconds}`
      }
    });

    await cache.put(cacheKey, resp.clone());
  }

  return resp;
}
