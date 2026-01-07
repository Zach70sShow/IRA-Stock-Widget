export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get("limit"), 1, 60, 30);

  // Toggle sources (defaults ON)
  const includeReddit = (url.searchParams.get("reddit") ?? "1") !== "0";

  // ---- SOURCES (RSS first; Reddit is JSON) ----
  const SOURCES = [
    // AZ Family (user-provided)
    {
      id: "azfamily_news",
      label: "AZFamily News",
      tag: "AZ",
      type: "rss",
      url: "https://www.azfamily.com/arc/outboundfeeds/rss/category/news/?outputType=xml&size=50&sort=display_date:desc&summary=true",
    },
    {
      id: "azfamily_politics",
      label: "AZFamily Politics",
      tag: "US • Politics",
      type: "rss",
      url: "https://www.azfamily.com/arc/outboundfeeds/rss/category/politics/?outputType=xml&size=20&sort=display_date:desc&summary=true",
    },
    {
      id: "azfamily_forecast",
      label: "AZFamily Forecast",
      tag: "AZ • Weather",
      type: "rss",
      url: "https://www.azfamily.com/arc/outboundfeeds/rss/category/weather/forecast/?outputType=xml&size=3&sort=display_date:desc&summary=true",
    },
    // Tech
    { id: "verge", label: "The Verge", tag: "Tech", type: "rss", url: "https://www.theverge.com/rss/index.xml" },
    { id: "arstechnica", label: "Ars Technica", tag: "Tech", type: "rss", url: "https://feeds.arstechnica.com/arstechnica/index" },

    // Markets
    { id: "marketwatch", label: "MarketWatch", tag: "Markets", type: "rss", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
    { id: "yahoo_finance", label: "Yahoo Finance", tag: "Markets", type: "rss", url: "https://finance.yahoo.com/news/rssindex" },

    // World / US
    { id: "reuters_world", label: "Reuters (World)", tag: "World", type: "rss", url: "https://www.reuters.com/world/rss" },
    { id: "ap_top", label: "AP News", tag: "US", type: "rss", url: "https://apnews.com/hub/ap-top-news?output=rss" },

    // Gaming
    { id: "ign", label: "IGN", tag: "Gaming", type: "rss", url: "https://feeds.ign.com/ign/all" },
    { id: "pcgamer", label: "PC Gamer", tag: "Gaming", type: "rss", url: "https://www.pcgamer.com/rss/" },

    // Video editing / creative (lightweight)
    { id: "adobe_blog", label: "Adobe Blog", tag: "Editing", type: "rss", url: "https://blog.adobe.com/en/rss.xml" },
  ];

  const REDDIT_SOURCES = [
    { id: "r_investing", label: "Reddit r/investing", tag: "Markets", type: "reddit", subreddit: "investing" },
    { id: "r_stockmarket", label: "Reddit r/StockMarket", tag: "Markets", type: "reddit", subreddit: "StockMarket" },
    { id: "r_technology", label: "Reddit r/technology", tag: "Tech", type: "reddit", subreddit: "technology" },
    { id: "r_nfl", label: "Reddit r/nfl", tag: "NFL", type: "reddit", subreddit: "nfl" },
    { id: "r_games", label: "Reddit r/Games", tag: "Gaming", type: "reddit", subreddit: "Games" },
    { id: "r_videoediting", label: "Reddit r/videoediting", tag: "Editing", type: "reddit", subreddit: "videoediting" },
    { id: "r_arizona", label: "Reddit r/arizona", tag: "AZ", type: "reddit", subreddit: "arizona" },
  ];

  const activeSources = [
    ...SOURCES,
    ...(includeReddit ? REDDIT_SOURCES : []),
  ];

  // Fetch in parallel (best-effort)
  const results = await Promise.allSettled(activeSources.map(src => fetchSource(src)));

  // Flatten + clean
  let items = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value?.length) items.push(...r.value);
  }

  // De-dupe by URL
  const seen = new Set();
  items = items.filter(it => {
    const key = (it.url || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort newest first if we have dates
  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  // Limit final
  items = items.slice(0, limit);

  return json(
    {
      ok: true,
      generatedAt: new Date().toISOString(),
      count: items.length,
      items,
    },
    200,
    {
      "cache-control": "s-maxage=120, stale-while-revalidate=600",
      "access-control-allow-origin": "*",
    }
  );
}

// ---------------- helpers ----------------

async function fetchSource(src) {
  if (src.type === "rss") return fetchRSS(src);
  if (src.type === "reddit") return fetchReddit(src);
  return [];
}

async function fetchRSS(src) {
  const r = await fetch(src.url, {
    headers: {
      "User-Agent": "EdgeHeadlines/1.0 (+Cloudflare Pages)",
      "Accept": "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
    },
  });

  if (!r.ok) return [];
  const xml = await r.text();
  return parseRSS(xml, src);
}

async function fetchReddit(src) {
  const url = `https://www.reddit.com/r/${encodeURIComponent(src.subreddit)}/hot.json?limit=15`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "EdgeHeadlines/1.0 (+Cloudflare Pages)",
      "Accept": "application/json",
    },
  });

  if (!r.ok) return [];
  const data = await r.json();

  const children = data?.data?.children || [];
  const out = [];
  for (const c of children) {
    const p = c?.data;
    if (!p) continue;
    if (p.stickied) continue;
    if (!p.title) continue;

    const permalink = p.permalink ? `https://www.reddit.com${p.permalink}` : null;
    out.push({
      sourceId: src.id,
      source: src.label,
      tag: src.tag,
      title: String(p.title),
      url: permalink,
      ts: typeof p.created_utc === "number" ? Math.floor(p.created_utc * 1000) : 0,
    });
  }
  return out;
}

function parseRSS(xml, src) {
  // SUPER lightweight RSS/Atom parsing via regex (fine for “headlines-only”)
  // Handles <item>...</item> and <entry>...</entry>
  const items = [];

  const blocks = [
    ...matchAll(xml, /<item\b[\s\S]*?<\/item>/gi),
    ...matchAll(xml, /<entry\b[\s\S]*?<\/entry>/gi),
  ];

  for (const b of blocks) {
    const title = textFromTag(b, "title") || "";
    if (!title) continue;

    // RSS: <link>url</link>
    // Atom: <link href="..."/>
    const linkTag = firstMatch(b, /<link\b[^>]*?>[\s\S]*?<\/link>/i);
    let url = linkTag ? stripCdata(textContent(linkTag)) : "";
    if (!url) {
      const href = attrFromTag(b, "link", "href");
      if (href) url = href;
    }

    const pub =
      textFromTag(b, "pubDate") ||
      textFromTag(b, "published") ||
      textFromTag(b, "updated") ||
      "";

    const ts = pub ? Date.parse(pub) || 0 : 0;

    items.push({
      sourceId: src.id,
      source: src.label,
      tag: src.tag,
      title: cleanText(title),
      url: cleanText(url),
      ts,
    });
  }

  return items;
}

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function clampInt(v, min, max, def) {
  const n = parseInt(String(v ?? ""), 10);
  if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
  return def;
}

function cleanText(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function stripCdata(s) {
  return String(s || "").replace(/^<!\[CDATA\[(.*)\]\]>$/s, "$1").trim();
}

function textFromTag(block, tag) {
  const m = firstMatch(block, new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  return cleanText(stripCdata(m[1]));
}

function textContent(tagHtml) {
  const m = /<[^>]+>([\s\S]*?)<\/[^>]+>/.exec(tagHtml);
  return m ? m[1] : "";
}

function attrFromTag(block, tag, attr) {
  const m = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]+)"[^>]*\\/?>`, "i").exec(block);
  return m ? cleanText(m[1]) : "";
}

function firstMatch(text, re) {
  const m = re.exec(text);
  return m ? m : null;
}

function matchAll(text, re) {
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push(m[0]);
  return out;
}
