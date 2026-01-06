// functions/api/market.js
const DEFAULTS = {
  spy: "SPY",
  volPrimary: "VXX",
  volFallback: "VIXY",
  sectors: ["XLK","XLF","XLE","XLY","XLI","XLP","XLV","XLB","XLU","XLC"],
  // Google News RSS query for Marketplace.org Business-ish coverage
  rssUrl:
    "https://news.google.com/rss/search?q=site%3Amarketplace.org%20business&hl=en-US&gl=US&ceid=US:en",
};

function pctChange(prev, last) {
  if (!isFinite(prev) || prev === 0 || !isFinite(last)) return null;
  return ((last - prev) / prev) * 100;
}

function pickBars(bars, sym) {
  const arr = bars?.[sym];
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const prev = arr[arr.length - 2]?.c;
  const last = arr[arr.length - 1]?.c;
  return { prev, last };
}

function clampStr(s, max = 120) {
  s = String(s ?? "").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

async function fetchRssHeadline(rssUrl) {
  const r = await fetch(rssUrl, {
    headers: { "accept": "application/rss+xml, application/xml, text/xml, */*" },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!r.ok) return null;

  const xml = await r.text();

  // Super-light RSS parse (good enough for title/link/source)
  const itemMatch = xml.match(/<item>[\s\S]*?<\/item>/i);
  if (!itemMatch) return null;
  const item = itemMatch[0];

  const title = (item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1]
              ?? item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
              ?? "").replace(/&#39;/g, "'").replace(/&amp;/g, "&");

  const link = item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? null;

  // Try to infer source (often appears in <source> or in title suffix)
  const source = item.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1]
              ?? "marketplace.org";

  if (!title) return null;
  return {
    title: clampStr(title, 140),
    link,
    source: clampStr(source, 40),
  };
}

async function fetchAlpacaBars({ env, symbols }) {
  const key = env.ALPACA_KEY;
  const secret = env.ALPACA_SECRET;
  if (!key || !secret) throw new Error("Missing ALPACA_KEY / ALPACA_SECRET env vars");

  const feed = env.ALPACA_FEED || "iex"; // iex works for free plans (delayed)
  const base = env.ALPACA_DATA_ENDPOINT || "https://data.alpaca.markets";

  // 2 bars = enough to compute “today %” using last close vs prev close
  const barsUrl =
    `${base}/v2/stocks/bars?timeframe=1Day&limit=2&feed=${encodeURIComponent(feed)}` +
    `&symbols=${encodeURIComponent(symbols.join(","))}`;

  const r = await fetch(barsUrl, {
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      "accept": "application/json",
    },
    cf: { cacheTtl: 15, cacheEverything: true },
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Alpaca bars failed: ${r.status} ${t.slice(0, 120)}`);
  }

  return r.json(); // { bars: { SYM: [{c:...}, {c:...}] } }
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);

    const spy = url.searchParams.get("spy") || DEFAULTS.spy;
    const volPrimary = url.searchParams.get("vol") || DEFAULTS.volPrimary;

    const symbols = [
      spy,
      volPrimary,
      DEFAULTS.volFallback,
      ...DEFAULTS.sectors,
    ];

    const alpaca = await fetchAlpacaBars({ env, symbols });
    const bars = alpaca?.bars ?? {};

    // SPY
    const spyBars = pickBars(bars, spy);
    const spyLast = spyBars?.last ?? null;
    const spyPct = spyBars ? pctChange(spyBars.prev, spyBars.last) : null;

    // VOL proxy: prefer requested (VXX) else fallback (VIXY)
    let volSym = volPrimary;
    let volBars = pickBars(bars, volSym);
    if (!volBars) {
      volSym = DEFAULTS.volFallback;
      volBars = pickBars(bars, volSym);
    }
    const volLast = volBars?.last ?? null;
    const volPct = volBars ? pctChange(volBars.prev, volBars.last) : null;

    // Sectors: build top movers list
    const sectorMoves = DEFAULTS.sectors
      .map((s) => {
        const b = pickBars(bars, s);
        const last = b?.last ?? null;
        const pct = b ? pctChange(b.prev, b.last) : null;
        return { symbol: s, last, pct };
      })
      .filter(x => x.pct != null)
      .sort((a,b) => Math.abs(b.pct) - Math.abs(a.pct))
      .slice(0, 8); // keep it readable on Edge

    // Format into 2 lines of 4 items
    const fmt = (x) => `${x.symbol} ${x.pct >= 0 ? "+" : ""}${x.pct.toFixed(2)}%`;
    const line1 = sectorMoves.slice(0,4).map(fmt).join("   •   ");
    const line2 = sectorMoves.slice(4,8).map(fmt).join("   •   ");

    // Headline
    const headline = await fetchRssHeadline(DEFAULTS.rssUrl);

    const payload = {
      ok: true,
      spy: { symbol: spy, price: spyLast, pct: spyPct },
      vol: { symbol: volSym, price: volLast, pct: volPct },
      sectors: {
        items: sectorMoves,
        lines: [line1 || "—", line2 || "—"],
      },
      headline: headline || { title: "—", source: "—", link: null },
      updatedAt: new Date().toISOString(),
    };

    return new Response(JSON.stringify(payload), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err?.message ?? err) }),
      { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
}
