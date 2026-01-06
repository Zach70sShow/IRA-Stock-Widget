export async function onRequestGet(ctx) {
  const url = new URL(ctx.request.url);
  const cacheKey = new Request(url.origin + url.pathname + url.search);
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    // Stooq tickers:
    // SPY: spy.us
    // VXX: vxx.us
    // Sector ETFs: xlf.us, xle.us, xlk.us, xly.us, xli.us, xlp.us, xlv.us, xlu.us
    const quotes = await Promise.all([
      stooq("spy.us"),
      stooq("vxx.us"),
      stooq("xle.us"), stooq("xlf.us"), stooq("xly.us"),
      stooq("xli.us"), stooq("xlk.us"), stooq("xlp.us")
    ]);

    const [SPY, VXX, XLE, XLF, XLY, XLI, XLK, XLP] = quotes;

    const sectors = [
      { symbol:"XLE", pct: XLE?.pct ?? null },
      { symbol:"XLF", pct: XLF?.pct ?? null },
      { symbol:"XLY", pct: XLY?.pct ?? null },
      { symbol:"XLI", pct: XLI?.pct ?? null },
      { symbol:"XLK", pct: XLK?.pct ?? null },
      { symbol:"XLP", pct: XLP?.pct ?? null },
    ];

    // Pull 1 business headline from our /api/news (cached heavily)
    const news = await fetch(new URL(url.origin + "/api/news").toString(), { cf: { cacheTtl: 600, cacheEverything: true } })
      .then(r => r.json()).catch(() => null);

    const headline = news?.items?.[0]
      ? { title: news.items[0].title, source: news.items[0].source }
      : { title: "—", source: "" };

    const payload = {
      ok: true,
      spy: { price: SPY?.price ?? null, pct: SPY?.pct ?? null },
      vxx: { price: VXX?.price ?? null, pct: VXX?.pct ?? null },
      sectors,
      headline,
      updatedAt: new Date().toISOString()
    };

    const res = json(payload, 200, { "Cache-Control":"public, max-age=0" });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;

  } catch (e) {
    return json({ ok:false, error:"Market fetch failed (" + (e?.message || e) + ")" }, 200, { "Cache-Control":"no-store" });
  }
}

async function stooq(symbol){
  // CSV: https://stooq.com/q/l/?s=spy.us&i=d
  const u = new URL("https://stooq.com/q/l/");
  u.searchParams.set("s", symbol);
  u.searchParams.set("i", "d");

  const txt = await fetch(u.toString(), { cf:{ cacheTtl: 60, cacheEverything:true } }).then(r => r.text());
  const lines = txt.trim().split(/\r?\n/);
  if (lines.length < 2) return null;

  const cols = lines[0].split(",");
  const vals = lines[1].split(",");

  const get = (k) => {
    const i = cols.indexOf(k);
    return i >= 0 ? vals[i] : null;
  };

  const close = Number(get("Close"));
  const open  = Number(get("Open"));

  // pct based on (close-open)/open
  const pct = (isFinite(close) && isFinite(open) && open !== 0)
    ? ((close - open) / open) * 100
    : null;

  return {
    price: isFinite(close) ? Number(close.toFixed(2)) : null,
    pct: isFinite(pct) ? Number(pct.toFixed(2)) : null
  };
}

function json(obj, status=200, headers={}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", ...headers }
  });
}
