function parseRssTitles(xml, max = 8) {
  // Very small RSS parser: pulls <title> inside <item>
  const items = [];
  const itemMatches = xml.split("<item>").slice(1);
  for (const chunk of itemMatches) {
    const t = chunk.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i);
    const title = (t?.[1] || t?.[2] || "").trim();
    if (!title) continue;

    // Google News titles often include " - Source"
    let clean = title;
    let source = "Google News";
    const parts = title.split(" - ");
    if (parts.length >= 2) {
      clean = parts.slice(0, -1).join(" - ").trim();
      source = parts[parts.length - 1].trim() || source;
    }

    items.push({ title: clean, source });
    if (items.length >= max) break;
  }
  return items;
}

export async function onRequestGet({ request }) {
  const origin = new URL(request.url).origin;

  const spy = "SPY";
  const vxx = "VXX";
  const sectors = ["XLK","XLF","XLE","XLI","XLY","XLP"];

  // Use your existing quotes endpoint (Alpaca behind it)
  const symbols = [spy, vxx, ...sectors].join(",");
  const qRes = await fetch(`${origin}/api/quotes?symbols=${encodeURIComponent(symbols)}&t=${Date.now()}`, { cache: "no-store" });
  if (!qRes.ok) return new Response("Quotes fetch failed", { status: 502 });
  const qData = await qRes.json();
  const quotes = qData?.quotes || {};

  const pick = (sym) => {
    const q = quotes[sym];
    if (!q) return null;
    const price = Number(q.price);
    const pct = Number(q.changesPercentage);
    return (Number.isFinite(price) && Number.isFinite(pct)) ? { price, pct } : null;
  };

  const sectorList = sectors
    .map(sym => {
      const q = pick(sym);
      return q ? { sym, pct: q.pct } : null;
    })
    .filter(Boolean)
    .sort((a,b)=> (b.pct - a.pct));

  // One markets headline (Google News RSS query)
  const rssUrl =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent("marketplace business stocks S&P 500") +
    "&hl=en-US&gl=US&ceid=US:en";

  const rssRes = await fetch(rssUrl, { headers: { "user-agent": "Mozilla/5.0" } });
  const rssText = rssRes.ok ? await rssRes.text() : "";
  const rssItems = rssText ? parseRssTitles(rssText, 5) : [];
  const headline = rssItems[0] || null;

  return Response.json({
    spy: pick(spy),
    vxx: pick(vxx),
    sectors: sectorList.slice(0, 6),
    headline: headline ? { ...headline, when: "" } : null
  });
}
