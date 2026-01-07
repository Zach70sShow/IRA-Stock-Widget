export async function onRequestGet({ request }) {
  const url = new URL(request.url);

  const MAX_ITEMS = 140;       // total returned
  const PER_FEED_LIMIT = 12;   // cap per feed
  const TIMEOUT_MS = 6500;

  const googleNews = (q) =>
    `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

  const reddit = (sub) => `https://www.reddit.com/r/${sub}/.rss`;

  // === YOUR LOCAL AZFEEDS (as provided) ===
  const AZFAMILY_NEWS =
    "https://www.azfamily.com/arc/outboundfeeds/rss/category/news/?outputType=xml&size=50&sort=display_date:desc&summary=true";
  const AZFAMILY_POLITICS =
    "https://www.azfamily.com/arc/outboundfeeds/rss/category/politics/?outputType=xml&size=20&sort=display_date:desc&summary=true";
  const AZFAMILY_FORECAST =
    "https://www.azfamily.com/arc/outboundfeeds/rss/category/weather/forecast/?outputType=xml&size=3&sort=display_date:desc&summary=true";
  const AZFAMILY_COVERAGE =
    "https://www.azfamily.com/arc/outboundfeeds/rss/category/weather/coverage/?outputType=xml&size=3&sort=display_date:desc&summary=true";

  // You can add/remove feeds here without touching the UI.
  const FEEDS = [
    // ---- Local AZ ----
    { bucket: "Arizona", source: "AZFamily", url: AZFAMILY_NEWS },
    { bucket: "Arizona", source: "AZFamily Politics", url: AZFAMILY_POLITICS },

    // Optional: weather headlines (small feeds, fine)
    { bucket: "AZ Weather", source: "AZFamily Forecast", url: AZFAMILY_FORECAST },
    { bucket: "AZ Weather", source: "AZFamily Coverage", url: AZFAMILY_COVERAGE },

    // ---- Markets ----
    { bucket: "Markets", source: "Google News", url: googleNews("stocks OR markets OR S&P 500 OR inflation OR interest rates") },
    { bucket: "Markets", source: "Reddit r/stocks", url: reddit("stocks") },
    { bucket: "Markets", source: "Reddit r/investing", url: reddit("investing") },

    // ---- Tech ----
    { bucket: "Tech", source: "Google News", url: googleNews("technology OR AI OR OpenAI OR Apple OR Microsoft OR Nvidia") },
    { bucket: "Tech", source: "Reddit r/technology", url: reddit("technology") },

    // ---- NFL ----
    { bucket: "NFL", source: "Google News", url: googleNews("NFL OR playoff OR Super Bowl OR Arizona Cardinals") },
    { bucket: "NFL", source: "Reddit r/nfl", url: reddit("nfl") },
    { bucket: "NFL", source: "Reddit r/AZCardinals", url: reddit("AZCardinals") },

    // ---- US ----
    { bucket: "US", source: "Google News", url: googleNews("US news OR economy OR Supreme Court OR Congress") },

    // ---- Politics ----
    { bucket: "Politics", source: "Google News", url: googleNews("US politics OR White House OR Senate OR House of Representatives") },
    { bucket: "Politics", source: "Reddit r/politics", url: reddit("politics") },

    // ---- Global ----
    { bucket: "Global", source: "Google News", url: googleNews("world news OR geopolitics OR international relations") },

    // ---- Video editing ----
    { bucket: "Editing", source: "Google News", url: googleNews("video editing OR Premiere Pro OR DaVinci Resolve OR After Effects") },
    { bucket: "Editing", source: "Reddit r/videoediting", url: reddit("videoediting") },

    // ---- Gaming ----
    { bucket: "Gaming", source: "Google News", url: googleNews("video games OR gaming industry OR Steam OR Xbox OR PlayStation OR Nintendo") },
    { bucket: "Gaming", source: "Reddit r/gaming", url: reddit("gaming") },
  ];

  const withTimeout = (p, ms) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

  function decode(s) {
    return (s || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function parseFeed(xmlText, meta) {
    const xml = xmlText || "";
    const out = [];

    // RSS <item>
    const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
    for (const block of items.slice(0, PER_FEED_LIMIT)) {
      const title = decode((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").trim();
      let link = decode((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || "").trim();

      if (!link) {
        const href = (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1];
        if (href) link = href;
      }

      const pub = decode((block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] || "").trim();
      const iso = pub ? safeISO(pub) : null;

      if (!title || !link) continue;
      out.push({ title, url: link, publishedAt: iso, source: meta.source, bucket: meta.bucket });
    }

    // Atom <entry>
    const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
    for (const block of entries.slice(0, PER_FEED_LIMIT)) {
      const title = decode((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").trim();

      let link = (block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i) || [])[1];
      if (!link) link = (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1];

      const upd = decode((block.match(/<(updated|published)[^>]*>([\s\S]*?)<\/(updated|published)>/i) || [])[2] || "").trim();
      const iso = upd ? safeISO(upd) : null;

      if (!title || !link) continue;
      out.push({ title, url: decode(link), publishedAt: iso, source: meta.source, bucket: meta.bucket });
    }

    return out;
  }

  function safeISO(s) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }

  function normalizeUrl(u) {
    try {
      const x = new URL(u);
      // strip common tracking params
      ["utm_source","utm_medium","utm_campaign","utm_term","utm_content"].forEach(p => x.searchParams.delete(p));
      return x.toString();
    } catch { return u; }
  }

  function keyFor(it) {
    return (it.url || it.title || "").toLowerCase().slice(0, 500);
  }

  // Fetch all feeds
  const results = await Promise.allSettled(
    FEEDS.map(async (f) => {
      const res = await withTimeout(fetch(f.url, {
        headers: {
          "User-Agent": "EdgeHeadlines/1.0 (+Cloudflare Pages)",
          "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        }
      }), TIMEOUT_MS);

      if (!res.ok) throw new Error(`feed ${res.status}`);
      const text = await res.text();
      return parseFeed(text, f);
    })
  );

  let items = [];
  for (const r of results) {
    if (r.status === "fulfilled") items = items.concat(r.value);
  }

  items = items.map(x => ({ ...x, url: normalizeUrl(x.url) }));

  // Deduplicate
  const seen = new Set();
  const deduped = [];
  for (const it of items) {
    const k = keyFor(it);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(it);
  }

  // Sort newest first; unknown dates last
  deduped.sort((a,b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });

  const limited = deduped.slice(0, MAX_ITEMS);

  return new Response(JSON.stringify({
    ok: true,
    updatedAt: new Date().toISOString(),
    count: limited.length,
    items: limited
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Helps avoid hammering feeds when the Edge refreshes often
      "cache-control": "s-maxage=180, stale-while-revalidate=600",
    }
  });
}
