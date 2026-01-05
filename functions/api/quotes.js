export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const symbolsRaw = (url.searchParams.get("symbols") || "").trim();

  if (!symbolsRaw) {
    return new Response(JSON.stringify({ error: "Missing symbols" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }

  const keyId = env.APCA_API_KEY_ID;
  const secret = env.APCA_API_SECRET_KEY;

  if (!keyId || !secret) {
    return new Response(JSON.stringify({ error: "Missing Alpaca env vars (APCA_API_KEY_ID / APCA_API_SECRET_KEY)" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }

  // Normalize symbols
  const symbols = symbolsRaw
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  // Alpaca snapshots (multi) endpoint
  // We explicitly request feed=iex to work on free plan.
  // Endpoint: https://data.alpaca.markets/v2/stocks/snapshots :contentReference[oaicite:3]{index=3}
  const feed = "iex";
  const alpacaUrl =
    `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(symbols.join(","))}&feed=${feed}`;

  // Cache to reduce calls and stay well under throttling (Alpaca throttles API) :contentReference[oaicite:4]{index=4}
  const cacheSeconds = 30;
  const cache = caches.default;
  const cacheKey = new Request(alpacaUrl, { method: "GET" });

  let resp = await cache.match(cacheKey);

  if (!resp) {
    const upstream = await fetch(alpacaUrl, {
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secret
      },
      cf: { cacheTtl: cacheSeconds }
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return new Response(JSON.stringify({
        error: "Upstream failed",
        status: upstream.status,
        body: text.slice(0, 300)
      }), {
        status: 502,
        headers: { "content-type": "application/json" }
      });
    }

    const data = await upstream.json();

    // data is a map keyed by symbol
    // Each item includes latestTrade (price) and prevDailyBar (close), etc.
    const quotes = {};

    for (const sym of symbols) {
      const snap = data?.[sym];
      if (!snap) continue;

      const price = Number(snap.latestTrade?.p ?? snap.latestQuote?.ap ?? snap.latestQuote?.bp);
      const prevClose = Number(snap.prevDailyBar?.c);

      const change =
        (isFinite(price) && isFinite(prevClose)) ? (price - prevClose) : null;

      const changesPercentage =
        (change != null && isFinite(prevClose) && prevClose !== 0)
          ? (change / prevClose) * 100
          : null;

      if (isFinite(price)) {
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
