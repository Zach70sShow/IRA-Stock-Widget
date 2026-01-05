export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const symbolsRaw = (url.searchParams.get("symbols") || "").trim();
  if (!symbolsRaw) {
    return new Response(JSON.stringify({ error: "Missing symbols" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  const apiKey = env.TWELVE_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing TWELVE_API_KEY env var" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }

  // Normalize symbols (remove spaces)
  const symbols = symbolsRaw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  const symbolsParam = symbols.join(",");

  const cacheSeconds = 45;
  const tdUrl =
    `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbolsParam)}&apikey=${apiKey}`;

  // Cloudflare cache
  const cache = caches.default;
  const cacheKey = new Request(tdUrl, { method: "GET" });

  let resp = await cache.match(cacheKey);
  if (!resp) {
    const upstream = await fetch(tdUrl, { cf: { cacheTtl: cacheSeconds } });
    const data = await upstream.json();

    // Twelve Data returns either:
    // - single object for 1 symbol
    // - { "AAPL": {...}, "MSFT": {...} } for many symbols (depending on plan/endpoint behavior)
    // We'll handle both.

    const quotes = {};

    // Case: error
    if (data && data.code && data.message) {
      return new Response(JSON.stringify({ error: data.message, code: data.code }), {
        status: 502,
        headers: { "content-type": "application/json" }
      });
    }

    // Case: single symbol object
    if (data && data.symbol && data.close) {
      const price = Number(data.close);
      const prevClose = Number(data.previous_close);
      const change = (isFinite(price) && isFinite(prevClose)) ? (price - prevClose) : null;
      const changesPercentage =
        (change != null && isFinite(prevClose) && prevClose !== 0) ? (change / prevClose) * 100 : null;

      quotes[data.symbol] = { price, change, changesPercentage };
    } else {
      // Case: multi symbol map
      for (const sym of symbols) {
        const q = data?.[sym];
        if (!q) continue;

        const price = Number(q.close);
        const prevClose = Number(q.previous_close);
        const change = (isFinite(price) && isFinite(prevClose)) ? (price - prevClose) : null;
        const changesPercentage =
          (change != null && isFinite(prevClose) && prevClose !== 0) ? (change / prevClose) * 100 : null;

        quotes[sym] = { price, change, changesPercentage };
      }
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
